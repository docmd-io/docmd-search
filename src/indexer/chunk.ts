import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import type { Chunk } from '../types.js';

/** Split documents into overlapping chunks by approximate token count. */
export async function chunkDocuments(
  files: string[],
  rootDir: string,
  chunkSize: number,
  chunkOverlap: number
): Promise<Chunk[]> {
  const chunks: Chunk[] = [];

  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const rel = relative(rootDir, file);
    const fileChunks = chunkText(content, rel, chunkSize, chunkOverlap);
    chunks.push(...fileChunks);
  }

  return chunks;
}

/** Chunk a single document's text. Splits on headings first, then by size. */
function chunkText(
  text: string,
  file: string,
  maxTokens: number,
  overlap: number
): Chunk[] {
  const chunks: Chunk[] = [];

  // Split by markdown headings
  const sections = text.split(/^(#{1,6}\s+.+)$/m);
  let currentHeading: string | undefined;
  let buffer = '';
  let byteOffset = 0;

  for (const section of sections) {
    if (/^#{1,6}\s+/.test(section)) {
      // Flush previous buffer
      if (buffer.trim()) {
        chunks.push(...splitBySize(buffer, file, currentHeading, byteOffset, maxTokens, overlap));
      }
      currentHeading = section.replace(/^#+\s+/, '').trim();
      byteOffset += Buffer.byteLength(buffer, 'utf-8');
      buffer = '';
    } else {
      buffer += section;
    }
  }

  // Flush remaining
  if (buffer.trim()) {
    chunks.push(...splitBySize(buffer, file, currentHeading, byteOffset, maxTokens, overlap));
  }

  return chunks;
}

/** Split text into chunks of ~maxTokens words with overlap. */
function splitBySize(
  text: string,
  file: string,
  heading: string | undefined,
  startOffset: number,
  maxTokens: number,
  overlap: number
): Chunk[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxTokens) {
    return [{
      file,
      heading,
      text: text.trim(),
      range: [startOffset, startOffset + Buffer.byteLength(text, 'utf-8')],
    }];
  }

  const chunks: Chunk[] = [];
  let i = 0;
  while (i < words.length) {
    const slice = words.slice(i, i + maxTokens).join(' ');
    chunks.push({
      file,
      heading,
      text: slice,
      range: [startOffset, startOffset + Buffer.byteLength(slice, 'utf-8')],
    });
    i += maxTokens - overlap;
  }
  return chunks;
}
