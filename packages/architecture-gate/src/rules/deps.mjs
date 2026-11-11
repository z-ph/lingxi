import { isBuiltin } from 'node:module';
import { dependencyEntries } from '../dependencies.mjs';

function violation(file, message) {
  return { file, message };
}

export async function checkRuntimeDependencies(ctx) {
  if (!ctx.spec) return [];
  const violations = [];
  const prefix = ctx.spec.packageNamePrefix;
  const registry = ctx.spec.runtimeDependencies;
  const versions = new Map();

  for (const item of ctx.workspacePackages) {
    if (!item.packageJson || !item.name) continue;
    for (const { section, name, version } of dependencyEntries(item.packageJson)) {
      if (name.startsWith(prefix)) continue;
      if (isBuiltin(name)) {
        violations.push(
          violation(
            `${item.dir}/package.json`,
            `${section}.${name} 是 Node 内置模块，不应声明为依赖`,
          ),
        );
        continue;
      }
      if (
        section !== 'dependencies' &&
        section !== 'optionalDependencies' &&
        section !== 'peerDependencies'
      ) {
        continue;
      }
      const rule = registry[name];
      if (!rule) {
        violations.push(
          violation(
            `${item.dir}/package.json`,
            `${section}.${name} 未在 docs/architecture.md 的 runtimeDependencies 中登记（用途/许可证/allowedIn）`,
          ),
        );
        continue;
      }
      if (!rule.allowedIn.includes(item.name)) {
        violations.push(
          violation(
            `${item.dir}/package.json`,
            `${section}.${name} 未被允许用于 ${item.name}；allowedIn=${rule.allowedIn.join(', ')}`,
          ),
        );
      }

      const usage = versions.get(name) ?? new Map();
      usage.set(version, [...(usage.get(version) ?? []), item.name]);
      versions.set(name, usage);
    }
  }

  for (const [name, usage] of versions) {
    if (usage.size <= 1) continue;
    const details = [...usage.entries()]
      .map(([version, packages]) => `${version} (${packages.join(', ')})`)
      .join('; ');
    violations.push(violation('packages', `运行时依赖 ${name} 在仓库内版本不一致: ${details}`));
  }

  return violations;
}
