#!/usr/bin/env node
import { resolve } from 'node:path';
import { runGate } from './gate.mjs';
import { formatJson, formatText } from './report.mjs';

function printHelp() {
  process.stdout.write(
    [
      '用法: node packages/architecture-gate/src/cli.mjs [--root <dir>] [--format text|json]',
      '',
      '  --root <dir>       被检查的仓库根目录（默认当前目录）',
      '  --format <format>  输出格式：text（默认）或 json',
      '  --help, -h         显示帮助',
      '',
      '退出码: 0 通过；1 有违规；2 用法或内部错误。',
      '',
    ].join('\n'),
  );
}

function parseArgs(argv) {
  let root = process.cwd();
  let format = 'text';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (argument === '--root') {
      const value = argv[index + 1];
      if (!value) throw new Error('--root 需要一个目录参数');
      root = resolve(value);
      index += 1;
      continue;
    }
    if (argument === '--format') {
      const value = argv[index + 1];
      if (value !== 'text' && value !== 'json') throw new Error('--format 只支持 text 或 json');
      format = value;
      index += 1;
      continue;
    }
    throw new Error(`未知参数: ${argument}`);
  }
  return { root, format };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return 0;
  }
  const result = await runGate({ root: options.root });
  process.stdout.write(options.format === 'json' ? formatJson(result) : formatText(result));
  return result.summary.errorCount === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(
      `闸机执行失败: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  });
