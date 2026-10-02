/** Replicate dsh-better-sidebar's seat structure against the vendored cordis build. */
import { Context } from './vendor/cordis/lib/index.js'

const ctx = new Context()
let registered = 0
let unregistered = 0
ctx.provide('svc', {
  register(): () => void {
    registered++
    return () => { unregistered++ }
  },
})

const fiber = ctx.plugin({
  name: 'seat-holder',
  apply(inner: Context): unknown {
    inner.effect(() => {
      const seat = inner.inject(['svc'], (seatCtx) => {
        const disposers: Array<() => void> = []
        disposers.push(seatCtx.get('svc')!.register())
        return () => { for (const d of disposers) d() }
      })
      return () => { void seat.dispose() }
    }, 'holder: registrations')
    return undefined
  },
})

await fiber
await new Promise((resolve) => setTimeout(resolve, 10))
console.log('after activate: registered =', registered, 'unregistered =', unregistered)
await fiber.dispose()
await new Promise((resolve) => setTimeout(resolve, 100))
console.log('after dispose+100ms: registered =', registered, 'unregistered =', unregistered)
