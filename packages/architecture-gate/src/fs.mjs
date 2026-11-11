import { access, readdir, readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative } from 'node:path';

export const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-test',
  'coverage',
  'artifacts',
  '.next',
  '.cache',
]);

export async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function readText(path) {
  return readFile(path, 'utf8');
}

export async function readJson(path) {
  let text;
  try {
    text = await readText(path);
  } catch (error) {
    throw new Error(`无法读取 ${path}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`JSON 解析失败 ${path}: ${error.message}`);
  }
}

/**
 * List files below root as POSIX-style relative paths.
 *
 * @param {string} root
 * @param {{extensions?: string[]|null, skip?: (relPath: string, entry: import('node:fs').Dirent) => boolean, maxDepth?: number}} [options]
 * @returns {Promise<string[]>}
 */
export async function walkFiles(root, options = {}) {
  const { extensions = null, skip = () => false, maxDepth = 32 } = options;
  const files = [];

  async function walk(directory, relDirectory, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const relPath = relDirectory ? `${relDirectory}/${entry.name}` : entry.name;
      if (skip(relPath, entry)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (DEFAULT_IGNORED_DIRS.has(entry.name)) continue;
        await walk(absolute, relPath, depth + 1);
      } else if (entry.isFile()) {
        if (!extensions || extensions.includes(extname(entry.name))) {
          files.push(relPath);
        }
      }
    }
  }

  await walk(root, '', 0);
  return files;
}

export function isWithin(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
