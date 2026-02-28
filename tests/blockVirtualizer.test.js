import test from 'node:test';
import assert from 'node:assert/strict';
import { virtualizeBlocksAroundActive } from '../src/core/viewport/BlockVirtualizer.js';

test('virtualizeBlocksAroundActive returns active-window slice', () => {
  const blocks = Array.from({ length: 50 }, (_, index) => ({
    id: `b${index + 1}`,
    from: index * 10,
    to: index * 10 + 9
  }));

  const result = virtualizeBlocksAroundActive({
    blocks,
    activeBlockId: 'b21',
    bufferBefore: 2,
    bufferAfter: 3
  });

  assert.equal(result.activeIndex, 20);
  assert.equal(result.fromIndex, 18);
  assert.equal(result.toIndexExclusive, 24);
  assert.equal(result.blocks.length, 6);
  assert.equal(result.blocks[0].id, 'b19');
  assert.equal(result.blocks[result.blocks.length - 1].id, 'b24');
});

test('virtualizeBlocksAroundActive prefers viewport-centered slice when viewport window is provided', () => {
  const blocks = Array.from({ length: 40 }, (_, index) => ({
    id: `b${index + 1}`,
    from: index * 10,
    to: index * 10 + 9
  }));

  const result = virtualizeBlocksAroundActive({
    blocks,
    activeBlockId: 'b2',
    viewportWindow: {
      from: 205,
      to: 245
    },
    bufferBefore: 1,
    bufferAfter: 2
  });

  assert.equal(result.fromIndex, 19);
  assert.equal(result.toIndexExclusive, 27);
  assert.equal(result.blocks[0].id, 'b20');
  assert.equal(result.blocks.at(-1).id, 'b27');
  assert.equal(result.activeIndex, 1);
});
