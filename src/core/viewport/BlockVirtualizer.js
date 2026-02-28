import { resolveBlockWindow } from './ViewportWindow.js';

export function virtualizeBlocksAroundActive({
  blocks = [],
  activeBlockId = null,
  bufferBefore = 40,
  bufferAfter = 40
} = {}) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return {
      blocks: [],
      fromIndex: 0,
      toIndexExclusive: 0,
      activeIndex: -1
    };
  }

  let activeIndex = blocks.findIndex((block) => block?.id === activeBlockId);
  if (activeIndex < 0) {
    activeIndex = 0;
  }

  const window = resolveBlockWindow({
    blockCount: blocks.length,
    activeIndex,
    before: bufferBefore,
    after: bufferAfter
  });

  return {
    blocks: blocks.slice(window.fromIndex, window.toIndexExclusive),
    fromIndex: window.fromIndex,
    toIndexExclusive: window.toIndexExclusive,
    activeIndex
  };
}
