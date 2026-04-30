

/**
 * docmd-search CLI
 *
 * Usage:
 *   docmd-search [directory]          Index + interactive TUI search
 *   docmd-search [directory] --ui     Index + launch docmd web UI
 *   docmd-search [directory] --dev    Verbose output
 *   docmd-search --model <id>         Override embedding model
 *   docmd-search --settings           Open settings TUI
 *   docmd-search --version            Print version
 *   docmd-search --help               Show help
 */

import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexDirectory } from '../indexer/index.js';
import type { IndexProgress } from '../indexer/index.js';
import { loadSearchIndex, loadAllBatches, hasSearchableIndex } from '../index-io.js';
import { resolveConfig, isWizardCompleted } from '../config.js';
import {
  clearScreen,
  createProgressDisplay,
  runSearchTUI,
  runSettingsTUI,
  printBanner,
  runSetupWizard,
} from '../tui.js';
import { checkPeerDeps, formatMissingDepsMessage } from '../model.js';
import type { SearchResult, SearchIndex } from '../types.js';

/* ── ANSI ──────────────────────────────────────────────────── */

const A = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  dim:   '\x1b[2m',
  magenta: '\x1b[35m',
  green: '\x1b[32m',
  red:   '\x1b[31m',
  yellow:'\x1b[33m',
};

/* ── Version ───────────────────────────────────────────────── */

function getVersion(): string {
  try {
    const __dir = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dir, '../../package.json'), 'utf-8'));
    return pkg.version ?? '0.1.0';
  } catch {
    return '0.1.0';
  }
}

/* ── Parse Args ────────────────────────────────────────────── */

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('-')));
const positional = args.filter(a => !a.startsWith('-'));

const showHelp = flags.has('--help') || flags.has('-h');
const showVersion = flags.has('--version') || flags.has('-v');
const launchUI = flags.has('--ui');
const isDev = flags.has('--dev');
const openSettings = flags.has('--settings');

// Extract --model value
let modelOverride: string | undefined;
const modelIdx = args.indexOf('--model');
if (modelIdx !== -1 && args[modelIdx + 1] && !args[modelIdx + 1].startsWith('-')) {
  modelOverride = args[modelIdx + 1];
}

const version = getVersion();

/* ── Version ───────────────────────────────────────────────── */

if (showVersion) {
  console.log(`docmd-search v${version}`);
  process.exit(0);
}

/* ── Help ──────────────────────────────────────────────────── */

if (showHelp) {
  printBanner(version);
  console.log(`   ${A.bold}Usage${A.reset}`);
  console.log(`     docmd-search [dir]              index directory, open search`);
  console.log(`     docmd-search [dir] --ui          index + launch web ui`);
  console.log(`     docmd-search --settings          configure model`);
  console.log(`     docmd-search --help              show this help`);
  console.log('');
  console.log(`   ${A.bold}Options${A.reset}`);
  console.log(`     --ui                            launch web ui in browser`);
  console.log(`     --dev                           verbose output for debugging`);
  console.log(`     --model <id>                    override embedding model`);
  console.log(`     --version                       show version`);
  console.log('');
  console.log(`   ${A.bold}Examples${A.reset}`);
  console.log(`     ${A.dim}$${A.reset} docmd-search ./docs`);
  console.log(`     ${A.dim}$${A.reset} docmd-search ./docs --ui`);
  console.log(`     ${A.dim}$${A.reset} docmd-search --settings`);
  console.log(`     ${A.dim}$${A.reset} docmd-search ./my-project --model Xenova/bge-small-en-v1.5`);
  console.log('');
  process.exit(0);
}

/* ── Settings Command ──────────────────────────────────────── */

if (openSettings) {
  await runSettingsTUI();
  process.exit(0);
}

/* ── First-Run Detection ──────────────────────────────────── */

const wizardDone = await isWizardCompleted();

if (!wizardDone) {
  clearScreen();
  printBanner(version);
  await runSetupWizard();
}

