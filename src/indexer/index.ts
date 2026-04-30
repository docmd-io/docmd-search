/**
 * Build-time indexer: crawl → chunk → embed → serialize.
 */

import type { IndexOptions, SearchIndex } from '../types.js';
import { crawl } from './crawl.js';
import { chunkDocuments } from './chunk.js';

export async function indexDirectory(options: IndexOptions): Promise<SearchIndex> {
  const {
    rootDir,
    include = ['**/*.md', '**/*.txt', '**/*.html'],
    exclude = ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    chunkSize = 256,
    chunkOverlap = 32,
  } = options;

  // 1. Crawl files
  const files = await crawl(rootDir, include, exclude);
  console.log(`  Found ${files.length} files`);

  // 2. Chunk content
  const chunks = await chunkDocuments(files, rootDir, chunkSize, chunkOverlap);
  console.log(`  Created ${chunks.length} chunks`);

  // 3. Generate embeddings (placeholder — will integrate ONNX model)
  //    For now, return empty vectors so the pipeline is wired end-to-end.
  const dimensions = 384; // MiniLM-L6-v2 output size
  const vectors = chunks.map(() => new Int8Array(dimensions));

  return {
    version: 1,
    model: 'all-MiniLM-L6-v2',
    dimensions,
    chunks,
    vectors,
  };
}
