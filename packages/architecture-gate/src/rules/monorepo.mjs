import { join } from 'node:path';
import { dependencyEntries } from '../dependencies.mjs';
import { isFile, pathExists } from '../fs.mjs';

const ALL_LOCKFILES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
];

function violation(file, message) {
  return { file, message };
}

export async function checkMonorepo(ctx) {
  const violations = [];
  const rootPackage = ctx.rootPackage;

  if (!rootPackage) {
    violations.push(violation('package.json', ctx.rootPackageError ?? '缺少根 package.json'));
    return violations;
  }
  if (ctx.rootPackageError) {
    violations.push(violation('package.json', ctx.rootPackageError));
    return violations;
  }
  if (rootPackage.private !== true) {
    violations.push(violation('package.json', '根 package.json 必须设置 "private": true'));
  }
  for (const script of ['format:check', 'gate', 'test', 'build']) {
    if (typeof rootPackage.scripts?.[script] !== 'string' || !rootPackage.scripts[script].trim()) {
      violations.push(violation('package.json', `根 package.json 缺少 scripts.${script}`));
    }
  }

  if (ctx.spec) {
    const rootNode = rootPackage.engines?.node;
    if (rootNode !== ctx.spec.node) {
      violations.push(
        violation(
          'package.json',
          `engines.node 必须与机器契约一致：期望 ${ctx.spec.node}，实际 ${String(rootNode)}`,
        ),
      );
    }
    if (JSON.stringify(rootPackage.workspaces) !== JSON.stringify(ctx.spec.workspaces)) {
      violations.push(
        violation(
          'package.json',
          `workspaces 必须与机器契约一致：期望 ${JSON.stringify(ctx.spec.workspaces)}，实际 ${JSON.stringify(rootPackage.workspaces)}`,
        ),
      );
    }
  }

  for (const lockfile of ALL_LOCKFILES) {
    if (lockfile !== 'package-lock.json' && (await pathExists(join(ctx.root, lockfile)))) {
      violations.push(
        violation(lockfile, `不允许第二个锁文件 ${lockfile}；只能使用根 package-lock.json`),
      );
    }
  }
  if (!(await pathExists(join(ctx.root, 'package-lock.json')))) {
    violations.push(
      violation('package-lock.json', '缺少根 package-lock.json；monorepo 只能有一个根锁文件'),
    );
  }

  const actualPackages = ctx.workspacePackages;
  const declared = ctx.spec?.packages ?? {};
  const prefix = ctx.spec?.packageNamePrefix ?? '@phone-as-tool/';

  for (const item of actualPackages) {
    if (!item.packageJson) {
      violations.push(
        violation(`${item.dir}/package.json`, item.packageJsonError ?? '无法读取 package.json'),
      );
      continue;
    }
    const packageJson = item.packageJson;
    const directoryName = item.dir.split('/').at(-1);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(directoryName)) {
      violations.push(violation(item.dir, `包目录名必须为 kebab-case: ${directoryName}`));
    }
    if (typeof packageJson.name !== 'string' || packageJson.name !== `${prefix}${directoryName}`) {
      violations.push(
        violation(
          `${item.dir}/package.json`,
          `包名必须是 ${prefix}${directoryName}，实际 ${String(packageJson.name)}`,
        ),
      );
    }
    if (packageJson.private !== true) {
      violations.push(
        violation(`${item.dir}/package.json`, 'workspace 包必须设置 "private": true'),
      );
    }
    if (typeof packageJson.version !== 'string' || !packageJson.version.trim()) {
      violations.push(violation(`${item.dir}/package.json`, 'workspace 包必须有 version'));
    }
    if (packageJson.type !== 'module') {
      violations.push(
        violation(`${item.dir}/package.json`, 'workspace 包必须设置 "type": "module"'),
      );
    }
    if (ctx.spec && packageJson.engines?.node !== ctx.spec.node) {
      violations.push(
        violation(
          `${item.dir}/package.json`,
          `engines.node 必须与机器契约一致：期望 ${ctx.spec.node}，实际 ${String(packageJson.engines?.node)}`,
        ),
      );
    }

    const specEntry = declared[packageJson.name];
    if (!specEntry) {
      violations.push(
        violation(
          `${item.dir}/package.json`,
          `包 ${packageJson.name} 未在 docs/architecture.md 的机器契约中登记`,
        ),
      );
    } else if (specEntry.dir !== item.dir) {
      violations.push(
        violation(
          `${item.dir}/package.json`,
          `包目录与机器契约不一致：期望 ${specEntry.dir}，实际 ${item.dir}`,
        ),
      );
    }

    for (const { section, name, version } of dependencyEntries(packageJson)) {
      if (name.startsWith(prefix) && version !== 'workspace:*') {
        violations.push(
          violation(
            `${item.dir}/package.json`,
            `${section}.${name} 必须使用 workspace:*，实际 ${String(version)}`,
          ),
        );
      }
    }

    for (const lockfile of ALL_LOCKFILES) {
      if (await isFile(join(ctx.root, item.dir, lockfile))) {
        violations.push(
          violation(`${item.dir}/${lockfile}`, '不允许包级锁文件；只能使用根 package-lock.json'),
        );
      }
    }
  }

  const names = actualPackages.map((item) => item.name).filter(Boolean);
  const duplicateNames = names.filter((name, index) => names.indexOf(name) !== index);
  for (const name of new Set(duplicateNames)) {
    violations.push(violation('packages', `包名重复: ${name}`));
  }

  for (const [name, entry] of Object.entries(declared)) {
    const matches = actualPackages.filter((item) => item.dir === entry.dir);
    if (matches.length === 0 && (await pathExists(join(ctx.root, entry.dir)))) {
      violations.push(
        violation(entry.dir, `机器契约登记了 ${name}，但目录中没有可用的 package.json`),
      );
    }
  }

  return violations;
}
