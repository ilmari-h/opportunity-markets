import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'dist/browser',
  platform: 'browser',
  target: 'es2022',
  esbuildOptions(options) {
    options.alias = {
      fs: './src/shims/fs-browser.ts',
    };
  },
  external: ['crypto'],
});
