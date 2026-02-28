import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findNearestBlockForPosition,
  resolveActivationBlockBounds
} from '../src/core/selection/LiveActivationHelpers.js';

test('findNearestBlockForPosition and resolveActivationBlockBounds use contains then nearest tolerance', () => {
  const blocks = [
    { from: 0, to: 10 },
    { from: 12, to: 20 }
  ];

  assert.equal(findNearestBlockForPosition(blocks, 11, 1), blocks[1]);
  assert.equal(findNearestBlockForPosition(blocks, 25, 1), null);

  assert.equal(resolveActivationBlockBounds(blocks, 12, null), blocks[1]);
  assert.equal(resolveActivationBlockBounds(blocks, 999, 19), blocks[1]);
  assert.equal(resolveActivationBlockBounds(blocks, 999, 25), null);
});
