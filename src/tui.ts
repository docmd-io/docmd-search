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
 * Terminal UI.
 *
 * Provides:
 * - ASCII banner with branding
 * - Setup wizard for first-run model selection
 * - Progress display for indexing phases
 * - Interactive search TUI with live results
 * - Settings TUI for model management
 */

import { AVAILABLE_MODELS, saveGlobalConfig, loadGlobalConfig, getModelProfile } from './config.js';
import type { ModelProfile, GlobalConfig } from './config.js';
import type { IndexProgress, IndexPhase } from './indexer/index.js';
import type { SearchResult } from './types.js';
import { getActiveEngineId } from './engine.js';

/* ── ANSI Codes ────────────────────────────────────────────── */

const A = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  italic:  '\x1b[3m',
  magenta: '\x1b[35m',
  green:   '\x1b[32m',
  red:     '\x1b[31m',
  yellow:  '\x1b[33m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
  bgMagenta: '\x1b[45m',
  up:      (n: number) => `\x1b[${n}A`,
  clear:   '\x1b[2K',
  hide:    '\x1b[?25l',
  show:    '\x1b[?25h',
};

/* ── Banner ────────────────────────────────────────────────── */

const BANNER = `
   ${A.magenta}     _                 _${A.reset}
   ${A.magenta}  __| |___ ___ _____ _| |${A.reset}
   ${A.magenta} | .  | . |  _|     | . |${A.reset}
   ${A.magenta} |____|___|___|_|_|_|___|${A.reset}
   ${A.dim} SEARCH${A.reset}
`;

/** Print the docmd-search banner. */
export function printBanner(version?: string): void {
  console.log(BANNER);
  if (version) {
    console.log(`   ${A.dim}v${version} · offline semantic search${A.reset}`);
    console.log('');
  }
}

/**
 * Print engine status line (Rust / JS / built-in).
 * Called after banner so the user knows which backend is active.
 */
export async function printEngineStatus(): Promise<void> {
  const id = await getActiveEngineId();
  switch (id) {
    case 'rust':
      console.log(`   ${A.magenta}⚡${A.reset} ${A.bold}Rust engine${A.reset} ${A.dim}(accelerated)${A.reset}`);
      break;
    case 'js':
      console.log(`   ${A.cyan}◆${A.reset} ${A.bold}JS engine${A.reset} ${A.dim}(docmd)${A.reset}`);
      break;
    default:
      console.log(`   ${A.dim}◇ built-in engine${A.reset}`);
  }
  console.log('');
}

/** Clear the terminal screen. */
export function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
}

/* ── Progress Display ──────────────────────────────────────── */

/** Create a progress bar string. */
function progressBar(current: number, total: number, width: number = 20): string {
  if (total <= 0) return `${'░'.repeat(width)}`;
  const ratio = Math.min(current / total, 1);
  const filled = Math.round(width * ratio);
  const empty = width - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}

/** Map phase to a display label. */
function phaseLabel(phase: IndexPhase): string {
  switch (phase) {
    case 'crawling': return 'scanning';
    case 'chunking': return 'chunking';
    case 'downloading-model': return 'model   ';
    case 'embedding': return 'indexing ';
    case 'saving': return 'saving  ';
    case 'complete': return 'done    ';
    default: return phase;
  }
}

export interface ProgressDisplay {
  /** Render an updated progress state. */
  render(progress: IndexProgress): void;
  /** Clear the progress display. */
  clear(): void;
}

/**
 * Create a live-updating progress display for the terminal.
 */
