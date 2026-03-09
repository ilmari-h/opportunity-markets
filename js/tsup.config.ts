import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  platform: 'node',
  target: 'es2022',
  esbuildOptions(options) {
    options.packages = 'external';
  },
});
