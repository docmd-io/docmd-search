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
 * Worker script for parallel embedding generation.
 * Each worker loads the model once and processes batches independently.
 */

import { parentPort, workerData } from 'worker_threads';

let pipeline: any = null;
let dimensions: number = 384;
let initPromise: Promise<void> | null = null;

async function init() {
  if (pipeline) return;
  if (initPromise) return initPromise;
  
  initPromise = (async () => {
    const { modelId } = workerData;
    
    try {
      const { pipeline: createPipeline, env } = await import('@huggingface/transformers');

      // Use stable user-level cache dir, same as main process
      const { homedir } = await import('os');
      const { join } = await import('path');
      env.cacheDir = join(homedir(), '.docmd-search', 'models');

      pipeline = await createPipeline('feature-extraction', modelId, {
        dtype: 'q8',
      });

      // Dimensions will be auto-detected on first embed call
      dimensions = 384; // sensible default, corrected after first inference
      
      parentPort?.postMessage({ type: 'ready' });
    } catch (err: any) {
      parentPort?.postMessage({ type: 'error', error: err.message });
      throw err;
    }
  })();
  
  return initPromise;
}

async function embed(batch: string[]): Promise<number[][]> {
  await init(); // Ensure model is loaded

  if (!pipeline) {
    throw new Error('Model not initialized');
  }

  const output = await pipeline(batch, {
    pooling: 'mean',
    normalize: true,
  });

  // Auto-detect dimensions from actual output on first call
  const actualDims = output.dims[output.dims.length - 1] as number;
  if (actualDims && actualDims !== dimensions) {
    dimensions = actualDims;
  }

  const embeddings: number[][] = [];

  for (let j = 0; j < batch.length; j++) {
    const embedding: number[] = [];
    for (let k = 0; k < dimensions; k++) {
      embedding.push(output.data[j * dimensions + k]);
    }
    embeddings.push(embedding);
  }

  return embeddings;
}

// Initialize immediately
init().catch(err => {
  console.error('Worker init failed:', err);
  process.exit(1);
});
parentPort?.on('message', async (message) => {
  if (message.type === 'embed') {
    try {
      const embeddings = await embed(message.batch);
      parentPort?.postMessage({
        type: 'result',
        batchId: message.batchId,
        embeddings,
      });
    } catch (err: any) {
      parentPort?.postMessage({
        type: 'error',
        batchId: message.batchId,
        error: err.message,
      });
    }
  }
});
