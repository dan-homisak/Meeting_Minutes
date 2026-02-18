import { createBlockGraphFromRanges } from './BlockNode.js';

function normalizeBlocks(blocks, maxLength) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return [];
  }

  const clampedMax = Number.isFinite(maxLength) ? Math.max(0, Math.trunc(maxLength)) : 0;
  const normalized = [];

  for (const block of blocks) {
    if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
      continue;
    }

    const from = Math.max(0, Math.trunc(block.from));
    const to = Math.min(clampedMax, Math.max(from, Math.trunc(block.to)));
    if (to <= from) {
      continue;
    }

    normalized.push({ from, to });
  }

  normalized.sort((left, right) => left.from - right.from || left.to - right.to);
  return normalized;
}

function normalizeInlineSpans(inlineSpans, maxLength) {
  if (!Array.isArray(inlineSpans) || inlineSpans.length === 0) {
    return [];
  }

  const clampedMax = Number.isFinite(maxLength) ? Math.max(0, Math.trunc(maxLength)) : 0;
  const normalized = [];

  for (const span of inlineSpans) {
    if (!span || !Number.isFinite(span.from) || !Number.isFinite(span.to)) {
      continue;
    }

    const from = Math.max(0, Math.trunc(span.from));
    const to = Math.min(clampedMax, Math.max(from, Math.trunc(span.to)));
    if (to <= from) {
      continue;
    }

    normalized.push({
      from,
      to,
      type: typeof span.type === 'string' && span.type ? span.type : 'unknown'
    });
  }

  normalized.sort((left, right) => left.from - right.from || left.to - right.to);
  return normalized;
}

export function createDocModel({
  version = 0,
  text = '',
  blocks = [],
  inlineSpans = [],
  meta = null
} = {}) {
  const normalizedText = typeof text === 'string' ? text : '';
  const length = normalizedText.length;
  const normalizedBlocks = normalizeBlocks(blocks, length);
  const normalizedInlineSpans = normalizeInlineSpans(inlineSpans, length);
  const blockGraph = createBlockGraphFromRanges(normalizedBlocks, length);

  return {
    version: Number.isFinite(version) ? Math.max(0, Math.trunc(version)) : 0,
    text: normalizedText,
    length,
    blocks: normalizedBlocks,
    blockGraph,
    inlineSpans: normalizedInlineSpans,
    meta: meta && typeof meta === 'object' ? { ...meta } : {}
  };
}

export function createEmptyDocModel() {
  return createDocModel({
    version: 0,
    text: '',
    blocks: [],
    inlineSpans: [],
    meta: {
      parser: 'none',
      reason: 'empty'
    }
  });
}
