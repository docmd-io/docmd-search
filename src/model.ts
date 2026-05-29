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
 * Embedding Model Manager.
 *
 * Wraps @huggingface/transformers + onnxruntime-node to provide:
 * - Model download with progress tracking
 * - Batch embedding generation
 * - Float32 → Int8 quantization
 *
 * ONNX Runtime is the inference engine (runs the model in Node.js).
 * The model files (e.g., MiniLM at ~30MB) determine speed/quality.
 * User picks the model; the runtime stays the same.
 */

import { getModelProfile } from './config.js';
import type { ModelProfile } from './config.js';
import { runTask, getActiveEngineId } from './engine.js';

/* ── Types ─────────────────────────────────────────────────── */

export type ProgressPhase = 'loading' | 'downloading' | 'ready';

export interface ModelProgress {
  phase: ProgressPhase;
  /** Download progress 0-100 (only during 'downloading' phase). */
  progress?: number;
  /** Human-readable status message. */
  message: string;
}

export type OnModelProgress = (progress: ModelProgress) => void;

export interface ModelManager {
  /** The model profile being used. */
  profile: ModelProfile;
  /** Load the model (downloads if not cached). */
  load(): Promise<void>;
  /** Check if the model is loaded and ready. */
  isLoaded(): boolean;
  /**
   * Generate embeddings for an array of texts. Batches internally.
   * @param texts - Texts to embed
   * @param onProgress - Optional callback called after each batch (current, total)
   */
  embed(texts: string[], onProgress?: (current: number, total: number) => void): Promise<Float32Array[]>;
  /** Generate embeddings in parallel using worker threads. */
  embedParallel(texts: string[], onProgress?: (current: number, total: number) => void): Promise<Float32Array[]>;
  /** Release model resources. */
  dispose(): void;
}

/* ── Peer Dependency Check ─────────────────────────────────── */

/**
 * Check if the required peer dependencies are available.
 * Returns an object with the missing deps, or null if all present.
 */
export function checkPeerDeps(): { missing: string[] } | null {
  const missing: string[] = [];

  try {
    // Just check if the module resolves, don't import it
    import.meta.resolve?.('@huggingface/transformers');
  } catch {
    missing.push('@huggingface/transformers');
  }

  try {
    import.meta.resolve?.('onnxruntime-node');
  } catch {
    missing.push('onnxruntime-node');
  }

  return missing.length > 0 ? { missing } : null;
}

/**
 * Format a helpful error message when peer deps are missing.
 */
export function formatMissingDepsMessage(missing: string[]): string {
  const pkgs = missing.join(' ');
  return [
    '',
    '  ⚠ Missing required dependencies for embedding:',
    '',
    `    npm install ${pkgs}`,
    '',
    '  These are optional peer dependencies — only needed when generating',
    '  embeddings. The search client (browser) does not need them.',
    '',
  ].join('\n');
}

/* ── Quantization ──────────────────────────────────────────── */

/**
 * Quantize Float32 vectors to Int8 using per-vector min/max scaling.
 *
 * Delegates to the best available engine (Rust → JS → built-in).
 * Falls back to inline JS if the engine call fails.
 *
 * Each vector is independently scaled to [-128, 127] range.
 * This achieves ~4x compression with minimal quality loss for
 * cosine similarity operations.
 */
export async function quantizeToInt8(vectors: Float32Array[]): Promise<Int8Array[]> {
  // Convert Float32Arrays to plain number[][] for the engine
  const plain = vectors.map(v => Array.from(v));
  const dimensions = plain[0]?.length ?? 384;

  const result = await runTask<{ quantized: number[][]; mins: number[]; ranges: number[] }>(
    'search:quantize',
    { vectors: plain, dimensions }
  );

  if (result?.quantized) {
    return result.quantized.map(q => new Int8Array(q));
  }

  // Inline fallback (should never be reached — built-in engine always works)
  return vectors.map(vec => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < vec.length; i++) {
      if (vec[i] < min) min = vec[i];
      if (vec[i] > max) max = vec[i];
    }
    const range = max - min || 1;
    const quantized = new Int8Array(vec.length);
    for (let i = 0; i < vec.length; i++) {
      quantized[i] = Math.round(((vec[i] - min) / range) * 255 - 128);
    }
    return quantized;
  });
}

/**
 * Return the name of the engine currently used for quantization.
 * Useful for TUI display ("⚡ Rust engine" vs "JS engine").
 */
export async function getQuantizeEngine(): Promise<string> {
  const id = await getActiveEngineId();
  switch (id) {
    case 'rust':    return 'Rust engine';
    case 'js':      return 'JS engine';
    default:        return 'built-in';
  }
}

/* ── Model Manager Factory ─────────────────────────────────── */

/**
 * Embedding batch size — how many texts to embed in one ONNX inference call.
 *
 * Larger batches amortize the per-call overhead and improve CPU utilization.
 * 128 is a good balance between throughput and peak memory across machines.
 * The pipeline handles variable-length padding internally.
 */
const BATCH_SIZE = 128;

/**
 * Maximum characters to pass to the tokenizer per chunk.
 *
 * The model's sequence limit is 256 tokens ≈ 1024 chars for English prose.
 * The JavaScript BPE tokenizer is O(n²) in sequence length, so long inputs
 * cause disproportionate slowdowns. Truncating here is safe because:
 *   - The model silently truncates anything beyond its limit anyway
 *   - Semantic meaning is captured in the first ~256 tokens
 *   - Chunks are already bounded by chunkSize during indexing
 */
