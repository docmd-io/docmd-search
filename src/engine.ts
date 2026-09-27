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
 * Engine Adapter for docmd-search.
 *
 * Provides a unified task-runner interface that:
 *   1. Tries @docmd/engine-rust (pre-compiled native binary) — fastest
 *   2. Tries @docmd/engine-python (persistent Python 3 worker) — high performance
 *   3. Falls back to @docmd/engine-js (pure Node.js) — standard JS
 *   4. Falls back to built-in inline JS — if neither docmd engine is installed
 *
 * docmd-search does NOT require the docmd engines. When running standalone
 * (npx docmd-search), all tasks fall through to the built-in fallback.
 * When running inside a docmd project, the engines are already installed and
 * the native or Python engines accelerate chunking + quantisation.
 *
 * Tasks used by docmd-search:
 *   search:chunk     — split text into overlapping chunks by heading + word count
 *   search:quantize  — Float32[] → Int8[] per-vector quantisation
 *   search:cosine    — batch cosine similarity scoring (for client-side search)
 */

/* ── Types ─────────────────────────────────────────────────── */

export interface EngineTask {
  type: string;
  payload: any;
}

export interface EngineResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  duration?: number;
}

export interface Engine {
  readonly name: string;
  run<T = any>(task: EngineTask): Promise<EngineResult<T>>;
  supports?(taskType: string): boolean;
}

import * as path from 'node:path';
import { createRequire } from 'node:module';

/* ── Engine Resolution ─────────────────────────────────────── */

export type EngineId = 'rust' | 'python' | 'js' | 'builtin';

let _engine: Engine | null = null;
let _engineId: EngineId = 'builtin';
let _preference: EngineId | null = null;

async function tryImportEngine(pkgName: string): Promise<any> {
  try {
    return await import(pkgName);
  } catch {
    try {
      const req = createRequire(path.join(process.cwd(), 'package.json'));
      const resolved = req.resolve(pkgName);
      return await import(resolved);
    } catch {
      return null;
    }
  }
}

/**
 * Set an explicit engine preference (e.g., 'python', 'rust', 'js').
 */
export function setEnginePreference(pref: EngineId | null): void {
  _preference = pref;
  _engine = null;
}

/**
 * Load the best available engine.
 * Result is cached — the engine is resolved once and reused.
 */
export async function getEngine(preferredId?: EngineId): Promise<{ engine: Engine; id: EngineId }> {
  if (preferredId) {
    _preference = preferredId;
    _engine = null;
  }
  if (_engine) return { engine: _engine, id: _engineId };

  const attempts: EngineId[] = _preference
    ? ([_preference, 'rust', 'python', 'js'] as EngineId[]).filter((v, i, a) => a.indexOf(v) === i)
    : ['rust', 'python', 'js'];

  for (const candidate of attempts) {
    if (candidate === 'rust') {
      try {
        const rustMod = await tryImportEngine('@docmd/engine-rust');
        if (rustMod && typeof rustMod.isRustEngineAvailable === 'function' && rustMod.isRustEngineAvailable()) {
          _engine = rustMod.createRustEngine() as Engine;
          _engineId = 'rust';
          return { engine: _engine, id: _engineId };
        }
      } catch {
        // Not installed or binary missing — try next
      }
    } else if (candidate === 'python') {
      try {
        const pyMod = await tryImportEngine('@docmd/engine-python');
        if (pyMod && typeof pyMod.isPythonEngineAvailable === 'function' && pyMod.isPythonEngineAvailable()) {
          _engine = pyMod.createPythonEngine() as Engine;
          _engineId = 'python';
          return { engine: _engine, id: _engineId };
        }
      } catch {
        // Not installed or Python 3 missing — try next
      }
    } else if (candidate === 'js') {
      try {
        const jsMod = await tryImportEngine('@docmd/engine-js');
        if (jsMod && typeof jsMod.createJsEngine === 'function') {
          _engine = jsMod.createJsEngine() as Engine;
          _engineId = 'js';
          return { engine: _engine, id: _engineId };
        }
      } catch {
        // Try built-in fallback
      }
    }
  }

  // Final fallback: Built-in inline fallback
  _engine = createBuiltinEngine();
  _engineId = 'builtin';
  return { engine: _engine, id: _engineId };
}

