/** An external reference presenter loaded through the shipped browser composition. */
window.__ModuleLoader__.load({
  id: '@fixture/reference-chain',
  factory(require) {
    const React = require('react')
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.message.reference', () => ctx.slots.register({
          name: 'conversation.message.reference',
          select: ({ token }) => token === '@external/opaque' || token === `@external/${'a'.repeat(250)}`
            ? 'External project' : null,
        }, ({ matched }) => React.createElement('span', { 'data-external-reference': true }, matched)))
      },
    }
  },
})
