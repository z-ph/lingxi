#!/usr/bin/env node
/**
 * Measure the ui_tree token budget over app hierarchies.
 *
 * Default: the five representative app fixtures in test/fixtures/apps.ts.
 * Real captures (once the M2 Android adapter exists) can be fed as JSON:
 *
 *   node dist/bench/measure-ui-tree.js --input path/to/dump.json
 *   node dist/bench/measure-ui-tree.js --input path/to/dumps/ --enforce
 *
 * A dump JSON file is either a raw tree ({ bounds, children, ... }), an object
 * with { app, name, tree }, or an array of such objects.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { pruneUiTree, type RawUiNode } from '../src/ui-tree/index.js';
import { APP_FIXTURES, type AppFixture } from '../test/fixtures/apps.js';
import { countTokens, TOKENIZER_NAME } from './token-count.js';
import {
  summarize,
  TOKEN_BUDGET,
  withinBudget,
  type Distribution,
} from './stats.js';

interface Measurement {
  readonly app: string;
  readonly name: string;
  readonly locale: string;
  readonly nodes: number;
  readonly rawNodes: number;
  readonly rawTokens: number;
  readonly payloadTokens: number;
  readonly truncated: boolean;
}

interface CliOptions {
  readonly input?: string;
  readonly json: boolean;
  readonly enforce: boolean;
}

interface Report {
  readonly tokenizer: string;
  readonly budget: typeof TOKEN_BUDGET;
  readonly measurements: readonly Measurement[];
  readonly summary: Distribution;
  readonly pass: boolean;
}

function measure(fixture: AppFixture): Measurement {
  const payload = pruneUiTree(fixture.tree);
  return {
    app: fixture.app,
    name: fixture.name,
    locale: fixture.locale,
    nodes: payload.nodes.length,
    rawNodes: countRawNodes(fixture.tree),
    rawTokens: countTokens(JSON.stringify(fixture.tree)),
    payloadTokens: countTokens(JSON.stringify(payload)),
    truncated: payload.truncated,
  };
}

function countRawNodes(root: RawUiNode): number {
  let total = 1;
  for (const child of root.children ?? []) total += countRawNodes(child);
  return total;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let input: string | undefined;
  let json = false;
  let enforce = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === '--input' || arg === '-i') {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} needs a file or directory path`);
      input = value;
      index += 1;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--enforce') {
      enforce = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return input === undefined ? { json, enforce } : { input, json, enforce };
}

function printUsage(): void {
  console.log(
    [
      'Usage: npm run measure -- [--input <file-or-dir>] [--json] [--enforce]',
      '',
      'Without --input, five representative app fixtures are measured.',
      'With --input, measure raw JSON hierarchy dumps (or { tree } wrappers).',
      '--enforce exits non-zero when median >= 3000 or p95 >= 8000 tokens.',
    ].join('\n'),
  );
}

async function loadFixtures(input: string): Promise<AppFixture[]> {
  const info = await stat(input);
  const files = info.isDirectory()
    ? (await readdir(input))
        .filter((entry) => extname(entry).toLowerCase() === '.json')
        .sort()
        .map((entry) => join(input, entry))
    : [input];

  if (files.length === 0) throw new Error(`no JSON dumps found in ${input}`);

  const fixtures: AppFixture[] = [];
  for (const file of files) {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of entries) {
      fixtures.push(toFixture(entry, file, fixtures.length));
    }
  }
  return fixtures;
}

function toFixture(value: unknown, file: string, index: number): AppFixture {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${file}: expected a JSON object`);
  }
  const record = value as Record<string, unknown>;
  const tree = ('tree' in record ? record.tree : record) as RawUiNode | undefined;
  if (typeof tree !== 'object' || tree === null || typeof tree.bounds !== 'object') {
    throw new Error(`${file}: expected an accessibility tree with a bounds object`);
  }
  return {
    app: typeof record.app === 'string' ? record.app : `custom-${index + 1}`,
    name: typeof record.name === 'string' ? record.name : basename(file),
    locale: typeof record.locale === 'string' ? record.locale : 'unknown',
    screen: { width: 0, height: 0 },
    tree,
  };
}

function buildReport(measurements: readonly Measurement[]): Report {
  const summary = summarize(measurements.map((entry) => entry.payloadTokens));
  return {
    tokenizer: TOKENIZER_NAME,
    budget: TOKEN_BUDGET,
    measurements,
    summary,
    pass: withinBudget(summary),
  };
}

function formatThousands(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString('en-US')
    : value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function printReport(report: Report, source: 'bundled' | 'input'): void {
  const headers = ['App', 'Locale', 'Nodes', 'Raw nodes', 'Raw tokens', 'Payload', 'Truncated'];
  const rows = report.measurements.map((entry) => [
    entry.name,
    entry.locale,
    String(entry.nodes),
    String(entry.rawNodes),
    formatThousands(entry.rawTokens),
    formatThousands(entry.payloadTokens),
    String(entry.truncated),
  ]);
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] as string).length)),
  );
  const line = (cells: readonly string[]): string =>
    cells.map((cell, column) => cell.padEnd(widths[column] as number)).join('  ').trimEnd();

  console.log(`ui_tree token budget — pruned JSON payload, ${report.tokenizer}`);
  console.log(
    source === 'bundled'
      ? 'Representative app fixtures (not real-device captures; see docs/mcp-tools.md)'
      : 'Custom JSON dumps (converted to RawUiNode)',
  );
  console.log('');
  console.log(line(headers));
  console.log(line(widths.map((width) => '-'.repeat(width))));
  for (const row of rows) console.log(line(row));
  console.log('');
  console.log(
    `Median payload: ${formatThousands(report.summary.median)} tokens ` +
      `(budget < ${formatThousands(report.budget.median)}): ${report.summary.median < report.budget.median ? 'PASS' : 'FAIL'}`,
  );
  console.log(
    `p95 payload (nearest-rank): ${formatThousands(report.summary.p95)} tokens ` +
      `(budget < ${formatThousands(report.budget.p95)}): ${report.summary.p95 < report.budget.p95 ? 'PASS' : 'FAIL'}`,
  );
  console.log(
    `Apps measured: ${report.summary.count}; range ${formatThousands(report.summary.min)}–${formatThousands(report.summary.max)} tokens`,
  );
  console.log(`Overall: ${report.pass ? 'PASS' : 'FAIL'}`);
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${(error as Error).message}\n`);
    printUsage();
    process.exitCode = 2;
    return;
  }

  const fixtures = options.input ? await loadFixtures(options.input) : [...APP_FIXTURES];
  const report = buildReport(fixtures.map(measure));

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, options.input ? 'input' : 'bundled');
  }

  if (options.enforce && !report.pass) process.exitCode = 1;
}

await main();
