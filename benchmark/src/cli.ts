#!/usr/bin/env node
/** Benchmark CLI: list, verify, run. */

import { ModelAgent } from './agent/model-agent.js';
import { ScriptedAgent } from './agent/scripted-agent.js';
import type { Agent } from './agent/types.js';
import { HARNESS_VERSION } from './environment.js';
import { buildReport, writeReport } from './report.js';
import { runSuite, type RunRecord } from './runner.js';
import { suiteCounts, TASKS, validateSuite } from './suite/index.js';
import { CATEGORIES, CATEGORY_LABELS, type BenchmarkTask, type Category } from './suite/types.js';
import { round } from './util/stats.js';

interface ParsedArgs {
  command: string;
  flags: Map<string, string>;
  help: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [first, ...rest] = argv;
  const command = first !== undefined && !first.startsWith('--') ? first : 'run';
  const args = first !== undefined && !first.startsWith('--') ? rest : argv;
  const flags = new Map<string, string>();
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const equals = arg.indexOf('=');
    if (equals !== -1) {
      flags.set(arg.slice(2, equals), arg.slice(equals + 1));
      continue;
    }
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(arg.slice(2), next);
      index += 1;
    } else {
      flags.set(arg.slice(2), 'true');
    }
  }
  return { command, flags, help };
}

const USAGE = `Phone as Tool benchmark v${HARNESS_VERSION}

用法:
  node dist/src/cli.js list
  node dist/src/cli.js verify
  node dist/src/cli.js run [options]

run 选项:
  --repeat=<n>         每个任务运行次数（默认 5）
  --out=<dir>          结果目录（默认 results/<timestamp>-<agent>）
  --agent=<name>       scripted（默认）或 openai
  --model=<id>         openai Agent 的模型 id（--agent=openai 时必填）
  --base-url=<url>     OpenAI 兼容端点（默认 https://api.openai.com/v1）
  --task=<id[,id]>     只跑指定任务（逗号分隔）
  --category=<name>    simple | multi-step | cross-app
  --quiet              不打印每次运行
  --no-write           不写结果文件

环境变量:
  BENCHMARK_MODEL_API_KEY   --agent=openai 时的 API key（不写入日志）
`;

function printHelp(): void {
  process.stdout.write(`${USAGE}\n`);
}

function printList(): void {
  const counts = suiteCounts();
  process.stdout.write(`任务集：${counts.total}（简单 ${counts.simple} / 多步 ${counts['multi-step']} / 跨 App ${counts['cross-app']}）\n\n`);
  for (const task of TASKS) {
    process.stdout.write(`${task.id.padEnd(34)} [${CATEGORY_LABELS[task.category]}] ${task.title}\n`);
  }
}

function printVerify(): number {
  const errors = validateSuite();
  if (errors.length === 0) {
    process.stdout.write(`任务集结构检查通过：${TASKS.length} 个任务，10/10/10。\n`);
    return 0;
  }
  process.stdout.write(`任务集结构检查失败：\n${errors.map((error) => `  - ${error}`).join('\n')}\n`);
  return 1;
}

function selectTasks(flags: Map<string, string>): BenchmarkTask[] {
  const ids = new Set<string>();
  // --task can be repeated; our parser keeps the last value, so also accept
  // comma-separated ids.
  const rawTask = flags.get('task');
  if (rawTask !== undefined) {
    for (const id of rawTask.split(',').map((value) => value.trim())) {
      if (id.length > 0) ids.add(id);
    }
  }
  const rawCategory = flags.get('category');
  if (rawCategory !== undefined && !CATEGORIES.includes(rawCategory as Category)) {
    throw new Error(`unknown category: ${rawCategory}`);
  }
  const tasks = TASKS.filter((task) => {
    if (ids.size > 0 && !ids.has(task.id)) return false;
    if (rawCategory !== undefined && task.category !== rawCategory) return false;
    return true;
  });
  if (tasks.length === 0) throw new Error('no tasks selected');
  const unknown = [...ids].filter((id) => !TASKS.some((task) => task.id === id));
  if (unknown.length > 0) throw new Error(`unknown task id: ${unknown.join(', ')}`);
  return tasks;
}

