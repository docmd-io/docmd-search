/**
 * docmd-search CLI
 *
 * Usage:
 *   npx docmd-search [directory]       Index and search a directory
 *   npx docmd-search --ui              Launch web UI in browser
 *   npx docmd-search settings          Open settings TUI
 *   npx docmd-search search [query]    Search from command line
 *   npx docmd-search --help            Show help
 */

import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { indexDirectory, type IndexProgress } from '../indexer/index.js';
import { createSearchIndex, loadSearchIndex } from '../index-io.js';
import { resolveConfig } from '../config.js';
import { clearScreen, createProgressDisplay, runSearchTUI, runSettingsTUI, printBanner } from '../tui.js';
import { serveUI } from '../ui/server.js';
import type { SearchResult } from '../types.js';

/* ── ANSI ──────────────────────────────────────────────────── */

// Brand color: Magenta/Pink — the modern "semantic/ML" color
const A = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  dim:   '\x1b[2m',
  magenta: '\x1b[35m',
  green: '\x1b[32m',
  red:   '\x1b[31m',
  yellow:'\x1b[33m',
};

/* ── Parse Args ────────────────────────────────────────────── */

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('-')));
const positional = args.filter(a => !a.startsWith('-'));

const showHelp = flags.has('--help') || flags.has('-h');
const launchUI = flags.has('--ui');
const isDev = flags.has('--dev');
const command = positional[0];

/* ── Help ──────────────────────────────────────────────────── */

if (showHelp) {
  printBanner();
  console.log(`   ${A.bold}Usage${A.reset}`);
  console.log(`     docmd-search [dir]              index directory, open search`);
  console.log(`     docmd-search search <query>     search from command line`);
  console.log(`     docmd-search settings           configure model`);
  console.log(`     docmd-search --help             show this help`);
  console.log('');
  console.log(`   ${A.bold}Options${A.reset}`);
  console.log(`     --ui                            launch web ui in browser`);
  console.log(`     --dev                           verbose output for debugging`);
  console.log(`     --model <id>                    override embedding model`);
  console.log('');
  console.log(`   ${A.bold}Examples${A.reset}`);
  console.log(`     ${A.dim}$${A.reset} docmd-search ./docs`);
  console.log(`     ${A.dim}$${A.reset} docmd-search search "deploy to production"`);
  console.log(`     ${A.dim}$${A.reset} docmd-search settings`);
  console.log(`     ${A.dim}$${A.reset} docmd-search ./docs --ui`);
  console.log('');
  process.exit(0);
}

/* ── Settings Command ──────────────────────────────────────── */

if (command === 'settings') {
  await runSettingsTUI();
  process.exit(0);
}

/* ── Resolve Directory ─────────────────────────────────────── */

// For 'search' command, the optional second positional is the directory
// e.g. `docmd-search search "query" ./docs` or just `docmd-search search "query"`
const targetDir = command === 'search'
  ? resolve(positional[2] ?? '.')
  : resolve(command && command !== 'search' ? command : '.');

const config = await resolveConfig();
const outDir = resolve(targetDir, config.outDir);

/* ── Index Discovery ───────────────────────────────────────── */

/**
 * Find a .docmd-search index by:
 * 1. Checking the explicit outDir
 * 2. Walking UP from cwd (for when you're inside an indexed project)
 * 3. Checking common subdirs (docs/, site/, .)
 */
