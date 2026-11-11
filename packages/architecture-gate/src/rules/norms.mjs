import { join } from 'node:path';
import { pathExists, readText } from '../fs.mjs';

const REQUIRED_FILES = [
  'docs/architecture.md',
  'docs/en/architecture.md',
  'docs/ci-gates.md',
  'docs/en/ci-gates.md',
  'docs/architecture-review.md',
  'docs/en/architecture-review.md',
  '.github/workflows/ci.yml',
  '.github/workflows/architecture-review.yml',
];

const REQUIRED_CI_COMMANDS = [
  'npm ci',
  'npm run format:check',
  'npm run gate',
  'npm test',
  'npm run build',
  'npm run typecheck',
];

function violation(file, message) {
  return { file, message };
}

export async function checkNorms(ctx) {
  const violations = [];

  for (const file of REQUIRED_FILES) {
    if (!(await pathExists(join(ctx.root, file)))) {
      violations.push(violation(file, '规范要求的文件不存在'));
    }
  }

  if (ctx.specError) {
    violations.push(violation('docs/architecture.md', ctx.specError));
  }
  if (ctx.archEnDoc && /```json architecture-gate\b/.test(ctx.archEnDoc)) {
    violations.push(
      violation(
        'docs/en/architecture.md',
        '英文镜像是解释性文档，不能复制机器契约代码块（避免双源）',
      ),
    );
  }

  const ciPath = join(ctx.root, '.github/workflows/ci.yml');
  if (await pathExists(ciPath)) {
    const ci = await readText(ciPath);
    for (const command of REQUIRED_CI_COMMANDS) {
      if (!ci.includes(command)) {
        violations.push(violation('.github/workflows/ci.yml', `CI 必须包含命令: ${command}`));
      }
    }
    if (ci.includes('continue-on-error')) {
      violations.push(
        violation('.github/workflows/ci.yml', 'CI 不能使用 continue-on-error 绕过闸机'),
      );
    }
  }

  const reviewPath = join(ctx.root, '.github/workflows/architecture-review.yml');
  if (await pathExists(reviewPath)) {
    const review = await readText(reviewPath);
    if (!review.includes('schedule:')) {
      violations.push(
        violation(
          '.github/workflows/architecture-review.yml',
          '巡检工作流必须包含 schedule 触发器',
        ),
      );
    }
    if (!review.includes('gh issue create')) {
      violations.push(
        violation('.github/workflows/architecture-review.yml', '巡检工作流必须创建巡检 issue'),
      );
    }
    if (!review.includes('docs/architecture-review.md')) {
      violations.push(
        violation(
          '.github/workflows/architecture-review.yml',
          '巡检工作流必须链接 docs/architecture-review.md',
        ),
      );
    }
  }

  const agentsPath = join(ctx.root, 'AGENTS.md');
  if (await pathExists(agentsPath)) {
    const agents = await readText(agentsPath);
    for (const link of ['docs/architecture.md', 'docs/ci-gates.md']) {
      if (!agents.includes(link)) {
        violations.push(violation('AGENTS.md', `AGENTS.md 必须链接 ${link}`));
      }
    }
  } else {
    violations.push(violation('AGENTS.md', '缺少 AGENTS.md'));
  }

  return violations;
}
