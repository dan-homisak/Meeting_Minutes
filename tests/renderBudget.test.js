import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRenderBudget } from '../src/core/viewport/RenderBudget.js';

test('applyRenderBudget caps rendered block count while prioritizing the active block', () => {
  const blocks = [
    { id: 'a', from: 0, to: 6 },
    { id: 'b', from: 6, to: 12 },
    { id: 'c', from: 12, to: 18 },
    { id: 'd', from: 18, to: 24 }
  ];
  const result = applyRenderBudget({
    blocks,
    maxBlocks: 2,
    maxCharacters: 100,
    activeLineFrom: 13
  });

  assert.deepEqual(result.blocks.map((block) => block.id), ['b', 'c']);
  assert.equal(result.stats.outputBlockCount, 2);
  assert.equal(result.stats.limitHit, 'max-blocks');
});

test('applyRenderBudget enforces character budget after keeping the first selected block', () => {
  const blocks = [
    { id: 'a', from: 0, to: 5 },
    { id: 'b', from: 5, to: 10 },
    { id: 'c', from: 10, to: 15 }
  ];
  const result = applyRenderBudget({
    blocks,
    maxBlocks: 10,
    maxCharacters: 7,
    activeLineFrom: 6
  });

  assert.deepEqual(result.blocks.map((block) => block.id), ['b']);
  assert.equal(result.stats.outputBlockCount, 1);
  assert.equal(result.stats.limitHit, 'max-characters');
  assert.equal(result.stats.consumedCharacters, 5);
});

test('applyRenderBudget returns all blocks when limits are large enough', () => {
  const blocks = [
    { id: 'a', from: 0, to: 4 },
    { id: 'b', from: 4, to: 8 },
    { id: 'c', from: 8, to: 12 }
  ];
  const result = applyRenderBudget({
    blocks,
    maxBlocks: 10,
    maxCharacters: 100
  });

  assert.deepEqual(result.blocks.map((block) => block.id), ['a', 'b', 'c']);
  assert.equal(result.stats.limitHit, null);
});
