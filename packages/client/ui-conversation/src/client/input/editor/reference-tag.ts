/**
 * Provider-owned reference tag recognition in the composer document: plain
 * text runs are scanned for tags a registered parser recognizes (e.g.
 * `@workspace-ref/<payload>`), and each valid tag is replaced by one
 * ReferenceChipNode atom. Recognition is provisioned by the trigger
 * pipeline's parser registry, never hardcoded here. Must run inside
 * `editor.update()`.
 */
import type { TextNode } from 'lexical'
import { $getRoot } from 'lexical'
import type { ReferenceTagMatch } from '../../contract/draft-editor.ts'
import { $createReferenceChipNode } from './chip-node.tsx'

/**
 * Replace every provider-owned reference tag in the document with a
 * reference chip, scanning each text node in document order. The trailing
 * fragment of a split node is scanned on the same pass, so multiple tags in
 * one node all convert; every replacement preserves clipboard-text offsets
 * (the chip's clipboard text is the matched tag), leaving projections and
 * selection stable. A degenerate match (no consumed text) or an undefined
 * answer ends that node's scan.
 * @param parse - the aggregated reference-tag parser (earliest match within
 * the scanned text, or undefined).
 * @returns how many tags were converted.
 */
export function $replaceReferenceTagsWithChips(parse: (text: string) => ReferenceTagMatch | undefined): number {
  let converted = 0
  for (const first of $getRoot().getAllTextNodes()) {
    let node: TextNode | undefined = first
    while (node !== undefined) {
      const text = node.getTextContent()
      if (text === '') break
      const match = parse(text)
      if (match === undefined) break
      if (!(match.start >= 0 && match.end > match.start && match.end <= text.length)) break
      const chip = $createReferenceChipNode(match.insert)
      if (match.start === 0 && match.end === text.length) {
        node.replace(chip)
        node = undefined
      } else {
        const pieces = node.splitText(match.start, match.end)
        // splitText keeps the node itself as the matched piece only when it
        // starts at offset 0; otherwise the pieces are [prefix, matched, suffix?].
        const matched = pieces[match.start === 0 ? 0 : 1]
        matched?.replace(chip)
        node = pieces[match.start === 0 ? 1 : 2]
      }
      converted += 1
    }
  }
  return converted
}
