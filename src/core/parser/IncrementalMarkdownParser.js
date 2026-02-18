import { buildBlockRangesFromMarkdown, normalizeBlockRanges } from './BlockGraphBuilder.js';
import { buildInlineSpansForBlocks } from './InlineSpanBuilder.js';

function normalizeChangeRanges(changeRanges) {
  if (!Array.isArray(changeRanges) || changeRanges.length === 0) {
    return [];
  }

  const normalized = [];
  for (const range of changeRanges) {
    if (
      !range ||
      !Number.isFinite(range.oldFrom) ||
      !Number.isFinite(range.oldTo) ||
      !Number.isFinite(range.newFrom) ||
      !Number.isFinite(range.newTo)
    ) {
      continue;
    }

    const oldFrom = Math.max(0, Math.trunc(range.oldFrom));
    const oldTo = Math.max(oldFrom, Math.trunc(range.oldTo));
    const newFrom = Math.max(0, Math.trunc(range.newFrom));
    const newTo = Math.max(newFrom, Math.trunc(range.newTo));

    normalized.push({
      oldFrom,
      oldTo,
      newFrom,
      newTo
    });
  }

  normalized.sort((left, right) => left.oldFrom - right.oldFrom || left.oldTo - right.oldTo);
  return normalized;
}

function summarizeOldChangeBounds(changeRanges) {
  if (!Array.isArray(changeRanges) || changeRanges.length === 0) {
    return null;
  }

  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const range of changeRanges) {
    from = Math.min(from, range.oldFrom);
    to = Math.max(to, range.oldTo);
  }

  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }

  return {
    from,
    to: Math.max(from, to)
  };
}

function findImpactedWindow(previousBlocks, oldFrom, oldTo) {
  if (!Array.isArray(previousBlocks) || previousBlocks.length === 0) {
    return {
      oldFrom,
      oldTo: Math.max(oldFrom, oldTo)
    };
  }

  let firstOverlappingIndex = -1;
  let lastOverlappingIndex = -1;
  for (let index = 0; index < previousBlocks.length; index += 1) {
    const block = previousBlocks[index];
    if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
      continue;
    }

    if (block.to > oldFrom && block.from < oldTo) {
      if (firstOverlappingIndex < 0) {
        firstOverlappingIndex = index;
      }
      lastOverlappingIndex = index;
    }
  }

  if (firstOverlappingIndex < 0) {
    let insertionIndex = previousBlocks.length;
    for (let index = 0; index < previousBlocks.length; index += 1) {
      const block = previousBlocks[index];
      if (block.from >= oldFrom) {
        insertionIndex = index;
        break;
      }
    }

    firstOverlappingIndex = Math.max(0, insertionIndex - 1);
    lastOverlappingIndex = Math.min(previousBlocks.length - 1, insertionIndex);
  }

  const startIndex = Math.max(0, firstOverlappingIndex - 1);
  const endIndex = Math.min(previousBlocks.length - 1, lastOverlappingIndex + 1);
  const rangeFrom = previousBlocks[startIndex]?.from ?? oldFrom;
  const rangeTo = previousBlocks[endIndex]?.to ?? oldTo;

  return {
    oldFrom: Math.max(0, Math.min(rangeFrom, rangeTo)),
    oldTo: Math.max(rangeFrom, rangeTo)
  };
}

function clampPosition(position, maxLength) {
  if (!Number.isFinite(position)) {
    return 0;
  }

  const max = Math.max(0, Math.trunc(maxLength));
  return Math.max(0, Math.min(max, Math.trunc(position)));
}

function mapPosition(mapPositionFn, position, assoc, fallback, maxLength) {
  if (typeof mapPositionFn !== 'function') {
    return clampPosition(fallback, maxLength);
  }

  try {
    const mapped = mapPositionFn(position, assoc);
    if (!Number.isFinite(mapped)) {
      return clampPosition(fallback, maxLength);
    }
    return clampPosition(mapped, maxLength);
  } catch {
    return clampPosition(fallback, maxLength);
  }
}

function mapRange(range, mapPositionFn, maxLength) {
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) {
    return null;
  }

  const mappedFrom = mapPosition(mapPositionFn, range.from, -1, range.from, maxLength);
  const mappedTo = mapPosition(mapPositionFn, range.to, 1, range.to, maxLength);
  const from = Math.min(mappedFrom, mappedTo);
  const to = Math.max(mappedFrom, mappedTo);
  if (to <= from) {
    return null;
  }

  return { from, to };
}

function mapInlineSpan(span, mapPositionFn, maxLength) {
  const mappedRange = mapRange(span, mapPositionFn, maxLength);
  if (!mappedRange) {
    return null;
  }

  return {
    from: mappedRange.from,
    to: mappedRange.to,
    type: typeof span?.type === 'string' && span.type ? span.type : 'unknown'
  };
}

