/* ── Core Types ─────────────────────────────────────────────── */

/** A chunk of content extracted from a file. */
export interface Chunk {
  /** Source file path (relative to index root). */
  file: string;
  /** Section heading, if any. */
  heading?: string;
  /** Raw text content of the chunk. */
  text: string;
  /** Byte offset range in original file. */
  range: [start: number, end: number];
}

/** A single vector entry in the search index. */
export interface VectorEntry {
  /** Index into the chunks array. */
  chunkIndex: number;
  /** Quantized int8 embedding vector. */
  vector: Int8Array;
}

/** The serialized search index output. */
export interface SearchIndex {
  /** Index format version. */
  version: number;
  /** Embedding model identifier used at build time. */
  model: string;
  /** Vector dimensionality. */
  dimensions: number;
  /** All content chunks. */
  chunks: Chunk[];
  /** Quantized vectors (parallel to chunks). */
  vectors: Int8Array[];
}

/** Options for the indexing pipeline. */
export interface IndexOptions {
  /** Root directory to index. */
  rootDir: string;
  /** Glob patterns to include (default: ['**\/*.md', '**\/*.txt', '**\/*.html']). */
  include?: string[];
  /** Glob patterns to exclude. */
  exclude?: string[];
  /** Max tokens per chunk (default: 256). */
  chunkSize?: number;
  /** Chunk overlap in tokens (default: 32). */
  chunkOverlap?: number;
  /** Output directory for the index (default: '.docmd-search'). */
  outDir?: string;
}

/** A search result returned to the client. */
export interface SearchResult {
  /** Relevance score (0–1). */
  score: number;
  /** The matched chunk. */
  chunk: Chunk;
}
