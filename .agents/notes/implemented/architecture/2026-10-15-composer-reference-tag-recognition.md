# Agent Note: Provider-owned reference tag recognition in the composer

Status: implemented

English | [中文](2026-10-15-composer-reference-tag-recognition.zh.md)

## Problem

Reference chips are atomic decorations in the composer, but their plain-text form (for example `@workspace-ref/<base64url>` from workspace-reference plugins) only re-enters the draft as a chip through a menu pick or `insertReference`. Text containing such tags — pasted in bulk, or injected into a new chat draft by another UI — stayed plain editable text: no chip, no identity, no tooltip, and the tag's folded display never applied.

The tag grammar belongs to its provider (the plugin that mints the tags and renders their message mentions), not to `ui-conversation` or the trigger pipeline. Hardcoding one grammar in the composer would add workspace knowledge to a package that must stay domain-neutral, and every future tag format would need another hardcoded branch.

## Decision

Recognition is a provider-owned, synchronous text scan with a registry on the input-trigger service, and the conversion runs inside the composer's own edit transactions.

### Seam

`ReferenceTagMatch` (`ui-conversation` draft-editor contract) is `{ start, end, insert }` with offsets in UTF-16 code units into the scanned text; `insert.clipboardText` must equal the matched substring exactly, so replacing the tag with the chip keeps every projection offset stable (the chip's clipboard expansion IS the tag). `ReferenceTagParser.parse(text)` answers the earliest tag in the text, or undefined; the provider validates the complete tag (encoding, payload, round-trip identity) before answering, mirroring how `workspaceMentions` already rejects malformed tags.

`ctx.inputTriggers.registerReferenceTagParser(parser)` registers one grammar; parsers poll in registration order and the first defined answer wins, so overlapping grammars are disambiguated by registration order. The registry sits beside the source roster but never seeds a candidate menu — a provider that only defines a tag grammar is not a menu source. The per-session `InputTriggerController` exposes `parseReferenceTag(text)` over the live registry (faulty parsers log and are skipped, like faulty lexicon sources), and `SessionInputShell` wires it into the editor runtime as a plain dep.

### Conversion points

`$replaceReferenceTagsWithChips` walks every text node, and for each node asks the parser, splits the matched range out, and replaces it with `$createReferenceChipNode`. The trailing fragment of a split is scanned on the same pass (multiple tags in one node all convert); a degenerate match (empty or out-of-bounds range) ends that node's scan instead of looping. The conversion runs inside the existing `editor.update()` of:

- `paste()` — after the plain text insertion, so one paste is one undo step, and before the text-ref transform commits, so a full tag never degrades into a folder-style highlight first;
- `setDraft(text)` — the plain-text seed path (persisted drafts, plugin injections into a new chat composer).

`restoreDraft` is deliberately excluded: its occurrence offsets are authoritative structured data from a `DraftSnapshot`, and scanning could only shift them. `insertAsyncText`/`replaceText` stay plain-text splices.

### Selection

After `paste()`, the post-insertion caret is captured in detect coordinates and re-applied after conversion. Tags never move the clipboard projection (chip text = tag text), so a pre-conversion detect offset still addresses the same document position after chips replace the nodes the selection pointed into — including a tag that ends exactly at the paste's end, whose node would otherwise be replaced out from under the caret.

## Alternatives considered

- **A TextNode transform for tag conversion** (like `registerTextRefDecoration`). Rejected: chips are atomic decorators, and a transform converting mid-typing would need the AutoLink-style editing escape hatches; the real entry paths are paste and programmatic seeds, both of which already run inside their own `editor.update()` where conversion happens deterministically before the text-ref transform.
- **Tag parsing as an `InputTriggerSource` hook.** Rejected: a provider that only defines a tag grammar is not a menu source, and registering one would seed an empty candidate group into the `@` menu. The registry sits beside the source roster precisely so that recognition is not menu participation.
- **Hardcoding the `@workspace-ref/` grammar in `ui-conversation`.** Rejected: the grammar is owned by workspace-reference plugins, and a hardcoded branch would add workspace knowledge to a domain-neutral package for one provider's format.
- **Scanning `restoreDraft` text too.** Rejected: structured restoration's occurrence offsets are authoritative, and re-scanning could only shift them; a legacy draft upgrade would need its own deliberate pass.

## Verification

Unit specs cover the pure walk (mid-node, whole-node, adjacent, multi-paragraph, and malformed tags; degenerate matches break instead of looping), the runtime entry points (paste and plain seed convert in one undoable edit; the caret survives a tag ending exactly at the paste's end; structured restoration is untouched), and the registry (registration order, first-defined wins, live roster after late registration, fiber disposal, faulty-parser containment). The GUI aggregate and package suites pass with these specs; the trigger pipeline service contract tests cover the new registration face.

## Consequences

Pasting a large block containing valid tags renders the chips (label, glyph, raw-text tooltip) with the same insert semantics as a menu pick; malformed or unregistered text is untouched. The parser registry is the only new public surface besides the two contract members; `ui-conversation` gains no workspace knowledge and no visible behavior changes while no parser is registered.

Workspace-reference plugins register their existing `workspaceMentions` grammar through the new seam to opt in; the message-side `conversation.message.reference` slot keeps owning rendered mentions.