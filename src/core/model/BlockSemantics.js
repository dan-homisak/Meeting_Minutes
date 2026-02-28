function normalizeSource(source) {
  return typeof source === 'string' ? source : '';
}

function readTrimmedSource(source) {
  return normalizeSource(source).trim();
}

export function extractLeadingFrontmatter(source) {
  const text = normalizeSource(source);
  if (!text.startsWith('---\n')) {
    return null;
  }

  const closingFenceMatch = text.match(/\n---(?:\n|$)/);
  if (!closingFenceMatch || !Number.isFinite(closingFenceMatch.index)) {
    return null;
  }

  const closingStart = closingFenceMatch.index;
  const totalLength = closingStart + closingFenceMatch[0].length;
  const raw = text.slice(0, totalLength);
  const body = raw
    .replace(/^---\n/, '')
    .replace(/\n---(?:\n|$)$/, '')
    .replace(/\n$/, '');

  return {
    raw,
    body,
    totalLength
  };
}

export function extractFrontmatterRange(source, offset = 0) {
  const absoluteOffset = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0;
  const frontmatter = extractLeadingFrontmatter(source);
  if (!frontmatter) {
    return null;
  }

  const from = absoluteOffset;
  const to = absoluteOffset + frontmatter.totalLength;
  if (to <= from) {
    return null;
  }

  return {
    from,
    to,
    sourceFrom: 0,
    sourceTo: frontmatter.totalLength,
    raw: frontmatter.raw,
    body: frontmatter.body,
    totalLength: frontmatter.totalLength
  };
}

export function looksLikeFrontmatterBlock(source, isFirstBlock = false) {
  if (!isFirstBlock) {
    return false;
  }
  return Boolean(extractLeadingFrontmatter(source));
}

export function classifyBlockSource(source, { isFirstBlock = false } = {}) {
  const text = normalizeSource(source);
  const trimmed = readTrimmedSource(text);

  if (!trimmed) {
    return 'paragraph';
  }
  if (looksLikeFrontmatterBlock(text, isFirstBlock)) {
    return 'frontmatter';
  }
  if (/^!\[\[[^[\]\n]+(?:\|[^[\]\n]+)?\]\]$/.test(trimmed)) {
    return 'embed';
  }
  if (/^\[\[[^[\]\n]+(?:\|[^[\]\n]+)?\]\]$/.test(trimmed)) {
    return 'wikilink';
  }
  if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(trimmed)) {
    return 'hr';
  }
  if (/^\s{0,3}#{1,6}\s+/.test(trimmed)) {
    return 'heading';
  }
  if (/^\s*>\s?/.test(trimmed)) {
    return 'blockquote';
  }
  if (/^\s*([`~]{3,})/.test(trimmed) && /([`~]{3,})\s*$/.test(trimmed)) {
    return 'code';
  }
  if (/^\s*(?:[-+*]|\d+\.)\s+\[(?: |x|X)\]\s+/.test(trimmed)) {
    return 'task';
  }
  if (/^\s*(?:[-+*]|\d+\.)\s+/.test(trimmed)) {
    return 'list';
  }

  const lines = text.split('\n');
  if (
    lines.length >= 2 &&
    lines[0].includes('|') &&
    /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[1].trim())
  ) {
    return 'table';
  }

  return 'paragraph';
}

export function buildBlockAttrsFromSource(type, source) {
  const attrs = {};
  const text = normalizeSource(source);
  const firstLine = text.split('\n')[0] ?? '';

  if (type === 'heading') {
    const match = firstLine.match(/^\s{0,3}(#{1,6})\s+/);
    if (match) {
      attrs.level = match[1].length;
    }
  }

  if (type === 'task') {
    attrs.checked = /\[(x|X)\]/.test(firstLine);
  }

  if (type === 'frontmatter') {
    attrs.fenced = true;
  }

  return attrs;
}
