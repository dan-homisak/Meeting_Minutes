import { findBlockContainingPosition } from '../render/LiveBlockIndex.js';

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

  if (
    !Number.isFinite(sourcePosDistanceToSourceFromBlock) ||
    sourcePosDistanceToSourceFromBlock <= 0
  ) {
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
  if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
    return null;
  }

  const from = clampPosition(Math.min(block.from, block.to), docLength);
  const to = clampPosition(Math.max(block.from, block.to), docLength);
  const max = to > from ? to - 1 : from;
  return { from, max };
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
