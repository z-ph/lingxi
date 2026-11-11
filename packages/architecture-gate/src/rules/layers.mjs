import { dirname, join, resolve } from 'node:path';
import { declaredDependencyNames, dependencyEntries } from '../dependencies.mjs';
import { isWithin, readText, walkFiles } from '../fs.mjs';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'];
const IMPORT_PATTERNS = [
  /(?:^|[\r\n])\s*import\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  /(?:^|[\r\n])\s*export\s+(?:[^'";]+?\s+from\s+)['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function violation(file, message) {
  return { file, message };
}

export function findDependencyCycle(adjacency) {
  const state = new Map();
  const stack = [];
  let cycle = null;

  function visit(name) {
    if (cycle) return;
    state.set(name, 1);
    stack.push(name);
    for (const dependency of adjacency.get(name) ?? []) {
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

  for (const name of adjacency.keys()) {
    if ((state.get(name) ?? 0) === 0) visit(name);
    if (cycle) break;
  }
  return cycle;
}

export async function checkLayers(ctx) {
  if (!ctx.spec) return [];
  const violations = [];
  const prefix = ctx.spec.packageNamePrefix;
  const adjacency = new Map();

  for (const item of ctx.workspacePackages) {
    if (!item.packageJson || !item.name) continue;
    const sourceEntry = ctx.spec.packages[item.name];
    const internalDependencies = [];

    for (const { section, name } of dependencyEntries(item.packageJson)) {
      if (!name.startsWith(prefix)) continue;
      internalDependencies.push(name);
      const targetEntry = ctx.spec.packages[name];
      if (!targetEntry) {
        violations.push(
          violation(`${item.dir}/package.json`, `${section}.${name} 未在机器契约中登记`),
        );
        continue;
      }
      if (sourceEntry && !sourceEntry.mayDependOn.includes(name)) {
        violations.push(
          violation(
            `${item.dir}/package.json`,
            `${section}.${name} 不在 mayDependOn 白名单中（当前允许: ${sourceEntry.mayDependOn.join(', ') || '无'}）`,
          ),
        );
      }
      if (
        sourceEntry &&
        Number.isInteger(sourceEntry.layer) &&
        targetEntry.layer >= sourceEntry.layer
      ) {
        violations.push(
          violation(
            `${item.dir}/package.json`,
            `${section}.${name} 的层号 ${targetEntry.layer} 不低于当前包层号 ${sourceEntry.layer}`,
          ),
        );
      }
    }

    adjacency.set(item.name, internalDependencies);
  }

  const cycle = findDependencyCycle(adjacency);
  if (cycle) {
    violations.push(violation('packages', `实际包依赖存在环: ${cycle.join(' -> ')}`));
  }

  return violations;
}

function lineAt(content, index) {
  let line = 1;
  for (let position = 0; position < index; position += 1) {
    if (content[position] === '\n') line += 1;
  }
  return line;
}

export async function checkImports(ctx) {
  if (!ctx.spec) return [];
  const violations = [];
  const prefix = ctx.spec.packageNamePrefix;

  for (const item of ctx.workspacePackages) {
    if (!item.packageJson || !item.name) continue;
    const packageRoot = join(ctx.root, item.dir);
    const declared = declaredDependencyNames(item.packageJson);
    const files = await walkFiles(packageRoot, {
      extensions: SOURCE_EXTENSIONS,
      skip: (relPath) =>
        relPath.startsWith('src/fixtures/') ||
        relPath.startsWith('src/__fixtures__/') ||
        relPath.startsWith('src/test/') ||
        relPath.startsWith('src/__tests__/'),
    });

    for (const relativeFile of files) {
      if (!relativeFile.startsWith('src/')) continue;
      const absoluteFile = join(packageRoot, relativeFile);
      const content = await readText(absoluteFile);
      for (const pattern of IMPORT_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const specifier = match[1];
          const line = lineAt(content, match.index);
          if (specifier.startsWith('.') || specifier.startsWith('/')) {
            const absoluteTarget = resolve(dirname(absoluteFile), specifier);
            if (!isWithin(packageRoot, absoluteTarget)) {
              violations.push(
                violation(
                  `${item.dir}/${relativeFile}:${line}`,
                  `跨包相对导入 ${specifier}；请改为包公开入口并提供 workspace 依赖`,
                ),
              );
            }
            continue;
          }
          if (!specifier.startsWith(prefix)) continue;
          const rest = specifier.slice(prefix.length);
          const [suffix, ...subpath] = rest.split('/');
          const targetName = `${prefix}${suffix}`;
          if (subpath.length > 0) {
            violations.push(
              violation(
                `${item.dir}/${relativeFile}:${line}`,
                `深导入 ${specifier}；只能使用 ${targetName} 的公开入口`,
              ),
            );
            continue;
          }
          if (!ctx.spec.packages[targetName]) {
            violations.push(
              violation(`${item.dir}/${relativeFile}:${line}`, `导入了未登记的包 ${targetName}`),
            );
            continue;
          }
          if (!declared.has(targetName)) {
            violations.push(
              violation(
                `${item.dir}/${relativeFile}:${line}`,
                `导入了未在 package.json 声明的内部依赖 ${targetName}`,
              ),
            );
          }
        }
      }
    }
  }

  return violations;
}
