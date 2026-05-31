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

/**
 * Client-side search runtime.
 *
 * Loaded in the browser — performs keyword scoring + cosine similarity
 * over pre-built vectors. No ML model, no WASM, just math.
 *
 * Target: <5KB minified.
 *
 * Multi-batch loading:
 * 1. Fetch manifest.json → learn batch count + dimensions
 * 2. Load batch 000 → search is available immediately
 * 3. Background-load remaining batches → progressively improve results
 */

/* ── Types (inline to keep bundle small) ───────────────────── */

interface Chunk {
  file: string;
  heading?: string;
  text: string;
  range: [number, number];
}

interface SearchResult {
  score: number;
  chunk: Chunk;
}

interface BatchMeta {
  batchId: number;
  chunks: Chunk[];
  dimensions: number;
  compression: 'none' | 'ternary' | 'pq';
  vectorCount: number;
}

interface Manifest {
  version: number;
  model: string;
  dimensions: number;
  status: string;
  totalChunks: number;
  batchCount: number;
}

interface ClientIndex {
  dimensions: number;
  chunks: Chunk[];
  vectors: Int8Array[];  // One Int8Array per chunk
  ready: boolean;
  batchesLoaded: number;
  totalBatches: number;
}

/* ── State ─────────────────────────────────────────────────── */

let _index: ClientIndex | null = null;
let _basePath: string = '';

/* ── Public API ────────────────────────────────────────────── */

export type OnBatchLoaded = (loaded: number, total: number) => void;

/**
 * Load the search index from a URL base path.
 *
 * Loads batch 0 first for instant search, then background-loads the rest.
 * Calls `onBatchLoaded` after each batch.
 */
export async function load(
  basePath: string,
  onBatchLoaded?: OnBatchLoaded
): Promise<void> {
  _basePath = basePath.replace(/\/$/, '');

  // 1. Fetch manifest
  const manifestRes = await fetch(`${_basePath}/manifest.json`);

  if (!manifestRes.ok) {
    // Try legacy single-file format
    await loadLegacy(_basePath);
    return;
  }

  const manifest: Manifest = await manifestRes.json();

  _index = {
    dimensions: manifest.dimensions,
    chunks: [],
    vectors: [],
    ready: false,
    batchesLoaded: 0,
    totalBatches: manifest.batchCount,
  };

  // 2. Load batch 0 (makes search available immediately)
  await loadBatch(0);
  _index.ready = true;
  onBatchLoaded?.(1, manifest.batchCount);

  // 3. Background-load remaining batches
  for (let i = 1; i < manifest.batchCount; i++) {
    // Use requestIdleCallback if available, else setTimeout
    await new Promise<void>(resolve => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => resolve());
      } else {
        setTimeout(resolve, 10);
      }
    });

    await loadBatch(i);
    onBatchLoaded?.(i + 1, manifest.batchCount);
  }
}

/**
 * Search the loaded index.
 *
 * Uses hybrid scoring: keyword BM25-ish + vector cosine similarity.
 * Score = keyword * 0.6 + cosine * 0.4
 */
export function search(query: string, topK: number = 10): SearchResult[] {
  if (!_index || !_index.ready) {
    throw new Error('docmd-search: index not loaded. Call load() first.');
  }

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const scores: { score: number; idx: number }[] = [];

  // Phase 1: Keyword scoring
  for (let i = 0; i < _index.chunks.length; i++) {
    const text = _index.chunks[i].text.toLowerCase();
    let kwScore = 0;

    for (const term of terms) {
      const count = text.split(term).length - 1;
      kwScore += count / (count + 1.5); // BM25-like saturation
    }

    if (kwScore > 0) {
      scores.push({ score: kwScore, idx: i });
    }
  }

  if (scores.length === 0) return [];

  // Phase 2: Vector reranking (if vectors are available)
  if (scores.length > 1 && _index.vectors.length > 0) {
    scores.sort((a, b) => b.score - a.score);
    const bestVec = _index.vectors[scores[0].idx];

    // Only use vectors if they contain real data
    if (bestVec && bestVec.some(v => v !== 0)) {
      for (const s of scores) {
        const vec = _index.vectors[s.idx];
        if (vec) {
          const sim = cosineSimilarity(bestVec, vec);
          // Normalize keyword score to [0,1] using sigmoid-like function
          // to prevent scores exceeding 100%
          const normalizedKw = s.score / (s.score + 1);
          s.score = normalizedKw * 0.6 + sim * 0.4;
        }
      }
    }
  }

  scores.sort((a, b) => b.score - a.score);

  return scores.slice(0, topK).map(s => ({
    score: s.score,
    chunk: _index!.chunks[s.idx],
  }));
}

