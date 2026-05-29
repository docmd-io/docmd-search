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
 * Build-time indexer pipeline.
 *
 * Flow: crawl → chunk → embed → quantize → save (multi-batch, progressive).
 *
 * Key features:
 * - Progressive: search available from batch 0, new batches added as embedding completes
 * - Incremental: on re-run, only re-indexes changed/new files (mtime + size check)
 * - Resumable: interrupted indexing resumes from last complete batch
 * - Transparent: progress callback reports every phase for TUI/CLI display
 */

import { stat } from 'node:fs/promises';
import { relative, join, isAbsolute } from 'node:path';
import type { IndexOptions, SearchIndex, Chunk } from '../types.js';
import { crawl } from './crawl.js';
import { chunkDocuments } from './chunk.js';
import { createModelManager, quantizeToInt8 } from '../model.js';
import type { ModelManager, OnModelProgress } from '../model.js';
import { resolveConfig, getModelProfile } from '../config.js';
import type { SearchConfig } from '../config.js';
import {
  saveBatch,
  saveManifest,
  loadManifest,
  createEmptyManifest,
  getCompressionType,
  buildNavTree,
  saveNavigation,
} from '../index-io.js';
import type { IndexManifest, FileRecord } from '../index-io.js';
import { detectChangedFiles, getDetectionMethod } from '../git-aware.js';
import { getCachedModel } from '../model-cache.js';

/* ── Progress Reporting ────────────────────────────────────── */

export type IndexPhase =
  | 'crawling'
  | 'chunking'
  | 'downloading-model'
  | 'embedding'
  | 'saving'
  | 'complete';

export interface IndexProgress {
  phase: IndexPhase;
  /** Current item number (within the phase). */
  current: number;
  /** Total items in this phase. */
  total: number;
  /** Currently processing file (if applicable). */
  file?: string;
  /** Human-readable message. */
  message?: string;
}

export type OnIndexProgress = (progress: IndexProgress) => void;

/* ── Extended Index Options ────────────────────────────────── */

export interface IndexDirectoryOptions extends IndexOptions {
  /** Embedding model ID override. */
  model?: string;
  /** Search config override (takes precedence over defaults). */
  config?: Partial<SearchConfig>;
}

/* ── Batch Size ────────────────────────────────────────────── */

/** Number of chunks per batch file. */
const CHUNKS_PER_BATCH = 256;

/* ── Main Pipeline ─────────────────────────────────────────── */

/**
 * Index a directory: crawl → chunk → embed → save.
 *
 * Supports progressive indexing (batches saved during embedding),
 * incremental updates (only re-indexes changed files), and
 * resumption from interrupted runs.
 */
