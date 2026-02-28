import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRenderBudget } from '../src/core/viewport/RenderBudget.js';

test('applyRenderBudget truncates when over budget', () => {
  const blocks = Array.from({ length: 10 }, (_, index) => index);
  const result = applyRenderBudget(blocks, 4);

  assert.equal(result.blocks.length, 4);
  assert.equal(result.truncated, true);
  assert.equal(result.maxBlocks, 4);
});

test('applyRenderBudget keeps full list when under budget', () => {
  const blocks = [1, 2, 3];
  const result = applyRenderBudget(blocks, 10);

  assert.equal(result.blocks.length, 3);
  assert.equal(result.truncated, false);
});
