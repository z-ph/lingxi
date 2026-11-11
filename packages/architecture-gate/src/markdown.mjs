const LINK_RE = /!?\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;

/**
 * Remove fenced code blocks so links that appear in examples are not validated.
 *
 * @param {string} content
 * @returns {string}
 */
export function stripFencedCode(content) {
  const lines = content.split(/\r?\n/);
  const output = [];
  let fence = null;
  for (const line of lines) {
    const match = line.match(FENCE_RE);
    if (!fence && match) {
      fence = match[1][0];
      output.push('');
      continue;
    }
    if (fence && match && match[1][0] === fence) {
      fence = null;
      output.push('');
      continue;
    }
    output.push(fence ? '' : line);
  }
  return output.join('\n');
}

/**
 * Extract inline Markdown links/images outside code fences.
 *
 * @param {string} content
 * @returns {{target: string, line: number}[]}
 */
export function extractLinks(content) {
  const stripped = stripFencedCode(content);
  const links = [];
  const lines = stripped.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    LINK_RE.lastIndex = 0;
    let match;
    while ((match = LINK_RE.exec(line)) !== null) {
      let target = match[2];
      if (target.startsWith('<') && target.endsWith('>')) {
        target = target.slice(1, -1);
      }
      links.push({ target, line: index + 1 });
    }
  }
  return links;
}

function headingText(raw) {
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*~]/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * GitHub-style heading slug, good enough for this repository's anchors.
 *
 * @param {string} text
 * @returns {string}
 */
export function slugifyHeading(text) {
  return headingText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Collect the anchors a Markdown file exposes, including GitHub's duplicate suffixes.
 *
 * @param {string} content
 * @returns {Set<string>}
 */
export function headingAnchors(content) {
  const anchors = new Set();
  const counts = new Map();
  const lines = stripFencedCode(content).split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(HEADING_RE);
    if (!match) continue;
    const base = slugifyHeading(match[2]);
    if (!base) continue;
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}