/**
 * Check if the index is loaded and ready for searching.
 */
export function isReady(): boolean {
  return _index?.ready === true;
}

/**
 * Get loading progress (batches loaded / total batches).
 */
export function getProgress(): { loaded: number; total: number } {
  if (!_index) return { loaded: 0, total: 0 };
  return { loaded: _index.batchesLoaded, total: _index.totalBatches };
}

/**
 * Get the total number of indexed chunks.
 */
export function getChunkCount(): number {
  return _index?.chunks.length ?? 0;
}

/* ── Internal ──────────────────────────────────────────────── */

/** Load a single batch and merge into the index. */
async function loadBatch(batchId: number): Promise<void> {
  if (!_index) return;

  const prefix = String(batchId).padStart(3, '0');

  // Fetch batch metadata + vectors in parallel
  const [metaRes, vecRes] = await Promise.all([
    fetch(`${_basePath}/batches/${prefix}.json`),
    fetch(`${_basePath}/batches/${prefix}.bin`),
  ]);

  const meta: BatchMeta = await metaRes.json();
  const vecBuf = await vecRes.arrayBuffer();
  const buffer = new Uint8Array(vecBuf);

  // Decompress vectors
  const vectors = decompressVectors(
    buffer,
    meta.vectorCount,
    meta.dimensions,
    meta.compression
  );

  // Append to index
  _index.chunks.push(...meta.chunks);
  _index.vectors.push(...vectors);
  _index.batchesLoaded = batchId + 1;
}

/** Load legacy single-file format (backward compatibility). */
async function loadLegacy(basePath: string): Promise<void> {
  const [metaRes, vecRes] = await Promise.all([
    fetch(`${basePath}/search-index.json`),
    fetch(`${basePath}/search-index.bin`),
  ]);

  const meta = await metaRes.json();
  const vecBuf = await vecRes.arrayBuffer();
  const flat = new Int8Array(vecBuf);

  const vectors: Int8Array[] = [];
  for (let i = 0; i < meta.chunks.length; i++) {
    vectors.push(flat.slice(i * meta.dimensions, (i + 1) * meta.dimensions));
  }

  _index = {
    dimensions: meta.dimensions,
    chunks: meta.chunks,
    vectors,
    ready: true,
    batchesLoaded: 1,
    totalBatches: 1,
  };
}

/* ── Decompression (browser-side) ──────────────────────────── */

/**
 * Decompress vectors from binary data.
 * Mirrors the Node.js decompressVectors in index-io.ts.
 */
function decompressVectors(
  buffer: Uint8Array,
  vectorCount: number,
  dimensions: number,
  compression: 'none' | 'ternary' | 'pq'
): Int8Array[] {
  if (compression === 'none') {
    const vectors: Int8Array[] = [];
    for (let i = 0; i < vectorCount; i++) {
      const start = i * dimensions;
      vectors.push(new Int8Array(buffer.buffer, buffer.byteOffset + start, dimensions));
    }
    return vectors;
  }

  // Ternary decompression (also handles PQ which falls back to ternary)
  const bytesPerVector = Math.ceil(dimensions / 4);
  const vectors: Int8Array[] = [];

  for (let v = 0; v < vectorCount; v++) {
    const vec = new Int8Array(dimensions);
    const offset = v * bytesPerVector;

    for (let i = 0; i < dimensions; i++) {
      const byteIdx = offset + Math.floor(i / 4);
      const bitOffset = (i % 4) * 2;
      const ternary = (buffer[byteIdx] >> bitOffset) & 0x03;
      // Map back: 0 → -127, 1 → 0, 2 → 127
      vec[i] = ternary === 0 ? -127 : ternary === 2 ? 127 : 0;
    }

    vectors.push(vec);
  }

  return vectors;
}

/* ── Math ──────────────────────────────────────────────────── */

/** Cosine similarity between two Int8 vectors. */
export function cosineSimilarity(a: Int8Array, b: Int8Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}