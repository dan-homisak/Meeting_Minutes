import {
  createEmptyLiveDocModel,
  createLiveDocModel
} from '../model/LiveDocModel.js';
import { diffLiveDocModels } from '../model/ModelDiff.js';

function normalizeText(value) {
  return typeof value === 'string' ? value : '';
}

function buildLineStartOffsets(source) {
  const text = normalizeText(source);
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

function offsetAtLine(lineOffsets, lineIndex) {
  if (!Array.isArray(lineOffsets) || lineOffsets.length === 0) {
    return 0;
  }

  const lineCount = Math.max(1, lineOffsets.length - 1);
  const normalizedLine = Math.max(0, Math.trunc(lineIndex));
  if (normalizedLine <= 0) {
    return 0;
  }
  if (normalizedLine >= lineCount) {
    return lineOffsets[lineOffsets.length - 1];
  }
  return lineOffsets[normalizedLine];
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

function extractFrontmatterRange(source) {
  const text = normalizeText(source);
  if (!text.startsWith('---\n')) {
    return null;
  }

  const closingFenceMatch = text.match(/\n---(?:\n|$)/);
  if (!closingFenceMatch || !Number.isFinite(closingFenceMatch.index)) {
    return null;
  }

  const closingStart = closingFenceMatch.index;
  const totalLength = closingStart + closingFenceMatch[0].length;

  return {
    from: 0,
    to: totalLength,
    body: text
      .slice(0, totalLength)
      .replace(/^---\n/, '')
      .replace(/\n---(?:\n|$)$/, '')
      .replace(/\n$/, ''),
    totalLength
  };
}

function trimTrailingBlockWhitespace(source, from, to, _hint) {
  const localSource = normalizeText(source);
  let end = Math.max(from, to);

  while (end > from && localSource[end - 1] === '\n') {
    end -= 1;
  }

  while (end > from && /[ \t]/.test(localSource[end - 1])) {
    end -= 1;
  }

  return Math.max(from, end);
}

function buildRangeFromMap(token, lineOffsets, source, absoluteOffset) {
  if (!token || !Array.isArray(token.map) || token.map.length < 2) {
    return null;
  }

  const rawStart = Number(token.map[0]);
  const rawEnd = Number(token.map[1]);
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) {
    return null;
  }

  const fromLocal = offsetAtLine(lineOffsets, rawStart);
  const toLocalRaw = offsetAtLine(lineOffsets, rawEnd);
  const toLocal = trimTrailingBlockWhitespace(source, fromLocal, toLocalRaw, token.type);

  if (toLocal <= fromLocal) {
    return null;
  }

  return {
    from: absoluteOffset + fromLocal,
    to: absoluteOffset + toLocal
  };
}

function classifyBlockSource(source, { isFirstBlock = false, hint = '' } = {}) {
  const text = normalizeText(source);
  const trimmed = text.trim();

  if (!trimmed) {
    return 'paragraph';
  }

  if (isFirstBlock && /^---\n[\s\S]*\n---(?:\n|$)/.test(text)) {
    return 'frontmatter';
  }

  if (hint === 'tr_open' || hint === 'table_open') {
    return 'table';
  }

  if (hint === 'fence' || hint === 'code_block') {
    return 'code';
  }

  if (hint === 'hr') {
    return 'hr';
  }

  if (hint === 'heading_open') {
    return 'heading';
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
  if (/^\s*(?:[-+*]|\d+\.)\s+\[(?: |x|X)\](?:\s+|$)/.test(trimmed)) {
    return 'task';
  }
  if (/^\s*(?:[-+*]|\d+\.)(?:\s+|$)/.test(trimmed) || hint === 'list_item_open') {
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

function buildBlockAttrs(type, source, hint = '') {
  const attrs = {};
  const text = normalizeText(source);
  const firstLine = text.split('\n')[0] ?? '';

  if (type === 'heading') {
    const headingMatch = firstLine.match(/^\s{0,3}(#{1,6})\s+/);
    if (headingMatch) {
      attrs.level = headingMatch[1].length;
    }
  }

  if (type === 'task') {
    attrs.checked = /\[(x|X)\]/.test(firstLine);
  }

  if (type === 'list' || type === 'task') {
    const indentationMatch = firstLine.match(/^(\s*)/);
    const indentation = indentationMatch?.[1]?.length ?? 0;
    attrs.depth = Math.max(0, Math.floor(indentation / 2));
    attrs.listMarker = /^\s*(\d+\.|[-+*])/.exec(firstLine)?.[1] ?? '-';
  }

  if (type === 'table') {
    attrs.row = hint === 'tr_open';
  }

  return attrs;
}

function normalizeCandidateRanges(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const filtered = candidates
    .filter((candidate) => (
      candidate &&
      Number.isFinite(candidate.from) &&
      Number.isFinite(candidate.to) &&
      candidate.to > candidate.from
    ))
    .map((candidate) => ({
      from: Math.max(0, Math.trunc(candidate.from)),
      to: Math.max(0, Math.trunc(candidate.to)),
      priority: Number.isFinite(candidate.priority) ? Math.trunc(candidate.priority) : 0,
      hint: typeof candidate.hint === 'string' ? candidate.hint : ''
    }));

  const dedupedMap = new Map();
  for (const candidate of filtered) {
    const key = `${candidate.from}:${candidate.to}:${candidate.hint}`;
    if (!dedupedMap.has(key) || dedupedMap.get(key).priority < candidate.priority) {
      dedupedMap.set(key, candidate);
    }
  }

  const deduped = [...dedupedMap.values()];
  deduped.sort((left, right) => (
    right.priority - left.priority ||
    (left.to - left.from) - (right.to - right.from) ||
    left.from - right.from ||
    left.to - right.to
  ));

  const selected = [];
  for (const candidate of deduped) {
    const overlaps = selected.some((picked) => (
      candidate.from < picked.to && candidate.to > picked.from
    ));
    if (!overlaps) {
      selected.push(candidate);
    }
  }

  return selected
    .sort((left, right) => left.from - right.from || left.to - right.to)
    .map((candidate) => ({
      from: candidate.from,
      to: candidate.to,
      hint: candidate.hint
    }));
}

function collectBlockCandidates(tokens, source, absoluteOffset) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return [];
  }

  const lineOffsets = buildLineStartOffsets(source);
  const candidates = [];

  for (const token of tokens) {
    if (!token || !Array.isArray(token.map)) {
      continue;
    }

    const mapped = buildRangeFromMap(token, lineOffsets, source, absoluteOffset);
    if (!mapped) {
      continue;
    }

    if (token.type === 'list_item_open') {
      candidates.push({ ...mapped, priority: 320, hint: token.type });
      continue;
    }

    if (token.type === 'tr_open') {
      candidates.push({ ...mapped, priority: 310, hint: token.type });
      continue;
    }

    if (!token.block || token.nesting === -1 || token.level !== 0) {
      continue;
    }

    if (
      token.type === 'bullet_list_open' ||
      token.type === 'ordered_list_open' ||
      token.type === 'table_open' ||
      token.type === 'thead_open' ||
      token.type === 'tbody_open'
    ) {
      continue;
    }

    candidates.push({ ...mapped, priority: 120, hint: token.type });
  }

  return normalizeCandidateRanges(candidates);
}

function overlapLength(left, right) {
  if (!left || !right) {
    return 0;
  }
  const from = Math.max(left.from, right.from);
  const to = Math.min(left.to, right.to);
  return Math.max(0, to - from);
}

function resolveStableBlockId(previousBlocks, nextBlock, usedIds) {
  if (!nextBlock || !Number.isFinite(nextBlock.from) || !Number.isFinite(nextBlock.to)) {
    return null;
  }

  const previous = Array.isArray(previousBlocks) ? previousBlocks : [];

  for (const block of previous) {
    if (!block || typeof block.id !== 'string' || usedIds.has(block.id)) {
      continue;
    }
    if (block.from === nextBlock.from && block.to === nextBlock.to && block.type === nextBlock.type) {
      return block.id;
    }
  }

  let bestMatch = null;
  for (const block of previous) {
    if (!block || typeof block.id !== 'string' || usedIds.has(block.id)) {
      continue;
    }
    if (block.type !== nextBlock.type) {
      continue;
    }

    const overlap = overlapLength(block, nextBlock);
    if (overlap <= 0) {
      continue;
    }

    const blockLength = Math.max(1, block.to - block.from);
    const nextLength = Math.max(1, nextBlock.to - nextBlock.from);
    const coverage = overlap / Math.max(blockLength, nextLength);
    const score = coverage;

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        id: block.id,
        score
      };
    }
  }

  if (!bestMatch) {
    return null;
  }

  return bestMatch.score >= 0.45 ? bestMatch.id : null;
}

function assignStableBlockIds(previousBlocks, nextBlocks) {
  const usedIds = new Set();
  const withIds = [];

  for (const block of Array.isArray(nextBlocks) ? nextBlocks : []) {
    if (!block) {
      continue;
    }

    if (typeof block.id === 'string' && block.id.length > 0 && !usedIds.has(block.id)) {
      usedIds.add(block.id);
      withIds.push(block);
      continue;
    }

    const resolvedId = resolveStableBlockId(previousBlocks, block, usedIds);
    if (resolvedId) {
      usedIds.add(resolvedId);
      withIds.push({
        ...block,
        id: resolvedId
      });
      continue;
    }

    const fallbackId = `${block.type}:${block.from}:${block.to}`;
    usedIds.add(fallbackId);
    withIds.push({
      ...block,
      id: fallbackId
    });
  }

  return withIds;
}

const INLINE_PATTERNS = [
  { type: 'link', regex: /\[[^\]\n]+\]\([^\)\n]+\)/g },
  { type: 'wikilink', regex: /\[\[[^[\]\n|]+(?:\|[^[\]\n]+)?\]\]/g },
  { type: 'strong', regex: /\*\*[^*\n]+\*\*|__[^_\n]+__/g },
  { type: 'emphasis', regex: /(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_)/g },
  { type: 'strike', regex: /~~[^~\n]+~~/g },
  { type: 'highlight', regex: /==[^=\n]+==/g },
  { type: 'code', regex: /`[^`\n]+`/g }
];

const INLINE_TYPE_PRIORITY = Object.freeze({
  code: 400,
  link: 320,
  wikilink: 320,
  strong: 240,
  strike: 220,
  highlight: 210,
  emphasis: 180
});

function inlinePriority(type) {
  return INLINE_TYPE_PRIORITY[type] ?? 100;
}

function spansOverlap(left, right) {
  if (!left || !right || !Number.isFinite(left.from) || !Number.isFinite(left.to) || !Number.isFinite(right.from) || !Number.isFinite(right.to)) {
    return false;
  }
  return left.from < right.to && right.from < left.to;
}

function selectNonOverlappingInlineSpans(spans) {
  const candidates = (Array.isArray(spans) ? spans : [])
    .filter((span) => (
      span &&
      Number.isFinite(span.from) &&
      Number.isFinite(span.to) &&
      span.to > span.from
    ))
    .sort((left, right) => (
      inlinePriority(right.type) - inlinePriority(left.type) ||
      (right.to - right.from) - (left.to - left.from) ||
      left.from - right.from ||
      left.to - right.to
    ));

  const selected = [];
  for (const candidate of candidates) {
    if (selected.some((existing) => spansOverlap(existing, candidate))) {
      continue;
    }
    selected.push(candidate);
  }

  return selected.sort((left, right) => left.from - right.from || left.to - right.to);
}

function collectInlineSpans(text, blocks) {
  const spans = [];

  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
      continue;
    }

    const source = text.slice(block.from, block.to);
    for (const pattern of INLINE_PATTERNS) {
      for (const match of source.matchAll(pattern.regex)) {
        if (!Number.isFinite(match.index)) {
          continue;
        }

        const from = block.from + match.index;
        const to = from + match[0].length;
        if (to <= from) {
          continue;
        }

        spans.push({
          from,
          to,
          type: pattern.type
        });
      }
    }
  }

  return selectNonOverlappingInlineSpans(spans);
}

function splitRangeByNonEmptyLines(source, from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return [];
  }

  const text = normalizeText(source);
  const segments = [];
  let cursor = Math.max(0, Math.trunc(from));
  const end = Math.max(cursor, Math.trunc(to));

  while (cursor < end) {
    const nextBreak = text.indexOf('\n', cursor);
    const rawLineEnd = nextBreak >= 0 && nextBreak < end ? nextBreak : end;
    let lineStart = cursor;
    let lineEnd = rawLineEnd;

    while (lineStart < lineEnd && /[ \t]/.test(text[lineStart])) {
      lineStart += 1;
    }
    while (lineEnd > lineStart && /[ \t\r]/.test(text[lineEnd - 1])) {
      lineEnd -= 1;
    }

    if (lineEnd > lineStart) {
      segments.push({
        from: cursor,
        to: rawLineEnd
      });
    }

    if (rawLineEnd >= end) {
      break;
    }
    cursor = rawLineEnd + 1;
  }

  return segments;
}

function expandCandidateRangesForEditing(source, candidateRanges) {
  const expanded = [];

  for (const candidate of Array.isArray(candidateRanges) ? candidateRanges : []) {
    if (!candidate) {
      continue;
    }

    const blockSource = source.slice(candidate.from, candidate.to);
    const preliminaryType = classifyBlockSource(blockSource, {
      isFirstBlock: candidate.from === 0,
      hint: candidate.hint
    });

    const shouldSplitByLine = (
      preliminaryType === 'paragraph' ||
      preliminaryType === 'blockquote' ||
      preliminaryType === 'list' ||
      preliminaryType === 'task'
    );
    if (!shouldSplitByLine) {
      expanded.push(candidate);
      continue;
    }

    const lineSegments = splitRangeByNonEmptyLines(source, candidate.from, candidate.to);
    if (lineSegments.length === 0) {
      expanded.push(candidate);
      continue;
    }

    for (const lineSegment of lineSegments) {
      expanded.push({
        ...candidate,
        from: lineSegment.from,
        to: lineSegment.to
      });
    }
  }

  return expanded;
}

function lineOverlapsExistingBlock(blocks, from, to) {
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
      continue;
    }
    if (to > block.from && from < block.to) {
      return true;
    }
  }
  return false;
}

function collectUncoveredListTaskBlocks(source, lineOffsets, existingBlocks, minimumFrom = 0) {
  const additions = [];
  const text = normalizeText(source);
  const minOffset = Math.max(0, Math.trunc(minimumFrom));
  const lineCount = Math.max(1, lineOffsets.length - 1);

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const lineFrom = offsetAtLine(lineOffsets, lineIndex);
    if (lineFrom < minOffset) {
      continue;
    }

    const rawLineEnd = offsetAtLine(lineOffsets, lineIndex + 1);
    const lineToWithoutNewline = rawLineEnd > lineFrom && text[rawLineEnd - 1] === '\n'
      ? rawLineEnd - 1
      : rawLineEnd;
    if (lineToWithoutNewline <= lineFrom) {
      continue;
    }

    const rawLine = text.slice(lineFrom, lineToWithoutNewline);
    const trimmedRight = rawLine.replace(/[ \t\r]+$/g, '');
    const lineTo = lineFrom + trimmedRight.length;
    if (lineTo <= lineFrom) {
      continue;
    }

    const looksLikeTask = /^\s*(?:[-+*]|\d+\.)\s+\[(?: |x|X)\](?:\s+|$)/.test(trimmedRight);
    const looksLikeList = /^\s*(?:[-+*]|\d+\.)(?:\s+|$)/.test(trimmedRight);
    if (!looksLikeTask && !looksLikeList) {
      continue;
    }

    if (lineOverlapsExistingBlock([...existingBlocks, ...additions], lineFrom, lineTo)) {
      continue;
    }

    const blockSource = text.slice(lineFrom, lineTo);
    const blockType = classifyBlockSource(blockSource, {
      isFirstBlock: lineFrom === 0,
      hint: 'list_item_open'
    });
    const attrs = buildBlockAttrs(blockType, blockSource, 'list_item_open');

    additions.push({
      id: null,
      type: blockType,
      from: lineFrom,
      to: lineTo,
      lineFrom: resolveLineForOffset(lineOffsets, lineFrom),
      lineTo: resolveLineForOffset(lineOffsets, Math.max(lineFrom, lineTo - 1)),
      depth: Number.isFinite(attrs.depth) ? attrs.depth : null,
      attrs
    });
  }

  return additions;
}

function parseBlocksFromText(markdownEngine, text, previousBlocks = []) {
  const source = normalizeText(text);
  const lineOffsets = buildLineStartOffsets(source);
  const blocks = [];

  const frontmatterRange = extractFrontmatterRange(source);
  if (frontmatterRange) {
    blocks.push({
      id: null,
      type: 'frontmatter',
      from: frontmatterRange.from,
      to: frontmatterRange.to,
      lineFrom: 1,
      lineTo: resolveLineForOffset(lineOffsets, Math.max(0, frontmatterRange.to - 1)),
      depth: null,
      attrs: { fenced: true }
    });
  }

  const parseOffset = frontmatterRange ? frontmatterRange.to : 0;
  const parseSource = source.slice(parseOffset);

  let tokens = [];
  if (markdownEngine && typeof markdownEngine.parse === 'function') {
    try {
      tokens = markdownEngine.parse(parseSource, {});
    } catch {
      tokens = [];
    }
  }

  const candidateRanges = collectBlockCandidates(tokens, parseSource, parseOffset);
  const expandedCandidates = expandCandidateRangesForEditing(source, candidateRanges);

  if (expandedCandidates.length === 0 && source.trim().length > 0) {
    const from = parseOffset;
    const to = source.length;
    blocks.push({
      id: null,
      type: classifyBlockSource(source.slice(from, to), { isFirstBlock: blocks.length === 0 }),
      from,
      to,
      lineFrom: resolveLineForOffset(lineOffsets, from),
      lineTo: resolveLineForOffset(lineOffsets, Math.max(from, to - 1)),
      depth: null,
      attrs: {}
    });
  } else {
    for (const candidate of expandedCandidates) {
      const blockSource = source.slice(candidate.from, candidate.to);
      const blockType = classifyBlockSource(blockSource, {
        isFirstBlock: candidate.from === 0,
        hint: candidate.hint
      });
      const attrs = buildBlockAttrs(blockType, blockSource, candidate.hint);

      blocks.push({
        id: null,
        type: blockType,
        from: candidate.from,
        to: candidate.to,
        lineFrom: resolveLineForOffset(lineOffsets, candidate.from),
        lineTo: resolveLineForOffset(lineOffsets, Math.max(candidate.from, candidate.to - 1)),
        depth: Number.isFinite(attrs.depth) ? attrs.depth : null,
        attrs
      });
    }
  }

  const uncoveredListTaskBlocks = collectUncoveredListTaskBlocks(
    source,
    lineOffsets,
    blocks,
    parseOffset
  );
  blocks.push(...uncoveredListTaskBlocks);

  const sortedBlocks = blocks
    .filter((block) => Number.isFinite(block.from) && Number.isFinite(block.to) && block.to > block.from)
    .sort((left, right) => left.from - right.from || left.to - right.to);

  return assignStableBlockIds(previousBlocks, sortedBlocks);
}

function classifyTransaction(transaction) {
  if (!transaction) {
    return {
      docChanged: false,
      selectionSet: false
    };
  }

  return {
    docChanged: Boolean(transaction.docChanged),
    selectionSet: Boolean(transaction.selection)
  };
}

function isFullDocumentReplacement(transaction) {
  if (!transaction?.docChanged || !transaction?.changes || !transaction?.startState?.doc) {
    return false;
  }

  const previousLength = transaction.startState.doc.length;
  let changeCount = 0;
  let fullReplace = false;

  transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    changeCount += 1;
    if (
      fromA === 0 &&
      toA === previousLength &&
      fromB === 0 &&
      toB === transaction.state.doc.length
    ) {
      fullReplace = true;
    }
  });

  return fullReplace && changeCount === 1;
}

export function createObsidianCoreParser({ markdownEngine } = {}) {
  let liveModel = createEmptyLiveDocModel();

  function commit(nextText, parserMeta = {}) {
    const previousBlocks = parserMeta.reuseBlockIds === false ? [] : liveModel.blocks;
    const nextBlocks = parseBlocksFromText(markdownEngine, nextText, previousBlocks);
    const nextInlines = collectInlineSpans(nextText, nextBlocks);

    const nextModel = createLiveDocModel({
      version: liveModel.version + 1,
      text: nextText,
      blocks: nextBlocks,
      inlines: nextInlines,
      meta: {
        parser: parserMeta.parser ?? 'full',
        reparsedFrom: Number.isFinite(parserMeta.reparsedFrom)
          ? Math.trunc(parserMeta.reparsedFrom)
          : null,
        reparsedTo: Number.isFinite(parserMeta.reparsedTo)
          ? Math.trunc(parserMeta.reparsedTo)
          : null
      }
    });

    const diff = diffLiveDocModels(liveModel, nextModel);
    liveModel = nextModel;

    return {
      model: nextModel,
      diff
    };
  }

  function ensureText(text) {
    const source = normalizeText(text);
    if (source === liveModel.text) {
      return {
        model: liveModel,
        diff: null
      };
    }

    return commit(source, {
      parser: 'full',
      reparsedFrom: 0,
      reparsedTo: source.length
    });
  }

  function setText(text, reason = 'set-text') {
    const source = normalizeText(text);
    return {
      ...commit(source, {
        parser: 'full',
        reparsedFrom: 0,
        reparsedTo: source.length,
        reuseBlockIds: false
      }),
      reason
    };
  }

  function applyEditorTransaction(transaction) {
    const classification = classifyTransaction(transaction);

    if (!classification.docChanged) {
      return {
        model: liveModel,
        diff: null,
        classification
      };
    }

    const nextText = normalizeText(transaction?.state?.doc?.toString?.());
    const fullDocumentReplacement = isFullDocumentReplacement(transaction);
    const committed = commit(nextText, {
      parser: 'incremental',
      reparsedFrom: 0,
      reparsedTo: nextText.length,
      reuseBlockIds: !fullDocumentReplacement
    });

    return {
      ...committed,
      classification
    };
  }

  function getModel() {
    return liveModel;
  }

  return {
    ensureText,
    setText,
    applyEditorTransaction,
    getModel
  };
}
