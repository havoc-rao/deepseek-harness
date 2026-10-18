/** Shared user-text entry delegates matching and reference presentation to the Conversation text Factory. */
import type { UserTextProps } from '../contract/slots.ts'

/**
 * Render sent or queued text with the registered business matchers and reference chain.
 * @param props - original text, confirmed reference facts, and the Factory renderer.
 * @returns the shared inline text presentation without altering logged text.
 */
export function UserText({ text, sessionLabels = [], slashNames = [], slashKind = 'skill', references, renderFactorySlot }: UserTextProps) {
  return renderFactorySlot('conversation.user.text', {
    text,
    facts: {
      sessionLabels,
      ...(slashKind === 'skill' ? { skillNames: slashNames } : {
        commands: slashNames.flatMap(name => text.startsWith(`/${name}`)
          && (text.length === name.length + 1 || /\s/u.test(text.slice(name.length + 1, name.length + 2)))
          ? [{ start: 0, end: name.length + 1, name }] : []),
      }),
    },
    interactive: references !== undefined,
  })
}
