import test from 'node:test';
import assert from 'node:assert/strict';
import * as livePreviewCore from '../src/livePreviewCore.js';
import * as liveBlockHelpers from '../src/core/render/LiveBlockHelpers.js';
import * as liveBlockIndex from '../src/core/render/LiveBlockIndex.js';
import * as sourceRangeMapper from '../src/core/mapping/SourceRangeMapper.js';
import * as blockRangeCollector from '../src/core/parser/BlockRangeCollector.js';
import * as liveActivationHelpers from '../src/core/selection/LiveActivationHelpers.js';

function assertForwarded(name, expected) {
  assert.equal(typeof livePreviewCore[name], 'function', `${name} should be exported`);
  assert.equal(livePreviewCore[name], expected, `${name} should be forwarded from core module`);
}

test('livePreviewCore forwards render helper exports from core modules', () => {
  assertForwarded('buildRenderedFragment', liveBlockHelpers.buildRenderedFragment);
  assertForwarded('blockContainsLine', liveBlockHelpers.blockContainsLine);
  assertForwarded('splitBlockAroundActiveLine', liveBlockHelpers.splitBlockAroundActiveLine);
  assertForwarded('isFencedCodeBlock', liveBlockHelpers.isFencedCodeBlock);
  assertForwarded('shouldSkipEmptyTrailingBoundaryBlock', liveBlockHelpers.shouldSkipEmptyTrailingBoundaryBlock);

  assertForwarded('buildLiveBlockIndex', liveBlockIndex.buildLiveBlockIndex);
  assertForwarded('detectLiveBlockType', liveBlockIndex.detectLiveBlockType);
  assertForwarded('findBlockContainingPosition', liveBlockIndex.findBlockContainingPosition);
  assertForwarded('findIndexedBlockAtPosition', liveBlockIndex.findIndexedBlockAtPosition);
  assertForwarded('readFenceVisibilityState', liveBlockIndex.readFenceVisibilityState);
});

test('livePreviewCore forwards mapping and parser exports from core modules', () => {
  assertForwarded('annotateMarkdownTokensWithSourceRanges', sourceRangeMapper.annotateMarkdownTokensWithSourceRanges);
  assertForwarded('buildLineStartOffsets', sourceRangeMapper.buildLineStartOffsets);
  assertForwarded('resolveSourceRangeFromTokenMap', sourceRangeMapper.resolveSourceRangeFromTokenMap);

  assertForwarded('collectTopLevelBlocks', blockRangeCollector.collectTopLevelBlocks);
  assertForwarded('collectTopLevelBlocksFromTokens', blockRangeCollector.collectTopLevelBlocksFromTokens);
  assertForwarded('lineIndexToPos', blockRangeCollector.lineIndexToPos);
});

test('livePreviewCore forwards selection activation exports from core modules', () => {
  assertForwarded('shouldPreferSourceFromForRenderedFencedClick', liveActivationHelpers.shouldPreferSourceFromForRenderedFencedClick);
  assertForwarded('shouldPreferSourceFromForRenderedBoundaryClick', liveActivationHelpers.shouldPreferSourceFromForRenderedBoundaryClick);
  assertForwarded('shouldPreferRenderedDomAnchorPosition', liveActivationHelpers.shouldPreferRenderedDomAnchorPosition);
  assertForwarded('findNearestBlockForPosition', liveActivationHelpers.findNearestBlockForPosition);
  assertForwarded('findBlockBySourceFrom', liveActivationHelpers.findBlockBySourceFrom);
  assertForwarded('resolveActivationBlockBounds', liveActivationHelpers.resolveActivationBlockBounds);
  assertForwarded('clampSelectionToBlockRange', liveActivationHelpers.clampSelectionToBlockRange);
  assertForwarded('resolveLiveBlockSelection', liveActivationHelpers.resolveLiveBlockSelection);
  assertForwarded('parseSourceFromAttribute', liveActivationHelpers.parseSourceFromAttribute);
});
