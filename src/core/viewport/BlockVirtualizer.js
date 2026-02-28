function isFiniteBlockRange(block) {
  return (
    block &&
    Number.isFinite(block.from) &&
    Number.isFinite(block.to) &&
    Math.trunc(block.to) > Math.trunc(block.from)
  );
}

function blockContainsPosition(block, position) {
  return (
    isFiniteBlockRange(block) &&
    Number.isFinite(position) &&
    position >= Math.trunc(block.from) &&
    position < Math.trunc(block.to)
  );
}

function blockIntersectsWindow(block, sourceFrom, sourceTo) {
  if (!isFiniteBlockRange(block)) {
    return false;
  }

  const blockFrom = Math.trunc(block.from);
  const blockTo = Math.trunc(block.to);
  return blockTo > sourceFrom && blockFrom < sourceTo;
}

export function virtualizeBlocksForViewport({
  blocks = [],
  viewportWindow = null,
  activeLineFrom = Number.NaN
} = {}) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return {
      blocks: [],
      stats: {
        inputBlockCount: 0,
        outputBlockCount: 0,
        droppedBlockCount: 0,
        activeBlockInjected: false
      }
    };
  }

  const windowEnabled =
    Boolean(viewportWindow?.enabled) &&
    Number.isFinite(viewportWindow?.sourceFrom) &&
    Number.isFinite(viewportWindow?.sourceTo) &&
    Math.trunc(viewportWindow.sourceTo) > Math.trunc(viewportWindow.sourceFrom);

  if (!windowEnabled) {
    return {
      blocks,
      stats: {
        inputBlockCount: blocks.length,
        outputBlockCount: blocks.length,
        droppedBlockCount: 0,
        activeBlockInjected: false
      }
    };
  }

  const sourceFrom = Math.trunc(viewportWindow.sourceFrom);
  const sourceTo = Math.trunc(viewportWindow.sourceTo);
  const includedIndexes = new Set();
  let activeBlockIndex = -1;

  blocks.forEach((block, index) => {
    if (blockContainsPosition(block, activeLineFrom) && activeBlockIndex === -1) {
      activeBlockIndex = index;
    }
    if (blockIntersectsWindow(block, sourceFrom, sourceTo)) {
      includedIndexes.add(index);
    }
  });

  let activeBlockInjected = false;
  if (activeBlockIndex >= 0 && !includedIndexes.has(activeBlockIndex)) {
    includedIndexes.add(activeBlockIndex);
    activeBlockInjected = true;
  }

  const sortedIndexes = [...includedIndexes].sort((left, right) => left - right);
  const outputBlocks = sortedIndexes.map((index) => blocks[index]);

  return {
    blocks: outputBlocks,
    stats: {
      inputBlockCount: blocks.length,
      outputBlockCount: outputBlocks.length,
      droppedBlockCount: Math.max(0, blocks.length - outputBlocks.length),
      activeBlockInjected
    }
  };
}
