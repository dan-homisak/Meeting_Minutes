import {
  buildBlockAttrsFromSource,
  classifyBlockSource
} from './BlockSemantics.js';

function normalizeBlockRanges(blocks, maxLength) {
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

    normalized.push({
      from,
      to,
      id: typeof block.id === 'string' && block.id.length > 0 ? block.id : undefined
    });
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

function buildLineStartOffsets(text) {
  if (typeof text !== 'string' || text.length === 0) {
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

function resolveLineForOffset(lineOffsets, position) {
  if (!Array.isArray(lineOffsets) || lineOffsets.length === 0) {
    return 1;
  }

  const pos = Math.max(0, Math.trunc(position));
  let low = 0;
  let high = lineOffsets.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = lineOffsets[mid];
    if (value === pos) {
      return mid + 1;
    }
    if (value < pos) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return Math.max(1, low);
}

function readBlockSource(text, block) {
  if (typeof text !== 'string') {
    return '';
  }
  const from = Math.max(0, Math.trunc(block?.from ?? 0));
  const to = Math.max(from, Math.trunc(block?.to ?? from));
  return text.slice(from, to);
}

function normalizeStableKey(text) {
  if (typeof text !== 'string') {
    return '';
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 80).toLowerCase();
}

function enrichBlocks(blocks, text) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return [];
  }

  const lineOffsets = buildLineStartOffsets(text);
  const idOccurrences = new Map();

  return blocks.map((block, index) => {
    const source = readBlockSource(text, block);
    const type = classifyBlockSource(source, {
      isFirstBlock: index === 0
    });
    const attrs = buildBlockAttrsFromSource(type, source);
    const lineFrom = resolveLineForOffset(lineOffsets, block.from);
    const lineTo = resolveLineForOffset(lineOffsets, Math.max(block.from, block.to - 1));

    const keyBase = `${type}:${normalizeStableKey(source)}`;
    const seenCount = idOccurrences.get(keyBase) ?? 0;
    idOccurrences.set(keyBase, seenCount + 1);

    const stableId = `${keyBase}:${seenCount + 1}`;

    return {
      ...block,
      id: typeof block?.id === 'string' && block.id.length > 0 ? block.id : stableId,
      type,
      lineFrom,
      lineTo,
      attrs
    };
  });
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
  const normalizedRanges = normalizeBlockRanges(blocks, length);
  const normalizedBlocks = enrichBlocks(normalizedRanges, normalizedText);
  const normalizedInlineSpans = normalizeInlineSpans(inlineSpans, length);
  const frontmatter = normalizedBlocks.find((block) => block.type === 'frontmatter') ?? null;

  return {
    version: Number.isFinite(version) ? Math.max(0, Math.trunc(version)) : 0,
    text: normalizedText,
    length,
    blocks: normalizedBlocks,
    frontmatter,
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
