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
 * Multi-batch Index I/O.
 *
 * Index format:
 *   .docmd-search/
 *   ├── manifest.json          — Master manifest (tracks files, batches, status)
 *   ├── navigation.json        — Pre-built nav tree for docmd UI
 *   └── batches/
 *       ├── 000.json + 000.bin — Batch 0 (chunk metadata + vectors)
 *       ├── 001.json + 001.bin — Batch 1
 *       └── ...
 *
 * Multi-batch design enables:
 *   - Instant search availability (from batch 000 onward)
 *   - Resumable indexing after interruption
 *   - Incremental client loading
 *   - Automatic compression based on total chunk count
 */

import { writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Chunk, SearchIndex } from './types.js';

/* ── Manifest Types ────────────────────────────────────────── */

/** Per-file tracking data for incremental indexing. */
export interface FileRecord {
  /** File modification time (ms since epoch). */
  mtime: number;
  /** File size in bytes. */
  size: number;
  /** Batch IDs containing chunks from this file. */
  batches: number[];
}

/** Compression type for a batch's vectors. */
export type CompressionType = 'none' | 'ternary' | 'pq';

/** Master manifest tracking the entire index state. */
export interface IndexManifest {
  /** Manifest format version. */
  version: number;
  /** Embedding model used. */
  model: string;
  /** Vector dimensionality. */
  dimensions: number;
  /** Current indexing status. */
  status: 'indexing' | 'complete';
  /** Total files discovered. */
  totalFiles: number;
  /** Files successfully indexed so far. */
  indexedFiles: number;
  /** Total chunks across all batches. */
  totalChunks: number;
  /** Number of batches written. */
  batchCount: number;
  /** Per-file tracking for incremental updates. */
  files: Record<string, FileRecord>;
}

/** Metadata stored alongside each batch's vector data. */
export interface BatchMeta {
  /** Batch identifier (0, 1, 2...). */
  batchId: number;
  /** Chunks in this batch. */
  chunks: Chunk[];
  /** Vector dimensionality. */
  dimensions: number;
  /** Compression used on the .bin file. */
  compression: CompressionType;
  /** Number of vectors in the .bin file. */
  vectorCount: number;
}

/** Navigation node for the pre-built nav tree. */
export interface NavNode {
  /** Display title (from first heading or filename). */
  title: string;
  /** File path relative to index root. */
  path: string;
  /** Child nodes (subdirectories/nested files). */
  children?: NavNode[];
}

/* ── Compression ───────────────────────────────────────────── */

/**
 * Determine compression type based on total chunk count.
 *
 * | Chunks    | Compression | Ratio |
 * |-----------|-------------|-------|
 * | < 100     | none        | 1x    |
 * | 100-2000  | ternary     | ~4x   |
 * | > 2000    | pq          | ~8-16x|
 */
export function getCompressionType(totalChunks: number): CompressionType {
  if (totalChunks >= 2000) return 'pq';
  if (totalChunks >= 100) return 'ternary';
  return 'none';
}

/**
 * Compress Int8 vectors using ternary quantization.
 * Maps each value to -1, 0, or +1 and packs 4 values per byte.
 */
function ternaryCompress(vectors: Int8Array[], dimensions: number): Buffer {
  const results: Buffer[] = [];

  for (const vec of vectors) {
    // Each value becomes 2 bits: 00 = -1, 01 = 0, 10 = +1
    const bytesNeeded = Math.ceil(dimensions / 4);
    const packed = Buffer.alloc(bytesNeeded);

    for (let i = 0; i < dimensions; i++) {
      const val = vec[i];
      // Map Int8 to ternary: < -42 → -1, > 42 → +1, else → 0
      const ternary = val < -42 ? 0 : val > 42 ? 2 : 1;
      const byteIdx = Math.floor(i / 4);
      const bitOffset = (i % 4) * 2;
      packed[byteIdx] |= ternary << bitOffset;
    }

    results.push(packed);
  }

  return Buffer.concat(results);
}

/**
 * Decompress ternary-encoded vectors back to Int8.
 */
