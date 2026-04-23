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
  const regex = pattern
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*');
  return new RegExp(`^${regex}$`).test(path);
}
