/** Browser caller for generic Connection unary RPC channels. */

import {
  RpcId,
  type ClientRequest,
  type RpcId as RpcIdType,
} from '../rpc.ts'
import type { ClientConnectionRpc, ConnectionRpcResult, ConnectionRpcObserver, ConnectionRpcObservation } from '../rpc.ts'
import { randomUuid } from './random-uuid.ts'

const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

/**
 * Transport this caller posts through; same signature as the global `fetch`.
 * Receives the document-relative route so a carrier resolves it against its own base.
 */
export type RpcFetch = (input: string | URL, init: RequestInit) => Promise<Response>

/** Worker-local opener for decoded Gateway Remote streams; `uplink` carries the Client's items for the stream. */
export type RpcStreamOpen = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
  uplink?: AsyncIterable<unknown>,
) => AsyncIterable<unknown>

/**
 * Create the browser-backed generic RPC caller.
 * @param doFetch - transport override; defaults to the page's global fetch.
 * @param openStream - optional worker-local Gateway stream carrier.
 * @returns caller that owns request correlation and response-envelope validation.
 */
export function createWebConnectionRpc(doFetch?: RpcFetch, openStream?: RpcStreamOpen): ClientConnectionRpc {
  const send: RpcFetch = doFetch ?? ((input, init) => globalThis.fetch(input, init))
  const observers = new Set<ConnectionRpcObserver>()
  const select = (channel: string, endpoint: string, payload: unknown): ConnectionRpcObservation | undefined => {
    for (const observer of observers) {
      try {
        const selected = observer(channel, endpoint, payload)
        if (selected !== undefined) return selected
      } catch (error: unknown) { void error }
    }
    return undefined
  }
  return {
    observeCalls(observer) {
      observers.add(observer)
      return () => { observers.delete(observer) }
    },
    runObservedResult(channel, endpoint, payload, decode) {
      return measureSync(select(channel, endpoint, payload), 'client.resultCodecDecode', decode)
    },
    async call(channel, endpoint, payload, signal) {
      assertTarget(channel, endpoint)
      const observation = select(channel, endpoint, payload)
      const measure = async <T>(phase: Parameters<ConnectionRpcObservation>[0], callback: () => T | Promise<T>): Promise<T> => {
        if (observation === undefined) return callback()
        const start = performance.now()
        let outcome: Parameters<ConnectionRpcObservation>[3] = 'success'
        try { return await callback() } catch (error: unknown) {
          outcome = signal?.aborted ? 'cancelled' : 'error'
          throw error
        } finally {
          try { observation(phase, start, performance.now(), outcome) } catch (error: unknown) { void error }
        }
      }
      const rpcId = RpcId(randomUuid())
      const message: ClientRequest = {
        type: 'client-request',
        rpcId,
        method: endpoint,
        payload,
      }
      // The channel key is absolute; a page posts the document-relative form, and
      // a carrier that resolves against the Host root accepts the same form.
      const route = `${channel}/${endpoint}`.slice(1)
      const body = observation === undefined ? JSON.stringify(message)
        : await measure('client.requestEncode', () => JSON.stringify(message))
      const request: RequestInit = {
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
        ...signal === undefined ? {} : { signal },
      }
      const response = await (observation === undefined ? send(route, request)
        : measure('client.fetchHeaders', () => send(route, request)))
      if (!response.ok) {
        throw new Error(`transport failure for ${channel}/${endpoint}: HTTP ${response.status}`)
      }
      const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      const decode = async () => {
        if (mediaType === 'multipart/form-data') {
          return parseBinaryResponse(response, observation === undefined ? undefined : { observation, measure, signal })
        }
        if (observation === undefined) return parseConnectionResponse(await response.json())
        const text = await measure('client.responseBodyRead', () => response.text())
        return measureSync(observation, 'client.responseEnvelopeParse', () => {
          const value: unknown = JSON.parse(text)
          return parseConnectionResponse(value)
        }, signal)
      }
      const full = await (observation === undefined ? decode() : measure('client.responseDecode', decode))
      signal?.throwIfAborted()
      if (full.rpcId !== rpcId) {
        throw new Error(`rpcId mismatch for ${endpoint}: sent ${rpcId}, got ${full.rpcId}`)
      }
      return full.result
    },
    ...openStream === undefined ? {} : {
      open(channel, endpoint, payload, signal, uplink) {
        assertTarget(channel, endpoint)
        if (channel !== '/api') {
          throw new Error(`connection: worker-local streams require the /api channel, got ${JSON.stringify(channel)}`)
        }
        return openStream(endpoint, payload, signal, uplink)
      },
    },
  }
}

type ObservationPhase = Parameters<ConnectionRpcObservation>[0]
interface DecodeObservation {
  readonly observation: ConnectionRpcObservation
  readonly measure: <T>(phase: ObservationPhase, callback: () => T | Promise<T>) => Promise<T>
  readonly signal: AbortSignal | undefined
}

