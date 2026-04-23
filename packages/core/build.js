import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  sourcemap: true,
  minify: process.argv.includes('--minify'),
};

// Main library (Node.js — build-time indexing)
await build({
  ...shared,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  external: ['onnxruntime-node'],
});

// CLI
await build({
  ...shared,
  entryPoints: ['src/bin/docmd-search.ts'],
  outfile: 'dist/bin/docmd-search.js',
  banner: { js: '#!/usr/bin/env node' },
  external: ['onnxruntime-node'],
});

// Client-side search runtime (browser)
await build({
  entryPoints: ['src/client/index.ts'],
  outfile: 'dist/client/index.js',
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  sourcemap: true,
  minify: true,
});

console.log('✓ Build complete');
