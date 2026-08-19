import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDshArgs } from '../src/args.ts'

const parse = (argv: string[]) => parseDshArgs(argv, '1.2.3')

/** Capture the process exit code while muting Commander's output. */
function exitCode(argv: string[]): number {
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  try {
    parse(argv)
    throw new Error(`expected ${JSON.stringify(argv)} to exit`)
  } catch {
    return exit.mock.calls.at(-1)?.[0] as number
  } finally {
    vi.restoreAllMocks()
  }
}

afterEach(() => { vi.restoreAllMocks() })

describe('parseDshArgs', () => {
  it('routes profile boots, handing the rest to the app', () => {
    expect(parse(['--profile', 'tui'])).toEqual({ mode: 'profile', profile: 'tui', patches: [], args: [] })
    expect(parse(['--profile', 'tui', '--patch', 'a.yml', '--patch', 'b.yml']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: ['a.yml', 'b.yml'], args: [] })
    expect(parse(['--profile', 'web', '--dev']))
      .toEqual({ mode: 'profile', profile: 'web', patches: [], args: ['--dev'] })
  })

  it('ends the launcher flags at the first token it does not own', () => {
    // App flags, including its -h, and positionals reach the app verbatim.
    expect(parse(['--profile', 'tui', '--resume', 'abc']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: [], args: ['--resume', 'abc'] })
    expect(parse(['--profile', 'web', '-h']))
      .toEqual({ mode: 'profile', profile: 'web', patches: [], args: ['-h'] })
    expect(parse(['web', '--host', '127.0.0.1', '--port', '8080', '--dev']))
      .toEqual({ mode: 'profile', profile: 'web', patches: [], args: ['--host', '127.0.0.1', '--port', '8080'] })
    expect(parse(['--profile', 'headless', 'run', 'the', 'tests']))
      .toEqual({ mode: 'profile', profile: 'headless', patches: [], args: ['run', 'the', 'tests'] })
    // Launcher flags placed after that boundary belong to the app too.
    expect(parse(['--profile', 'tui', '--patch', 'a.yml', '--resume', 'b', '--patch', 'late.yml']))
      .toEqual({ mode: 'profile', profile: 'tui', patches: ['a.yml'], args: ['--resume', 'b', '--patch', 'late.yml'] })
  })

  it('routes the plugin pnpm forwarder', () => {
    expect(parse(['plugin', '--profile', 'tui', 'add', 'turtle-ui']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['add', 'turtle-ui'] })
    expect(parse(['plugin', '--profile', 'tui', 'remove', 'turtle-ui']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['remove', 'turtle-ui'] })
    expect(parse(['plugin', '--profile', 'tui', 'why', '@deepseek-ai/cordis']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['why', '@deepseek-ai/cordis'] })
    // Unknown pnpm flags forward verbatim.
    expect(parse(['plugin', '--profile', 'tui', 'add', '--save-dev', 'x']))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['add', '--save-dev', 'x'] })
  })

  it('routes the plugin entry toggle and rejects malformed toggles', () => {
    expect(parse(['plugin', '--profile', 'web', 'enable', 'dsh-better-sidebar']))
      .toEqual({ mode: 'plugin-toggle', profile: 'web', action: 'enable', id: 'dsh-better-sidebar' })
    expect(parse(['plugin', '--profile', 'web', 'disable', 'dsh-better-sidebar']))
      .toEqual({ mode: 'plugin-toggle', profile: 'web', action: 'disable', id: 'dsh-better-sidebar' })
    // Only the first positional intercepts the toggle; every other verb still forwards to pnpm.
    expect(parse(['plugin', '--profile', 'web', 'add', 'enable']))
      .toEqual({ mode: 'plugin', profile: 'web', args: ['add', 'enable'] })
    expect(parse(['plugin', '--profile', 'web', 'uninstall', 'disable']))
      .toEqual({ mode: 'plugin', profile: 'web', args: ['uninstall', 'disable'] })
    expect(exitCode(['plugin', '--profile', 'web', 'enable'])).toBe(1) // needs an id
    expect(exitCode(['plugin', '--profile', 'web', 'disable', 'a', 'b'])).toBe(1) // one id only
    expect(exitCode(['plugin', '--profile', 'web', 'disable', ''])).toBe(1) // empty id
  })

  it('routes the plugin list verb and rejects extra arguments', () => {
    expect(parse(['plugin', '--profile', 'web', 'list']))
      .toEqual({ mode: 'plugin-list', profile: 'web' })
    expect(parse(['plugin', '--profile', 'web', 'ls']))
      .toEqual({ mode: 'plugin-list', profile: 'web' })
    expect(exitCode(['plugin', '--profile', 'web', 'list', 'x'])).toBe(1) // list takes nothing
    expect(exitCode(['plugin', '--profile', 'web', 'ls', 'x'])).toBe(1)
  })

  it('routes profile and web config dumps', () => {
    expect(parse(['--profile', 'web', '--dump-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: false, patches: [] })
    expect(parse(['--profile', 'web', '--dump-default-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: true, patches: [] })
    expect(parse(['--profile', 'tui', '--dump-config', '--patch', 'x.yml']))
      .toEqual({ mode: 'dump-config', profile: 'tui', defaultOnly: false, patches: ['x.yml'] })
    expect(parse(['web', '--dump-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: false, patches: [] })
    expect(parse(['web', '--dump-default-config']))
      .toEqual({ mode: 'dump-config', profile: 'web', defaultOnly: true, patches: [] })
  })

  // Each update object carries `install` and `pull` booleans.
  const update = (profile: string | undefined, packages: string[], install: boolean, pull = false) =>
    ({ mode: 'update', profile, packages, install, pull })
  it('routes the link-plugin update runner', () => {
    // No --profile selects interactively across profiles.
    expect(parse(['update'])).toEqual(update(undefined, [], false))
    expect(parse(['update', '--install'])).toEqual(update(undefined, [], true))
    expect(parse(['update', '--profile', 'web'])).toEqual(update('web', [], false))
    expect(parse(['update', '--profile', 'web', 'dsh-better-sidebar']))
      .toEqual(update('web', ['dsh-better-sidebar'], false))
    expect(parse(['update', '--profile', 'web', '--install', 'a', 'b']))
      .toEqual(update('web', ['a', 'b'], true))
    expect(parse(['update', '--profile', 'web', '--pull']))
      .toEqual(update('web', [], false, true))
    expect(parse(['update', '--profile', 'web', '--pull', '--install', 'x']))
      .toEqual(update('web', ['x'], true, true))
  })

  it('routes the Electron desktop-app launcher', () => {
    expect(parse(['electron'])).toEqual({ mode: 'electron', action: 'start', args: [] })
    expect(parse(['electron', 'start'])).toEqual({ mode: 'electron', action: 'start', args: [] })
    expect(parse(['electron', 'start', '--dev', '--some-flag']))
      .toEqual({ mode: 'electron', action: 'start', args: ['--dev', '--some-flag'] })
    expect(parse(['electron', '--dev', '--some-flag']))
      .toEqual({ mode: 'electron', action: 'start', args: ['--dev', '--some-flag'] })
    expect(parse(['electron', 'stop'])).toEqual({ mode: 'electron', action: 'stop' })
    expect(parse(['electron', 'log'])).toEqual({ mode: 'electron', action: 'log', lines: 100 })
    expect(parse(['electron', 'log', '-n', '20'])).toEqual({ mode: 'electron', action: 'log', lines: 20 })
    expect(parse(['electron', 'log', '--lines', '350'])).toEqual({ mode: 'electron', action: 'log', lines: 350 })
    expect(exitCode(['electron', 'stop', 'x'])).toBe(1) // stop takes no arguments
    expect(exitCode(['electron', 'log', '-n'])).toBe(1) // -n needs a count
    expect(exitCode(['electron', 'log', '-n', 'x'])).toBe(1) // non-numeric count
    expect(exitCode(['electron', 'log', '-n', '0'])).toBe(1) // positive count required
    expect(exitCode(['electron', 'log', 'bogus'])).toBe(1) // only -n/--lines allowed
  })

  it('routes the web pid launcher, its stop verb, and its foreground dev switch', () => {
    // The bare command is the detached launcher; app arguments forward verbatim.
    expect(parse(['web'])).toEqual({ mode: 'web', action: 'start', patches: [], args: [] })
    expect(parse(['web', '--port', '8080']))
      .toEqual({ mode: 'web', action: 'start', patches: [], args: ['--port', '8080'] })
    expect(parse(['web', '--patch', 'web.yml', '--port', '8080']))
      .toEqual({ mode: 'web', action: 'start', patches: ['web.yml'], args: ['--port', '8080'] })
    expect(parse(['web', 'stop'])).toEqual({ mode: 'web', action: 'stop' })
    expect(exitCode(['web', 'stop', 'x'])).toBe(1) // stop takes no arguments
    expect(exitCode(['web', '--patch='])).toBe(1) // start needs a real patch path
    // `--dev` keeps the classic foreground boot, stripped from the app args.
    expect(parse(['web', '--dev'])).toEqual({ mode: 'profile', profile: 'web', patches: [], args: [] })
    expect(parse(['web', '--dev', '--port', '8080']))
      .toEqual({ mode: 'profile', profile: 'web', patches: [], args: ['--port', '8080'] })
    expect(parse(['web', '--port', '8080', '--dev']))
      .toEqual({ mode: 'profile', profile: 'web', patches: [], args: ['--port', '8080'] })
    // The launcher stops owning flags at the first token it does not know; a
    // `--patch` behind `--dev` is app territory (passThrough semantics).
    expect(parse(['web', '--dev', '--patch', 'web.yml']))
      .toEqual({ mode: 'profile', profile: 'web', patches: [], args: ['--patch', 'web.yml'] })
    // Help stays a foreground boot so the web app's own help prints and exits.
    expect(parse(['web', '--help'])).toEqual({ mode: 'profile', profile: 'web', patches: [], args: ['--help'] })
    expect(parse(['web', '-h'])).toEqual({ mode: 'profile', profile: 'web', patches: [], args: ['-h'] })
  })

  it('rejects missing profile, removed flags, and contradictory inputs', () => {
    expect(exitCode([])).toBe(1)
    expect(exitCode(['tui'])).toBe(1) // an app argument without --profile has no app to reach
    expect(exitCode(['--config', 'c.yml'])).toBe(1) // removed
    expect(exitCode(['-p', 'task'])).toBe(1) // removed
    expect(exitCode(['run', 'task'])).toBe(1) // app-owned task replaced the launcher subcommand
    expect(exitCode(['--profile', ''])).toBe(1)
    expect(exitCode(['--profile', 'x', '--patch='])).toBe(1)
    expect(exitCode(['--dump-config'])).toBe(1)
    expect(exitCode(['--profile', 'x', '--dump-config', '--dump-default-config'])).toBe(1)
    expect(exitCode(['--profile', 'x', '--dump-default-config', '--patch', 'p.yml'])).toBe(1)
    expect(exitCode(['--profile', 'x', '--dump-config', 'task'])).toBe(1)
    expect(exitCode(['--bogus'])).toBe(1)
    expect(exitCode(['--profile', 'x', 'web'])).toBe(1)
    expect(exitCode(['web', '--dump-config', '--dump-default-config'])).toBe(1)
    expect(exitCode(['web', '--dump-default-config', '--patch', 'w.yml'])).toBe(1)
    expect(exitCode(['web', '--patch='])).toBe(1)
    // A dump never runs app command-line providers, so it cannot show what
    // those flags would decide; printing a tree that differs from the same
    // invocation's boot would mislead.
    expect(exitCode(['web', '--dump-config', '--port', '8080'])).toBe(1)
    expect(exitCode(['--profile', 'web', '--dump-config', '-h'])).toBe(1)
    expect(exitCode(['plugin', 'add', 'x'])).toBe(1) // --profile required
    expect(exitCode(['plugin', '--profile', 'tui'])).toBe(1) // nothing to forward
    expect(exitCode(['plugin', '--profile', ''])).toBe(1)
    expect(exitCode(['--profile', 'x', 'plugin', 'add', 'y'])).toBe(1)
    expect(exitCode(['update', '--profile', ''])).toBe(1)
    expect(exitCode(['--profile', 'x', 'update', 'y'])).toBe(1)
    expect(exitCode(['--profile', 'x', 'electron'])).toBe(1) // no parent options on the electron spawner
  })

  it('keeps its own help for an invocation with no app to hand it to', () => {
    expect(exitCode(['--help'])).toBe(0)
    expect(exitCode(['-h'])).toBe(0)
    expect(exitCode(['--version'])).toBe(0)
  })
})