export function createProgressDisplay(verbose: boolean = false): ProgressDisplay {
  let lastLines = 0;
  const startTime = Date.now();

  return {
    render(progress: IndexProgress): void {
      // Clear previous output
      if (lastLines > 0) {
        process.stdout.write(A.up(lastLines) + '\r');
        for (let i = 0; i < lastLines; i++) {
          process.stdout.write(A.clear + '\n');
        }
        process.stdout.write(A.up(lastLines) + '\r');
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
      const bar = progressBar(progress.current, progress.total);
      const label = phaseLabel(progress.phase);

      let lines: string[] = [];

      if (progress.phase === 'complete') {
        lines.push(`   ${A.green}✓${A.reset} ${progress.message ?? 'Complete'}  ${A.dim}(${elapsed}s)${A.reset}`);
      } else {
        lines.push(`   ${A.magenta}${label}${A.reset}  ${bar}  ${A.bold}${pct}%${A.reset}  ${A.dim}${progress.current}/${progress.total}${A.reset}`);

        if (progress.file && verbose) {
          lines.push(`   ${A.dim}→ ${progress.file}${A.reset}`);
        }

        if (progress.message && verbose) {
          lines.push(`   ${A.dim}${progress.message}${A.reset}`);
        }

        lines.push(`   ${A.dim}elapsed: ${elapsed}s${A.reset}`);
      }

      process.stdout.write(lines.join('\n') + '\n');
      lastLines = lines.length;
    },

    clear(): void {
      if (lastLines > 0) {
        process.stdout.write(A.up(lastLines) + '\r');
        for (let i = 0; i < lastLines; i++) {
          process.stdout.write(A.clear + '\n');
        }
        process.stdout.write(A.up(lastLines) + '\r');
        lastLines = 0;
      }
    },
  };
}

/* ── Setup Wizard ──────────────────────────────────────────── */

/**
 * Run the first-run setup wizard.
 * Prompts the user to select an embedding model.
 * Returns the selected model profile.
 */
export async function runSetupWizard(): Promise<ModelProfile> {
  const readline = await import('node:readline');

  console.log(`   ${A.bold}First-time setup${A.reset}`);
  console.log(`   ${A.dim}Select an embedding model for semantic search.${A.reset}`);
  console.log(`   ${A.dim}You can change this later with: docmd-search --settings${A.reset}`);
  console.log('');

  // Display models
  AVAILABLE_MODELS.forEach((model, i) => {
    const marker = model.recommended ? `${A.green}★${A.reset}` : ' ';
    const rec = model.recommended ? ` ${A.green}(recommended)${A.reset}` : '';
    console.log(`   ${marker} ${A.bold}${i + 1}.${A.reset} ${model.name}${rec}`);
    console.log(`      ${A.dim}${model.description}${A.reset}`);
    console.log(`      ${A.dim}${model.dimensions}d · ${model.size}${A.reset}`);
    console.log('');
  });

  // Prompt for selection
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(`   ${A.magenta}Pick a model${A.reset} [1-${AVAILABLE_MODELS.length}] (default: 1): `, resolve);
  });

  rl.close();

  const choice = parseInt(answer.trim(), 10);
  const selectedIndex = (choice >= 1 && choice <= AVAILABLE_MODELS.length) ? choice - 1 : 0;
  const selected = AVAILABLE_MODELS[selectedIndex];

  console.log('');
  console.log(`   ${A.green}✓${A.reset} Selected: ${A.bold}${selected.name}${A.reset} ${A.dim}(${selected.size})${A.reset}`);
  console.log('');

  // Save to global config
  await saveGlobalConfig({
    model: selected.id,
    wizardCompleted: true,
  });

  return selected;
}

/* ── Interactive Search TUI ────────────────────────────────── */

type SearchFn = (query: string, topK?: number) => SearchResult[];

/**
 * Run the interactive search TUI.
 * User types a query and sees live results.
 */
export async function runSearchTUI(
  searchFn: SearchFn,
  totalChunks: number
): Promise<void> {
  const readline = await import('node:readline');

  console.log(`   ${A.dim}${totalChunks} chunks indexed · type to search · Ctrl+C to exit${A.reset}`);
  console.log('');

  // Enable raw mode for character-by-character input
  if (!process.stdin.isTTY) {
    // Non-interactive mode — fall back to line-based input
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`   ${A.magenta}search${A.reset} ❯ `, (query) => {
      const results = searchFn(query, 10);
      printSearchResults(results, query);
      rl.close();
    });
    return;
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf-8');
  process.stdout.write(A.hide);

  let query = '';
  let lastResultLines = 0;

  const renderPrompt = () => {
    // Clear previous results
    if (lastResultLines > 0) {
      process.stdout.write(A.up(lastResultLines + 1) + '\r');
      for (let i = 0; i <= lastResultLines; i++) {
        process.stdout.write(A.clear + '\n');
      }
      process.stdout.write(A.up(lastResultLines + 1) + '\r');
    }

    // Render prompt
    process.stdout.write(`${A.clear}   ${A.magenta}search${A.reset} ❯ ${query}\n`);

    // Render results
    if (query.trim()) {
      const results = searchFn(query, 8);
      const lines = formatSearchResults(results, query);
      process.stdout.write(lines.join('\n') + '\n');
      lastResultLines = lines.length;
    } else {
      process.stdout.write(`   ${A.dim}start typing to search...${A.reset}\n`);
      lastResultLines = 1;
    }
  };

  renderPrompt();

  process.stdin.on('data', (key: string) => {
    if (key === '\x03') {
      // Ctrl+C — exit
      process.stdout.write(A.show);
      process.stdout.write('\n');
      process.exit(0);
    }

    if (key === '\x7f' || key === '\b') {
      // Backspace
      query = query.slice(0, -1);
    } else if (key === '\r' || key === '\n') {
      // Enter — just stay (could open file in future)
      return;
    } else if (key.charCodeAt(0) >= 32 && key.charCodeAt(0) < 127) {
      // Printable character
      query += key;
    } else {
      // Ignore control characters and escape sequences
      return;
    }

    renderPrompt();
  });

  // Keep running until Ctrl+C
  await new Promise<void>(() => {});
}

