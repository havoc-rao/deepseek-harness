import { defineConfig } from 'tsdown'

/** Node-only backend: tsc emits to lib/types, tsdown bundles the plugin entry and invariant companion. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
