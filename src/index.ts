/**
 * docmd-search — Universal offline semantic search engine.
 *
 * Build-time: crawl files → chunk → embed → output compressed vector index.
 * Runtime: cosine similarity over quantized vectors. No model in the browser.
 */

// ── Core Pipeline ────────────────────────────────────────
export { indexDirectory } from './indexer/index.js';
export type { IndexDirectoryOptions, IndexProgress, IndexPhase, OnIndexProgress } from './indexer/index.js';

// ── Index I/O ────────────────────────────────────────────
export {
  createSearchIndex,
  loadSearchIndex,
  loadAllBatches,
  loadManifest,
  saveBatch,
  saveManifest,
  hasSearchableIndex,
  getCompressionType,
  buildNavTree,
  saveNavigation,
} from './index-io.js';
export type { IndexManifest, BatchMeta, NavNode, CompressionType, FileRecord } from './index-io.js';

// ── Configuration ────────────────────────────────────────
export {
  resolveConfig,
  loadGlobalConfig,
  saveGlobalConfig,
  loadProjectConfig,
  isWizardCompleted,
  getModelProfile,
  getDefaultModel,
  AVAILABLE_MODELS,
  DEFAULT_CONFIG,
  getGlobalDir,
} from './config.js';
export type { SearchConfig, ModelProfile, GlobalConfig } from './config.js';

// ── Embedding Model ──────────────────────────────────────
export {
  createModelManager,
  quantizeToInt8,
  checkPeerDeps,
  formatMissingDepsMessage,
} from './model.js';
export type { ModelManager, ModelProgress, OnModelProgress } from './model.js';

// ── TUI ──────────────────────────────────────────────────
export {
  printBanner,
  clearScreen,
  createProgressDisplay,
  runSetupWizard,
  runSearchTUI,
  runSettingsTUI,
} from './tui.js';

// ── Web UI ───────────────────────────────────────────────
export { launchWebUI } from './ui/launcher.js';
export type { LaunchOptions } from './ui/launcher.js';

// ── Types ────────────────────────────────────────────────
export type { SearchIndex, SearchResult, IndexOptions, Chunk, VectorEntry } from './types.js';