const MAX_CHARS_PER_TEXT = 1000;

/**
 * Create a ModelManager instance for the given model.
 *
 * @param modelId - HuggingFace model identifier (e.g., 'Xenova/all-MiniLM-L6-v2')
 * @param onProgress - Optional callback for download/load progress
 */
export function createModelManager(
  modelId: string,
  onProgress?: OnModelProgress
): ModelManager {
  const profile = getModelProfile(modelId);

  let pipeline: any = null;
  let loaded = false;

  const notify = (phase: ProgressPhase, message: string, progress?: number) => {
    onProgress?.({ phase, message, progress });
  };

  return {
    profile,

    async load(): Promise<void> {
      if (loaded) return;

      notify('loading', `Loading model: ${profile.name}...`);

      try {
        // Dynamic import — only loads @huggingface/transformers when actually needed
        const { pipeline: createPipeline, env } = await import('@huggingface/transformers');

        // Point to stable user-level cache (~/.docmd-search/models)
        // Avoids re-downloading when node_modules is wiped
        const { homedir } = await import('os');
        const { join } = await import('path');
        env.cacheDir = join(homedir(), '.docmd-search', 'models');

        // ── GPU Acceleration ──────────────────────────────────────────
        // Detect GPU capabilities and configure ONNX Runtime accordingly.
        // Apple Silicon (M1/M2/M3) uses Metal Performance Shaders (MPS).
        // Windows/Linux use CUDA or DirectML when available.
        const { detectGPUBackend, getExecutionProviders } = await import('./gpu.js');
        const gpu = await detectGPUBackend();

        if (gpu.hasGPU) {
          notify('loading', `GPU detected: ${gpu.name}`, undefined);
          // Configure ONNX Runtime to use GPU execution providers
          // Note: We set executionProviders on the env object before creating pipeline
          // This tells transformers.js to use GPU when available
          const providers = getExecutionProviders(gpu);
          // For ONNX Runtime in transformers.js, we configure via executionProviders
          if ((env.backends as any).onnx) {
            (env.backends as any).onnx.executionProviders = providers;
          }
        }

        // Track download progress
        let lastProgress = 0;
        const progressCallback = (data: any) => {
          if (data.status === 'progress' && data.progress != null) {
            const pct = Math.round(data.progress);
            if (pct !== lastProgress) {
              lastProgress = pct;
              notify('downloading', `Downloading ${profile.name}...`, pct);
            }
          }
        };

        // Use q8 (Int8 quantized) model — 4x smaller, 2-3x faster, minimal quality loss.
        // Falls back automatically to fp32 if quantized weights are unavailable.
        pipeline = await createPipeline('feature-extraction', profile.id, {
          progress_callback: progressCallback,
          dtype: 'q8',
        });

        loaded = true;
        notify('ready', `Model ready: ${profile.name}${gpu.hasGPU ? ` (${gpu.name})` : ''}`);
      } catch (err: any) {
        const message = err?.message ?? String(err);

        // Check for common issues
        if (message.includes('Cannot find module') || message.includes('MODULE_NOT_FOUND')) {
          throw new Error(
            `Missing dependency: @huggingface/transformers or onnxruntime-node.\n` +
            `Install with: npm install @huggingface/transformers onnxruntime-node`
          );
        }

        throw new Error(`Failed to load model "${profile.id}": ${message}`);
      }
    },

    isLoaded(): boolean {
      return loaded;
    },

    async embed(texts: string[], onProgress?: (current: number, total: number) => void): Promise<Float32Array[]> {
      if (!loaded || !pipeline) {
        throw new Error('Model not loaded. Call load() first.');
      }

      const allEmbeddings: Float32Array[] = [];

      // Process in batches to avoid memory issues
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);

        // Truncate each text to MAX_CHARS_PER_TEXT before tokenization.
        // The JS BPE tokenizer is O(n²) in sequence length — without this,
        // real doc chunks (~1200 chars) are 200× slower than short synthetic texts.
        // The model's 256-token limit means anything beyond ~1000 chars is
        // silently discarded anyway.
        const truncated = batch.map(t =>
          t.length > MAX_CHARS_PER_TEXT ? t.slice(0, MAX_CHARS_PER_TEXT) : t
        );

        // Run inference
        const output = await pipeline(truncated, {
          pooling: 'mean',
          normalize: true,
        });

        // Extract Float32Arrays from the output tensor
        for (let j = 0; j < batch.length; j++) {
          const embedding = new Float32Array(profile.dimensions);
          for (let k = 0; k < profile.dimensions; k++) {
            embedding[k] = output.data[j * profile.dimensions + k];
          }
          allEmbeddings.push(embedding);
        }

        onProgress?.(allEmbeddings.length, texts.length);
      }

      return allEmbeddings;
    },

    async embedParallel(texts: string[], onProgress?: (current: number, total: number) => void): Promise<Float32Array[]> {
      // Dynamic import to avoid circular dependency
      const { embedParallel } = await import('./parallel-embed.js');
      
      return embedParallel(texts, {
        modelId: profile.id,
        onProgress,
      });
    },

    dispose(): void {
      pipeline = null;
      loaded = false;
    },
  };
}