/**
 * Run a task using the best available engine.
 * If the primary engine fails on a search:* task, falls through to the next
 * engine in the chain (rust → python → js → builtin).
 * Throws if the task fails and `throwOnError` is true (default false).
 */
export async function runTask<T = any>(
  type: string,
  payload: any,
  throwOnError = false
): Promise<T | null> {
  const { engine } = await getEngine();
  const result = await engine.run<T>({ type, payload });

  if (result.success) return result.data ?? null;

  // If primary engine failed on a search:* task, try fallback chain
  if (type.startsWith('search:')) {
    const fallbackResult = await runTaskWithFallback<T>(type, payload);
    if (fallbackResult !== undefined) return fallbackResult;
  }

  if (throwOnError) throw new Error(result.error ?? `Task ${type} failed`);
  return null;
}

/**
 * Try Python, JS engine, then built-in fallback for search tasks.
 * Returns undefined if no fallback could handle it.
 */
async function runTaskWithFallback<T>(type: string, payload: any): Promise<T | null | undefined> {
  // If primary is rust, try python then JS engine
  if (_engineId === 'rust') {
    try {
      const pyMod = await tryImportEngine('@docmd/engine-python');
      if (pyMod?.isPythonEngineAvailable?.()) {
        const pyEngine = pyMod.createPythonEngine() as Engine;
        const pyResult = await pyEngine.run<T>({ type, payload });
        if (pyResult.success) return pyResult.data ?? null;
      }
    } catch { /* fall through */ }

    try {
      const jsMod = await tryImportEngine('@docmd/engine-js');
      if (jsMod?.createJsEngine) {
        const jsEngine = jsMod.createJsEngine() as Engine;
        const jsResult = await jsEngine.run<T>({ type, payload });
        if (jsResult.success) return jsResult.data ?? null;
      }
    } catch { /* fall through to built-in */ }
  } else if (_engineId === 'python') {
    try {
      const jsMod = await tryImportEngine('@docmd/engine-js');
      if (jsMod?.createJsEngine) {
        const jsEngine = jsMod.createJsEngine() as Engine;
        const jsResult = await jsEngine.run<T>({ type, payload });
        if (jsResult.success) return jsResult.data ?? null;
      }
    } catch { /* fall through to built-in */ }
  }

  // Final fallback: built-in engine (always has search:* tasks)
  if (_engineId !== 'builtin') {
    const builtin = createBuiltinEngine();
    const builtinResult = await builtin.run<T>({ type, payload });
    if (builtinResult.success) return builtinResult.data ?? null;
  }

  return undefined;
}

/**
 * Return which engine is currently active (for diagnostics / TUI display).
 */
export async function getActiveEngineId(): Promise<EngineId> {
  await getEngine();
  return _engineId;
}

/* ── Built-in Fallback Engine ──────────────────────────────── */

/**
 * Pure inline JS implementation of the three tasks docmd-search needs.
 * No external dependencies. Always available.
 */
function createBuiltinEngine(): Engine {
  return {
    name: 'builtin',

    supports(taskType: string): boolean {
      return ['search:chunk', 'search:quantize', 'search:cosine'].includes(taskType);
    },

    async run<T>(task: EngineTask): Promise<EngineResult<T>> {
      const start = Date.now();
      try {
        let data: any;

        switch (task.type) {
          case 'search:chunk':
            data = builtinChunk(task.payload);
            break;
          case 'search:quantize':
            data = builtinQuantize(task.payload);
            break;
          case 'search:cosine':
            data = builtinCosine(task.payload);
            break;
          default:
            return {
              success: false,
              error: `Built-in engine: unknown task '${task.type}'`,
              duration: Date.now() - start,
            };
        }

        return { success: true, data, duration: Date.now() - start };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message ?? String(err),
          duration: Date.now() - start,
        };
      }
    },
  };
}

