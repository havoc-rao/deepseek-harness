/**
 * Main-process host boot. A mirror of apps/cli/src/profile-boot.ts's
 * `runProfile` over the shared 'web' profile, minus process-signal wiring and
 * config HMR: the desktop app exits through Electron lifecycle, and a user
 * patch edit takes effect on relaunch (no live reload).
 *
 * The webserver listens on loopback and the renderer loads it directly at
 * http://127.0.0.1:{port}: same-origin fetch and WebSocket then need no CORS
 * or custom-scheme bridging.
 */
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  boot,
  createRuntimeResolution,
  installFailLoud,
  loadOverlayPatches,
  loadProfile,
  PluginPackages,
  readProfilePatches,
  type ProfileContext,
} from '@deepseek-ai/dsh-app-boot'
import { ModuleLoader } from '@deepseek-ai/cordis-plugin-loader'
import { provideCmdline, type AppReady } from '@deepseek-ai/dsh-cmdline'
import { provideDesktopShell } from './shell.ts'
import { provideDesktopShortcuts } from './shortcuts.ts'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DSH_LAUNCH_ENVIRONMENT_KEY, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'

const NAME = 'dsh'
export const PROFILE_NAME = 'web'
const PROFILE_ROOT_FILENAME = 'cordis.yml'

/** Absolute path of this package's package.json (both anchors: src/ and lib/ sit one level under apps/electron). */
const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

/**
 * Electron's embedder cannot load the node-addon-require-builtin addon (it
 * needs the GetAlignedPointerFromEmbedderData symbol that only plain Node
 * exports), so ModuleLoader.fromInternal() returns undefined there and the
 * loader would fall back to ambient import(), which cannot resolve bare
 * package names from the profile directory. Replace the missing internal
 * loader with a createRequire-based shim that resolves against the base URL
 * (PluginPackages carries the computed runtime resolution for bare names).
 */
function shimLoaderInternal(): void {
  if (ModuleLoader.fromInternal() !== undefined) return
  // The full ModuleLoaderV2 type describes Node's internal loader surface
  // (register/load/resolveSync/...); the loader's only consumer is
  // tree.import, which needs exactly the import method. Cast through unknown
  // because the runtime never touches the rest.
  ModuleLoader.fromInternal = (() => ({
    version: 'v2',
    async import(specifier: string, baseUrl: string): Promise<unknown> {
      if (specifier.startsWith('node:')) return import(specifier)
      try {
        const resolved = createRequire(baseUrl).resolve(specifier)
        return await import(pathToFileURL(resolved).href)
      } catch {
        // require.resolve covers this repo's ESM exports; the fallback keeps
        // unusual specifiers resolvable instead of failing resolution.
        return import(specifier)
      }
    },
  })) as unknown as typeof ModuleLoader.fromInternal
}

const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

/** Launcher-owned readiness signal committed only after boot and host setup succeed. */
function createAppReady(): { service: AppReady; commit(): void } {
  let ready = false
  const listeners = new Set<() => void>()
  return {
    service: {
      onReady(listener) {
        if (ready) {
          listener()
          return () => {}
        }
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    commit() {
      if (ready) return
      ready = true
      for (const listener of [...listeners]) listener()
      listeners.clear()
    },
  }
}

export interface StartHostOptions {
  /** The frozen launch-environment snapshot, shared with the CLI. */
  environment: LaunchEnvironmentSnapshot
  /** Overlay patch files (electron.patch.yml) in argv order. */
  patchFiles: readonly string[]
  /** Electron app exit (replaces the CLI's process shutdown controller). */
  exit: (code: number) => void
}

export interface StartedHost {
  ctx: Context
  /** The host webserver URL the renderer window loads. */
  url: string
  dispose: () => Promise<void>
}

export async function startHost(options: StartHostOptions): Promise<StartedHost> {
  shimLoaderInternal()
  const profile = loadProfile(NAME, PROFILE_NAME, INSTALL_ANCHOR, undefined, { userLayer: true })
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  const overlays = options.patchFiles.flatMap(file => loadOverlayPatches(NAME, resolve(file)))
  // Loader-visible package resolution is computed up front and handed to the
  // PluginPackages provider below; nothing links node_modules on disk.
  const resolution = await createRuntimeResolution({ installAnchor: INSTALL_ANCHOR, profile })
  const profileContext: ProfileContext = {
    name: PROFILE_NAME,
    dir: profile.dir,
    patchPath: profile.patchPath,
    installAnchor: INSTALL_ANCHOR,
    startedBundles: profile.layers.map(layer => layer.packageName),
    cwd: process.cwd(),
    home: resolveDshHome(),
    overlays,
    telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED,
  }
  let disposed = false
  installFailLoud(NAME, process, async () => {
    if (!disposed) await ctx.fiber.dispose()
  })
  // Profile HMR and other readiness-gated plugins wait on this signal.
  const appReady = createAppReady()
  const rootConfig = join(profile.dir, PROFILE_ROOT_FILENAME)
  const ctx = await boot(NAME, rootConfig, readProfilePatches(NAME, profileContext, profile), async (hostCtx) => {
    hostCtx.provide('profileContext', profileContext)
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment)
    // Before any config-tree entry mounts, so the Loader resolves every
    // bare plugin specifier through the computed runtime resolution.
    await hostCtx.plugin(PluginPackages, { resolution })
    provideCmdline(hostCtx, { args: [], exit: options.exit, ready: appReady.service })
    provideDesktopShell(hostCtx)
    provideDesktopShortcuts(hostCtx)
  })
  appReady.commit()
  return {
    ctx,
    // The index route answers the 401 page without the process launch token,
    // so the renderer window must open the token-bearing root URL once.
    url: ctx.connection.authenticatedUrl(`http://127.0.0.1:${ctx.webServer.port}`),
    dispose: async () => {
      if (disposed) return
      disposed = true
      await ctx.fiber.dispose()
    },
  }
}
