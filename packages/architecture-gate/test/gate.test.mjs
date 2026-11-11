import assert from 'node:assert/strict';
import test from 'node:test';
import { runGate } from '../src/gate.mjs';
import {
  appendTextFixture,
  assertNoViolation,
  assertViolation,
  copyWithinFixture,
  createFixture,
  readJsonFixture,
  removeFixtureFile,
  replaceInFixture,
  writeJsonFixture,
  writeTextFixture,
} from './helpers.mjs';

test('good fixture passes every rule', async (t) => {
  const root = await createFixture(t);
  const result = await runGate({ root });
  assert.deepEqual(result.violations, [], JSON.stringify(result.violations, null, 2));
});

test('DOC-001 rejects a document without an English mirror', async (t) => {
  const root = await createFixture(t);
  await removeFixtureFile(root, 'docs/en/vision.md');
  const result = await runGate({ root });
  assertViolation(result, 'DOC-001', 'docs/vision.md');
});

test('DOC-001 rejects an orphan English mirror', async (t) => {
  const root = await createFixture(t);
  await writeTextFixture(root, 'docs/en/orphan.md', '# Orphan\n\nNo Chinese primary exists.\n');
  const result = await runGate({ root });
  assertViolation(result, 'DOC-001', 'docs/en/orphan.md');
});

test('DOC-001 rejects a missing language link', async (t) => {
  const root = await createFixture(t);
  await replaceInFixture(
    root,
    'docs/vision.md',
    '[简体中文](vision.md) | [English](en/vision.md)',
    'Fixture vision',
  );
  const result = await runGate({ root });
  assertViolation(result, 'DOC-001', '语言链接');
});

test('DOC-002 rejects a broken local link', async (t) => {
  const root = await createFixture(t);
  await appendTextFixture(root, 'docs/vision.md', '[broken](missing.md)');
  const result = await runGate({ root });
  assertViolation(result, 'DOC-002', 'missing.md');
});

test('DOC-002 rejects a broken anchor', async (t) => {
  const root = await createFixture(t);
  await appendTextFixture(root, 'docs/vision.md', '[broken anchor](en/vision.md#does-not-exist)');
  const result = await runGate({ root });
  assertViolation(result, 'DOC-002', 'does-not-exist');
});

test('DOC-003 rejects a doc missing from the README index', async (t) => {
  const root = await createFixture(t);
  await replaceInFixture(root, 'README.md', '- [Vision](docs/vision.md)', '- Vision');
  const result = await runGate({ root });
  assertViolation(result, 'DOC-003', 'docs/vision.md');
});

test('MONO-001 rejects a missing root lockfile', async (t) => {
  const root = await createFixture(t);
  await removeFixtureFile(root, 'package-lock.json');
  const result = await runGate({ root });
  assertViolation(result, 'MONO-001', 'package-lock.json');
});

test('MONO-001 rejects a missing root format:check script', async (t) => {
  const root = await createFixture(t);
  const rootPackage = await readJsonFixture(root, 'package.json');
  delete rootPackage.scripts['format:check'];
  await writeJsonFixture(root, 'package.json', rootPackage);
  const result = await runGate({ root });
  assertViolation(result, 'MONO-001', 'format:check');
});

test('MONO-001 rejects an engines.node mismatch', async (t) => {
  const root = await createFixture(t);
  const rootPackage = await readJsonFixture(root, 'package.json');
  rootPackage.engines.node = '>=24';
  await writeJsonFixture(root, 'package.json', rootPackage);
  const result = await runGate({ root });
  assertViolation(result, 'MONO-001', 'engines.node');
});

test('MONO-001 rejects a nested package lockfile', async (t) => {
  const root = await createFixture(t);
  await writeJsonFixture(root, 'packages/daemon/package-lock.json', {});
  const result = await runGate({ root });
  assertViolation(result, 'MONO-001', 'packages/daemon/package-lock.json');
});

test('MONO-001 rejects an undeclared workspace package', async (t) => {
  const root = await createFixture(t);
  await writeJsonFixture(root, 'packages/extra/package.json', {
    name: '@phone-as-tool/extra',
    version: '0.0.0',
    private: true,
    type: 'module',
    engines: { node: '>=22' },
  });
  const result = await runGate({ root });
  assertViolation(result, 'MONO-001', '@phone-as-tool/extra');
});

test('ARCH-001 rejects a dependency outside mayDependOn', async (t) => {
  const root = await createFixture(t);
  const contracts = await readJsonFixture(root, 'packages/contracts/package.json');
  contracts.dependencies = { '@phone-as-tool/daemon': 'workspace:*' };
  await writeJsonFixture(root, 'packages/contracts/package.json', contracts);
  const result = await runGate({ root });
  assertViolation(result, 'ARCH-001', 'mayDependOn');
});

test('ARCH-001 rejects a dependency cycle', async (t) => {
  const root = await createFixture(t);
  const device = await readJsonFixture(root, 'packages/device/package.json');
  device.dependencies = {
    '@phone-as-tool/contracts': 'workspace:*',
    '@phone-as-tool/daemon': 'workspace:*',
  };
  await writeJsonFixture(root, 'packages/device/package.json', device);
  const result = await runGate({ root });
  assertViolation(result, 'ARCH-001', '存在环');
});

