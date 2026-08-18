import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runList, runToggle } from '../src/plugin-entries.ts'

/**
 * `dsh plugin enable|disable|list` inspects and edits the profile's own patch
 * layer (`cordis.patch.yml`) — the file the composition mounts and long-lived
 * surfaces hot-reload — so every test drives a real $DSH_HOME with real files
 * and asserts the written YAML, not a mock.
 */

let home: string
let stdout: string
let stderr: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-plugin-toggle-'))
  process.env.DSH_HOME = home
  stdout = ''
  stderr = ''
  vi.spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => { stdout += String(chunk); return true })
  vi.spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => { stderr += String(chunk); return true })
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.DSH_HOME
  rmSync(home, { recursive: true, force: true })
})

/** Create a profile directory with an explicit bundle list and no patch layer. */
function makeProfile(name: string, bundles: string[] = []): string {
  const dir = join(home, 'profiles', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: `dsh-profile-${name}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles } },
  }, null, 2) + '\n')
  return dir
}

function writePatch(dir: string, content: string): void {
  writeFileSync(join(dir, 'cordis.patch.yml'), content)
}

function patchContent(dir: string): string {
  return readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
}

/** Install a fake bundle package that inserts one row with the given disabled state. */
function installInsertingBundle(name: string, bundleName: string, rowId: string, disabled: boolean, rowName = './noop.mjs'): void {
  const profileDir = join(home, 'profiles', name)
  const bundleDir = join(profileDir, 'node_modules', bundleName)
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(join(bundleDir, 'package.json'), JSON.stringify({
    name: bundleName,
    private: true,
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2) + '\n')
  writeFileSync(join(bundleDir, 'cordis.patch.yml'), [
    '- insert:',
    `  - id: ${rowId}`,
    `    name: ${rowName}`,
    `    disabled: ${disabled}`,
    '',
  ].join('\n'))
}

describe('runToggle', () => {
  it('disable writes the row\'s disabled:true into an empty patch layer and reports it', () => {
    const dir = makeProfile('tui')
    writePatch(dir, '[]\n')

    const code = runToggle('tui', 'disable', 'dsh-better-sidebar')

    expect(code).toBe(0)
    expect(patchContent(dir)).toBe('- id: dsh-better-sidebar\n  disabled: true\n')
    expect(stdout).toContain('disabled dsh-better-sidebar in')
    // This empty profile composes no rows, so the write is reported as
    // targeting a row that is not mounted — the honest signal for a typo'd id.
    expect(stderr).toContain('no composed row with id "dsh-better-sidebar"')
  })

  it('disable is idempotent: a second run reports already disabled without rewriting', () => {
    const dir = makeProfile('tui')
    writePatch(dir, '- id: dsh-better-sidebar\n  disabled: true\n')

    const code = runToggle('tui', 'disable', 'dsh-better-sidebar')

    expect(code).toBe(0)
    expect(patchContent(dir)).toBe('- id: dsh-better-sidebar\n  disabled: true\n')
    expect(stdout).toContain('already disabled')
    expect(stderr).toContain('no composed row with id "dsh-better-sidebar"')
  })

  it('disable keeps an existing entry\'s other fields and adds disabled:true', () => {
    const dir = makeProfile('tui')
    writePatch(dir, [
      '# my own override',
      '- id: dsh-better-sidebar',
      '  name: ./dsh-better-sidebar.mjs',
      '  config:',
      '    style: compact # keep me',
      '',
    ].join('\n'))

    const code = runToggle('tui', 'disable', 'dsh-better-sidebar')

    expect(code).toBe(0)
    expect(patchContent(dir)).toBe([
      '# my own override',
      '- id: dsh-better-sidebar',
      '  name: ./dsh-better-sidebar.mjs',
      '  config:',
      '    style: compact # keep me',
      '  disabled: true',
      '',
    ].join('\n'))
  })

  it('disable replaces a !!js disabled expression with a literal true', () => {
    const dir = makeProfile('tui')
    writePatch(dir, '- id: row\n  disabled: !!js process.env.X === \'0\'\n')

    const code = runToggle('tui', 'disable', 'row')

    expect(code).toBe(0)
    expect(patchContent(dir)).toBe('- id: row\n  disabled: true\n')
  })

  it('enable removes the override and drops an id-only entry, keeping the file\'s leading comments', () => {
    const dir = makeProfile('tui')
    writePatch(dir, '# top comment\n- id: dsh-better-sidebar\n  disabled: true\n')

    const code = runToggle('tui', 'enable', 'dsh-better-sidebar')

    expect(code).toBe(0)
    expect(patchContent(dir)).toBe('# top comment\n[]\n')
    expect(stdout).toContain('enabled dsh-better-sidebar')
  })

  it('enable keeps an entry that still carries config after removing the override', () => {
    const dir = makeProfile('tui')
    writePatch(dir, [
      '- id: dsh-better-sidebar',
      '  name: ./dsh-better-sidebar.mjs',
      '  disabled: true',
      '  config:',
      '    style: compact',
      '',
    ].join('\n'))

    const code = runToggle('tui', 'enable', 'dsh-better-sidebar')

    expect(code).toBe(0)
    expect(patchContent(dir)).toBe([
      '- id: dsh-better-sidebar',
      '  name: ./dsh-better-sidebar.mjs',
      '  config:',
      '    style: compact',
      '',
    ].join('\n'))
  })

  it('enable with no override reports nothing to enable and leaves the file untouched', () => {
    const dir = makeProfile('tui')
    writePatch(dir, '- id: other\n  config:\n    value: 1\n')

    const code = runToggle('tui', 'enable', 'absent')

    expect(code).toBe(0)
    expect(patchContent(dir)).toBe('- id: other\n  config:\n    value: 1\n')
    expect(stdout).toContain('has no disabled override')
  })

  it('initializes a missing profile first, like every dsh plugin verb', () => {
    const dir = join(home, 'profiles', 'web')
    expect(existsSync(dir)).toBe(false)

    const code = runToggle('web', 'disable', 'row')

    expect(code).toBe(0)
    expect(existsSync(join(dir, 'package.json'))).toBe(true)
    expect(patchContent(dir)).toContain('- id: row\n  disabled: true')
    expect(stderr).toContain('initialized profile web')
  })

  it('fails loud on a patch layer that is not a top-level array', () => {
    const dir = makeProfile('tui')
    writePatch(dir, 'id: not-an-array\n')

    const code = runToggle('tui', 'disable', 'row')

    expect(code).toBe(1)
    expect(stderr).toContain('must be a top-level YAML array')
  })

  it('fails loud on an unparsable patch layer', () => {
    const dir = makeProfile('tui')
    writePatch(dir, '- id: [unclosed\n')

    const code = runToggle('tui', 'disable', 'row')

    expect(code).toBe(1)
    expect(stderr).toContain('failed to parse')
  })

  it('reports a typo\'d id that no composed row carries, after still writing the patch', () => {
    const dir = makeProfile('tui', ['@fake/bundle'])
    installInsertingBundle('tui', '@fake/bundle', 'real-row', false)
    writePatch(dir, '[]\n')

    const code = runToggle('tui', 'disable', 'typod-row')

    expect(code).toBe(0)
    expect(patchContent(dir)).toContain('- id: typod-row\n  disabled: true')
    expect(stderr).toContain('no composed row with id "typod-row"')
  })

  it('warns when enable leaves a lower-layer disable standing, and still drops the override', () => {
    const dir = makeProfile('tui', ['@fake/bundle'])
    installInsertingBundle('tui', '@fake/bundle', 'real-row', true)
    writePatch(dir, '- id: real-row\n  disabled: false\n')

    const code = runToggle('tui', 'enable', 'real-row')

    expect(code).toBe(0)
    expect(patchContent(dir)).not.toContain('id: real-row')
    expect(stderr).toContain('still disabled by a lower layer')
  })

  it('keeps writing the patch when the tree cannot be composed (a broken bundle)', () => {
    const dir = makeProfile('tui', ['@deepseek-ai/not-installed-bundle'])
    writePatch(dir, '[]\n')

    const code = runToggle('tui', 'disable', 'row')

    expect(code).toBe(0)
    expect(patchContent(dir)).toContain('- id: row\n  disabled: true')
    expect(stderr).not.toContain('no composed row')
  })

  it('resolves a row name to its entry id and patches under the real id', () => {
    // The shipped dsh-better-sidebar bundle inserts `name: dsh-better-sidebar`
    // with `id: better-sidebar` — exactly the mismatch that made a package-name
    // toggle write a dead patch for an unmounted id.
    const dir = makeProfile('tui', ['@fake/bundle'])
    installInsertingBundle('tui', '@fake/bundle', 'better-sidebar', false, 'dsh-better-sidebar')
    writePatch(dir, '[]\n')

    const code = runToggle('tui', 'disable', 'dsh-better-sidebar')

    expect(code).toBe(0)
    expect(patchContent(dir)).toBe('- id: better-sidebar\n  disabled: true\n')
    expect(stdout).toContain('disabled better-sidebar')
    expect(stdout).toContain('matched by row name dsh-better-sidebar')
    expect(stderr).toBe('')
  })

  it('cleans up the stale literal-id entry a previous toggle left behind', () => {
    // The user's earlier `disable dsh-better-sidebar` (pre-resolution) wrote a
    // bare `- id: dsh-better-sidebar` entry that targeted nothing; the same
    // invocation now resolves to better-sidebar and must not stack both.
    const dir = makeProfile('tui', ['@fake/bundle'])
    installInsertingBundle('tui', '@fake/bundle', 'better-sidebar', true, 'dsh-better-sidebar')
    writePatch(dir, '- id: dsh-better-sidebar\n  disabled: true\n')

    const code = runToggle('tui', 'disable', 'dsh-better-sidebar')

    expect(code).toBe(0)
    expect(patchContent(dir)).toBe('- id: better-sidebar\n  disabled: true\n')
    expect(stderr).toBe('')
  })

  it('fails loud when the matched row has no entry id', () => {
    makeProfile('tui', ['@fake/bundle'])
    installInsertingBundle('tui', '@fake/bundle', 'better-sidebar', false, 'dsh-better-sidebar')
    // A second bundle row without an id shares the name; the first name match
    // must win, so give the name to an idless row instead.
    const profileDir = join(home, 'profiles', 'tui')
    const bundleDir = join(profileDir, 'node_modules', '@fake/bundle')
    writeFileSync(join(bundleDir, 'cordis.patch.yml'), [
      '- insert:',
      '  - name: idless-plugin',
      '    disabled: true',
      '',
    ].join('\n'))

    const code = runToggle('tui', 'disable', 'idless-plugin')

    expect(code).toBe(1)
    expect(stderr).toContain('has no entry id and cannot be toggled')
  })
})

describe('runList', () => {
  it('prints every composed row with its id, state, and name', () => {
    const dir = makeProfile('tui', ['@fake/bundle'])
    installInsertingBundle('tui', '@fake/bundle', 'better-sidebar', true, 'dsh-better-sidebar')
    writePatch(dir, '[]\n')

    const code = runList('tui')

    expect(code).toBe(0)
    expect(stdout).toContain('1 row(s) composed in profile tui (0 enabled, 1 disabled, 0 by expression)')
    expect(stdout).toMatch(/better-sidebar\s+disabled\s+dsh-better-sidebar/)
    expect(stderr).toBe('')
  })

  it('labels a !!js disabled expression as expression', () => {
    const dir = makeProfile('tui', ['@fake/bundle'])
    installInsertingBundle('tui', '@fake/bundle', 'row', false, './plugin.mjs')
    writePatch(dir, '- id: row\n  disabled: !!js process.env.X === \'1\'\n')

    const code = runList('tui')

    expect(code).toBe(0)
    expect(stdout).toMatch(/row\s+expression\s+\.\/plugin\.mjs/)
  })

  it('fails loud for a profile the tree cannot be composed and never writes files', () => {
    const before = join(home, 'profiles', 'nope')

    const code = runList('nope')

    expect(code).toBe(1)
    expect(stderr).toContain('profile "nope" does not exist')
    expect(existsSync(before)).toBe(false)
  })
})
