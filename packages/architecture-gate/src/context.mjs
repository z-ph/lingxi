import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists, readJson } from './fs.mjs';
import { loadWorkspacePackages } from './workspaces.mjs';

export const ARCHITECTURE_DOC = 'docs/architecture.md';
export const ARCHITECTURE_EN_DOC = 'docs/en/architecture.md';
const MACHINE_BLOCK_RE = /```json architecture-gate\s*\r?\n([\s\S]*?)\r?\n```/g;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findCycle(packages) {
  const state = new Map();
  const stack = [];
  let cycle = null;

  function visit(name) {
    if (cycle) return;
    state.set(name, 1);
    stack.push(name);
    for (const dependency of packages[name].mayDependOn) {
      const dependencyState = state.get(dependency) ?? 0;
      if (dependencyState === 1) {
        cycle = [...stack.slice(stack.indexOf(dependency)), dependency];
        return;
      }
      if (dependencyState === 0) {
        visit(dependency);
        if (cycle) return;
      }
    }
    stack.pop();
    state.set(name, 2);
  }

  for (const name of Object.keys(packages)) {
    if ((state.get(name) ?? 0) === 0) visit(name);
    if (cycle) break;
  }
  return cycle;
}

/**
 * Validate the machine-readable architecture contract.
 * The contract lives in docs/architecture.md and is the single source for layout.
 *
 * @param {any} spec
 * @returns {string[]}
 */
