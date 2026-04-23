/**
 * Client-side search runtime.
 * Loaded in the browser — performs cosine similarity over pre-built vectors.
 * No ML model, no WASM, just math. Target: <5KB minified.
 */

import type { Chunk, SearchResult } from '../types.js';

interface ClientIndex {
  dimensions: number;
  chunks: Chunk[];
  vectors: Int8Array; // flat buffer
}

let _index: ClientIndex | null = null;

/** Load the search index from a URL base path. */
export async function load(basePath: string): Promise<void> {
  const [metaRes, vecRes] = await Promise.all([
    fetch(`${basePath}/search-index.json`),
    fetch(`${basePath}/search-index.bin`),
  ]);

  const meta = await metaRes.json();
  const vecBuf = await vecRes.arrayBuffer();

  _index = {
    dimensions: meta.dimensions,
    chunks: meta.chunks,
    vectors: new Int8Array(vecBuf),
  };
}

/** Search the index. Returns top-k results sorted by relevance. */
export function search(query: string, topK = 10): SearchResult[] {
  if (!_index) throw new Error('docmd-search: index not loaded. Call load() first.');

  // TODO: query embedding — for now, placeholder using term-frequency scoring
  //       Once we ship build-time embeddings, we'll also ship a tiny
  //       query encoder (quantized, ~200KB WASM) or pre-compute common queries.
  return termFrequencyFallback(query, _index, topK);
}

/** Simple BM25-ish term frequency fallback until vector search is wired. */
function termFrequencyFallback(query: string, index: ClientIndex, topK: number): SearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scores: { score: number; chunk: Chunk }[] = [];

  for (const chunk of index.chunks) {
    const text = chunk.text.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const count = text.split(term).length - 1;
      // BM25-like saturation
      score += count / (count + 1.5);
    }
    if (score > 0) scores.push({ score, chunk });
  }

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK);
}

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
