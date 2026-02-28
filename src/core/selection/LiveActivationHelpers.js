import { findBlockContainingPosition } from '../render/LiveBlockIndex.js';

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

function findBlockBySourceFrom(blocks, sourceFrom) {
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