function normalizeInlineSpans(spans, maxLength) {
  if (!Array.isArray(spans) || spans.length === 0) {
    return [];
  }

  const normalized = [];
  for (const span of spans) {
    if (!span || !Number.isFinite(span.from) || !Number.isFinite(span.to)) {
      continue;
    }

    const from = clampPosition(span.from, maxLength);
    const to = clampPosition(span.to, maxLength);
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

export function createIncrementalMarkdownParser({
  markdownEngine,
  maxIncrementalWindowChars = 60000
} = {}) {
  function parseFull(nextText, metadata = null) {
    const source = typeof nextText === 'string' ? nextText : '';
    const blocks = buildBlockRangesFromMarkdown({
      markdownEngine,
      source,
      offset: 0
    });
    const inlineSpans = buildInlineSpansForBlocks(source, blocks);

    return {
      blocks,
      inlineSpans,
      meta: {
        parser: 'full',
        reason: typeof metadata?.reason === 'string' ? metadata.reason : 'full-parse',
        reparsedCharLength: source.length
      }
    };
  }

  function parseIncremental({
    previousModel,
    nextText,
    changeRanges,
    mapPosition: mapPositionFn
  } = {}) {
    const source = typeof nextText === 'string' ? nextText : '';
    const previousBlocks = Array.isArray(previousModel?.blocks) ? previousModel.blocks : [];
    const previousInlineSpans = Array.isArray(previousModel?.inlineSpans)
      ? previousModel.inlineSpans
      : [];
    const normalizedChangeRanges = normalizeChangeRanges(changeRanges);

    if (previousBlocks.length === 0 || normalizedChangeRanges.length === 0) {
      return parseFull(source, {
        reason: normalizedChangeRanges.length === 0 ? 'missing-change-ranges' : 'missing-previous-blocks'
      });
    }

    const oldChangedBounds = summarizeOldChangeBounds(normalizedChangeRanges);
    if (!oldChangedBounds) {
      return parseFull(source, {
        reason: 'missing-old-change-bounds'
      });
    }

    const impactedWindow = findImpactedWindow(previousBlocks, oldChangedBounds.from, oldChangedBounds.to);
    const newWindowFrom = mapPosition(
      mapPositionFn,
      impactedWindow.oldFrom,
      -1,
      impactedWindow.oldFrom,
      source.length
    );
    const newWindowTo = mapPosition(
      mapPositionFn,
      impactedWindow.oldTo,
      1,
      impactedWindow.oldTo,
      source.length
    );
    const reparsedFrom = Math.min(newWindowFrom, newWindowTo);
    const reparsedTo = Math.max(newWindowFrom, newWindowTo);
    const reparsedCharLength = Math.max(0, reparsedTo - reparsedFrom);

    if (reparsedCharLength > maxIncrementalWindowChars) {
      return parseFull(source, {
        reason: 'incremental-window-too-large'
      });
    }

    const windowSource = source.slice(reparsedFrom, reparsedTo);
    const reparsedBlocks = buildBlockRangesFromMarkdown({
      markdownEngine,
      source: windowSource,
      offset: reparsedFrom
    });

    const mappedPrefixBlocks = previousBlocks
      .filter((block) => block.to <= impactedWindow.oldFrom)
      .map((block) => mapRange(block, mapPositionFn, source.length))
      .filter(Boolean);

    const mappedSuffixBlocks = previousBlocks
      .filter((block) => block.from >= impactedWindow.oldTo)
      .map((block) => mapRange(block, mapPositionFn, source.length))
      .filter(Boolean);

    const blocks = normalizeBlockRanges(
      [...mappedPrefixBlocks, ...reparsedBlocks, ...mappedSuffixBlocks],
      source.length
    );

    const mappedPrefixInlineSpans = previousInlineSpans
      .filter((span) => span.to <= impactedWindow.oldFrom)
      .map((span) => mapInlineSpan(span, mapPositionFn, source.length))
      .filter(Boolean);

    const mappedSuffixInlineSpans = previousInlineSpans
      .filter((span) => span.from >= impactedWindow.oldTo)
      .map((span) => mapInlineSpan(span, mapPositionFn, source.length))
      .filter(Boolean);

    const reparsedInlineSpans = buildInlineSpansForBlocks(source, reparsedBlocks);
    const inlineSpans = normalizeInlineSpans(
      [...mappedPrefixInlineSpans, ...reparsedInlineSpans, ...mappedSuffixInlineSpans],
      source.length
    );

    return {
      blocks,
      inlineSpans,
      meta: {
        parser: 'incremental',
        reason: 'transaction-delta',
        changeCount: normalizedChangeRanges.length,
        reparsedFrom,
        reparsedTo,
        reparsedCharLength
      }
    };
  }

  return {
    parseFull,
    parseIncremental
  };
}