export async function indexDirectory(
  options: IndexDirectoryOptions,
  onProgress?: OnIndexProgress
): Promise<SearchIndex> {
  const {
    rootDir,
    include,
    exclude,
    chunkSize,
    chunkOverlap,
    outDir: outDirName,
    model: modelOverride,
    config: configOverride,
  } = options;

  // Resolve full config
  const config = await resolveConfig(rootDir, {
    ...configOverride,
    ...(include ? { include } : {}),
    ...(exclude ? { exclude } : {}),
    ...(chunkSize != null ? { chunkSize } : {}),
    ...(chunkOverlap != null ? { chunkOverlap } : {}),
    ...(outDirName ? { outDir: outDirName } : {}),
    ...(modelOverride ? { model: modelOverride } : {}),
  });

  // If outDir is already absolute, use it as-is; otherwise join with rootDir
  const outDir = isAbsolute(config.outDir)
    ? config.outDir
    : join(rootDir, config.outDir);
  const modelProfile = getModelProfile(config.model);

  const notify = (phase: IndexPhase, current: number, total: number, file?: string, message?: string) => {
    onProgress?.({ phase, current, total, file, message });
  };

  // ── Phase 1: Crawl ──────────────────────────────────────

  notify('crawling', 0, 0, undefined, 'Discovering files...');

  const filePaths = await crawl(rootDir, config.include, config.exclude);

  notify('crawling', filePaths.length, filePaths.length, undefined,
    `Found ${filePaths.length} files`);

  // ── Phase 1.5: Incremental check ───────────────────────

  const existingManifest = await loadManifest(outDir);
  let filesToIndex = filePaths;

  if (config.incremental && existingManifest) {
    // Check if we're resuming an interrupted run
    if (existingManifest.status === 'indexing') {
      notify('crawling', 0, 0, undefined, 'Resuming interrupted indexing...');
    }

    // Detect changed files using git (if available) or mtime fallback
    const detectionMethod = await getDetectionMethod(rootDir);
    notify('crawling', 0, 0, undefined, `Detecting changes (${detectionMethod})...`);
    
    const changed = await detectChangedFiles(rootDir, filePaths, existingManifest.files);

    if (changed.length === 0 && existingManifest.status === 'complete') {
      notify('complete', filePaths.length, filePaths.length, undefined,
        'Index is up to date — no changes detected');

      // Return existing index
      const { loadAllBatches } = await import('../index-io.js');
      return loadAllBatches(outDir);
    }

    filesToIndex = changed.length > 0 ? changed : filePaths;
    
    if (changed.length > 0) {
      notify('crawling', changed.length, filePaths.length, undefined,
        `Found ${changed.length} changed files (${detectionMethod})`);
    }
  }

  // ── Phase 2: Chunk ──────────────────────────────────────

  notify('chunking', 0, filesToIndex.length, undefined, 'Chunking documents...');

  const chunks = await chunkDocuments(
    filesToIndex,
    rootDir,
    config.chunkSize,
    config.chunkOverlap
  );

  notify('chunking', filesToIndex.length, filesToIndex.length, undefined,
    `Created ${chunks.length} chunks from ${filesToIndex.length} files`);

  // ── Phase 3: Initialize manifest ───────────────────────

  const manifest: IndexManifest = existingManifest
    ? { ...existingManifest, status: 'indexing' }
    : createEmptyManifest(modelProfile.id, modelProfile.dimensions);

  manifest.model = modelProfile.id;
  manifest.dimensions = modelProfile.dimensions;
  manifest.totalFiles = filePaths.length;

  // Update file records
  for (const fp of filesToIndex) {
    const rel = relative(rootDir, fp);
    const fileInfo = await stat(fp);
    manifest.files[rel] = {
      mtime: fileInfo.mtimeMs,
      size: fileInfo.size,
      batches: [],
    };
  }

  await saveManifest(outDir, manifest);

  // ── Phase 4: Embed + Save (progressive batches) ────────

  let modelManager: ModelManager | null = null;
  let allVectors: Int8Array[] = [];

  try {
    // Use cached model manager (keeps model in memory for subsequent runs)
    modelManager = await getCachedModel(config.model, (p) => {
      if (p.phase === 'downloading') {
        notify('downloading-model', p.progress ?? 0, 100, undefined,
          p.message);
      }
    });

    notify('downloading-model', 0, 100, undefined, 'Loading embedding model...');

// ── Embedding ──────────────────────────────────────────────
  // Note: Worker-based parallel embedding was explored but abandoned —
  // each worker loads the model independently (~30s each), making it slower.
  // Sequential embedding with large batches is the optimal approach.
  const allTexts = chunks.map(c => c.text);

  notify('embedding', 0, chunks.length, undefined, 'Generating embeddings...');

  // embed() handles internal batching (BATCH_SIZE in model.ts).
  // Pass all texts at once — no outer loop needed.
  const allFloatVectors = await modelManager.embed(allTexts, (current, total) => {
    notify('embedding', current, total, chunks[current - 1]?.file,
      `Embedding ${current}/${total} chunks`);
  });
    
    // Quantize all vectors at once (Rust engine accelerates this)
    notify('embedding', chunks.length, chunks.length, undefined, 'Quantizing vectors...');
    const allInt8Vectors = await quantizeToInt8(allFloatVectors);

    // ── Save in batches (progressive) ──────────────────────
    let batchId = existingManifest?.batchCount ?? 0;
    const totalBatches = Math.ceil(chunks.length / CHUNKS_PER_BATCH);
    const compression = getCompressionType(chunks.length);

    for (let i = 0; i < chunks.length; i += CHUNKS_PER_BATCH) {
      const batchChunks = chunks.slice(i, i + CHUNKS_PER_BATCH);
      const batchVectors = allInt8Vectors.slice(i, i + CHUNKS_PER_BATCH);

      notify('saving', batchId, totalBatches, undefined,
        `Saving batch ${batchId + 1}/${totalBatches}...`);

      await saveBatch(outDir, batchId, batchChunks, batchVectors, modelProfile.dimensions, compression);

      allVectors.push(...batchVectors);

      // Update manifest
      manifest.batchCount = batchId + 1;
      manifest.totalChunks = i + batchChunks.length;
      manifest.indexedFiles = new Set(
        chunks.slice(0, i + batchChunks.length).map(c => c.file)
      ).size;
      await saveManifest(outDir, manifest);

      batchId++;
    }
  } catch (err: any) {
    // If embedding fails (missing deps, model error), save what we have
    // so the index is still partially searchable
    if (chunks.length > 0 && allVectors.length === 0) {
      // No embeddings at all — save chunks with zero vectors as fallback
      const zeroFloats = chunks.map(() => new Float32Array(modelProfile.dimensions));
      const zeroVectors = await quantizeToInt8(zeroFloats);
      await saveBatch(outDir, 0, chunks, zeroVectors, modelProfile.dimensions, 'none');
      manifest.batchCount = 1;
      manifest.totalChunks = chunks.length;
      allVectors = zeroVectors;
    }

    manifest.status = 'complete';
    await saveManifest(outDir, manifest);

    // Re-throw with context
    throw new Error(`Embedding failed: ${err?.message ?? String(err)}\n` +
      `Index saved with ${manifest.totalChunks} chunks (without embeddings).`);
  } finally {
    modelManager?.dispose();
  }

  // ── Phase 5: Finalize ──────────────────────────────────

  manifest.status = 'complete';
  manifest.indexedFiles = filePaths.length;
  await saveManifest(outDir, manifest);

  // Generate navigation.json for docmd UI
  const navFiles = chunks.reduce<Map<string, string>>((acc, chunk) => {
    if (!acc.has(chunk.file)) {
      acc.set(chunk.file, chunk.heading ?? '');
    }
    return acc;
  }, new Map());

  const navEntries = [...navFiles.entries()].map(([path, title]) => ({ path, title }));
  await saveNavigation(outDir, buildNavTree(navEntries));

  notify('complete', chunks.length, chunks.length, undefined,
    `Indexed ${chunks.length} chunks from ${filePaths.length} files`);

  // Return the full SearchIndex
  return {
    version: 1,
    model: modelProfile.id,
    dimensions: modelProfile.dimensions,
    chunks,
    vectors: allVectors,
  };
}
