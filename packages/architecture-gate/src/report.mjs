/**
 * @param {{root: string, violations: {id: string, file: string|null, message: string}[], summary: {ruleCount: number, errorCount: number}}} result
 * @returns {string}
 */
export function formatText(result) {
  const lines = [
    `架构与规范闸机 — ${result.root}`,
    `规则: ${result.summary.ruleCount}; 错误: ${result.summary.errorCount}`,
  ];
  for (const violation of result.violations) {
    const location = violation.file ? `${violation.file}: ` : '';
    lines.push(`  [${violation.id}] ${location}${violation.message}`);
  }
  if (result.summary.errorCount === 0) {
    lines.push('✅ 架构与规范闸机通过。');
  } else {
    lines.push('❌ 架构与规范闸机失败；规则说明见 docs/ci-gates.md。不要绕过闸机。');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * @param {any} result
 * @returns {string}
 */
export function formatJson(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}
