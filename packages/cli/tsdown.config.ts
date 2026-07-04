import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  tsconfig: '../../tsconfig.json',
  outDir: 'dist',
  dts: true,
  clean: true,
  outputOptions: {
    chunkFileNames: 'chunks/[name]-[hash].js',
  },
  outExtensions: () => ({
    js: '.js',
    dts: '.d.ts',
  }),
  deps: {
    onlyBundle: false,
    dts: {
      neverBundle: [/^zod(?:\/.*)?$/u],
    },
  },
});
