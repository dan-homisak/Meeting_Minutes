export {
  buildRenderedFragment,
  blockContainsLine,
  splitBlockAroundActiveLine,
  isFencedCodeBlock,
  shouldSkipEmptyTrailingBoundaryBlock
} from './core/render/LiveBlockHelpers.js';

export {
  buildLiveBlockIndex,
  detectLiveBlockType,
  findBlockContainingPosition,
  findIndexedBlockAtPosition,
  readFenceVisibilityState
} from './core/render/LiveBlockIndex.js';

export {
  annotateMarkdownTokensWithSourceRanges,
  buildLineStartOffsets,
  resolveSourceRangeFromTokenMap
} from './core/mapping/SourceRangeMapper.js';

export {
  collectTopLevelBlocks,
  collectTopLevelBlocksFromTokens,
  lineIndexToPos
} from './core/parser/BlockRangeCollector.js';

export {
  shouldPreferSourceFromForRenderedFencedClick,
  shouldPreferSourceFromForRenderedBoundaryClick,
  shouldPreferRenderedDomAnchorPosition,
  findNearestBlockForPosition,
  findBlockBySourceFrom,
  resolveActivationBlockBounds,
  clampSelectionToBlockRange,
  resolveLiveBlockSelection,
  parseSourceFromAttribute
} from './core/selection/LiveActivationHelpers.js';