function ternaryDecompress(buffer: Buffer, vectorCount: number, dimensions: number): Int8Array[] {
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

/**
 * Compress vectors based on the compression type.
 * For 'none': flat concatenation of Int8 vectors.
 * For 'ternary': 2-bit ternary packing.
 * For 'pq': currently falls back to ternary (PQ is a future optimisation).
 */
export function compressVectors(
  vectors: Int8Array[],
  dimensions: number,
  type: CompressionType
): Buffer {
  if (type === 'none') {
    // Flat concatenation
    const buffer = Buffer.alloc(vectors.length * dimensions);
    for (let i = 0; i < vectors.length; i++) {
      buffer.set(vectors[i], i * dimensions);
    }
    return buffer;
  }

  // Ternary and PQ (PQ falls back to ternary for now)
  return ternaryCompress(vectors, dimensions);
}

/**
 * Decompress vectors based on the compression type.
 */
export function decompressVectors(
  buffer: Buffer,
  vectorCount: number,
  dimensions: number,
  type: CompressionType
): Int8Array[] {
  if (type === 'none') {
    const vectors: Int8Array[] = [];
    for (let i = 0; i < vectorCount; i++) {
      const start = i * dimensions;
      vectors.push(new Int8Array(buffer.buffer, buffer.byteOffset + start, dimensions));
    }
    return vectors;
  }

  // Ternary and PQ
  return ternaryDecompress(buffer, vectorCount, dimensions);
}

/* ── Batch I/O ─────────────────────────────────────────────── */

/** Pad a batch ID to 3 digits: 0 → '000', 12 → '012'. */
function padBatchId(id: number): string {
  return String(id).padStart(3, '0');
}

/**
 * Save a single batch (chunk metadata + vector data) to disk.
 */
export async function saveBatch(
  outDir: string,
  batchId: number,
  chunks: Chunk[],
  vectors: Int8Array[],
  dimensions: number,
  compression?: CompressionType
): Promise<void> {
  const batchDir = join(outDir, 'batches');
  await mkdir(batchDir, { recursive: true });

  const prefix = padBatchId(batchId);
  const comp = compression ?? 'none';

  // Batch metadata (JSON)
  const meta: BatchMeta = {
    batchId,
    chunks,
    dimensions,
    compression: comp,
    vectorCount: vectors.length,
  };
  await writeFile(join(batchDir, `${prefix}.json`), JSON.stringify(meta), 'utf-8');

  // Vector data (binary, possibly compressed)
  const binData = compressVectors(vectors, dimensions, comp);
  await writeFile(join(batchDir, `${prefix}.bin`), binData);
}

/**
 * Load a single batch from disk.
 */
export async function loadBatch(
  dir: string,
  batchId: number
): Promise<{ chunks: Chunk[]; vectors: Int8Array[] }> {
  const prefix = padBatchId(batchId);
  const batchDir = join(dir, 'batches');

  const meta: BatchMeta = JSON.parse(
    await readFile(join(batchDir, `${prefix}.json`), 'utf-8')
  );

  const bin = await readFile(join(batchDir, `${prefix}.bin`));
  const buffer = Buffer.from(bin.buffer, bin.byteOffset, bin.byteLength);

  const vectors = decompressVectors(buffer, meta.vectorCount, meta.dimensions, meta.compression);

  return { chunks: meta.chunks, vectors };
}

/* ── Manifest I/O ──────────────────────────────────────────── */

const MANIFEST_FILE = 'manifest.json';

/**
 * Load the index manifest. Returns null if none exists.
 */
export async function loadManifest(dir: string): Promise<IndexManifest | null> {
  try {
    const raw = await readFile(join(dir, MANIFEST_FILE), 'utf-8');
    return JSON.parse(raw) as IndexManifest;
  } catch {
    return null;
  }
}

/**
 * Save or update the manifest. Atomic write (full replace).
 */
export async function saveManifest(dir: string, manifest: IndexManifest): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf-8');
}

/**
 * Update specific fields in the manifest without overwriting the rest.
 */
export async function updateManifest(
  dir: string,
  updates: Partial<IndexManifest>
): Promise<IndexManifest> {
  const existing = await loadManifest(dir);
  const manifest: IndexManifest = {
    ...(existing ?? createEmptyManifest('', 0)),
    ...updates,
  };
  await saveManifest(dir, manifest);
  return manifest;
}

/**
 * Create an empty manifest template.
 */
export function createEmptyManifest(model: string, dimensions: number): IndexManifest {
  return {
    version: 1,
    model,
    dimensions,
    status: 'indexing',
    totalFiles: 0,
    indexedFiles: 0,
    totalChunks: 0,
    batchCount: 0,
    files: {},
  };
}

/* ── Navigation.json ───────────────────────────────────────── */