function defaultOutDir(agentName: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  return `results/${stamp}-${agentName}`;
}

function formatRun(run: RunRecord): string {
  const status = run.passed ? 'pass' : `fail(${run.failure?.reason ?? 'unknown'})`;
  return `  ${run.runId.padEnd(42)} ${status.padEnd(15)} steps=${String(run.steps).padEnd(2)} ` +
    `elapsed=${round(run.elapsedMs, 1)}ms tokens=${run.tokens.total}`;
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printHelp();
    return 0;
  }
  if (parsed.command === 'list') {
    printList();
    return 0;
  }
  if (parsed.command === 'verify') {
    return printVerify();
  }
  if (parsed.command !== 'run') {
    process.stderr.write(`unknown command: ${parsed.command}\n\n`);
    printHelp();
    return 2;
  }

  const repeatRaw = parsed.flags.get('repeat') ?? '5';
  const repeat = Number(repeatRaw);
  if (!Number.isInteger(repeat) || repeat <= 0) throw new Error(`invalid --repeat: ${repeatRaw}`);
  const agentName = parsed.flags.get('agent') ?? 'scripted';
  const tasks = selectTasks(parsed.flags);
  const quiet = parsed.flags.get('quiet') === 'true';
  const write = parsed.flags.get('no-write') !== 'true';

  let agentFactory: (task: BenchmarkTask) => Agent;
  if (agentName === 'scripted') {
    agentFactory = () => new ScriptedAgent();
  } else if (agentName === 'openai') {
    const apiKey = process.env.BENCHMARK_MODEL_API_KEY ?? '';
    if (apiKey.length === 0) throw new Error('BENCHMARK_MODEL_API_KEY is required for --agent=openai');
    const model = parsed.flags.get('model');
    if (model === undefined || model.length === 0) throw new Error('--model is required for --agent=openai');
    const baseUrl = parsed.flags.get('base-url') ?? 'https://api.openai.com/v1';
    agentFactory = () =>
      new ModelAgent({
        apiKey,
        model,
        baseUrl,
        ...(parsed.flags.get('temperature') === undefined
          ? {}
          : { temperature: Number(parsed.flags.get('temperature')) }),
      });
  } else {
    throw new Error(`unknown agent: ${agentName}`);
  }

  process.stdout.write(
    `运行 ${tasks.length} 个任务 × ${repeat} 次，agent=${agentName}，共 ${tasks.length * repeat} 次。\n`,
  );
  const suite = await runSuite(tasks, {
    repeat,
    agentFactory,
    ...(quiet
      ? {}
      : {
          onTaskFinish: (run: RunRecord) => {
            process.stdout.write(`${formatRun(run)}\n`);
          },
        }),
  });
  const report = buildReport(suite);
  process.stdout.write(
    `\n成功率 ${(report.overall.successRate * 100).toFixed(1)}% (${report.overall.passed}/${report.overall.runs}) · ` +
      `步数中位数 ${report.overall.steps.median} · 耗时中位数 ${report.overall.elapsedMs.median}ms · ` +
      `token 中位数 ${report.overall.tokens.median} · 危险动作 ${report.overall.dangerousAttempts}\n`,
  );
  if (report.overall.actionAccuracy !== null) {
    process.stdout.write(`动作准确率 ${(report.overall.actionAccuracy * 100).toFixed(1)}% · `);
  }
  if (report.overall.recoveryRate !== null) {
    process.stdout.write(`恢复率 ${(report.overall.recoveryRate * 100).toFixed(1)}%\n`);
  } else {
    process.stdout.write('恢复率 n/a（无失败动作）\n');
  }

  if (write) {
    const directory = parsed.flags.get('out') ?? defaultOutDir(agentName);
    const written = await writeReport(directory, suite, report);
    process.stdout.write(`\n结果已写入 ${written.directory}/\n`);
    for (const file of written.files) process.stdout.write(`  ${file}\n`);
  }
  return report.overall.passed === report.overall.runs ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`benchmark failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
