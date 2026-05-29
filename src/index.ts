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

// ── Core Pipeline ────────────────────────────────────────
export { indexDirectory } from './indexer/index.js';
export type { IndexDirectoryOptions, IndexProgress, IndexPhase, OnIndexProgress } from './indexer/index.js';

// ── Index I/O ────────────────────────────────────────────
export {
  createSearchIndex,
  loadSearchIndex,
  loadAllBatches,
  loadBatch,
  loadManifest,
  saveBatch,
  saveManifest,
  updateManifest,
  createEmptyManifest,
  hasSearchableIndex,
  getCompressionType,
  compressVectors,
  decompressVectors,
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
  getQuantizeEngine,
  checkPeerDeps,
  formatMissingDepsMessage,
} from './model.js';
export type { ModelManager, ModelProgress, OnModelProgress } from './model.js';

// ── Engine Adapter ───────────────────────────────────────
export {
  getEngine,
  runTask,
  getActiveEngineId,
} from './engine.js';
export type { Engine, EngineTask, EngineResult } from './engine.js';

// ── TUI ──────────────────────────────────────────────────
export {
  printBanner,
  printEngineStatus,
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
