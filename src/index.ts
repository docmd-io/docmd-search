/**
 * docmd-search — Universal offline semantic search engine.
 *
 * Build-time: crawl files → chunk → embed → output compressed vector index.
 * Runtime: cosine similarity over quantized vectors. No model in the browser.
 */

export { indexDirectory } from './indexer/index.js';
export { createSearchIndex, loadSearchIndex } from './index-io.js';
export type { SearchIndex, SearchResult, IndexOptions, Chunk } from './types.js';
