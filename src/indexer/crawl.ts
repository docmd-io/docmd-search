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

import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

/** Crawl a directory and return matching file paths. */
export async function crawl(
  rootDir: string,
  include: string[],
  exclude: string[]
): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const rel = relative(rootDir, fullPath);

      // Skip excluded patterns (simple check for now)
      if (exclude.some(p => matchSimpleGlob(rel, p))) continue;

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (include.some(p => matchSimpleGlob(rel, p))) {
        results.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return results;
}

/** Minimal glob matcher — supports ** and * only. */
function matchSimpleGlob(path: string, pattern: string): boolean {
  // Use placeholder to avoid double-replacement
  let regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex chars
    .replace(/\*\*/g, '§§')                 // placeholder for **
    .replace(/\*/g, '[^/]*')                // * matches anything except /
    .replace(/§§\//g, '(.*/)?')             // **/ matches zero or more path segments
    .replace(/§§/g, '.*');                  // ** at end matches anything
  return new RegExp(`^${regex}$`).test(path);
}