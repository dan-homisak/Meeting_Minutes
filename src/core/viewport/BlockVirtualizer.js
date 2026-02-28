import { resolveBlockWindow } from './ViewportWindow.js';

export function virtualizeBlocksAroundActive({
  blocks = [],
  activeBlockId = null,
  viewportWindow = null,
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

  let fromIndexByViewport = -1;
  let toIndexByViewport = -1;
  if (
    viewportWindow &&
    Number.isFinite(viewportWindow.from) &&
    Number.isFinite(viewportWindow.to) &&
    viewportWindow.to > viewportWindow.from
  ) {
    const viewportFrom = Math.max(0, Math.trunc(viewportWindow.from));
    const viewportTo = Math.max(viewportFrom, Math.trunc(viewportWindow.to));
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
        continue;
      }
      const intersects = block.to > viewportFrom && block.from < viewportTo;
      if (!intersects) {
        continue;
      }
      if (fromIndexByViewport < 0) {
        fromIndexByViewport = index;
      }
      toIndexByViewport = index;
    }
  }

  let activeIndex = blocks.findIndex((block) => block?.id === activeBlockId);
  if (activeIndex < 0 && fromIndexByViewport >= 0) {
    activeIndex = fromIndexByViewport;
  }
  if (activeIndex < 0) {
    activeIndex = 0;
  }

  if (fromIndexByViewport >= 0 && toIndexByViewport >= fromIndexByViewport) {
    const fromIndex = Math.max(0, fromIndexByViewport - Math.max(0, Math.trunc(bufferBefore)));
    const toIndexExclusive = Math.min(
      blocks.length,
      toIndexByViewport + 1 + Math.max(0, Math.trunc(bufferAfter))
    );
    return {
      blocks: blocks.slice(fromIndex, toIndexExclusive),
      fromIndex,
      toIndexExclusive,
      activeIndex
    };
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
