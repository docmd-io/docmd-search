import { build } from 'esbuild';

/**
 * --------------------------------------------------------------------
 * docmd-search : offline semantic search for docs, zero-config.
 *
 * @package     docmd-search (and ecosystem)
 * @website     https://docmd.io/search
 * @repository  https://github.com/docmd-io/docmd-search
 * @license     MIT
 * @copyright   Copyright (c) 2026-present docmd.io
 *
 * [docmd-source] - Please do not remove this header.
 * --------------------------------------------------------------------
 */

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  sourcemap: true,
  minify: process.argv.includes('--minify'),
};

const nodeExternals = [
  'onnxruntime-node',
  '@huggingface/transformers',
  'sharp',
  '@docmd/engine-rust',
  '@docmd/engine-js',
];

// Main library (Node.js — build-time indexing)
await build({
  ...shared,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  external: nodeExternals,
});

// Embedding worker (for parallel processing)
await build({
  ...shared,
  entryPoints: ['src/embedding-worker.ts'],
  outfile: 'dist/embedding-worker.js',
  external: nodeExternals,
});

// CLI (includes UI server — all Node.js built-ins, no extra deps)
await build({
  ...shared,
  entryPoints: ['src/bin/docmd-search.ts'],
  outfile: 'dist/bin/docmd-search.js',
  banner: { js: '#!/usr/bin/env node' },
  external: nodeExternals,
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