function measureSync<T>(observation: ConnectionRpcObservation | undefined, phase: ObservationPhase,
  callback: () => T, signal?: AbortSignal): T {
  if (observation === undefined) return callback()
  const started = performance.now()
  let outcome: Parameters<ConnectionRpcObservation>[3] = 'success'
  try { return callback() } catch (error: unknown) {
    outcome = signal?.aborted ? 'cancelled' : 'error'
    throw error
  } finally {
    try { observation(phase, started, performance.now(), outcome) } catch (error: unknown) { void error }
  }
}

async function parseBinaryResponse(response: Response, observed?: DecodeObservation): Promise<ReturnType<typeof parseConnectionResponse>> {
  const body = await (observed === undefined ? response.formData()
    : observed.measure('client.responseFormData', () => response.formData()))
  const prepare = () => {
    const fields = new Map<string, string | Blob>()
    for (const [name, value] of body) {
      if (fields.has(name)) throw new TypeError('connection: invalid binary response fields')
      fields.set(name, value)
    }
    const metadata = fields.get('metadata')
    fields.delete('metadata')
    if (typeof metadata !== 'string') {
      throw new TypeError('connection: invalid binary response fields')
    }
    const envelope: unknown = JSON.parse(metadata)
    const full = parseConnectionResponse(envelope)
    if (!full.result.ok || !isRecord(envelope) || !Array.isArray(envelope.attachments) || envelope.attachments.length === 0) {
      throw new TypeError('connection: invalid binary response result')
    }
    return { fields, rpcId: full.rpcId, value: full.result.value, attachments: envelope.attachments }
  }
  const { fields, rpcId, value, attachments } = measureSync(observed?.observation, 'client.responseEnvelopeParse', prepare, observed?.signal)
  const readBinary = async () => {
    const root = { value }
    for (const attachment of attachments) {
      if (!isRecord(attachment) || attachment.codec !== 'bytes' || typeof attachment.part !== 'string'
      || !Array.isArray(attachment.path)) {
        throw new TypeError('connection: invalid binary response attachment')
      }
      const data = fields.get(attachment.part)
      fields.delete(attachment.part)
      if (!(data instanceof Blob)) {
        throw new TypeError('connection: invalid binary response fields')
      }
      let parent: object = root
      let key: string | number = 'value'
      for (const segment of attachment.path) {
        const value: unknown = Reflect.get(parent, key)
        if (typeof value !== 'object' || value === null) {
          throw new TypeError('connection: invalid binary response path')
        }
        if (Array.isArray(value)) {
          if (typeof segment !== 'number' || !Number.isSafeInteger(segment) || segment < 0 || segment >= value.length) {
            throw new TypeError('connection: invalid binary response path')
          }
        } else if (typeof segment !== 'string') {
          throw new TypeError('connection: invalid binary response path')
        }
        if (!Object.hasOwn(value, segment)) throw new TypeError('connection: invalid binary response path')
        parent = value
        key = segment
      }
      if (Reflect.get(parent, key) !== null) throw new TypeError('connection: invalid binary response placeholder')
      Object.defineProperty(parent, key, {
        value: new Uint8Array(await data.arrayBuffer()), enumerable: true, writable: true, configurable: true,
      })
    }
    if (fields.size !== 0) throw new TypeError('connection: invalid binary response fields')
    return {
      rpcId,
      result: { ok: true as const, value: root.value },
    }
  }
  return observed === undefined ? readBinary() : observed.measure('client.responseBinaryRead', readBinary)
}

function parseConnectionResponse(value: unknown): {
  readonly rpcId: RpcIdType
  readonly result: ConnectionRpcResult<unknown>
} {
  if (!isRecord(value) || value.type !== 'server-response' || typeof value.rpcId !== 'string') {
    throw new TypeError('connection: invalid server-response envelope')
  }
  const result = value.result
  if (!isRecord(result)) throw new TypeError('connection: invalid server-response result')
  if (result.ok === true) {
    return {
      rpcId: RpcId(value.rpcId),
      result: { ok: true, value: result.value },
    }
  }
  if (result.ok !== false || !isRecord(result.error)) {
    throw new TypeError('connection: invalid server-response result')
  }
  const error = result.error
  if (typeof error.code !== 'string' || typeof error.message !== 'string' || !isRecord(error.details)) {
    throw new TypeError('connection: invalid server-response failure')
  }
  return {
    rpcId: RpcId(value.rpcId),
    result: {
      ok: false,
      error: { code: error.code, message: error.message, details: error.details },
    },
  }
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertTarget(channel: string, endpoint: string): void {
  const segments = endpoint.split('/')
  if (!CHANNEL_PATTERN.test(channel)
    || segments.some(segment =>
      segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    throw new Error(`connection: invalid RPC target ${JSON.stringify(`${channel}/${endpoint}`)}`)
  }
}