/* ── Built-in Task Implementations ────────────────────────── */

interface ChunkResult {
  file: string;
  heading?: string;
  text: string;
  range: [number, number];
}

/**
 * Split a document into overlapping chunks by heading + word count.
 * Mirrors the Rust implementation exactly.
 */
function builtinChunk({
  text,
  file,
  chunkSize = 256,
  chunkOverlap = 32,
}: {
  text: string;
  file: string;
  chunkSize?: number;
  chunkOverlap?: number;
}): ChunkResult[] {
  const chunks: ChunkResult[] = [];
  let currentHeading: string | undefined;
  let currentWords: string[] = [];
  let currentStart = 0;
  let bytePos = 0;

  for (const line of text.split('\n')) {
    const lineBytes = line.length + 1;

    if (/^#{1,6}\s/.test(line)) {
      // Flush current chunk before heading
      if (currentWords.length > 0) {
        chunks.push({
          file,
          heading: currentHeading,
          text: currentWords.join(' '),
          range: [currentStart, bytePos],
        });
        currentWords = currentWords.slice(-chunkOverlap);
        currentStart = bytePos;
      }
      currentHeading = line.replace(/^#+\s*/, '').trim();
    } else {
      const words = line.split(/\s+/).filter(Boolean);
      currentWords.push(...words);

      if (currentWords.length >= chunkSize) {
        chunks.push({
          file,
          heading: currentHeading,
          text: currentWords.join(' '),
          range: [currentStart, bytePos + lineBytes],
        });
        currentWords = currentWords.slice(-chunkOverlap);
        currentStart = bytePos;
      }
    }

    bytePos += lineBytes;
  }

  if (currentWords.length > 0) {
    chunks.push({
      file,
      heading: currentHeading,
      text: currentWords.join(' '),
      range: [currentStart, bytePos],
    });
  }

  return chunks;
}

/**
 * Float32 → Int8 per-vector quantization.
 * Each vector is independently scaled to [-128, 127].
 */
function builtinQuantize({
  vectors,
  dimensions = 384,
}: {
  vectors: number[][];
  dimensions?: number;
}): { quantized: number[][]; mins: number[]; ranges: number[] } {
  const quantized: number[][] = [];
  const mins: number[] = [];
  const ranges: number[] = [];

  for (const vec of vectors) {
    const v = vec.length === dimensions
      ? vec
      : Array.from({ length: dimensions }, (_, i) => vec[i] ?? 0);

    const min = Math.min(...v);
    const max = Math.max(...v);
    const range = Math.abs(max - min) < 1e-10 ? 1.0 : max - min;

    const q = v.map(x => Math.round(((x - min) / range) * 255 - 128));
    quantized.push(q);
    mins.push(min);
    ranges.push(range);
  }

  return { quantized, mins, ranges };
}

/**
 * Batch cosine similarity between a query vector and a corpus.
 * Returns top-K results sorted by descending score.
 */
function builtinCosine({
  query,
  vectors,
  topK = 10,
}: {
  query: number[];
  vectors: number[][];
  topK?: number;
}): Array<{ index: number; score: number }> {
  const qNorm = Math.sqrt(query.reduce((s, v) => s + v * v, 0));
  if (qNorm < 1e-10) return [];

  const scores = vectors.map((vec, idx) => {
    const dot = query.reduce((s, v, i) => s + v * (vec[i] ?? 0), 0);
    const vNorm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    const sim = vNorm < 1e-10 ? 0 : dot / (qNorm * vNorm);
    return { index: idx, score: sim };
  });

  return scores.sort((a, b) => b.score - a.score).slice(0, topK);
}