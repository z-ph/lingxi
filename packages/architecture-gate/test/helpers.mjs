import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/good-repo', import.meta.url));

export async function createFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'architecture-gate-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await cp(FIXTURE_PATH, root, { recursive: true });
  return root;
}

export async function readJsonFixture(root, relativePath) {
  const content = await readFile(join(root, relativePath), 'utf8');
  return JSON.parse(content);
}

export async function writeJsonFixture(root, relativePath, value) {
  await writeTextFixture(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextFixture(root, relativePath, content) {
  const absolute = join(root, relativePath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
}

export async function appendTextFixture(root, relativePath, content) {
  const absolute = join(root, relativePath);
  const current = await readFile(absolute, 'utf8');
  await writeFile(absolute, `${current}\n${content}\n`, 'utf8');
}

export async function replaceInFixture(root, relativePath, search, replacement) {
  const absolute = join(root, relativePath);
  const current = await readFile(absolute, 'utf8');
  assert.ok(current.includes(search), `fixture file ${relativePath} does not contain ${search}`);
  await writeFile(absolute, current.replace(search, replacement), 'utf8');
}

export async function removeFixtureFile(root, relativePath) {
  await rm(join(root, relativePath), { force: true });
}

export async function copyWithinFixture(root, from, to) {
  await cp(join(root, from), join(root, to));
}

export function violationIds(result) {
  return result.violations.map((violation) => violation.id);
}

export function assertViolation(result, id, expectedText) {
  const matches = result.violations.filter((violation) => violation.id === id);
  assert.ok(
    matches.length > 0,
    `expected ${id}, got: ${JSON.stringify(result.violations, null, 2)}`,
  );
  if (expectedText) {
    assert.ok(
      matches.some(
        (violation) =>
          (violation.file ?? '').includes(expectedText) || violation.message.includes(expectedText),
      ),
      `expected ${id} to mention ${expectedText}, got: ${JSON.stringify(matches, null, 2)}`,
    );
  }
}

export function assertNoViolation(result, id) {
  const matches = result.violations.filter((violation) => violation.id === id);
  assert.deepEqual(matches, [], `did not expect ${id}, got: ${JSON.stringify(matches, null, 2)}`);
}
