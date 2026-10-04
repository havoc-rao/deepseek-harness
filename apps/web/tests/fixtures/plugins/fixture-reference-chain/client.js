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
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left', id: 'reference-insertion',
        }, ({ inputActions }) => React.createElement('div', {
          tabIndex: 0, 'data-reference-drop-target': true,
          onDragOver: event => { event.preventDefault() },
          onDrop: event => {
            const ref = event.dataTransfer.getData('application/x-reference-chain')
            if (ref !== '@external/opaque') return
            event.preventDefault()
            event.stopPropagation()
            if (inputActions.insertReference({
              source: 'reference', ref, label: 'External project',
              appearance: 'folder', clipboardText: ref,
            }, inputActions.captureInsertion())) inputActions.focus()
          },
        }, 'Drop reference')))
      },
    }
  },
})
