export function lineIndexToPos(doc, lineIndex) {
  if (lineIndex <= 0) {
    return 0;
  }

  if (lineIndex >= doc.lines) {
    return doc.length;
  }

  return doc.line(lineIndex + 1).from;
}

export function collectTopLevelBlocksFromTokens(doc, tokens) {
  const candidateBlocks = [];
  const seen = new Set();

  for (const token of tokens) {
    if (!token.block || !token.map || token.level !== 0 || token.nesting === -1) {
      continue;
    }

    const [startLine, endLine] = token.map;
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || endLine <= startLine) {
      continue;
    }

    const key = `${startLine}:${endLine}`;
    if (seen.has(key)) {
      continue;
    }

    const from = lineIndexToPos(doc, startLine);
    const to = lineIndexToPos(doc, endLine);
    if (to <= from) {
      continue;
    }

    const source = doc.sliceString(from, to);
    if (!source.trim()) {
      continue;
    }

    candidateBlocks.push({ from, to });
    seen.add(key);
  }

  candidateBlocks.sort((a, b) => a.from - b.from || a.to - b.to);

  const mergedBlocks = [];
  for (const block of candidateBlocks) {
    const previous = mergedBlocks[mergedBlocks.length - 1];
    if (!previous) {
      mergedBlocks.push({ ...block });
      continue;
    }

    if (block.from < previous.to) {
      if (block.to > previous.to) {
        previous.to = block.to;
      }
      continue;
    }

    mergedBlocks.push({ ...block });
  }

  return mergedBlocks;
}

export function collectTopLevelBlocks(doc, parseTokens) {
  const tokens = parseTokens(doc.toString());
  return collectTopLevelBlocksFromTokens(doc, tokens);
}

export function buildLineStartOffsets(source) {
  if (typeof source !== 'string') {
    return [0];
  }

  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      offsets.push(index + 1);
    }
  }

  if (offsets[offsets.length - 1] !== source.length) {
    offsets.push(source.length);
  }

  return offsets;
}

export function resolveSourceRangeFromTokenMap(
  tokenMap,
  lineStartOffsets,
  sourceFrom,
  sourceTo = null
) {
  if (
    !Array.isArray(tokenMap) ||
    tokenMap.length < 2 ||
    !Array.isArray(lineStartOffsets) ||
    lineStartOffsets.length < 2 ||
    !Number.isFinite(sourceFrom)
  ) {
    return null;
  }

  const lineCount = lineStartOffsets.length - 1;
  const rawStartLine = Number(tokenMap[0]);
  const rawEndLine = Number(tokenMap[1]);
  if (!Number.isFinite(rawStartLine) || !Number.isFinite(rawEndLine)) {
    return null;
  }

  if (rawStartLine < 0 || rawStartLine >= lineCount || rawEndLine <= rawStartLine) {
    return null;
  }

  const startLine = Math.min(lineCount, Math.max(0, Math.trunc(rawStartLine)));
  const endLineExclusive = Math.min(lineCount, Math.max(startLine + 1, Math.trunc(rawEndLine)));
  const startOffset = lineStartOffsets[startLine];
  const endOffset = lineStartOffsets[endLineExclusive];
  if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset) || endOffset <= startOffset) {
    return null;
  }

  const absoluteFrom = sourceFrom + startOffset;
  const absoluteUnboundedTo = sourceFrom + endOffset;
  const resolvedSourceTo = Number.isFinite(sourceTo) ? Math.max(sourceFrom, sourceTo) : null;
  const absoluteTo = Number.isFinite(resolvedSourceTo)
    ? Math.min(resolvedSourceTo, absoluteUnboundedTo)
    : absoluteUnboundedTo;

  if (!Number.isFinite(absoluteFrom) || !Number.isFinite(absoluteTo) || absoluteTo <= absoluteFrom) {
    return null;
  }

  return {
    from: absoluteFrom,
    to: absoluteTo,
    startLine,
    endLineExclusive
  };
}