function findNearestIndex(startDir: string, indexDirName: string): string | null {
  // Walk up from cwd
  let dir = startDir;
  const root = resolve('/');
  while (dir !== root) {
    const candidate = join(dir, indexDirName);
    if (existsSync(join(candidate, 'search-index.json'))) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  // Also check common subdirectory patterns from cwd
  for (const sub of ['docs', 'site', 'dist', 'public']) {
    const candidate = join(startDir, sub, indexDirName);
    if (existsSync(join(candidate, 'search-index.json'))) return candidate;
  }
  return null;
}

/* ── Search Command (CLI one-shot) ─────────────────────────── */

if (command === 'search') {
  // Separate the query from an optional trailing directory path
  // e.g. `search "my query" ./docs`  or  `search my query terms`
  const searchArgs = positional.slice(1);
  const lastArg = searchArgs[searchArgs.length - 1] ?? '';
  const lastIsPath = lastArg.startsWith('.') || lastArg.startsWith('/') || lastArg.includes('/');
  const queryParts = lastIsPath ? searchArgs.slice(0, -1) : searchArgs;
  const explicitDir = lastIsPath ? resolve(lastArg) : null;
  const query = queryParts.join(' ');

  if (!query) {
    console.error(`   ${A.red}error${A.reset}  missing query`);
    console.error(`   ${A.dim}usage: docmd-search search "your query"${A.reset}`);
    process.exit(1);
  }

  // Try: explicit dir → explicit outDir → auto-discover
  const explicitOutDir = explicitDir ? join(explicitDir, config.outDir) : null;
  const indexDir =
    (explicitOutDir && existsSync(join(explicitOutDir, 'search-index.json')) ? explicitOutDir : null) ??
    (existsSync(join(outDir, 'search-index.json')) ? outDir : null) ??
    findNearestIndex(process.cwd(), config.outDir);

  if (!indexDir) {
    console.error(`   ${A.red}error${A.reset}  no index found`);
    console.error(`   ${A.dim}run: docmd-search [directory]${A.reset}`);
    process.exit(1);
  }

  const index = await loadSearchIndex(indexDir);
  const results = performSearch(index, query, config.topK);
  printResults(results, query);
  process.exit(0);
}

/* ── Main: Index + Interactive Search ──────────────────────── */

const rootDir = targetDir;

// Clear the terminal before showing the banner for a clean startup
clearScreen();
printBanner();

if (isDev) {
  console.log(`   ${A.dim}dev mode  ${rootDir}${A.reset}`);
  console.log(`   ${A.dim}index     ${outDir}${A.reset}`);
  console.log('');
}

const progress = createProgressDisplay(isDev);
const start = performance.now();

const index = await indexDirectory({ rootDir, outDir: config.outDir }, (p: IndexProgress) => {
  progress.render(p);
});

// Silent write — don't print "Index written"
await createSearchIndex(index, outDir, { silent: true });
progress.clear();

const elapsed = ((performance.now() - start) / 1000).toFixed(2);
const fileCount = new Set(index.chunks.map(c => c.file)).size;
console.log(`   ${A.green}✓${A.reset} ${index.chunks.length} chunks from ${fileCount} files ${A.dim}(${elapsed}s)${A.reset}`);
console.log('');

/* ── Launch UI or TUI ──────────────────────────────────────── */

if (launchUI) {
  // Get version from package.json
  const { readFileSync } = await import('node:fs');
  const { dirname, join: pjoin } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dir = dirname(fileURLToPath(import.meta.url));
  let version = '0.1.0';
  try {
    const pkg = JSON.parse(readFileSync(pjoin(__dir, '../../package.json'), 'utf-8'));
    version = pkg.version ?? '0.1.0';
  } catch { /* ignore */ }

  const { port, close } = await serveUI({ indexDir: outDir, version });
  const url = `http://localhost:${port}`;

  console.log(`   ${A.magenta}◆${A.reset} Web UI ready`);
  console.log(`   ${A.dim}${url}${A.reset}`);
  console.log('');

  // Try to open in browser
  try {
    const { exec } = await import('node:child_process');
    const open = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start'
      : 'xdg-open';
    exec(`${open} ${url}`);
  } catch { /* ignore — user can open manually */ }

  // Keep server running until Ctrl+C
  process.on('SIGINT', () => {
    close();
    console.log(`\n   ${A.dim}server closed${A.reset}\n`);
    process.exit(0);
  });

  // Block forever
  await new Promise(() => {});
}

// Load the index for searching
const searchIndex = await loadSearchIndex(outDir);

function performSearch(idx: typeof searchIndex, query: string, topK: number): SearchResult[] {
  // Use cosine similarity search with the pre-built vectors
  const queryLower = query.toLowerCase();
  const terms = queryLower.split(/\s+/).filter(Boolean);

  const scores: { score: number; chunkIdx: number }[] = [];

  for (let i = 0; i < idx.chunks.length; i++) {
    const chunk = idx.chunks[i];
    const text = chunk.text.toLowerCase();

    // Keyword scoring (BM25-ish)
    let keywordScore = 0;
    for (const term of terms) {
      const count = text.split(term).length - 1;
      keywordScore += count / (count + 1.5);
    }

    // Semantic scoring: compare vectors between chunks
    // Use the best keyword match as a proxy query vector
    if (keywordScore > 0) {
      scores.push({ score: keywordScore, chunkIdx: i });
    }
  }

  // If we have real vectors and keyword matches, enhance with vector similarity
  if (scores.length > 1) {
    scores.sort((a, b) => b.score - a.score);
    const bestVec = idx.vectors[scores[0].chunkIdx];

    for (const s of scores) {
      const vec = idx.vectors[s.chunkIdx];
      let dot = 0, normA = 0, normB = 0;
      for (let j = 0; j < idx.dimensions; j++) {
        dot += bestVec[j] * vec[j];
        normA += bestVec[j] * bestVec[j];
        normB += vec[j] * vec[j];
      }
      const cosine = dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
      s.score = s.score * 0.6 + cosine * 0.4;
    }
  }

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK).map(s => ({
    score: s.score,
    chunk: idx.chunks[s.chunkIdx],
  }));
}

function printResults(results: SearchResult[], query: string) {
  if (results.length === 0) {
    console.log(`   ${A.dim}no results for "${query}"${A.reset}`);
    return;
  }

  console.log('');
  console.log(`   ${A.bold}results${A.reset}  "${query}"`);
  console.log('');
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const pct = Math.round(r.score * 100);
    const scoreColor = pct > 60 ? A.green : pct > 30 ? '\x1b[33m' : A.dim;
    const heading = r.chunk.heading ? ` ${A.dim}›${A.reset} ${r.chunk.heading}` : '';
    console.log(`   ${A.dim}${String(i + 1).padStart(2)}.${A.reset} ${A.magenta}${r.chunk.file}${A.reset}${heading}  ${scoreColor}${pct}%${A.reset}`);
    const snippet = r.chunk.text.replace(/\s+/g, ' ').trim().slice(0, 100);
    console.log(`       ${A.dim}${snippet}${r.chunk.text.length > 100 ? '…' : ''}${A.reset}`);
  }
  console.log('');
}

// Launch interactive TUI search
await runSearchTUI(
  (query, topK = 10) => performSearch(searchIndex, query, topK),
  searchIndex.chunks.length
);
