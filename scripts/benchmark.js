#!/usr/bin/env node
/**
 * docmd-search performance benchmark.
 * Usage: node scripts/benchmark.js <path-to-docs> [--model <model-id>]
 *
 * Clears the bench index each run so results are always from scratch.
 * Reports per-phase timing so bottlenecks are clearly visible.
 */

import { indexDirectory } from '../dist/index.js';
import { performance } from 'perf_hooks';
import { rm } from 'fs/promises';
import { join, resolve } from 'path';

const docsPath = resolve(process.argv[2] || '../docs');
const modelArg = process.argv.indexOf('--model');
const modelId = modelArg !== -1 ? process.argv[modelArg + 1] : undefined;
const outDir = join(docsPath, '.docmd-search-bench');

// Clear previous bench index
try { await rm(outDir, { recursive: true, force: true }); } catch {}

console.log('⚡ docmd-search Performance Benchmark');
console.log(`   docs  : ${docsPath}`);
console.log(`   model : ${modelId ?? 'default (Xenova/all-MiniLM-L6-v2)'}`);
console.log('');

const phaseTimers = {};
let lastPhase = null;
const totalStart = performance.now();

try {
  await indexDirectory(
    { rootDir: docsPath, outDir: '.docmd-search-bench', ...(modelId ? { model: modelId } : {}) },
    (progress) => {
      const now = performance.now();

      // Track phase transitions
      if (progress.phase !== lastPhase) {
        if (lastPhase) {
          phaseTimers[lastPhase] = (phaseTimers[lastPhase] || 0) + (now - (phaseTimers[`_start_${lastPhase}`] || now));
        }
        phaseTimers[`_start_${progress.phase}`] = now;
        lastPhase = progress.phase;
      }

      if (progress.phase === 'embedding') {
        const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
        const elapsed = ((now - totalStart) / 1000).toFixed(1);
        process.stdout.write(`\r   embedding : ${String(pct).padStart(3)}%  (${progress.current}/${progress.total})  ${elapsed}s elapsed`);
      } else if (progress.phase === 'complete') {
        process.stdout.write('\r' + ' '.repeat(70) + '\r');
      }
    }
  );

  const totalElapsed = (performance.now() - totalStart) / 1000;

  console.log('✅ Complete!');
  console.log('');
  console.log('   Results:');
  console.log(`   Total time     : ${totalElapsed.toFixed(2)}s`);
  console.log(`   Baseline fp32  : ~771s  (original, single-threaded fp32)`);
  console.log(`   Baseline q8    : ~412s  (q8, single-threaded)`);
  console.log(`   vs fp32        : ${(771 / totalElapsed).toFixed(1)}x faster`);
  console.log(`   vs q8 baseline : ${(412 / totalElapsed).toFixed(1)}x faster`);
  console.log('');
  console.log('   Tip: run with --model Xenova/paraphrase-multilingual-MiniLM-L12-v2 to test multilingual model');

} catch (err) {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
}