export function annotateMarkdownTokensWithSourceRanges(
  tokens,
  source,
  sourceFrom,
  sourceTo = null
) {
  if (!Array.isArray(tokens) || !Number.isFinite(sourceFrom)) {
    return {
      annotatedCount: 0,
      skippedCount: Array.isArray(tokens) ? tokens.length : 0
    };
  }

  const lineStartOffsets = buildLineStartOffsets(source);
  let annotatedCount = 0;
  let skippedCount = 0;

  for (const token of tokens) {
    if (!token || token.nesting === -1 || !Array.isArray(token.map)) {
      skippedCount += 1;
      continue;
    }

    const sourceRange = resolveSourceRangeFromTokenMap(
      token.map,
      lineStartOffsets,
      sourceFrom,
      sourceTo
    );
    if (!sourceRange) {
      skippedCount += 1;
      continue;
    }

    if (typeof token.attrSet === 'function') {
      token.attrSet('data-src-from', String(sourceRange.from));
      token.attrSet('data-src-to', String(sourceRange.to));
      token.attrSet('data-src-line-start', String(sourceRange.startLine));
      token.attrSet('data-src-line-end', String(Math.max(sourceRange.startLine, sourceRange.endLineExclusive - 1)));
      annotatedCount += 1;
      continue;
    }

    skippedCount += 1;
  }

  return {
    annotatedCount,
    skippedCount
  };
}

export function buildRenderedFragment(doc, from, to, renderMarkdownHtml) {
  if (to <= from) {
    return null;
  }

  const source = doc.sliceString(from, to);
  if (!source.trim()) {
    return null;
  }

  return {
    from,
    to,
    html: renderMarkdownHtml(source, from, to)
  };
}

export function blockContainsLine(block, line) {
  return line.from < block.to && line.to >= block.from;
}

export function splitBlockAroundActiveLine(doc, block, activeLine, renderMarkdownHtml) {
  if (!blockContainsLine(block, activeLine)) {
    const whole = buildRenderedFragment(doc, block.from, block.to, renderMarkdownHtml);
    return whole ? [whole] : [];
  }

  const fragments = [];
  const before = buildRenderedFragment(doc, block.from, Math.min(block.to, activeLine.from), renderMarkdownHtml);
  if (before) {
    fragments.push(before);
  }

  let afterStart = Math.max(block.from, activeLine.to);
  if (afterStart < block.to && doc.sliceString(afterStart, afterStart + 1) === '\n') {
    afterStart += 1;
  }

  const after = buildRenderedFragment(doc, afterStart, block.to, renderMarkdownHtml);
  if (after) {
    fragments.push(after);
  }

  return fragments;
}