/* ── Peer Dependency Check ─────────────────────────────────── */

const missingDeps = checkPeerDeps();
if (missingDeps) {
  console.log(formatMissingDepsMessage(missingDeps.missing));
  console.log(`   ${A.dim}These packages are needed for generating embeddings.${A.reset}`);
  console.log(`   ${A.dim}After installing, run docmd-search again.${A.reset}`);
  console.log('');
  process.exit(1);
}

/* ── Resolve Directory ─────────────────────────────────────── */

const targetDir = resolve(positional[0] ?? '.');
const config = await resolveConfig(targetDir, modelOverride ? { model: modelOverride } : undefined);
const outDir = join(targetDir, config.outDir);

/* ── Main: Index + Search ──────────────────────────────────── */

clearScreen();
printBanner(version);

if (isDev) {
  console.log(`   ${A.dim}directory  ${targetDir}${A.reset}`);
  console.log(`   ${A.dim}index      ${outDir}${A.reset}`);
  console.log(`   ${A.dim}model      ${config.model}${A.reset}`);
  console.log('');
}

// ── Run Indexer ───────────────────────────────────────────

const progress = createProgressDisplay(isDev);
const startTime = performance.now();

let searchIndex: SearchIndex;

try {
  searchIndex = await indexDirectory(
    {
      rootDir: targetDir,
      outDir: config.outDir,
      model: config.model,
      include: config.include,
      exclude: config.exclude,
      chunkSize: config.chunkSize,
      chunkOverlap: config.chunkOverlap,
      config,
    },
    (p: IndexProgress) => {
      progress.render(p);
    }
  );
} catch (err: any) {
  progress.clear();
  console.error(`   ${A.red}✗${A.reset} ${err.message}`);
  console.error('');

  // If we have a partial index, try to use it
  if (hasSearchableIndex(outDir)) {
    console.log(`   ${A.yellow}Using partial index...${A.reset}`);
    searchIndex = await loadAllBatches(outDir);
  } else {
    process.exit(1);
  }
}

progress.clear();

const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
const fileCount = new Set(searchIndex.chunks.map(c => c.file)).size;
console.log(`   ${A.green}✓${A.reset} ${searchIndex.chunks.length} chunks from ${fileCount} files ${A.dim}(${elapsed}s)${A.reset}`);
console.log('');

/* ── Launch UI or TUI ──────────────────────────────────────── */

if (launchUI) {
  // Web UI via docmd — Step 8 will implement launchWebUI()
  // For now, print a placeholder
  console.log(`   ${A.magenta}◆${A.reset} Web UI mode`);
  console.log(`   ${A.dim}Web UI via docmd will be available in a future version.${A.reset}`);
  console.log(`   ${A.dim}For now, using interactive TUI search.${A.reset}`);
  console.log('');
}

// ── Search Function ──────────────────────────────────────

function performSearch(idx: SearchIndex, query: string, topK: number = 10): SearchResult[] {
  const queryLower = query.toLowerCase();
  const terms = queryLower.split(/\s+/).filter(Boolean);

  if (terms.length === 0) return [];

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

    if (keywordScore > 0) {
      scores.push({ score: keywordScore, chunkIdx: i });
    }
  }

  // Enhance with vector similarity (hybrid scoring)
  if (scores.length > 1 && idx.vectors.length > 0) {
    scores.sort((a, b) => b.score - a.score);
    const bestVec = idx.vectors[scores[0].chunkIdx];

    // Only use vectors if they're not all zeros
    const hasRealVectors = bestVec.some(v => v !== 0);

    if (hasRealVectors) {
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
  }

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK).map(s => ({
    score: s.score,
    chunk: idx.chunks[s.chunkIdx],
  }));
}

// ── Launch Interactive Search ────────────────────────────

await runSearchTUI(
  (query, topK = 10) => performSearch(searchIndex, query, topK),
  searchIndex.chunks.length
);
