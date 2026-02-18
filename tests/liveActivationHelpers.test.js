import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampSelectionToBlockRange,
  findBlockBySourceFrom,
  findNearestBlockForPosition,
  parseSourceFromAttribute,
  resolveActivationBlockBounds,
  resolveLiveBlockSelection,
  shouldPreferRenderedDomAnchorPosition,
  shouldPreferSourceFromForRenderedBoundaryClick,
  shouldPreferSourceFromForRenderedFencedClick
} from '../src/core/selection/LiveActivationHelpers.js';

test('shouldPreferSourceFromForRenderedFencedClick keeps fenced PRE/CODE clicks near boundary drift', () => {
  assert.equal(
    shouldPreferSourceFromForRenderedFencedClick({
      targetTagName: 'pre',
      sourceFromBlockIsFencedCode: true,
      sourcePosDistanceToSourceFromBlock: 4,
      sourcePosLineDeltaAfterSourceFromBlock: 2
    }),
    true
  );

  assert.equal(
    shouldPreferSourceFromForRenderedFencedClick({
      targetTagName: 'h2',
      sourceFromBlockIsFencedCode: true,
      sourcePosDistanceToSourceFromBlock: 4,
      sourcePosLineDeltaAfterSourceFromBlock: 2
    }),
    false
  );
});

test('shouldPreferSourceFromForRenderedBoundaryClick keeps non-fenced heading and paragraph clicks near bottom', () => {
  assert.equal(
    shouldPreferSourceFromForRenderedBoundaryClick({
      targetTagName: 'h2',
      sourceFromBlockIsFencedCode: false,
      sourcePosDistanceToSourceFromBlock: 7,
      sourcePosLineDeltaAfterSourceFromBlock: 2,
      pointerDistanceToBlockBottom: 4,
      pointerRatioY: 0.77
    }),
    true
  );

  assert.equal(
    shouldPreferSourceFromForRenderedBoundaryClick({
      targetTagName: 'h2',
      sourceFromBlockIsFencedCode: true,
      sourcePosDistanceToSourceFromBlock: 7,
      sourcePosLineDeltaAfterSourceFromBlock: 2,
      pointerDistanceToBlockBottom: 4,
      pointerRatioY: 0.77
    }),
    false
  );
});

test('shouldPreferRenderedDomAnchorPosition keeps rendered click anchored when coordinate mapping drifts', () => {
  assert.equal(
    shouldPreferRenderedDomAnchorPosition({
      sourcePosDistanceToSourceFromBlock: 7,
      domTargetDistanceToSourceFromBlock: 0,
      domBlockDistanceToSourceFromBlock: 0
    }),
    true
  );

  assert.equal(
    shouldPreferRenderedDomAnchorPosition({
      sourcePosDistanceToSourceFromBlock: 7,
      domTargetDistanceToSourceFromBlock: 2,
      domBlockDistanceToSourceFromBlock: 3
    }),
    false
  );
});

test('findNearestBlockForPosition and resolveActivationBlockBounds use contains then nearest tolerance', () => {
  const blocks = [
    { from: 0, to: 10 },
    { from: 12, to: 20 }
  ];

  assert.equal(findNearestBlockForPosition(blocks, 11, 1), blocks[1]);
  assert.equal(findNearestBlockForPosition(blocks, 25, 1), null);
  assert.equal(findBlockBySourceFrom(blocks, 12), blocks[1]);

  assert.equal(resolveActivationBlockBounds(blocks, 12, null), blocks[1]);
  assert.equal(resolveActivationBlockBounds(blocks, 999, 19), blocks[1]);
  assert.equal(resolveActivationBlockBounds(blocks, 999, 25), null);
});

test('resolveLiveBlockSelection and clampSelectionToBlockRange constrain selection to block interior', () => {
  const block = { from: 20, to: 30 };

  assert.equal(clampSelectionToBlockRange(100, 88, block), 29);
  assert.equal(clampSelectionToBlockRange(100, 7, block), 20);
  assert.equal(resolveLiveBlockSelection(100, 10, Number.NaN), 10);
  assert.equal(resolveLiveBlockSelection(100, 10, 37.8, block), 29);
});

test('parseSourceFromAttribute parses valid numbers and rejects invalid values', () => {
  assert.equal(parseSourceFromAttribute('42'), 42);
  assert.equal(parseSourceFromAttribute('12.5'), 12.5);
  assert.equal(parseSourceFromAttribute('nan'), null);
  assert.equal(parseSourceFromAttribute(''), null);
  assert.equal(parseSourceFromAttribute(null), null);
});
