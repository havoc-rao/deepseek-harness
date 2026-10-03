/** Shared sent/queued text assembly; reference providers own their reactive display data. */
import { projectUserText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UserTextProps } from '../contract/slots.ts'

/**
 * Render user text with the reference chain ahead of the built-in file/skill chip.
 * @param props - plain occurrence inputs and the authorized reference outlet.
 * @returns inline text and reference nodes without altering logged text.
 */
export function UserText({ text, sessionLabels = [], slashNames = [], slashKind = 'skill', references, renderSlotChain }: UserTextProps) {
  return projectUserText(text, sessionLabels, slashNames, slashKind, references,
    (token, fallback) => renderSlotChain('conversation.message.reference', { token }, { fallback }))
}
