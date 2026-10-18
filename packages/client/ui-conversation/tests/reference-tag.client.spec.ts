/**
 * Provider-owned reference tag recognition: the document-wide conversion
 * (`$replaceReferenceTagsWithChips`), and its runtime entry points — paste
 * and plain-draft seed. Parser here mimics a provider grammar such as
 * `@workspace-ref/<base64url>`; the trigger pipeline owns the real registry.
 */
import { createHeadlessEditor } from '@lexical/headless'
import type { LexicalEditor } from 'lexical'
import { UNDO_COMMAND, $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, $nodesOfType } from 'lexical'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { ReferenceInsert, ReferenceTagMatch } from '../src/client/contract/draft-editor.ts'
import { ReferenceChipNode } from '../src/client/input/editor/chip-node.tsx'
import { $composerLayout, ATOMIC_CHAR } from '../src/client/input/editor/projection.ts'
import { $replaceReferenceTagsWithChips } from '../src/client/input/editor/reference-tag.ts'
import { DraftEditorRuntime } from '../src/client/input/editor/runtime.ts'
import { TextRefNode } from '../src/client/input/editor/text-ref.ts'

/** One fake workspace tag: `@workspace-ref/<word-char payload>`, payload excluded from trailing word chars. */
const TAG = '@workspace-ref/eyJpZCI6InNvbWUtaWQiLCJsYWJlbCI6ImRzaC1kZXZ0dW5uZWwtc3NoIn0'
const TAG_RE = /@workspace-ref\/([A-Za-z0-9_-]+)(?![\w-])/u

/** Parse the earliest fake tag; undefined when the text carries none. */
function tagParser(text: string): ReferenceTagMatch | undefined {
  const match = TAG_RE.exec(text)
  if (match === null) return undefined
  const tag = match[0]
  return {
    start: match.index,
    end: match.index + tag.length,
    insert: {
      source: 'reference',
      ref: tag,
      label: `workspace:${match[1]!.slice(0, 8)}`,
      appearance: 'folder',
      clipboardText: tag,
    } satisfies ReferenceInsert,
  }
}

function makeEditor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: 'reference-tag-spec',
    nodes: [ReferenceChipNode, TextRefNode],
    onError: (error) => { throw error },
  })
}

function chipsOf(): ReferenceChipNode[] {
  return $nodesOfType(ReferenceChipNode)
}

/** A runtime with the fake parser; the update listener re-projects on commit. */
function runtimeBench(parse: (text: string) => ReferenceTagMatch | undefined = () => undefined): DraftEditorRuntime {
  const runtime = new DraftEditorRuntime({
    onUpdate: () => { runtime.refreshProjection() },
    openReference: () => false,
    lexicon: () => new Map(),
    resolveLexicon: () => undefined,
    parseReferenceTag: parse,
  })
  const dispose = runtime.register()
  onTestFinished(() => { dispose() })
  return runtime
}

describe('$replaceReferenceTagsWithChips', () => {
  it('converts a mid-node tag into one chip, preserving the clipboard projection', () => {
    const editor = makeEditor()
    editor.update(() => {
      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode(`把这里接入经验交给 ${TAG} 也让他参考。`))
      $getRoot().append(paragraph)
    }, { discrete: true })
    editor.update(() => {
      const count = $replaceReferenceTagsWithChips(tagParser)
      expect(count).toBe(1)
      expect(chipsOf()).toHaveLength(1)
      const chip = chipsOf()[0]
      expect(chip?.getTextContent()).toBe(TAG)
      expect(chip?.getSource()).toBe('reference')
    }, { discrete: true })
    editor.read(() => {
      const layout = $composerLayout()
      expect(layout.clipboardText).toBe(`把这里接入经验交给 ${TAG} 也让他参考。`)
      expect(layout.detectText).toBe(`把这里接入经验交给 ${ATOMIC_CHAR} 也让他参考。`)
    })
  })

  it('converts every tag in one node, including adjacent tags', () => {
    const editor = makeEditor()
    editor.update(() => {
      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode(`${TAG}${TAG}前 ${TAG}`))
      $getRoot().append(paragraph)
    }, { discrete: true })
    editor.update(() => {
      expect($replaceReferenceTagsWithChips(tagParser)).toBe(3)
    }, { discrete: true })
    editor.read(() => {
      expect(chipsOf()).toHaveLength(3)
      expect($composerLayout().clipboardText).toBe(`${TAG}${TAG}前 ${TAG}`)
    })
  })

  it('converts tags split across paragraphs and skips a full remaining line', () => {
    const editor = makeEditor()
    editor.update(() => {
      const first = $createParagraphNode()
      first.append($createTextNode(`看 ${TAG}`))
      const second = $createParagraphNode()
      second.append($createTextNode(`@workspace-ref/坏标签! ${TAG}`))
      $getRoot().append(first, second)
    }, { discrete: true })
    editor.update(() => {
      expect($replaceReferenceTagsWithChips(tagParser)).toBe(2)
      expect(chipsOf()).toHaveLength(2)
    }, { discrete: true })
    editor.read(() => {
      expect($composerLayout().clipboardText).toBe(`看 ${TAG}\n@workspace-ref/坏标签! ${TAG}`)
      expect($composerLayout().detectText).toBe(`看 ${ATOMIC_CHAR}\n@workspace-ref/坏标签! ${ATOMIC_CHAR}`)
    })
  })

  it('keeps an invalid-looking tag as untouched text', () => {
    const editor = makeEditor()
    editor.update(() => {
      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode('传给 @workspace-ref/ 和 @workspace-ref 即可'))
      $getRoot().append(paragraph)
    }, { discrete: true })
    editor.update(() => {
      expect($replaceReferenceTagsWithChips(tagParser)).toBe(0)
      expect(chipsOf()).toHaveLength(0)
    }, { discrete: true })
  })

  it('breaks on a degenerate match instead of looping', () => {
    const editor = makeEditor()
    editor.update(() => {
      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode('abc'))
      $getRoot().append(paragraph)
    }, { discrete: true })
    editor.update(() => {
      expect($replaceReferenceTagsWithChips(() => ({ start: 1, end: 1, insert: {
        source: 'reference', ref: 'x', label: 'x', clipboardText: 'x',
      } }))).toBe(0)
      const text = $getRoot().getAllTextNodes().map(node => node.getTextContent())
      expect(text).toEqual(['abc'])
    }, { discrete: true })
  })

  it('scans nothing when no parser recognizes the text', () => {
    const editor = makeEditor()
    editor.update(() => {
      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode(`keep ${TAG} plain`))
      $getRoot().append(paragraph)
    }, { discrete: true })
    editor.update(() => {
      expect($replaceReferenceTagsWithChips(() => undefined)).toBe(0)
      expect(chipsOf()).toHaveLength(0)
    }, { discrete: true })
  })

  it('converts a whole-node tag by replacing the node itself', () => {
    const editor = makeEditor()
    editor.update(() => {
      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode(TAG))
      $getRoot().append(paragraph)
    }, { discrete: true })
    editor.update(() => {
      expect($replaceReferenceTagsWithChips(tagParser)).toBe(1)
      expect(chipsOf()).toHaveLength(1)
    }, { discrete: true })
    editor.read(() => {
      expect($composerLayout().clipboardText).toBe(TAG)
    })
  })
})

