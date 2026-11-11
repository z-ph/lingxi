import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isFile, readJson } from './fs.mjs';

/**
 * Load every immediate child of packages/ that looks like a workspace directory.
 * Broken/missing package.json entries are kept so rules can report them precisely.
 *
 * @param {string} root
 * @returns {Promise<Array<{dir: string, name: string|null, packagePath: string, packageJson: any, packageJsonError: string|null}>>}
 */
export async function loadWorkspacePackages(root) {
  const packagesRoot = join(root, 'packages');
  let entries;
  try {
    entries = await readdir(packagesRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const packages = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = `packages/${entry.name}`;
    const packagePath = join(packagesRoot, entry.name, 'package.json');
    if (!(await isFile(packagePath))) {
      packages.push({
        dir,
        name: null,
        packagePath,
        packageJson: null,
        packageJsonError: '缺少 package.json',
      });
      continue;
    }
    try {
      const packageJson = await readJson(packagePath);
      packages.push({
        dir,
        name: typeof packageJson.name === 'string' ? packageJson.name : null,
        packagePath,
        packageJson,
        packageJsonError: null,
      });
    } catch (error) {
      packages.push({
        dir,
        name: null,
        packagePath,
        packageJson: null,
        packageJsonError: error.message,
      });
    }
  }
  return packages;
}
