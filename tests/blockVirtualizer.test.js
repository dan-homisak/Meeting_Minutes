import test from 'node:test';
import assert from 'node:assert/strict';
import { virtualizeBlocksForViewport } from '../src/core/viewport/BlockVirtualizer.js';

test('virtualizeBlocksForViewport keeps only blocks intersecting the viewport window', () => {
  const blocks = [
    { id: 'a', from: 0, to: 10 },
    { id: 'b', from: 10, to: 20 },
    { id: 'c', from: 20, to: 30 },
    { id: 'd', from: 30, to: 40 }
  ];
  const result = virtualizeBlocksForViewport({
    blocks,
    viewportWindow: {
      enabled: true,
      sourceFrom: 12,
      sourceTo: 32
    }
  });

  assert.deepEqual(result.blocks.map((block) => block.id), ['b', 'c', 'd']);
  assert.equal(result.stats.inputBlockCount, 4);
  assert.equal(result.stats.outputBlockCount, 3);
  assert.equal(result.stats.activeBlockInjected, false);
});

test('virtualizeBlocksForViewport injects the active block when it falls outside the viewport window', () => {
  const blocks = [
    { id: 'a', from: 0, to: 10 },
    { id: 'b', from: 10, to: 20 },
    { id: 'c', from: 20, to: 30 }
  ];
  const result = virtualizeBlocksForViewport({
    blocks,
    viewportWindow: {
      enabled: true,
      sourceFrom: 20,
      sourceTo: 30
    },
    activeLineFrom: 5
  });

  assert.deepEqual(result.blocks.map((block) => block.id), ['a', 'c']);
  assert.equal(result.stats.outputBlockCount, 2);
  assert.equal(result.stats.activeBlockInjected, true);
});