export function validateArchitectureSpec(spec) {
  const errors = [];
  if (!isPlainObject(spec)) return ['机器契约必须是 JSON 对象'];
  if (spec.schemaVersion !== 1) errors.push('schemaVersion 必须为 1');
  if (typeof spec.node !== 'string' || !/^>=\d+(?:\.\d+)*$/.test(spec.node)) {
    errors.push('node 必须是 >=X[.Y[.Z]] 形式的字符串');
  }
  if (
    !Array.isArray(spec.workspaces) ||
    spec.workspaces.length === 0 ||
    !spec.workspaces.every((item) => typeof item === 'string' && item.length > 0)
  ) {
    errors.push('workspaces 必须是非空字符串数组');
  }
  if (typeof spec.packageNamePrefix !== 'string' || !spec.packageNamePrefix.endsWith('/')) {
    errors.push('packageNamePrefix 必须是以 / 结尾的字符串');
  }
  if (!isPlainObject(spec.packages) || Object.keys(spec.packages).length === 0) {
    errors.push('packages 必须是非空对象');
    return errors;
  }

  const prefix = typeof spec.packageNamePrefix === 'string' ? spec.packageNamePrefix : '';
  const directories = new Map();
  for (const [name, entry] of Object.entries(spec.packages)) {
    if (!isPlainObject(entry)) {
      errors.push(`packages.${name} 必须是对象`);
      continue;
    }
    if (!prefix || !name.startsWith(prefix) || name.length === prefix.length) {
      errors.push(`包名 ${name} 必须符合 ${prefix || '<prefix>'}<name>`);
    } else if (name.slice(prefix.length).includes('/')) {
      errors.push(`包名 ${name} 不能包含多层路径`);
    }
    if (typeof entry.dir !== 'string' || !/^packages\/[a-z0-9][a-z0-9-]*$/.test(entry.dir)) {
      errors.push(`packages.${name}.dir 必须是 packages/<kebab-case> 路径`);
    } else {
      if (entry.dir.split('/').at(-1) !== name.slice(prefix.length)) {
        errors.push(`packages.${name}.dir 的目录名必须与包名后缀一致`);
      }
      if (directories.has(entry.dir)) {
        errors.push(`packages.${name}.dir 与 ${directories.get(entry.dir)} 重复`);
      }
      directories.set(entry.dir, name);
    }
    if (!Number.isInteger(entry.layer) || entry.layer < 0 || entry.layer > 100) {
      errors.push(`packages.${name}.layer 必须是 0-100 的整数`);
    }
    if (
      !Array.isArray(entry.mayDependOn) ||
      !entry.mayDependOn.every((item) => typeof item === 'string')
    ) {
      errors.push(`packages.${name}.mayDependOn 必须是字符串数组`);
    }
  }

  for (const [name, entry] of Object.entries(spec.packages)) {
    if (!isPlainObject(entry) || !Array.isArray(entry.mayDependOn)) continue;
    const seen = new Set();
    for (const dependency of entry.mayDependOn) {
      if (seen.has(dependency)) {
        errors.push(`packages.${name}.mayDependOn 重复登记 ${dependency}`);
        continue;
      }
      seen.add(dependency);
      const target = spec.packages[dependency];
      if (!target) {
        errors.push(`packages.${name}.mayDependOn 指向未登记的包 ${dependency}`);
        continue;
      }
      if (dependency === name) errors.push(`packages.${name} 不能依赖自己`);
      if (
        Number.isInteger(target.layer) &&
        Number.isInteger(entry.layer) &&
        target.layer >= entry.layer
      ) {
        errors.push(
          `packages.${name} (layer ${entry.layer}) 不能依赖 ${dependency} (layer ${target.layer})`,
        );
      }
    }
  }

  const graphIsValid = Object.values(spec.packages).every(
    (entry) =>
      isPlainObject(entry) &&
      Array.isArray(entry.mayDependOn) &&
      entry.mayDependOn.every(
        (dependency) => typeof dependency === 'string' && spec.packages[dependency],
      ),
  );
  if (graphIsValid) {
    const cycle = findCycle(spec.packages);
    if (cycle) errors.push(`机器契约依赖图存在环: ${cycle.join(' -> ')}`);
  }

  if (!isPlainObject(spec.runtimeDependencies)) {
    errors.push('runtimeDependencies 必须是对象');
  } else {
    for (const [dependency, rule] of Object.entries(spec.runtimeDependencies)) {
      if (!dependency.trim()) errors.push('runtimeDependencies 包含空包名');
      if (!isPlainObject(rule)) {
        errors.push(`runtimeDependencies.${dependency} 必须是对象`);
        continue;
      }
      if (typeof rule.license !== 'string' || !rule.license.trim()) {
        errors.push(`runtimeDependencies.${dependency}.license 不能为空`);
      }
      if (typeof rule.purpose !== 'string' || rule.purpose.trim().length < 10) {
        errors.push(`runtimeDependencies.${dependency}.purpose 至少 10 个字符`);
      }
      if (!Array.isArray(rule.allowedIn) || rule.allowedIn.length === 0) {
        errors.push(`runtimeDependencies.${dependency}.allowedIn 必须是包名数组`);
      } else {
        for (const allowed of rule.allowedIn) {
          if (typeof allowed !== 'string' || !spec.packages[allowed]) {
            errors.push(`runtimeDependencies.${dependency}.allowedIn 包含未登记的包 ${allowed}`);
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Read repository files needed by every rule.
 *
 * @param {string} root
 */
export async function loadContext(root) {
  const context = {
    root,
    rootPackage: null,
    rootPackageError: null,
    spec: null,
    specError: null,
    archDoc: null,
    archEnDoc: null,
    workspacePackages: [],
  };

  const rootPackagePath = join(root, 'package.json');
  if (await pathExists(rootPackagePath)) {
    try {
      context.rootPackage = await readJson(rootPackagePath);
    } catch (error) {
      context.rootPackageError = error.message;
    }
  }

  const archDocPath = join(root, ARCHITECTURE_DOC);
  if (!(await pathExists(archDocPath))) {
    context.specError = `缺少 ${ARCHITECTURE_DOC}`;
  } else {
    context.archDoc = await readFile(archDocPath, 'utf8');
    const matches = [...context.archDoc.matchAll(MACHINE_BLOCK_RE)];
    if (matches.length === 0) {
      context.specError = `${ARCHITECTURE_DOC} 缺少 architecture-gate 机器契约代码块`;
    } else if (matches.length > 1) {
      context.specError = `${ARCHITECTURE_DOC} 只能包含一个 architecture-gate 机器契约代码块`;
    } else {
      try {
        const spec = JSON.parse(matches[0][1]);
        const errors = validateArchitectureSpec(spec);
        if (errors.length > 0) {
          context.specError = `机器契约不合法: ${errors.join('; ')}`;
        } else {
          context.spec = spec;
        }
      } catch (error) {
        context.specError = `机器契约 JSON 解析失败: ${error.message}`;
      }
    }
  }

  const archEnPath = join(root, ARCHITECTURE_EN_DOC);
  if (await pathExists(archEnPath)) {
    context.archEnDoc = await readFile(archEnPath, 'utf8');
  }

  context.workspacePackages = await loadWorkspacePackages(root);
  return context;
}
