/**
 * docmd-search — Configuration system.
 *
 * Handles model profiles, defaults, and config resolution.
 * Config is merged in order: defaults → global (~/.docmd-search) → project (.docmd-search) → CLI flags.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/* ── Model Profiles ────────────────────────────────────────── */

/** Describes an available embedding model. */
export interface ModelProfile {
  /** Model identifier (used for download + config). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Output vector dimensionality. */
  dimensions: number;
  /** Short description for the TUI wizard. */
  description: string;
  /** Approximate download size. */
  size: string;
  /** Whether this is the recommended default. */
  recommended: boolean;
}

/**
 * Available embedding models — smallest first.
 * Default is always the smallest/fastest model.
 * Larger models are the user's choice via the setup wizard.
 */
export const AVAILABLE_MODELS: ModelProfile[] = [
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    name: 'MiniLM L6 v2',
    dimensions: 384,
    description: 'Fastest, general purpose. Great for most documentation.',
    size: '~30 MB',
    recommended: true,
  },
  {
    id: 'Xenova/bge-small-en-v1.5',
    name: 'BGE Small (English)',
    dimensions: 384,
    description: 'English-optimised, slightly better quality than MiniLM.',
    size: '~45 MB',
    recommended: false,
  },
  {
    id: 'Xenova/bge-base-en-v1.5',
    name: 'BGE Base (English)',
    dimensions: 768,
    description: 'Higher quality embeddings for English. Advanced users.',
    size: '~110 MB',
    recommended: false,
  },
  {
    id: 'Xenova/all-mpnet-base-v2',
    name: 'MPNet Base v2',
    dimensions: 768,
    description: 'Highest quality, multilingual. Slower but most accurate.',
    size: '~110 MB',
    recommended: false,
  },
];

/** Get a model profile by its ID. Returns the default if not found. */
export function getModelProfile(modelId: string): ModelProfile {
  return AVAILABLE_MODELS.find(m => m.id === modelId)
    ?? AVAILABLE_MODELS.find(m => m.recommended)!;
}

/** Get the default (recommended) model profile. */
export function getDefaultModel(): ModelProfile {
  return AVAILABLE_MODELS.find(m => m.recommended)!;
}

/* ── Search Configuration ──────────────────────────────────── */

/** Full configuration for docmd-search. */
export interface SearchConfig {
  /** Embedding model identifier. */
  model: string;
  /** Max tokens per chunk (default: 256). */
  chunkSize: number;
  /** Chunk overlap in tokens (default: 32). */
  chunkOverlap: number;
  /** Glob patterns to include. */
  include: string[];
  /** Glob patterns to exclude. */
  exclude: string[];
  /** Output directory name (relative to root, default: '.docmd-search'). */
  outDir: string;
  /** Enable incremental indexing (default: true). */
  incremental: boolean;
  /** Max search results to return (default: 10). */
  topK: number;
}

/** Default exclude patterns — common build/cache/system directories. */
const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/site/**',
  '**/.git/**',
  '**/.docmd-search/**',
  '**/.cache/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/coverage/**',
  '**/.svn/**',
  '**/.hg/**',
  '**/vendor/**',
];

/** Default configuration values. */
export const DEFAULT_CONFIG: SearchConfig = {
  model: getDefaultModel().id,
  chunkSize: 256,
  chunkOverlap: 32,
  include: ['**/*.md', '**/*.txt', '**/*.html'],
  exclude: DEFAULT_EXCLUDE,
  outDir: '.docmd-search',
  incremental: true,
  topK: 10,
};

/* ── Global Configuration (~/.docmd-search/) ───────────────── */

/** Shape of the persisted global config file. */
export interface GlobalConfig {
  /** Selected model identifier. */
  model: string;
  /** Whether the first-run wizard has been completed. */
  wizardCompleted: boolean;
}

const GLOBAL_DIR = join(homedir(), '.docmd-search');
const GLOBAL_CONFIG_FILE = join(GLOBAL_DIR, 'config.json');

/** Ensure the global config directory exists. */
async function ensureGlobalDir(): Promise<void> {
  await mkdir(GLOBAL_DIR, { recursive: true });
}

/** Load global configuration. Returns null if no config exists yet. */
export async function loadGlobalConfig(): Promise<GlobalConfig | null> {
  try {
    const raw = await readFile(GLOBAL_CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as GlobalConfig;
  } catch {
    return null;
  }
}

/** Save global configuration. Creates the directory if needed. */
export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
  await ensureGlobalDir();
  await writeFile(GLOBAL_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/** Check if the first-run wizard has been completed. */
export async function isWizardCompleted(): Promise<boolean> {
  const config = await loadGlobalConfig();
  return config?.wizardCompleted === true;
}

/** Get the global config directory path. */
export function getGlobalDir(): string {
  return GLOBAL_DIR;
}

/* ── Project Configuration (.docmd-search/config.json) ─────── */

/** Load per-project configuration overrides. Returns null if none. */
export async function loadProjectConfig(rootDir: string): Promise<Partial<SearchConfig> | null> {
  try {
    const configPath = join(rootDir, '.docmd-search', 'config.json');
    const raw = await readFile(configPath, 'utf-8');
    return JSON.parse(raw) as Partial<SearchConfig>;
  } catch {
    return null;
  }
}

/* ── Config Resolution ─────────────────────────────────────── */

/**
 * Resolve the final search configuration by merging layers:
 *   defaults → global config → project config → CLI overrides
 *
 * @param rootDir - Project root directory (for loading project config)
 * @param overrides - CLI flags or programmatic overrides
 */
export async function resolveConfig(
  rootDir?: string,
  overrides?: Partial<SearchConfig>
): Promise<SearchConfig> {
  // Start with defaults
  const config = { ...DEFAULT_CONFIG };

  // Layer 2: Global config (model selection from wizard)
  const global = await loadGlobalConfig();
  if (global?.model) {
    config.model = global.model;
  }

  // Layer 3: Project config (per-project overrides)
  if (rootDir) {
    const project = await loadProjectConfig(rootDir);
    if (project) {
      Object.assign(config, project);
    }
  }

  // Layer 4: CLI overrides (highest priority)
  if (overrides) {
    Object.assign(config, overrides);
  }

  return config;
}
