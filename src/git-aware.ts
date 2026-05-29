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
 * Git-Aware Incremental Indexing.
 *
 * Detects changed files using git when available (fastest).
 * Falls back to mtime + size check when git is unavailable.
 *
 * Benefits:
 * - Faster change detection (git status is instant)
 * - More reliable than mtime (handles git operations better)
 * - Works seamlessly with existing incremental indexing
 */

import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Check if a directory is a git repository.
 */
export async function isGitRepo(dir: string): Promise<boolean> {
  const gitDir = join(dir, '.git');
  return existsSync(gitDir);
}

/**
 * Get list of changed files using git status.
 * Returns relative paths from the repository root.
 */
export async function getChangedFilesFromGit(
  repoDir: string
): Promise<Set<string>> {
  try {
    // Get all changed files (staged + unstaged + untracked)
    const { stdout } = await execAsync(
      'git status --porcelain',
      { cwd: repoDir }
    );

    const changed = new Set<string>();
    
    // Parse git status output
    // Format: XY PATH
    // X = index status, Y = work tree status
    // ?? = untracked, M = modified, A = added, D = deleted
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      
      // Extract file path (columns 4+)
      const filePath = line.slice(3).trim();
      
      // Skip deleted files
      if (line.startsWith(' D') || line.startsWith('D ')) {
        continue;
      }
      
      // Add modified/added/untracked files
      changed.add(filePath);
    }

    return changed;
  } catch (err) {
    // Git command failed, return empty set
    return new Set();
  }
}

/**
 * Get list of changed files using mtime + size comparison.
 * This is the fallback when git is unavailable.
 */
export async function getChangedFilesFromMtime(
  rootDir: string,
  filePaths: string[],
  existingFiles: Record<string, { mtime: number; size: number }>
): Promise<string[]> {
  const changed: string[] = [];

  for (const fp of filePaths) {
    const relative = fp.replace(rootDir + '/', '').replace(rootDir + '\\', '');
    const fileInfo = await stat(fp);
    const existing = existingFiles[relative];

    if (!existing ||
        existing.mtime !== fileInfo.mtimeMs ||
        existing.size !== fileInfo.size) {
      changed.push(fp);
    }
  }

  return changed;
}

/**
 * Detect changed files using the best available method.
 * 
 * Strategy:
 * 1. If git is available, use git status (fastest)
 * 2. Otherwise, fall back to mtime + size check
 * 
 * @param rootDir - Repository root directory
 * @param filePaths - All files to check
 * @param existingFiles - Existing file records from manifest
 * @returns List of files that need re-indexing
 */
export async function detectChangedFiles(
  rootDir: string,
  filePaths: string[],
  existingFiles: Record<string, { mtime: number; size: number }>
): Promise<string[]> {
  // Try git first (fastest)
  if (await isGitRepo(rootDir)) {
    const gitChanged = await getChangedFilesFromGit(rootDir);
    
    if (gitChanged.size > 0) {
      // Convert git relative paths to absolute paths
      const absolutePaths = Array.from(gitChanged)
        .filter(relPath => {
          // Only include files that exist in our file list
          const absPath = join(rootDir, relPath);
          return filePaths.includes(absPath);
        })
        .map(relPath => join(rootDir, relPath));
      
      return absolutePaths;
    }
    
    // Git returned no changes, but we should still verify with mtime
    // in case git status missed something (e.g., file outside git)
  }

  // Fallback to mtime + size check
  return getChangedFilesFromMtime(rootDir, filePaths, existingFiles);
}

/**
 * Get the detection method being used.
 */
export async function getDetectionMethod(rootDir: string): Promise<string> {
  if (await isGitRepo(rootDir)) {
    return 'git-aware';
  }
  return 'mtime-based';
}