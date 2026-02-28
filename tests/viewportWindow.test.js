import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBlockWindow } from '../src/core/viewport/ViewportWindow.js';

test('resolveBlockWindow clamps index and resolves before/after range', () => {
  const window = resolveBlockWindow({
    blockCount: 100,
    activeIndex: 50,
    before: 10,
    after: 5
  });

  assert.equal(window.fromIndex, 40);
  assert.equal(window.toIndexExclusive, 56);

  const startWindow = resolveBlockWindow({
    blockCount: 20,
    activeIndex: -10,
    before: 10,
    after: 10
  });
  assert.equal(startWindow.fromIndex, 0);
  assert.equal(startWindow.toIndexExclusive, 11);
});
