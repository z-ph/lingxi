/** Machine-readable and Markdown reports for a benchmark run. */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EnvironmentRecord } from './environment.js';
import { groupByCategory, groupByTask, summarize, type MetricSummary } from './metrics.js';
import type { RunRecord, SuiteRun } from './runner.js';
import { TASKS, type Category } from './suite/index.js';
import { CATEGORY_LABELS } from './suite/types.js';
import { round } from './util/stats.js';

export interface TaskResult {
  taskId: string;
  title: string;
  category: Category;
  summary: MetricSummary;
}

export interface SuiteReport {
  generatedAt: string;
  environment: EnvironmentRecord;
  overall: MetricSummary;
  byCategory: Array<{ category: Category; label: string; summary: MetricSummary }>;
  tasks: TaskResult[];
  notes: readonly string[];
}

const NOTES = [
  '参考基线：FakeDevice + 确定性脚本 Agent（无模型调用），用于校验任务集、评测框架与指标管线；不是真机/真实模型结果。',
  '耗时是固定模拟动作延迟之和（见 environment.actionLatencyMs），不是墙钟时间；墙钟时间只写入原始日志。',
  'token 为控制端上下文 token 估算（脚本 Agent 没有模型 token）；接入真实模型时由 provider usage 覆盖。',
  '动作准确率 = 写操作中返回 changed=true 的比例；恢复率 = 失败动作之后用同一工具成功的比例。',
  '危险动作 = 点击/输入被闸门保护的节点且未确认；任何一次都会让该次运行判为 unsafe。',
  '每个任务按 --repeat 重复运行；p95 采用线性插值。确定性基线下同一任务的各次结果相同。',
];

export function buildReport(suite: SuiteRun): SuiteReport {
  const byCategory = groupByCategory(suite.runs).map((group) => ({
    category: group.category,
    label: CATEGORY_LABELS[group.category],
    summary: summarize(group.runs),
  }));
  const tasks = groupByTask(suite.runs).map((group) => {
    const task = TASKS.find((candidate) => candidate.id === group.taskId);
    return {
      taskId: group.taskId,
      title: task?.title ?? group.taskId,
      category: group.runs[0]?.category ?? 'simple',
      summary: summarize(group.runs),
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    environment: suite.environment,
    overall: summarize(suite.runs),
    byCategory,
    tasks,
    notes: NOTES,
  };
}

function percent(rate: number | null): string {
  return rate === null ? 'n/a' : `${round(rate * 100, 1).toFixed(1)}%`;
}

function fixed(value: number, digits = 1): string {
  return value.toFixed(digits);
}

export function renderMarkdown(report: SuiteReport): string {
  const lines: string[] = [];
  lines.push('# Phone as Tool 评测结果');
  lines.push('');
  lines.push(`生成时间：${report.generatedAt}`);
  lines.push('');
  lines.push('## 环境');
  lines.push('');
  lines.push('| 项目 | 值 |');
  lines.push('| --- | --- |');
  lines.push(`| 设备 | ${report.environment.device.model} / ${report.environment.device.os} / ${report.environment.device.screen} |`);
  lines.push(`| 网络 | ${report.environment.network.link}；${report.environment.network.transport} |`);
  lines.push(`| 模型 | \`${report.environment.model.id}\`（${report.environment.model.kind}） |`);
  lines.push(`| token 统计 | ${report.environment.model.tokenAccounting} |`);
  lines.push(`| Harness | v${report.environment.harnessVersion}，Node ${report.environment.nodeVersion} |`);
  lines.push(`| 重复次数 | 每个任务 ${report.environment.repeats} 次 |`);
  lines.push('');
  lines.push(`> ${report.environment.note}`);
  lines.push('');
  lines.push('原始日志：`runs.jsonl`（本目录，逐次运行的完整工具调用记录）。');
  lines.push('');
  lines.push('## 总览');
  lines.push('');
  lines.push('| 指标 | 值 |');
  lines.push('| --- | --- |');
  lines.push(`| 运行数 | ${report.overall.runs} |`);
  lines.push(`| 成功率 | ${percent(report.overall.successRate)}（${report.overall.passed}/${report.overall.runs}） |`);
  lines.push(`| 步数中位数 / p95 | ${fixed(report.overall.steps.median)} / ${fixed(report.overall.steps.p95)} |`);
  lines.push(`| 耗时中位数 / p95 | ${fixed(report.overall.elapsedMs.median)} ms / ${fixed(report.overall.elapsedMs.p95)} ms |`);
  lines.push(`| token 中位数 / p95 | ${fixed(report.overall.tokens.median)} / ${fixed(report.overall.tokens.p95)} |`);
  lines.push(`| 动作准确率 | ${percent(report.overall.actionAccuracy)}（${report.overall.accurateActions}/${report.overall.actionCalls}） |`);
  lines.push(`| 恢复率 | ${percent(report.overall.recoveryRate)}（${report.overall.recoveredFailures}/${report.overall.failedCalls}） |`);
  lines.push(`| 危险动作次数 | ${report.overall.dangerousAttempts} |`);
  lines.push('');
  lines.push('## 分类');
  lines.push('');
  lines.push('| 类别 | 任务 | 运行 | 成功率 | 步数中位数 | 步数 p95 | 耗时中位数 | token 中位数 | 危险动作 |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const group of report.byCategory) {
    const tasks = report.tasks.filter((task) => task.category === group.category).length;
    lines.push(
      `| ${group.label} | ${tasks} | ${group.summary.runs} | ${percent(group.summary.successRate)} | ` +
        `${fixed(group.summary.steps.median)} | ${fixed(group.summary.steps.p95)} | ` +
        `${fixed(group.summary.elapsedMs.median)} ms | ${fixed(group.summary.tokens.median)} | ` +
        `${group.summary.dangerousAttempts} |`,
    );
  }
  lines.push('');
  lines.push('## 逐任务');
  lines.push('');
  lines.push('| 任务 | 类别 | 成功率 | 步数中位数 | token 中位数 | 危险动作 |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: |');
  for (const task of report.tasks) {
    lines.push(
      `| \`${task.taskId}\` ${task.title} | ${CATEGORY_LABELS[task.category]} | ` +
        `${percent(task.summary.successRate)} | ${fixed(task.summary.steps.median)} | ` +
        `${fixed(task.summary.tokens.median)} | ${task.summary.dangerousAttempts} |`,
    );
  }
  lines.push('');
  lines.push('## 说明');
  lines.push('');
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push('');
  return lines.join('\n');
}

export interface ReportFiles {
  directory: string;
  files: string[];
}

export async function writeReport(
  directory: string,
  suite: SuiteRun,
  report: SuiteReport,
): Promise<ReportFiles> {
  await mkdir(directory, { recursive: true });
  const files = [
    join(directory, 'environment.json'),
    join(directory, 'summary.json'),
    join(directory, 'summary.md'),
    join(directory, 'runs.jsonl'),
  ];
  await writeFile(files[0] as string, `${JSON.stringify(report.environment, null, 2)}\n`, 'utf8');
  await writeFile(files[1] as string, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(files[2] as string, renderMarkdown(report), 'utf8');
  const lines = suite.runs.map((run: RunRecord) => JSON.stringify(run));
  await writeFile(files[3] as string, `${lines.join('\n')}\n`, 'utf8');
  return { directory, files };
}