function parseFenceMarker(lineText) {
  if (typeof lineText !== 'string') {
    return null;
  }

  const match = lineText.match(/^\s*([`~]{3,})/);
  if (!match) {
    return null;
  }

  const marker = match[1];
  return {
    marker,
    markerChar: marker[0],
    markerLength: marker.length
  };
}

export function isFencedCodeBlock(doc, block) {
  if (
    !doc ||
    !block ||
    !Number.isFinite(block.from) ||
    !Number.isFinite(block.to)
  ) {
    return false;
  }

  const from = Math.max(0, Math.min(block.from, block.to));
  const to = Math.min(doc.length, Math.max(block.from, block.to));
  if (to <= from) {
    return false;
  }

  const firstLine = doc.lineAt(from);
  const lastLine = doc.lineAt(Math.max(from, to - 1));
  const firstLineText = doc.sliceString(firstLine.from, firstLine.to);
  const lastLineText = doc.sliceString(lastLine.from, lastLine.to);
  const startFence = parseFenceMarker(firstLineText);
  const endFence = parseFenceMarker(lastLineText);

  if (!startFence || !endFence) {
    return false;
  }

  return (
    startFence.markerChar === endFence.markerChar &&
    endFence.markerLength >= startFence.markerLength
  );
}

export function shouldSkipEmptyTrailingBoundaryBlock(activeLine, block, _blockIsFencedCode = false) {
  if (
    !activeLine ||
    !block ||
    !Number.isFinite(activeLine.from) ||
    !Number.isFinite(activeLine.to) ||
    !Number.isFinite(block.to)
  ) {
    return false;
  }

  const activeLineLength = Math.max(0, activeLine.to - activeLine.from);
  if (activeLineLength !== 0) {
    return false;
  }

  if (block.to !== activeLine.from) {
    return false;
  }

  // Rendering a block while the caret sits on its trailing empty boundary line
  // can collapse the active line and push the cursor to the far right.
  return true;
}

export function shouldPreferSourceFromForRenderedFencedClick({
  targetTagName,
  sourceFromBlockIsFencedCode = false,
  sourcePosDistanceToSourceFromBlock = null,
  sourcePosLineDeltaAfterSourceFromBlock = null,
  maxDistance = 12,
  maxLineDelta = 2
} = {}) {
  if (!sourceFromBlockIsFencedCode) {
    return false;
  }

  const normalizedTagName =
    typeof targetTagName === 'string' ? targetTagName.trim().toUpperCase() : '';
  if (normalizedTagName !== 'PRE' && normalizedTagName !== 'CODE') {
    return false;
  }

  if (!Number.isFinite(sourcePosDistanceToSourceFromBlock)) {
    return false;
  }

  const normalizedMaxDistance = Number.isFinite(maxDistance) ? Math.max(0, maxDistance) : 12;
  if (
    sourcePosDistanceToSourceFromBlock <= 0 ||
    sourcePosDistanceToSourceFromBlock > normalizedMaxDistance
  ) {
    return false;
  }

  if (!Number.isFinite(sourcePosLineDeltaAfterSourceFromBlock)) {
    return false;
  }

  const normalizedMaxLineDelta = Number.isFinite(maxLineDelta) ? Math.max(0, maxLineDelta) : 2;
  return (
    sourcePosLineDeltaAfterSourceFromBlock >= 0 &&
    sourcePosLineDeltaAfterSourceFromBlock <= normalizedMaxLineDelta
  );
}

const RENDERED_BOUNDARY_STICKY_ALLOWED_TAGS = new Set([
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'P',
  'LI',
  'BLOCKQUOTE',
  'UL',
  'OL',
  'TABLE'
]);

export function shouldPreferSourceFromForRenderedBoundaryClick({
  targetTagName,
  sourceFromBlockIsFencedCode = false,
  sourcePosDistanceToSourceFromBlock = null,
  sourcePosLineDeltaAfterSourceFromBlock = null,
  pointerDistanceToBlockBottom = null,
  pointerRatioY = null,
  maxDistanceFromBottomPx = 14,
  maxLineDelta = 3,
  maxSourcePosDistance = 30,
  minPointerRatioY = 0.3
} = {}) {
  if (sourceFromBlockIsFencedCode) {
    return false;
  }

  const normalizedTagName =
    typeof targetTagName === 'string' ? targetTagName.trim().toUpperCase() : '';
  if (!RENDERED_BOUNDARY_STICKY_ALLOWED_TAGS.has(normalizedTagName)) {
    return false;
  }

  if (!Number.isFinite(sourcePosDistanceToSourceFromBlock) || sourcePosDistanceToSourceFromBlock <= 0) {
    return false;
  }

  const normalizedMaxSourcePosDistance = Number.isFinite(maxSourcePosDistance)
    ? Math.max(0, maxSourcePosDistance)
    : 30;
  if (sourcePosDistanceToSourceFromBlock > normalizedMaxSourcePosDistance) {
    return false;
  }

  if (!Number.isFinite(sourcePosLineDeltaAfterSourceFromBlock)) {
    return false;
  }

  const normalizedMaxLineDelta = Number.isFinite(maxLineDelta) ? Math.max(0, maxLineDelta) : 3;
  if (
    sourcePosLineDeltaAfterSourceFromBlock < 1 ||
    sourcePosLineDeltaAfterSourceFromBlock > normalizedMaxLineDelta
  ) {
    return false;
  }

  const normalizedMaxDistanceFromBottomPx = Number.isFinite(maxDistanceFromBottomPx)
    ? Math.max(0, maxDistanceFromBottomPx)
    : 14;
  const nearBottomByDistance =
    Number.isFinite(pointerDistanceToBlockBottom) &&
    pointerDistanceToBlockBottom >= 0 &&
    pointerDistanceToBlockBottom <= normalizedMaxDistanceFromBottomPx;
  const normalizedMinPointerRatioY = Number.isFinite(minPointerRatioY)
    ? Math.min(1, Math.max(0, minPointerRatioY))
    : 0.3;
  const nearBottomByRatio =
    Number.isFinite(pointerRatioY) && pointerRatioY >= normalizedMinPointerRatioY;

  return nearBottomByDistance || nearBottomByRatio;
}

export function shouldPreferRenderedDomAnchorPosition({
  sourcePosDistanceToSourceFromBlock = null,
  domTargetDistanceToSourceFromBlock = null,
  domBlockDistanceToSourceFromBlock = null,
  maxSourcePosDistance = 40
} = {}) {
  if (!Number.isFinite(sourcePosDistanceToSourceFromBlock)) {
    return false;
  }

  const normalizedMaxSourcePosDistance = Number.isFinite(maxSourcePosDistance)
    ? Math.max(0, maxSourcePosDistance)
    : 40;
  if (
    sourcePosDistanceToSourceFromBlock <= 0 ||
    sourcePosDistanceToSourceFromBlock > normalizedMaxSourcePosDistance
  ) {
    return false;
  }

  const domTargetInSourceFromBlock =
    Number.isFinite(domTargetDistanceToSourceFromBlock) &&
    domTargetDistanceToSourceFromBlock === 0;
  const domBlockInSourceFromBlock =
    Number.isFinite(domBlockDistanceToSourceFromBlock) &&
    domBlockDistanceToSourceFromBlock === 0;

  return domTargetInSourceFromBlock || domBlockInSourceFromBlock;
}

function clampPosition(position, docLength) {
  if (!Number.isFinite(position)) {
    return 0;
  }

  if (position < 0) {
    return 0;
  }

  if (position > docLength) {
    return docLength;
  }

  return Math.trunc(position);
}

function normalizeBlockRange(block, docLength) {
  if (
    !block ||
    !Number.isFinite(block.from) ||
    !Number.isFinite(block.to)
  ) {
    return null;
  }

  const from = clampPosition(Math.min(block.from, block.to), docLength);
  const to = clampPosition(Math.max(block.from, block.to), docLength);
  const max = to > from ? to - 1 : from;
  return { from, max };
}

export function findBlockContainingPosition(blocks, position) {
  if (!Array.isArray(blocks) || !Number.isFinite(position)) {
    return null;
  }

  for (const block of blocks) {
    if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
      continue;
    }

    const from = Math.min(block.from, block.to);
    const to = Math.max(block.from, block.to);
    if (position >= from && position < to) {
      return block;
    }
  }

  return null;
}

export function findNearestBlockForPosition(blocks, position, tolerance = 1) {
  if (!Array.isArray(blocks) || !Number.isFinite(position)) {
    return null;
  }

  let closestBlock = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  const maxDistance = Number.isFinite(tolerance) ? Math.max(0, tolerance) : 1;

  for (const block of blocks) {
    if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
      continue;
    }

    const from = Math.min(block.from, block.to);
    const to = Math.max(block.from, block.to);
    const max = to > from ? to - 1 : from;

    let distance = 0;
    if (position < from) {
      distance = from - position;
    } else if (position > max) {
      distance = position - max;
    } else {
      return block;
    }

    if (distance < closestDistance) {
      closestDistance = distance;
      closestBlock = block;
    }
  }

  if (closestBlock && closestDistance <= maxDistance) {
    return closestBlock;
  }

  return null;
}

export function findBlockBySourceFrom(blocks, sourceFrom) {
  if (!Array.isArray(blocks) || !Number.isFinite(sourceFrom)) {
    return null;
  }

  for (const block of blocks) {
    if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
      continue;
    }

    if (block.from === sourceFrom) {
      return block;
    }
  }

  return null;
}

export function resolveActivationBlockBounds(
  blocks,
  sourceFrom,
  sourcePos = null,
  tolerance = 1
) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return null;
  }

  if (Number.isFinite(sourceFrom)) {
    const blockBySourceFrom = findBlockBySourceFrom(blocks, sourceFrom);
    if (blockBySourceFrom) {
      return blockBySourceFrom;
    }

    const blockContainingSourceFrom = findBlockContainingPosition(blocks, sourceFrom);
    if (blockContainingSourceFrom) {
      return blockContainingSourceFrom;
    }
  }

  if (Number.isFinite(sourcePos)) {
    const blockContainingSourcePos = findBlockContainingPosition(blocks, sourcePos);
    if (blockContainingSourcePos) {
      return blockContainingSourcePos;
    }

    const nearestBlockBySourcePos = findNearestBlockForPosition(blocks, sourcePos, tolerance);
    if (nearestBlockBySourcePos) {
      return nearestBlockBySourcePos;
    }
  }

  if (Number.isFinite(sourceFrom)) {
    return findNearestBlockForPosition(blocks, sourceFrom, tolerance);
  }

  return null;
}

export function clampSelectionToBlockRange(docLength, selection, block) {
  const clampedSelection = clampPosition(selection, docLength);
  const range = normalizeBlockRange(block, docLength);
  if (!range) {
    return clampedSelection;
  }

  if (clampedSelection < range.from) {
    return range.from;
  }

  if (clampedSelection > range.max) {
    return range.max;
  }

  return clampedSelection;
}

export function resolveLiveBlockSelection(docLength, sourceFrom, mappedPos, block = null) {
  const fallback = clampPosition(sourceFrom, docLength);
  const candidate = Number.isFinite(mappedPos) ? mappedPos : fallback;

  return clampSelectionToBlockRange(docLength, candidate, block);
}

export function parseSourceFromAttribute(rawValue) {
  if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
    return null;
  }

  const sourceFrom = Number(rawValue);
  if (!Number.isFinite(sourceFrom)) {
    return null;
  }

  return sourceFrom;
}
