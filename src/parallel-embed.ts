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
 * Parallel embedding manager using Worker Threads.
 * Distributes embedding work across multiple CPU cores.
 */

import { Worker } from 'worker_threads';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ParallelEmbedOptions {
  modelId: string;
  numWorkers?: number;
  onProgress?: (current: number, total: number) => void;
}

export class ParallelEmbedder {
  private workers: Worker[] = [];
  private freeWorkers: Worker[] = [];
  private taskQueue: Array<{
    batchId: number;
    batch: string[];
    resolve: (value: number[][]) => void;
    reject: (error: Error) => void;
  }> = [];
  private pendingResults = new Map<number, number[][]>();
  private totalTasks = 0;
  private completedTasks = 0;
  private onProgress?: (current: number, total: number) => void;
  private isInitialized = false;
  private initPromise: Promise<void>;
  private numWorkers: number;

  constructor(private options: ParallelEmbedOptions) {
    this.numWorkers = options.numWorkers || Math.max(1, os.cpus().length - 1);
    this.onProgress = options.onProgress;
    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    const workerScript = path.join(__dirname, 'embedding-worker.js');
    
    const readyPromises: Promise<void>[] = [];
    
    // Create worker pool
    for (let i = 0; i < this.numWorkers; i++) {
      const worker = new Worker(workerScript, {
        workerData: {
          modelId: this.options.modelId,
        },
      });
      
      // Create promise that resolves when worker is ready
      const readyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Worker ${i} failed to initialize within 60 seconds`));
        }, 60000);
        
        worker.on('message', (message: any) => {
          if (message.type === 'ready') {
            clearTimeout(timeout);
            this.freeWorkers.push(worker);
            resolve();
          } else if (message.type === 'result') {
            this.pendingResults.set(message.batchId, message.embeddings);
            this.completedTasks++;
            this.onProgress?.(this.completedTasks, this.totalTasks);
            this.freeWorkers.push(worker);
            this.processQueue();
          } else if (message.type === 'error') {
            console.error('Worker error:', message.error);
            this.freeWorkers.push(worker);
            this.processQueue();
          }
        });
        
        worker.on('error', (err) => {
          clearTimeout(timeout);
          console.error('Worker thread error:', err);
          this.freeWorkers.push(worker);
          this.processQueue();
          reject(err);
        });
      });
      
      readyPromises.push(readyPromise);
      this.workers.push(worker);
    }
    
    // Wait for all workers to be ready
    await Promise.all(readyPromises);
    this.isInitialized = true;
  }

  async embedAll(batches: string[][]): Promise<number[][][]> {
    await this.initPromise;
    
    return new Promise((resolve, reject) => {
      this.totalTasks = batches.length;
      this.completedTasks = 0;
      this.pendingResults.clear();
      
      let completed = 0;
      const results: number[][][] = new Array(batches.length);
      
      batches.forEach((batch, batchId) => {
        this.taskQueue.push({
          batchId,
          batch,
          resolve: (embeddings) => {
            results[batchId] = embeddings;
            completed++;
            if (completed === batches.length) {
              resolve(results);
            }
          },
          reject,
        });
      });
      
      this.processQueue();
    });
  }

  private processQueue() {
    while (this.taskQueue.length > 0 && this.freeWorkers.length > 0) {
      const worker = this.freeWorkers.pop()!;
      const task = this.taskQueue.shift()!;
      
      // Set up one-time message handler for this task
      const handler = (message: any) => {
        if (message.type === 'result' && message.batchId === task.batchId) {
          worker.off('message', handler);
          task.resolve(message.embeddings);
        } else if (message.type === 'error' && message.batchId === task.batchId) {
          worker.off('message', handler);
          task.reject(new Error(message.error));
        }
      };
      
      worker.on('message', handler);
      worker.postMessage({ type: 'embed', batchId: task.batchId, batch: task.batch });
    }
  }

  async terminate() {
    await Promise.all(this.workers.map(w => w.terminate()));
    this.workers = [];
    this.freeWorkers = [];
  }
}

/**
 * Convenience function to embed texts in parallel.
 */
export async function embedParallel(
  texts: string[],
  options: ParallelEmbedOptions
): Promise<Float32Array[]> {
  const batchSize = 64;
  const batches: string[][] = [];
  
  for (let i = 0; i < texts.length; i += batchSize) {
    batches.push(texts.slice(i, i + batchSize));
  }
  
  const embedder = new ParallelEmbedder(options);
  
  try {
    const results = await embedder.embedAll(batches);
    const allEmbeddings: Float32Array[] = [];
    
    for (const batchEmbeddings of results) {
      for (const embedding of batchEmbeddings) {
        allEmbeddings.push(new Float32Array(embedding));
      }
    }
    
    return allEmbeddings;
  } finally {
    await embedder.terminate();
  }
}
