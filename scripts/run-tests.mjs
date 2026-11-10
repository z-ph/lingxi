/**
 * Portable test entry: `node --test` does not expand globs on every supported
 * Node version/platform (notably Windows), so enumerate the compiled test files
 * here and pass them explicitly.
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const testDir = path.resolve('dist/test');
let files;
try {
  files = readdirSync(testDir)
    .filter((file) => file.endsWith('.test.js'))
    .sort()
    .map((file) => path.join(testDir, file));
} catch {
  console.error(`missing ${testDir}; run "npm run build" first`);
  process.exit(1);
}
if (files.length === 0) {
  console.error(`no compiled tests found in ${testDir}`);
  process.exit(1);
}
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
