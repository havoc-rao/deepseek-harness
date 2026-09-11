/**
 * The Tool image gallery slot, declared by the row surface that renders it:
 * durable images of a settled image-bearing Tool call, filled by the
 * attachment presentation plugin. The Tool layer never imports an attachment
 * implementation: a toolview declares this slot as a child and renders it with
 * the image card's references plus the session-authorized loader it received
 * in its owner, and the attachment plugin fills the gallery. Composing no
 * attachment presentation plugin renders nothing, which is why the image card
 * keeps its own envelope text beside the gallery. A child slot is declared by
 * exactly one entry: registering a second toolview that declares the same
 * child throws at load, so a future image-bearing tool must reuse this entry
 * or own a distinct slot.
 */
import type { MessageImageLoader, MessageImageSource } from '@deepseek-ai/dsh-client-ui-conversation/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'tool.call.images': { kind: 'single'; scope: 'session'; owner: ToolImagesOwnerProps }
  }
}

/** Owner currency of the Tool image gallery slot: references plus the loader. */
export interface ToolImagesOwnerProps {
  /** Durable references or submission-echo previews in result order. */
  images: readonly MessageImageSource[]
  /** Session-authorized image URL loader for the durable arm. */
  loadImage: MessageImageLoader
  /** Horizontal placement inside the owning record. */
  align: 'start' | 'end'
}
