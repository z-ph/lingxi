import { readdir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { isFile, pathExists, readText, walkFiles } from '../fs.mjs';
import { extractLinks, headingAnchors } from '../markdown.mjs';

async function listMarkdownFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter(
        (entry) => entry.isFile() && extname(entry.name) === '.md' && !entry.name.startsWith('.'),
      )
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function violation(file, message) {
  return { file, message };
}

function isExternalTarget(target) {
  return (
    target.startsWith('http://') ||
    target.startsWith('https://') ||
    target.startsWith('//') ||
    target.startsWith('mailto:') ||
    target.startsWith('tel:') ||
    target.startsWith('data:') ||
    target.startsWith('ftp://')
  );
}

export async function checkDocsMirror(ctx) {
  const docsDir = join(ctx.root, 'docs');
  if (!(await pathExists(docsDir))) {
    return [violation('docs', '缺少 docs/ 目录')];
  }

  const zhDocs = await listMarkdownFiles(join(docsDir));
  const enDocs = await listMarkdownFiles(join(docsDir, 'en'));
  const violations = [];

  for (const name of zhDocs) {
    if (!enDocs.includes(name)) {
      violations.push(violation(`docs/${name}`, `缺少英文镜像 docs/en/${name}`));
    }
  }
  for (const name of enDocs) {
    if (!zhDocs.includes(name)) {
      violations.push(violation(`docs/en/${name}`, `英文镜像是孤儿：缺少 docs/${name}`));
    }
  }

  for (const name of zhDocs) {
    const content = await readText(join(docsDir, name));
    const head = content.split(/\r?\n/).slice(0, 40).join('\n');
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const linkPattern = new RegExp(`\\[[^\\]]+\\]\\(\\s*en/${escaped}(?:#[^)]*)?\\s*\\)`);
    if (!linkPattern.test(head)) {
      violations.push(violation(`docs/${name}`, `开头 40 行内缺少指向 en/${name} 的语言链接`));
    }
  }

  return violations;
}

async function targetExists(absolutePath) {
  if (await pathExists(absolutePath)) return true;
  return false;
}

export async function checkLinks(ctx) {
  const files = await walkFiles(ctx.root, {
    extensions: ['.md'],
    skip: (relPath) =>
      relPath.startsWith('packages/architecture-gate/test/fixtures/') ||
      relPath.startsWith('node_modules/'),
  });
  const violations = [];
  const seen = new Set();

  for (const relativeFile of files) {
    const absoluteFile = join(ctx.root, relativeFile);
    const content = (await readText(absoluteFile)).replace(/<!--[\s\S]*?-->/g, '');
    for (const link of extractLinks(content)) {
      const target = link.target.trim();
      if (!target || isExternalTarget(target)) continue;
      const hashIndex = target.indexOf('#');
      let pathPart = hashIndex === -1 ? target : target.slice(0, hashIndex);
      const fragment = hashIndex === -1 ? '' : target.slice(hashIndex + 1);
      pathPart = pathPart.split('?')[0];
      try {
        pathPart = decodeURIComponent(pathPart);
      } catch {
        // Keep the raw path; the missing-file error is still useful.
      }

      let absoluteTarget;
      if (pathPart === '') {
        absoluteTarget = absoluteFile;
      } else if (pathPart.startsWith('/')) {
        absoluteTarget = resolve(ctx.root, `.${pathPart}`);
      } else {
        absoluteTarget = resolve(dirname(absoluteFile), pathPart);
      }

      const key = `${relativeFile}\u0000${target}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (!(await targetExists(absoluteTarget))) {
        violations.push(violation(`${relativeFile}:${link.line}`, `本地链接目标不存在: ${target}`));
        continue;
      }

      if (!fragment || extname(absoluteTarget) !== '.md') continue;
      if (!(await isFile(absoluteTarget))) continue;
      const targetContent = await readText(absoluteTarget);
      const anchors = headingAnchors(targetContent);
      let decodedFragment = fragment;
      try {
        decodedFragment = decodeURIComponent(fragment);
      } catch {
        // Keep the raw fragment.
      }
      if (!anchors.has(decodedFragment)) {
        violations.push(
          violation(
            `${relativeFile}:${link.line}`,
            `锚点不存在: ${target}（可用锚点: ${[...anchors].join(', ') || '无'}）`,
          ),
        );
      }
    }
  }

  return violations;
}

function collectDocLinks(content, prefix) {
  const links = new Set();
  for (const link of extractLinks(content)) {
    if (isExternalTarget(link.target)) continue;
    const pathPart = link.target.split('#')[0].split('?')[0].replace(/^\.\//, '');
    if (pathPart.startsWith(prefix) && pathPart.endsWith('.md')) {
      links.add(pathPart);
    }
  }
  return links;
}

export async function checkDocsIndex(ctx) {
  const violations = [];
  const zhDocs = await listMarkdownFiles(join(ctx.root, 'docs'));
  const enDocs = await listMarkdownFiles(join(ctx.root, 'docs/en'));

  for (const [readme, prefix, docs] of [
    ['README.md', 'docs/', zhDocs],
    ['README.en.md', 'docs/en/', enDocs],
  ]) {
    const readmePath = join(ctx.root, readme);
    if (!(await pathExists(readmePath))) {
      violations.push(violation(readme, '缺少 README 文件'));
      continue;
    }
    const linked = collectDocLinks(await readText(readmePath), prefix);
    for (const name of docs) {
      const expected = `${prefix}${name}`;
      if (!linked.has(expected)) {
        violations.push(violation(readme, `文档未出现在索引中: ${expected}`));
      }
    }
  }

  return violations;
}
