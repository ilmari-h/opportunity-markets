import { defineConfig } from 'tsup';

export default defineConfig([
  // Node.js build (ESM + CJS)
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    platform: 'node',
    target: 'es2022',
    external: ['fs', 'crypto'],
  },
  // Browser build (ESM only)
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    outDir: 'dist/browser',
    platform: 'browser',
    target: 'es2022',
    esbuildOptions(options) {
      // Replace fs with empty shim - crypto is left for consumer to polyfill
      options.alias = {
        fs: './src/shims/fs-browser.ts',
      };
    },
    // Mark crypto as external so consumers can polyfill it
    external: ['crypto'],
  },
]);