/**
 * Generate a navigation tree from a list of file paths.
 * Groups files by directory and extracts titles from headings.
 *
 * @param files - Array of { path, title } objects
 */
export function buildNavTree(files: { path: string; title: string }[]): NavNode[] {
  const root: NavNode[] = [];
  const dirMap = new Map<string, NavNode>();

  // Sort files for consistent ordering
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sorted) {
    const parts = file.path.split('/');
    const fileName = parts.pop()!;

    // Ensure all parent directories exist as nav nodes
    let currentLevel = root;
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!dirMap.has(currentPath)) {
        const dirNode: NavNode = {
          title: formatTitle(part),
          path: currentPath,
          children: [],
        };
        currentLevel.push(dirNode);
        dirMap.set(currentPath, dirNode);
      }

      currentLevel = dirMap.get(currentPath)!.children!;
    }

    // Add the file node
    currentLevel.push({
      title: file.title || formatTitle(fileName.replace(/\.\w+$/, '')),
      path: file.path,
    });
  }

  return root;
}

/** Convert a filename slug to a title. */
function formatTitle(slug: string): string {
  return slug
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Save the navigation tree to disk.
 */
export async function saveNavigation(dir: string, tree: NavNode[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  const nav = { tree };
  await writeFile(join(dir, 'navigation.json'), JSON.stringify(nav, null, 2), 'utf-8');
}

/* ── Query Helpers ─────────────────────────────────────────── */

/**
 * Check if a searchable index exists (at least batch 000).
 */
export function hasSearchableIndex(dir: string): boolean {
  return existsSync(join(dir, 'batches', '000.json'));
}

/**
 * Load all batches and merge into a unified SearchIndex.
 */
export async function loadAllBatches(dir: string): Promise<SearchIndex> {
  const manifest = await loadManifest(dir);
  if (!manifest) {
    throw new Error(`No index manifest found in ${dir}`);
  }

  const allChunks: Chunk[] = [];
  const allVectors: Int8Array[] = [];

  for (let i = 0; i < manifest.batchCount; i++) {
    const { chunks, vectors } = await loadBatch(dir, i);
    allChunks.push(...chunks);
    allVectors.push(...vectors);
  }

  return {
    version: manifest.version,
    model: manifest.model,
    dimensions: manifest.dimensions,
    chunks: allChunks,
    vectors: allVectors,
  };
}

/* ── Legacy Compatibility ──────────────────────────────────── */

/**
 * Create a search index in the legacy single-file format.
 * Kept for backward compatibility; new code should use saveBatch + saveManifest.
 */
export async function createSearchIndex(
  index: SearchIndex,
  outDir: string,
  options?: { silent?: boolean }
): Promise<void> {
  await mkdir(outDir, { recursive: true });

  // Write as a single batch (batch 0)
  const compression = getCompressionType(index.chunks.length);
  await saveBatch(outDir, 0, index.chunks, index.vectors, index.dimensions, compression);

  // Write manifest
  const manifest = createEmptyManifest(index.model, index.dimensions);
  manifest.status = 'complete';
  manifest.totalChunks = index.chunks.length;
  manifest.batchCount = 1;
  await saveManifest(outDir, manifest);

  if (!options?.silent) {
    const metaSize = (JSON.stringify(index.chunks).length / 1024).toFixed(1);
    const vecSize = ((index.vectors.length * index.dimensions) / 1024).toFixed(1);
    console.log(`  Index written → ${outDir}`);
    console.log(`    meta: ${metaSize} KB · vectors: ${vecSize} KB · compression: ${compression}`);
  }
}

/**
 * Load a search index (supports both multi-batch and legacy formats).
 */
export async function loadSearchIndex(dir: string): Promise<SearchIndex> {
  // Try multi-batch format first
  const manifest = await loadManifest(dir);
  if (manifest) {
    return loadAllBatches(dir);
  }

  // Fall back to legacy single-file format
  const META_FILE = 'search-index.json';
  const INDEX_FILE = 'search-index.bin';

  const meta = JSON.parse(await readFile(join(dir, META_FILE), 'utf-8'));
  const bin = await readFile(join(dir, INDEX_FILE));
  const flat = new Int8Array(bin.buffer, bin.byteOffset, bin.byteLength);

  const vectors: Int8Array[] = [];
  for (let i = 0; i < meta.chunks.length; i++) {
    vectors.push(flat.slice(i * meta.dimensions, (i + 1) * meta.dimensions));
  }

  return { ...meta, vectors };
}
