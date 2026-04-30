#!/usr/bin/env node

/**
 * docmd-search CLI
 * Usage: npx docmd-search [directory]
 */

import { resolve } from 'node:path';
import { indexDirectory } from '../index.js';
import { createSearchIndex } from '../index-io.js';

const args = process.argv.slice(2);
const rootDir = resolve(args[0] || '.');
const outDir = resolve(rootDir, '.docmd-search');

console.log(`\n🔍 docmd-search v0.1.0`);
console.log(`  Indexing: ${rootDir}\n`);

const start = performance.now();
const index = await indexDirectory({ rootDir, outDir });
await createSearchIndex(index, outDir);
const elapsed = ((performance.now() - start) / 1000).toFixed(2);

console.log(`\n  ✓ Done in ${elapsed}s\n`);
