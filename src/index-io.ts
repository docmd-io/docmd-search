import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SearchIndex } from './types.js';

const INDEX_FILE = 'search-index.bin';
const META_FILE = 'search-index.json';

/** Serialize and write the search index to disk. */
export async function createSearchIndex(index: SearchIndex, outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });

  // Meta (JSON) — chunks + metadata
  const meta = {
    version: index.version,
    model: index.model,
    dimensions: index.dimensions,
    chunks: index.chunks,
  };
  await writeFile(join(outDir, META_FILE), JSON.stringify(meta), 'utf-8');

  // Vectors (binary) — flat Int8Array buffer
  const totalBytes = index.vectors.length * index.dimensions;
  const buffer = new Int8Array(totalBytes);
  for (let i = 0; i < index.vectors.length; i++) {
    buffer.set(index.vectors[i], i * index.dimensions);
  }
  await writeFile(join(outDir, INDEX_FILE), Buffer.from(buffer.buffer));

  const metaSize = (JSON.stringify(meta).length / 1024).toFixed(1);
  const vecSize = (totalBytes / 1024).toFixed(1);
  console.log(`  Index written → ${outDir}`);
  console.log(`    meta: ${metaSize} KB · vectors: ${vecSize} KB`);
}

/** Load a search index from disk. */
export async function loadSearchIndex(dir: string): Promise<SearchIndex> {
  const meta = JSON.parse(await readFile(join(dir, META_FILE), 'utf-8'));
  const bin = await readFile(join(dir, INDEX_FILE));
  const flat = new Int8Array(bin.buffer, bin.byteOffset, bin.byteLength);

  const vectors: Int8Array[] = [];
  for (let i = 0; i < meta.chunks.length; i++) {
    vectors.push(flat.slice(i * meta.dimensions, (i + 1) * meta.dimensions));
  }

  return { ...meta, vectors };
}
