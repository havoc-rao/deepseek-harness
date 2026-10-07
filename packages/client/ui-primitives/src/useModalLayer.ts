/** Shared modal keyboard ownership and focus lifetime. */
import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { observeComposition } from './keyboard-composition.ts'
import { focusWithoutRing } from './focus.ts'

/** Dialog and menu elements whose document order determines foreground shortcut ownership. */
export const modalSelector = '[role="dialog"][aria-modal="true"], [role="menu"]'

const layers = new WeakMap<Document, { element: HTMLElement; close: () => void }[]>()
const eventLayers = new WeakMap<Event, Element | null>()
const captures = new WeakMap<Document, (event: KeyboardEvent) => void>()

function foreground(document: Document, event?: Event): Element | null {
  if (event !== undefined) {
    const cached = eventLayers.get(event)
    if (cached !== undefined) return cached
  }
  const top = [...document.querySelectorAll(modalSelector)]
    .filter(element => !element.closest('[hidden], [inert], [aria-hidden="true"]')).at(-1) ?? null
  if (event !== undefined) eventLayers.set(event, top)
  return top
}

/**
 * Request closure of the foreground registered modal using its current onClose callback.
 * A newer menu or unregistered dialog blocks dismissal of the modal behind it.
 * @param document - product document whose modal owns the close command.
 */
export function closeTopModal(document: Document): void {
  const top = foreground(document)
  const layer = layers.get(document)?.find(candidate => candidate.element === top)
  layer?.close()
}
/**
 * Whether an anchor belongs behind the current modal and must yield keyboard input.
 * @param anchor - local control owning the input handler.
 * @param event - native input event; its foreground remains fixed even after a layer closes.
 * @returns true when another modal or menu owns the foreground.
 */
export function isBehindModal(anchor: HTMLElement | null, event?: Event): boolean {
  if (anchor === null) return false
  // Legacy local-menu callers pass their trigger, outside the portaled menu.
  // Without an event, only dialogs block that trigger; event-aware consumers
  // arbitrate against the complete foreground, including menus.
  const top = event === undefined
    ? [...anchor.ownerDocument.querySelectorAll('[role="dialog"][aria-modal="true"]')].at(-1) ?? null
    : foreground(anchor.ownerDocument, event)
  return top !== null && !top.contains(anchor)
}

const focusable = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'

/**
 * Give only the top modal Escape and Tab ownership, then restore its previous focus.
 * Automatic entry and return focus omit outlines; keyboard traversal retains its indicators.
 * Controls mounted with the dialog use data-modal-autofocus for initial focus;
 * React autoFocus runs before this layer can capture the invoking control.
 * Local menus handle their Escape during capture before this bubble listener.
 * @param dialog - mounted dialog element.
 * @param open - whether this layer is active.
 * @param onClose - application close action.
 * @param onEscape - top-layer Escape action; defaults to closing the dialog.
 */
export function useModalLayer(dialog: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, onEscape = onClose): void {
  const close = useRef(onClose)
  close.current = onClose
  const escape = useRef(onEscape)
  escape.current = onEscape
  useLayoutEffect(() => {
    const element = dialog.current
    if (!open || element === null) return
    const document = element.ownerDocument
    const composition = observeComposition(document)
    const previous = document.activeElement
    const stack = layers.get(document) ?? []
    layers.set(document, stack)
    const layer = { element, close: () => { close.current() } }
    stack.push(layer)
    // Snapshot ownership before React handlers can close a portal or restore focus.
    const capture = (event: KeyboardEvent): void => { foreground(document, event) }
    if (stack.length === 1) {
      captures.set(document, capture)
      document.defaultView?.addEventListener('keydown', capture, true)
    }
    const initial = element.querySelector<HTMLElement>('[data-modal-autofocus]')
      ?? element.querySelector<HTMLElement>(focusable) ?? element
    if (!element.contains(document.activeElement)) focusWithoutRing(initial)
    const keydown = (event: KeyboardEvent): void => {
      if (isBehindModal(element, event) || event.defaultPrevented
        || event.ctrlKey || event.altKey || event.metaKey) return
      const composing = composition.guards(event)
      if (event.key === 'Escape' && !event.shiftKey) {
        // Consume before invoking the owner: it may synchronously unmount this
        // layer and return focus to a still-pending approval underneath.
        if (!composing) event.preventDefault()
        event.stopPropagation()
        if (!composing && !event.repeat) escape.current()
      }
      if (composing) return
      if (event.key !== 'Tab') return
      // Portaled menus own their traversal while they contain focus.
      if (document.activeElement?.closest('[role="menu"]')) return
      const items = [...element.querySelectorAll<HTMLElement>(focusable)]
        .filter(item => !item.closest('[inert], [hidden]'))
      const first = items[0] ?? element
      const last = items.at(-1) ?? element
      const atEdge = event.shiftKey ? document.activeElement === first : document.activeElement === last
      if (document.activeElement === element || !element.contains(document.activeElement) || atEdge) {
        event.preventDefault()
        const target = event.shiftKey ? last : first
        target.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      composition.dispose()
      const wasTop = stack.at(-1) === layer
      stack.splice(stack.indexOf(layer), 1)
      document.removeEventListener('keydown', keydown)
      if (stack.length === 0) {
        const capture = captures.get(document)
        if (capture !== undefined) document.defaultView?.removeEventListener('keydown', capture, true)
        captures.delete(document)
        layers.delete(document)
      }
      if (wasTop) {
        const target = previous instanceof HTMLElement && previous.isConnected ? previous : stack.at(-1)?.element
        if (target !== undefined) focusWithoutRing(target)
      }
    }
  }, [dialog, open])
}