test('ARCH-002 rejects a relative import escaping the package', async (t) => {
  const root = await createFixture(t);
  await writeTextFixture(
    root,
    'packages/daemon/src/extra.ts',
    "import '../../contracts/src/index.js';\n\nexport const extra = 1;\n",
  );
  const result = await runGate({ root });
  assertViolation(result, 'ARCH-002', '跨包相对导入');
});

test('ARCH-002 rejects a deep import into another package', async (t) => {
  const root = await createFixture(t);
  await writeTextFixture(
    root,
    'packages/daemon/src/extra.ts',
    "import '@phone-as-tool/contracts/src/index.js';\n\nexport const extra = 1;\n",
  );
  const result = await runGate({ root });
  assertViolation(result, 'ARCH-002', '深导入');
});

test('ARCH-002 rejects an undeclared internal import', async (t) => {
  const root = await createFixture(t);
  await writeTextFixture(
    root,
    'packages/contracts/src/extra.ts',
    "import '@phone-as-tool/device';\n\nexport const extra = 1;\n",
  );
  const result = await runGate({ root });
  assertViolation(result, 'ARCH-002', '未在 package.json 声明');
});

test('DEPS-001 rejects inconsistent runtime dependency versions', async (t) => {
  const root = await createFixture(t);
  const daemon = await readJsonFixture(root, 'packages/daemon/package.json');
  daemon.dependencies['left-pad'] = '1.0.0';
  await writeJsonFixture(root, 'packages/daemon/package.json', daemon);
  const device = await readJsonFixture(root, 'packages/device/package.json');
  device.dependencies['left-pad'] = '2.0.0';
  await writeJsonFixture(root, 'packages/device/package.json', device);
  await replaceInFixture(
    root,
    'docs/architecture.md',
    '"runtimeDependencies": {}',
    `"runtimeDependencies": {
    "left-pad": {
      "license": "MIT",
      "purpose": "Positive probe for dependency version consistency.",
      "allowedIn": ["@phone-as-tool/daemon", "@phone-as-tool/device"]
    }
  }`,
  );
  const result = await runGate({ root });
  assertViolation(result, 'DEPS-001', '版本不一致');
});

test('DEPS-001 rejects an unregistered runtime dependency', async (t) => {
  const root = await createFixture(t);
  const daemon = await readJsonFixture(root, 'packages/daemon/package.json');
  daemon.dependencies['left-pad'] = '1.0.0';
  await writeJsonFixture(root, 'packages/daemon/package.json', daemon);
  const result = await runGate({ root });
  assertViolation(result, 'DEPS-001', 'left-pad');
});

test('DEPS-001 accepts a registered runtime dependency', async (t) => {
  const root = await createFixture(t);
  const daemon = await readJsonFixture(root, 'packages/daemon/package.json');
  daemon.dependencies['left-pad'] = '1.0.0';
  await writeJsonFixture(root, 'packages/daemon/package.json', daemon);
  await replaceInFixture(
    root,
    'docs/architecture.md',
    '"runtimeDependencies": {}',
    `"runtimeDependencies": {
    "left-pad": {
      "license": "MIT",
      "purpose": "Positive probe for dependency registration.",
      "allowedIn": ["@phone-as-tool/daemon"]
    }
  }`,
  );
  const result = await runGate({ root });
  assertNoViolation(result, 'DEPS-001');
});

test('DRY-001 rejects duplicate source files', async (t) => {
  const root = await createFixture(t);
  await copyWithinFixture(
    root,
    'packages/contracts/src/index.ts',
    'packages/contracts/src/index-copy.ts',
  );
  const result = await runGate({ root });
  assertViolation(result, 'DRY-001', 'index-copy.ts');
});

test('NORMS-001 rejects a missing CI gate workflow', async (t) => {
  const root = await createFixture(t);
  await removeFixtureFile(root, '.github/workflows/ci.yml');
  const result = await runGate({ root });
  assertViolation(result, 'NORMS-001', '.github/workflows/ci.yml');
});

test('NORMS-001 rejects CI without format check', async (t) => {
  const root = await createFixture(t);
  await replaceInFixture(
    root,
    '.github/workflows/ci.yml',
    '      - run: npm run format:check\n',
    '',
  );
  const result = await runGate({ root });
  assertViolation(result, 'NORMS-001', 'format:check');
});

test('NORMS-001 rejects a duplicated machine contract in the English mirror', async (t) => {
  const root = await createFixture(t);
  await appendTextFixture(root, 'docs/en/architecture.md', '```json architecture-gate\n{}\n```');
  const result = await runGate({ root });
  assertViolation(result, 'NORMS-001', 'docs/en/architecture.md');
});

test('NORMS-001 rejects an invalid machine contract', async (t) => {
  const root = await createFixture(t);
  await replaceInFixture(root, 'docs/architecture.md', '"schemaVersion": 1', '"schemaVersion": 2');
  const result = await runGate({ root });
  assertViolation(result, 'NORMS-001', 'schemaVersion');
});
