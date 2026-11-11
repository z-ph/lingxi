import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readText, walkFiles } from '../fs.mjs';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.kt'];
const MIN_NORMALIZED_LENGTH = 200;

function violation(file, message) {
  return { file, message };
}

function normalizeSource(content) {
  return content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

function skipSourceFile(relPath) {
  if (/(?:^|\/)(?:fixtures|__fixtures__|test|__tests__|generated|dist)(?:\/|$)/.test(relPath))
    return true;
  if (/\.d\.ts$/.test(relPath)) return true;
  if (/\.(?:test|spec)\.[^.]+$/.test(relPath)) return true;
  return false;
}

export async function checkDuplicates(ctx) {
  const violations = [];
  const groups = new Map();
  const roots = [];

  for (const item of ctx.workspacePackages) {
    if (item.packageJson) {
      roots.push({
        label: item.dir,
        path: join(ctx.root, item.dir, 'src'),
        displayPrefix: `${item.dir}/src`,
      });
    }
  }
  roots.push({ label: 'apps', path: join(ctx.root, 'apps'), displayPrefix: 'apps' });

  for (const sourceRoot of roots) {
    const files = await walkFiles(sourceRoot.path, {
      extensions: SOURCE_EXTENSIONS,
      skip: skipSourceFile,
    });
    for (const relativeFile of files) {
      const absoluteFile = join(sourceRoot.path, relativeFile);
      const normalized = normalizeSource(await readText(absoluteFile));
      if (normalized.length < MIN_NORMALIZED_LENGTH) continue;
      const hash = createHash('sha256').update(normalized).digest('hex');
      const display = `${sourceRoot.displayPrefix}/${relativeFile}`;
      const group = groups.get(hash);
      if (group) {
        group.push(display);
      } else {
        groups.set(hash, [display]);
      }
    }
  }

  for (const files of groups.values()) {
    if (files.length < 2) continue;
    const [first, ...rest] = files;
    violations.push(violation(first, `检测到内容完全重复的源文件: ${files.join(', ')}`));
    for (const duplicate of rest) {
      violations.push(violation(duplicate, `与 ${first} 内容完全重复；请下沉共享或删除`));
    }
  }

  return violations;
}
