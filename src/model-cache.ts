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
 * Model Memory Cache - Singleton Pattern.
 *
 * Keeps the embedding model loaded in memory for the lifetime of the process.
 * This eliminates the ~30s model load overhead on subsequent runs.
 *
 * Use Cases:
 * - Watch mode (`--watch`): Model stays loaded between rebuilds
 * - Server mode (`--serve`): Model cached for search queries
 * - Multiple indexing runs: No reload overhead
 */

import { createModelManager } from './model.js';
import type { ModelManager, OnModelProgress } from './model.js';

/**
 * Global model cache singleton.
 * Stores loaded model instances by model ID.
 */
class ModelCache {
  private static instances: Map<string, ModelManager> = new Map();
  private static loadingPromises: Map<string, Promise<void>> = new Map();

  /**
   * Get or load a model by its ID.
   * If the model is already loaded, returns immediately.
   * If the model is currently loading, waits for the existing load to complete.
   * Otherwise, loads the model and caches it.
   */
  static async get(
    modelId: string,
    onProgress?: OnModelProgress
  ): Promise<ModelManager> {
    // Return cached instance if available
    const cached = this.instances.get(modelId);
    if (cached && cached.isLoaded()) {
      return cached;
    }

    // Wait for existing load promise if in progress
    const existingLoad = this.loadingPromises.get(modelId);
    if (existingLoad) {
      await existingLoad;
      return this.instances.get(modelId)!;
    }

    // Load new model
    const manager = createModelManager(modelId, onProgress);
    const loadPromise = manager.load();
    
    this.loadingPromises.set(modelId, loadPromise);
    
    try {
      await loadPromise;
      this.instances.set(modelId, manager);
    } finally {
      this.loadingPromises.delete(modelId);
    }

    return manager;
  }

  /**
   * Check if a model is currently loaded.
   */
  static has(modelId: string): boolean {
    const instance = this.instances.get(modelId);
    return instance !== undefined && instance.isLoaded();
  }

  /**
   * Dispose a specific model from cache.
   */
  static dispose(modelId: string): void {
    const instance = this.instances.get(modelId);
    if (instance) {
      instance.dispose();
      this.instances.delete(modelId);
    }
  }

  /**
   * Dispose all cached models.
   */
  static disposeAll(): void {
    for (const instance of this.instances.values()) {
      instance.dispose();
    }
    this.instances.clear();
    this.loadingPromises.clear();
  }

  /**
   * Get list of currently loaded model IDs.
   */
  static getLoadedModels(): string[] {
    return Array.from(this.instances.keys());
  }

  /**
   * Get cache statistics.
   */
  static getStats(): {
    loadedModels: number;
    modelIds: string[];
    memoryUsage: string;
  } {
    const modelIds = this.getLoadedModels();
    return {
      loadedModels: modelIds.length,
      modelIds,
      memoryUsage: modelIds.length > 0 ? '~100-300 MB per model' : '0 MB',
    };
  }
}

/**
 * Convenience function to get a cached model.
 */
export async function getCachedModel(
  modelId: string,
  onProgress?: OnModelProgress
): Promise<ModelManager> {
  return ModelCache.get(modelId, onProgress);
}

/**
 * Convenience function to dispose all cached models.
 */
export function disposeAllModels(): void {
  ModelCache.disposeAll();
}

/**
 * Convenience function to check if a model is loaded.
 */
export function isModelLoaded(modelId: string): boolean {
  return ModelCache.has(modelId);
}

/**
 * Convenience function to get cache statistics.
 */
export function getModelCacheStats() {
  return ModelCache.getStats();
}

export { ModelCache };
