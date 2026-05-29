/**
 * Diagnostic: compare embedding speed on real doc chunks vs synthetic texts.
 * Helps identify if tokenization of real markdown content is the bottleneck.
 *
 * Usage: node scripts/diagnose.mjs <docs-dir>
 */
import { readFile, readdir } from 'fs/promises';
import { createModelManager } from '../dist/index.js';
import { performance } from 'perf_hooks';
import os from 'os';
import { join, extname } from 'path';

const docsDir = process.argv[2] || '../docs';

// ── Collect real doc files ──────────────────────────────────────────────────
async function findMdFiles(dir, out = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (['.', 'node_modules', 'site', 'dist', '.docmd-search'].some(s => e.name.startsWith(s))) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await findMdFiles(full, out);
    else if (['.md', '.txt', '.html'].includes(extname(e.name))) out.push(full);
  }
  return out;
}

const files = await findMdFiles(docsDir);
console.log(`Found ${files.length} files in ${docsDir}`);

// Read and chunk real content (256-word chunks like the indexer)
const realTexts = [];
for (const f of files.slice(0, 100)) {
  try {
    const content = await readFile(f, 'utf-8');
    const words = content.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += 256) {
      realTexts.push(words.slice(i, i + 256).join(' '));
    }
  } catch {}
}

const avgRealLen = Math.round(realTexts.reduce((s, t) => s + t.length, 0) / realTexts.length);
console.log(`Real chunks: ${realTexts.length} total, avg ${avgRealLen} chars`);

// ── Set up model ────────────────────────────────────────────────────────────
const { env } = await import('@huggingface/transformers');
env.backends.onnx.wasm.numThreads = os.cpus().length;
console.log(`Threading: numThreads = ${os.cpus().length} CPUs`);

const mgr = createModelManager('Xenova/all-MiniLM-L6-v2');
await mgr.load();
console.log('Model loaded\n');

// ── Benchmark: real vs synthetic at 128 batch ───────────────────────────────
const realBatch  = Array.from({ length: 128 }, (_, i) => realTexts[i % realTexts.length]);
const synthBatch = Array.from({ length: 128 }, (_, i) => 'Documentation chunk ' + i + ' about semantic search.');
const longBatch  = Array.from({ length: 128 }, (_, i) => ('word '.repeat(256)).trim()); // max-length

await mgr.embed(realBatch.slice(0, 4)); // warmup

for (const [label, batch] of [
  ['Synthetic (short)',   synthBatch],
  ['Real doc chunks',     realBatch],
  ['Max-length (256w)',   longBatch],
]) {
  const avgLen = Math.round(batch.reduce((s, t) => s + t.length, 0) / batch.length);
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) await mgr.embed(batch);
  const elapsed = (performance.now() - t0) / 1000;
  const tps = Math.round(5 * 128 / elapsed);
  console.log(`${label.padEnd(22)} avg=${String(avgLen).padStart(5)} chars  ${elapsed.toFixed(2)}s  ${tps} chunks/s`);
}

// ── Benchmark: real content at scale ───────────────────────────────────────
console.log('\nScaling with real content:');
for (const n of [128, 512, 1024, 2048]) {
  const texts = Array.from({ length: n }, (_, i) => realTexts[i % realTexts.length]);
  const t0 = performance.now();
  await mgr.embed(texts);
  const elapsed = (performance.now() - t0) / 1000;
  console.log(`  n=${String(n).padStart(4)}  ${elapsed.toFixed(2)}s  ${Math.round(n / elapsed)} chunks/s`);
}

mgr.dispose();