describe('runtime recognition', () => {
  it('paste converts recognized tags in one edit and lands the caret after the insertion', () => {
    const runtime = runtimeBench(tagParser)
    const pasted = `把这里接入经验交给 ${TAG} 也让他参考他的 status btn 注入 new chat 页面。`
    runtime.paste(pasted)
    const projection = runtime.projection
    expect(projection.clipboardText).toBe(pasted)
    expect(projection.occurrences).toHaveLength(1)
    expect(projection.occurrences[0]).toMatchObject({ offset: 10, length: TAG.length, clipboardText: TAG })
    // Detect coordinates count the chip as one character.
    expect(projection.caret).toBe(pasted.length - (TAG.length - 1))
  })

  it('paste ending with a tag keeps a live caret after the converted chip', () => {
    const runtime = runtimeBench(tagParser)
    runtime.paste(`见 ${TAG}`)
    const projection = runtime.projection
    expect(projection.occurrences).toHaveLength(1)
    expect(projection.detectText).toBe(`见 ${ATOMIC_CHAR}`)
    expect(projection.caret).toBe(3)
    expect(runtime.editor.getEditorState().read(() => $isRangeSelection($getSelection()))).toBe(true)
  })

  it('paste into an existing draft converts only the pasted run and preserves surrounding text', () => {
    const runtime = runtimeBench(tagParser)
    runtime.setDraft('第一行')
    runtime.editor.update(() => {
      $getRoot().getAllTextNodes()[0]?.select(3, 3)
    }, { discrete: true })
    runtime.paste(`，再看 ${TAG}。`)
    const projection = runtime.projection
    expect(projection.clipboardText).toBe(`第一行，再看 ${TAG}。`)
    expect(projection.occurrences).toHaveLength(1)
    expect(projection.occurrences[0]?.offset).toBe('第一行，再看 '.length)
  })

  it('paste with tag conversion is one undo step', async () => {
    const runtime = runtimeBench(tagParser)
    runtime.setDraft('基稿')
    runtime.paste(`，见 ${TAG}`)
    expect(runtime.projection.occurrences).toHaveLength(1)
    runtime.editor.dispatchCommand(UNDO_COMMAND, undefined)
    // History restoration lands on the next microtask in headless editors.
    await Promise.resolve()
    runtime.editor.getEditorState().read(() => {})
    expect(runtime.projection.clipboardText).toBe('基稿')
  })

  it('plain-draft seed converts recognized tags and places the caret at the end', () => {
    const runtime = runtimeBench(tagParser)
    runtime.setDraft(`交给 ${TAG}\n并参考 ${TAG}`)
    const projection = runtime.projection
    expect(projection.clipboardText).toBe(`交给 ${TAG}\n并参考 ${TAG}`)
    expect(projection.occurrences).toHaveLength(2)
    expect(projection.detectText).toBe(`交给 ${ATOMIC_CHAR}\n并参考 ${ATOMIC_CHAR}`)
    expect(projection.caret).toBe(projection.detectText.length)
  })

  it('leaves the draft plain when no parser recognizes the pasted text', () => {
    const runtime = runtimeBench()
    const pasted = `交给 ${TAG} 保持文本`
    runtime.paste(pasted)
    const projection = runtime.projection
    expect(projection.occurrences).toHaveLength(0)
    expect(projection.clipboardText).toBe(pasted)
    expect(projection.caret).toBe(pasted.length)
  })

  it('structured restoration keeps its explicit occurrences and never re-scans text', () => {
    const runtime = runtimeBench(tagParser)
    runtime.restoreDraft(`见 ${TAG}`, [{
      source: 'reference', ref: 'x', label: 'x', clipboardText: TAG, offset: 2, length: TAG.length,
    }])
    const projection = runtime.projection
    expect(projection.occurrences).toHaveLength(1)
    expect(projection.occurrences[0]?.ref).toBe('x')
    expect(runtime.editor.getEditorState().read(() => $nodesOfType(ReferenceChipNode))).toHaveLength(1)
  })
})
