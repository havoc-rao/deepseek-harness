import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['lib/types/main.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  external: ['electron'],
  dts: false,
  clean: false,
})
