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
 * GPU Backend Detection for ONNX Runtime.
 *
 * Detects available GPU acceleration:
 * - Mac: Metal Performance Shaders (MPS) - uses Apple Silicon GPU + Neural Engine
 * - Windows: DirectML (universal) or CUDA (NVIDIA GPUs)
 * - Linux: CUDA (NVIDIA) or OpenCL (fallback)
 * - Browser: WebGPU (when available)
 *
 * Apple Silicon (M1/M2/M3) has unified memory architecture where CPU, GPU, and
 * Neural Engine share the same RAM. This makes GPU inference extremely efficient
 * with minimal data transfer overhead.
 */

import { platform } from 'os';

export type GPUBackend = 'mps' | 'cuda' | 'directml' | 'webgpu' | 'cpu';

export interface GPUCapabilities {
  /** Detected GPU backend */
  backend: GPUBackend;
  /** Backend name for display */
  name: string;
  /** Whether GPU is available */
  hasGPU: boolean;
  /** Platform-specific details */
  details?: string;
}

/**
 * Detect the best available GPU backend for ONNX Runtime.
 *
 * Priority order:
 * 1. Mac: MPS (Metal Performance Shaders) - Apple Silicon GPU
 * 2. Windows: CUDA (NVIDIA) → DirectML (universal)
 * 3. Linux: CUDA (NVIDIA) → CPU fallback
 * 4. Browser: WebGPU (when available)
 */
export async function detectGPUBackend(): Promise<GPUCapabilities> {
  const currentPlatform = platform();

  // Browser environment
  if (typeof window !== 'undefined') {
    // Check for WebGPU support
    if ('gpu' in navigator) {
      try {
        const adapter = await (navigator as any).gpu.requestAdapter();
        if (adapter) {
          return {
            backend: 'webgpu',
            name: 'WebGPU',
            hasGPU: true,
            details: 'Browser GPU acceleration',
          };
        }
      } catch {
        // WebGPU not available
      }
    }
    return {
      backend: 'cpu',
      name: 'CPU (WebAssembly)',
      hasGPU: false,
      details: 'WebGPU not available',
    };
  }

  // Node.js environment
  try {
    // Try to detect GPU by loading ONNX Runtime
    const ort = await import('onnxruntime-node');

    // Mac: Try MPS (Metal Performance Shaders)
    if (currentPlatform === 'darwin') {
      // Apple Silicon has excellent GPU + Neural Engine support
      // MPS backend is available in onnxruntime-node 1.14+
      const hasMPS = await checkMPSAvailability(ort);
      if (hasMPS) {
        return {
          backend: 'mps',
          name: 'Metal Performance Shaders (MPS)',
          hasGPU: true,
          details: 'Apple Silicon GPU + Neural Engine',
        };
      }
    }

    // Windows/Linux: Try CUDA (NVIDIA GPU)
    if (currentPlatform === 'win32' || currentPlatform === 'linux') {
      const hasCUDA = await checkCUDAAvailability(ort);
      if (hasCUDA) {
        return {
          backend: 'cuda',
          name: 'CUDA',
          hasGPU: true,
          details: 'NVIDIA GPU acceleration',
        };
      }
    }

    // Windows: Try DirectML (universal GPU support)
    if (currentPlatform === 'win32') {
      const hasDirectML = await checkDirectMLAvailability(ort);
      if (hasDirectML) {
        return {
          backend: 'directml',
          name: 'DirectML',
          hasGPU: true,
          details: 'Windows GPU acceleration',
        };
      }
    }

  } catch (err) {
    // ONNX Runtime not available or GPU detection failed
  }

  // Fallback to CPU
  return {
    backend: 'cpu',
    name: 'CPU (WebAssembly)',
    hasGPU: currentPlatform === 'darwin' ? true : false, // Mac has excellent CPU performance
    details: currentPlatform === 'darwin'
      ? 'Apple Silicon CPU (optimized)'
      : 'Multi-threaded CPU inference',
  };
}

/**
 * Check if MPS (Metal Performance Shaders) is available on Mac.
 * MPS is available on Apple Silicon (M1/M2/M3) and Intel Macs with Metal support.
 */
async function checkMPSAvailability(ort: any): Promise<boolean> {
  try {
    // Check if MPS is listed as an available execution provider
    // This is a lightweight check that doesn't require a model
    const providers = ort.listSupportedExecutionProviders?.() || [];
    return providers.includes('mps') || providers.includes('MPS');
  } catch {
    // If we can't check, assume MPS is available on Apple Silicon Macs
    // and let ONNX Runtime fallback to CPU if needed
    return platform() === 'darwin';
  }
}

/**
 * Check if CUDA is available (NVIDIA GPU).
 */
async function checkCUDAAvailability(ort: any): Promise<boolean> {
  try {
    const providers = ort.listSupportedExecutionProviders?.() || [];
    return providers.includes('cuda') || providers.includes('CUDA');
  } catch {
    return false;
  }
}

/**
 * Check if DirectML is available (Windows GPU).
 */
async function checkDirectMLAvailability(ort: any): Promise<boolean> {
  try {
    const providers = ort.listSupportedExecutionProviders?.() || [];
    return providers.includes('dml') || providers.includes('DirectML');
  } catch {
    return false;
  }
}

/**
 * Get execution providers for ONNX Runtime based on detected GPU.
 * Returns providers in priority order (GPU first, then CPU fallback).
 */
export function getExecutionProviders(gpu: GPUCapabilities): string[] {
  switch (gpu.backend) {
    case 'mps':
      return ['mps', 'cpu'];
    case 'cuda':
      return ['cuda', 'cpu'];
    case 'directml':
      return ['dml', 'cpu'];
    case 'webgpu':
      return ['webgpu', 'cpu'];
    default:
      return ['cpu'];
  }
}

/**
 * Format GPU capabilities for display.
 */
export function formatGPUInfo(gpu: GPUCapabilities): string {
  if (gpu.hasGPU) {
    return `⚡ ${gpu.name}`;
  }
  return `◇ ${gpu.name}`;
}