import { extractFrontmatterRange } from '../model/BlockSemantics.js';

function buildLineStartOffsets(source) {
  const text = typeof source === 'string' ? source : '';
  if (text.length === 0) {
    return [0];
  }

  const offsets = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      offsets.push(index + 1);
    }
  }

  if (offsets[offsets.length - 1] !== text.length) {
    offsets.push(text.length);
  }

  return offsets;
}

function lineIndexToOffset(lineOffsets, lineIndex) {
  if (!Array.isArray(lineOffsets) || lineOffsets.length === 0) {
    return 0;
  }

  const lineCount = Math.max(1, lineOffsets.length - 1);
  const normalizedIndex = Math.max(0, Math.trunc(lineIndex));
  if (normalizedIndex <= 0) {
    return 0;
  }

  if (normalizedIndex >= lineCount) {
    return lineOffsets[lineOffsets.length - 1];
  }

  return lineOffsets[normalizedIndex];
}

function normalizeRange(range, maxLength = Number.POSITIVE_INFINITY) {
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) {
    return null;
  }

  const clampedMax = Number.isFinite(maxLength) ? Math.max(0, Math.trunc(maxLength)) : Number.POSITIVE_INFINITY;
  const from = Math.max(0, Math.trunc(range.from));
  const to = Math.min(clampedMax, Math.max(from, Math.trunc(range.to)));
  if (to <= from) {
    return null;
  }

  return { from, to };
}

export function normalizeBlockRanges(ranges, maxLength = Number.POSITIVE_INFINITY) {
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return [];
  }

  const normalized = [];
  for (const range of ranges) {
    const next = normalizeRange(range, maxLength);
    if (!next) {
      continue;
    }
    normalized.push(next);
  }

  normalized.sort((left, right) => left.from - right.from || left.to - right.to);

  const merged = [];
  for (const range of normalized) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push({ ...range });
      continue;
    }

    if (range.from < previous.to) {
      previous.to = Math.max(previous.to, range.to);
      continue;
    }

    merged.push({ ...range });
  }

  return merged;
}

function buildFallbackBlockRanges(source, offset = 0) {
  const text = typeof source === 'string' ? source : '';
  if (!text.trim()) {
    return [];
  }

  const ranges = [];
  const pattern = /(?:^|\n)([^\n].*?)(?=\n\s*\n|\n?$)/gs;
  for (const match of text.matchAll(pattern)) {
    const blockText = match[1] ?? '';
    const full = match[0] ?? '';
    if (!blockText.trim()) {
      continue;
    }

    const fullIndex = Number(match.index);
    if (!Number.isFinite(fullIndex)) {
      continue;
    }

    const leadingBreak = full.startsWith('\n') ? 1 : 0;
    const from = offset + fullIndex + leadingBreak;
    const to = from + blockText.length;
    if (to <= from) {
      continue;
    }

    ranges.push({ from, to });
  }

  return normalizeBlockRanges(ranges, offset + text.length);
}

function collectTokenBlockRanges(tokens, source, offset = 0) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return [];
  }

  const lineOffsets = buildLineStartOffsets(source);
  const lineCount = Math.max(1, lineOffsets.length - 1);
  const seen = new Set();
  const ranges = [];

  for (const token of tokens) {
    if (!token?.block || token.nesting === -1 || token.level !== 0 || !Array.isArray(token.map)) {
      continue;
    }

    const startLine = Number(token.map[0]);
    const endLine = Number(token.map[1]);
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || endLine <= startLine) {
      continue;
    }

    const clampedStartLine = Math.min(lineCount, Math.max(0, Math.trunc(startLine)));
    const clampedEndLine = Math.min(lineCount, Math.max(clampedStartLine + 1, Math.trunc(endLine)));
    const fromLocal = lineIndexToOffset(lineOffsets, clampedStartLine);
    const toLocal = lineIndexToOffset(lineOffsets, clampedEndLine);
    if (toLocal <= fromLocal) {
      continue;
    }

    const blockSource = source.slice(fromLocal, toLocal);
    if (!blockSource.trim()) {
      continue;
    }

    const from = offset + fromLocal;
    const to = offset + toLocal;
    const key = `${from}:${to}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    ranges.push({ from, to });
  }

  return normalizeBlockRanges(ranges, offset + source.length);
}

export function buildBlockRangesFromMarkdown({
  markdownEngine,
  source,
  offset = 0
} = {}) {
  const text = typeof source === 'string' ? source : '';
  const absoluteOffset = Math.max(0, Math.trunc(offset));
  if (!text.trim()) {
    return [];
  }

  const frontmatterRange = extractFrontmatterRange(text, absoluteOffset);
  const sourceWithoutFrontmatter = frontmatterRange
    ? text.slice(frontmatterRange.sourceTo)
    : text;
  const sourceOffset = frontmatterRange ? frontmatterRange.to : absoluteOffset;

  if (!markdownEngine || typeof markdownEngine.parse !== 'function') {
    const fallbackRanges = buildFallbackBlockRanges(sourceWithoutFrontmatter, sourceOffset);
    if (!frontmatterRange) {
      return fallbackRanges;
    }
    return normalizeBlockRanges(
      [{ from: frontmatterRange.from, to: frontmatterRange.to }, ...fallbackRanges],
      absoluteOffset + text.length
    );
  }

  const tokens = markdownEngine.parse(sourceWithoutFrontmatter, {});
  const ranges = collectTokenBlockRanges(tokens, sourceWithoutFrontmatter, sourceOffset);
  if (ranges.length > 0) {
    if (!frontmatterRange) {
      return ranges;
    }
    return normalizeBlockRanges(
      [{ from: frontmatterRange.from, to: frontmatterRange.to }, ...ranges],
      absoluteOffset + text.length
    );
  }

  const fallbackRanges = buildFallbackBlockRanges(sourceWithoutFrontmatter, sourceOffset);
  if (!frontmatterRange) {
    return fallbackRanges;
  }
  return normalizeBlockRanges(
    [{ from: frontmatterRange.from, to: frontmatterRange.to }, ...fallbackRanges],
    absoluteOffset + text.length
  );
}