/** Format search results as terminal-printable lines. */
function formatSearchResults(results: SearchResult[], query: string): string[] {
  if (results.length === 0) {
    return [`   ${A.dim}no results for "${query}"${A.reset}`];
  }

  const lines: string[] = [''];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const pct = Math.round(r.score * 100);
    const scoreColor = pct > 60 ? A.green : pct > 30 ? A.yellow : A.dim;
    const heading = r.chunk.heading ? ` ${A.dim}›${A.reset} ${r.chunk.heading}` : '';
    lines.push(
      `   ${A.dim}${String(i + 1).padStart(2)}.${A.reset} ${A.magenta}${r.chunk.file}${A.reset}${heading}  ${scoreColor}${pct}%${A.reset}`
    );
    const snippet = r.chunk.text.replace(/\s+/g, ' ').trim().slice(0, 100);
    lines.push(`       ${A.dim}${snippet}${r.chunk.text.length > 100 ? '…' : ''}${A.reset}`);
  }

  lines.push('');
  return lines;
}

/** Print search results (non-interactive mode). */
function printSearchResults(results: SearchResult[], query: string): void {
  const lines = formatSearchResults(results, query);
  console.log(lines.join('\n'));
}

/* ── Settings TUI ──────────────────────────────────────────── */

/**
 * Run the settings TUI for model management.
 */
export async function runSettingsTUI(): Promise<void> {
  const readline = await import('node:readline');

  clearScreen();
  printBanner();

  console.log(`   ${A.bold}Settings${A.reset}`);
  console.log('');

  // Load current config
  const globalConfig = await loadGlobalConfig();
  const currentModel = globalConfig?.model
    ? getModelProfile(globalConfig.model)
    : AVAILABLE_MODELS.find(m => m.recommended)!;

  console.log(`   ${A.dim}Current model:${A.reset} ${A.bold}${currentModel.name}${A.reset} ${A.dim}(${currentModel.size})${A.reset}`);
  console.log('');

  // Show all models
  console.log(`   ${A.bold}Available models:${A.reset}`);
  console.log('');

  AVAILABLE_MODELS.forEach((model, i) => {
    const isCurrent = model.id === currentModel.id;
    const marker = isCurrent ? `${A.green}●${A.reset}` : `${A.dim}○${A.reset}`;
    const label = isCurrent ? ` ${A.green}(active)${A.reset}` : '';
    const rec = model.recommended ? ` ${A.yellow}★${A.reset}` : '';
    console.log(`   ${marker} ${A.bold}${i + 1}.${A.reset} ${model.name}${label}${rec}`);
    console.log(`      ${A.dim}${model.description}${A.reset}`);
    console.log(`      ${A.dim}${model.dimensions}d · ${model.size}${A.reset}`);
    console.log('');
  });

  // Prompt to change
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(`   ${A.magenta}Switch model?${A.reset} [1-${AVAILABLE_MODELS.length}] (Enter to keep current): `, resolve);
  });

  rl.close();

  const choice = parseInt(answer.trim(), 10);

  if (choice >= 1 && choice <= AVAILABLE_MODELS.length) {
    const selected = AVAILABLE_MODELS[choice - 1];

    if (selected.id === currentModel.id) {
      console.log(`   ${A.dim}Already using ${selected.name}${A.reset}`);
    } else {
      await saveGlobalConfig({
        model: selected.id,
        wizardCompleted: true,
      });
      console.log('');
      console.log(`   ${A.green}✓${A.reset} Switched to: ${A.bold}${selected.name}${A.reset}`);
      console.log(`   ${A.dim}Model will be downloaded on next indexing run if needed.${A.reset}`);
    }
  } else {
    console.log(`   ${A.dim}Keeping ${currentModel.name}${A.reset}`);
  }

  console.log('');
}