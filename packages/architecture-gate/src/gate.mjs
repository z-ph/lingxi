import { resolve } from 'node:path';
import { isDirectory } from './fs.mjs';
import { loadContext } from './context.mjs';
import { checkDocsIndex, checkDocsMirror, checkLinks } from './rules/docs.mjs';
import { checkMonorepo } from './rules/monorepo.mjs';
import { checkImports, checkLayers } from './rules/layers.mjs';
import { checkRuntimeDependencies } from './rules/deps.mjs';
import { checkDuplicates } from './rules/dry.mjs';
import { checkNorms } from './rules/norms.mjs';

const CHECKS = [
  ['NORMS-001', checkNorms],
  ['MONO-001', checkMonorepo],
  ['ARCH-001', checkLayers],
  ['ARCH-002', checkImports],
  ['DEPS-001', checkRuntimeDependencies],
  ['DRY-001', checkDuplicates],
  ['DOC-001', checkDocsMirror],
  ['DOC-002', checkLinks],
  ['DOC-003', checkDocsIndex],
];

/**
 * Run every architecture/norm rule against a repository.
 *
 * @param {{root?: string}} [options]
 * @returns {Promise<{root: string, violations: {id: string, file: string|null, message: string}[], summary: {ruleCount: number, errorCount: number}}>}
 */
export async function runGate(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  if (!(await isDirectory(root))) {
    throw new Error(`仓库根目录不存在或不是目录: ${root}`);
  }

  const context = await loadContext(root);
  const violations = [];

  for (const [id, check] of CHECKS) {
    try {
      const found = await check(context);
      for (const item of found) {
        violations.push({ id, file: item.file ?? null, message: item.message ?? '未提供错误消息' });
      }
    } catch (error) {
      violations.push({
        id,
        file: null,
        message: `规则执行异常: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  violations.sort((a, b) => {
    if (a.id !== b.id) return a.id.localeCompare(b.id, 'en');
    const fileA = a.file ?? '';
    const fileB = b.file ?? '';
    if (fileA !== fileB) return fileA.localeCompare(fileB, 'en');
    return a.message.localeCompare(b.message, 'en');
  });

  return {
    root,
    violations,
    summary: {
      ruleCount: CHECKS.length,
      errorCount: violations.length,
    },
  };
}
