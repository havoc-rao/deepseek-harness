/** Loopback OTLP collector using the installed exporter's protobuf reader. */
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

interface Reader {
  readonly pos: number
  isAtEnd(): boolean
  readTag(): { fieldNumber: number; wireType: number }
  readBytes(): Uint8Array
  readString(): string
  readVarint(): number
  skip(wireType: number): void
}
// The declared trace exporter depends on otlp-transformer. Version 0.220 has no
// generated root; its maintained reader decodes tags/bytes. Field maps below follow
// trace/protobuf/trace-serializer.js, metrics/protobuf/metrics-serializer.js, and
// common/protobuf/common-serializer.js. Fixed64 times stay bigint; numeric metrics are skipped.
const require = createRequire(import.meta.url)
const exporterRequire = createRequire(require.resolve('@opentelemetry/exporter-trace-otlp-proto'))
const transformer = dirname(exporterRequire.resolve('@opentelemetry/otlp-transformer'))
const { ProtobufReader } = exporterRequire(join(transformer, 'common/protobuf/protobuf-reader.js')) as {
  ProtobufReader: new (bytes: Uint8Array) => Reader
}
type Field = string | number | bigint | Uint8Array
function fields(bytes: Uint8Array): Map<number, Field[]> {
  const reader = new ProtobufReader(bytes)
  const result = new Map<number, Field[]>()
  while (!reader.isAtEnd()) {
    const { fieldNumber, wireType } = reader.readTag()
    if (wireType !== 0 && wireType !== 1 && wireType !== 2) { reader.skip(wireType); continue }
    let value: Field
    if (wireType === 1) {
      value = new DataView(bytes.buffer, bytes.byteOffset + reader.pos, 8).getBigUint64(0, true)
      reader.skip(wireType)
    } else value = wireType === 0 ? reader.readVarint() : reader.readBytes()
    result.set(fieldNumber, [...(result.get(fieldNumber) ?? []), value])
  }
  return result
}
function messages(message: Map<number, Field[]>, key: number) {
  return (message.get(key) ?? []).map((value) => {
    if (!(value instanceof Uint8Array)) throw new Error('Expected protobuf message')
    return fields(value)
  })
}
function text(message: Map<number, Field[]>, key: number) {
  const value = message.get(key)?.[0]
  return value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : ''
}
function hex(message: Map<number, Field[]>, key: number) {
  const value = message.get(key)?.[0]
  return value instanceof Uint8Array ? Buffer.from(value).toString('hex') : ''
}
function attributes(message: Map<number, Field[]>, key: number) {
  return Object.fromEntries(messages(message, key).map(item => [text(item, 1), text(messages(item, 2)[0]!, 1)]))
}
/**
 * Decode selected request fields emitted by the installed OTel trace encoder.
 * @param bytes - Complete HTTP/protobuf trace request.
 * @returns Span identifiers, ownership, resource, status, and event/link counts.
 */
export function decodeTraces(bytes: Uint8Array) {
  return messages(fields(bytes), 1).flatMap(resource => messages(resource, 2).flatMap(scope =>
    messages(scope, 2).map(span => ({
      name: text(span, 5), traceId: hex(span, 1), spanId: hex(span, 2), parentSpanId: hex(span, 4),
      kind: span.get(6)?.[0], attributes: attributes(span, 9),
      startTimeUnixNano: span.get(7)?.[0], endTimeUnixNano: span.get(8)?.[0],
      scope: text(messages(scope, 1)[0]!, 1), resource: attributes(messages(resource, 1)[0]!, 1),
      events: messages(span, 11).length, links: messages(span, 13).length,
      statusMessage: text(messages(span, 15)[0]!, 2), status: messages(span, 15)[0]!.get(3)?.[0],
    }))))
}
/**
 * Decode metric names and point attributes from the installed OTel metric encoder.
 * @param bytes - Complete HTTP/protobuf metric request.
 * @returns Metric names, ownership, resources, and count/histogram attributes.
 */
export function decodeMetrics(bytes: Uint8Array) {
  return messages(fields(bytes), 1).flatMap(resource => messages(resource, 2).flatMap(scope =>
    messages(scope, 2).map(metric => ({
      name: text(metric, 1), scope: text(messages(scope, 1)[0]!, 1),
      resource: attributes(messages(resource, 1)[0]!, 1),
      attributes: [...messages(metric, 7).flatMap(data => messages(data, 1).map(point => attributes(point, 7))),
        ...messages(metric, 9).flatMap(data => messages(data, 1).map(point => attributes(point, 9)))],
    }))))
}
/**
 * Bind an isolated collector and retain complete request bytes until awaited close.
 * @returns Requests, ephemeral loopback endpoint, and an awaited server disposer.
 */
export async function otlpWireCollector() {
  const requests: { path: string; contentType: string | undefined; bytes: Buffer }[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      requests.push({ path: request.url!, contentType: request.headers['content-type'], bytes: Buffer.concat(chunks) })
      response.writeHead(200, { 'content-type': 'application/x-protobuf' }).end()
    })
  })
  const close = () => new Promise<void>((resolve, reject) => server.close((error) => {
    if (error) reject(error)
    else resolve()
  }))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected loopback TCP address')
  return { requests, endpoint: `http://127.0.0.1:${address.port}`, close }
}
