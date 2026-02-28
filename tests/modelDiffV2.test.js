import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocModel } from '../src/core/model/DocModel.js';
import { diffDocModels } from '../src/core/model/ModelDiff.js';

test('diffDocModels exposes changed block IDs and inline fragment deltas', () => {
  const previous = createDocModel({
    version: 1,
    text: '- [ ] task one\n',
    blocks: [
      { id: 'block-task-1', from: 0, to: 14 }
    ],
    inlineSpans: [
      { from: 6, to: 10, type: 'text' }
    ]
  });

  const next = createDocModel({
    version: 2,
    text: '- [x] task one updated\n',
    blocks: [
      { id: 'block-task-1', from: 0, to: 22 }
    ],
    inlineSpans: [
      { from: 6, to: 10, type: 'text' },
      { from: 11, to: 18, type: 'text' }
    ]
  });

  const diff = diffDocModels(previous, next);

  assert.equal(diff.textChanged, true);
  assert.ok(diff.blockUpdatedIds.includes('block-task-1'));
  assert.ok(diff.changedBlockIds.includes('block-task-1'));
  assert.ok(diff.changedBlocks.some((entry) => entry.id === 'block-task-1' && entry.change === 'updated'));
  assert.equal(diff.changedInlineFragments.added.length, 1);
  assert.equal(diff.changedInlineFragments.removed.length, 0);
});

test('diffDocModels captures added and removed blocks by stable identifiers', () => {
  const previous = createDocModel({
    version: 1,
    text: '# One\n',
    blocks: [
      { id: 'heading-1', from: 0, to: 6 }
    ],
    inlineSpans: []
  });

  const next = createDocModel({
    version: 2,
    text: '# Two\n\nBody\n',
    blocks: [
      { id: 'heading-2', from: 0, to: 6 },
      { id: 'paragraph-1', from: 7, to: 12 }
    ],
    inlineSpans: []
  });

  const diff = diffDocModels(previous, next);

  assert.ok(diff.blockAddedIds.includes('heading-2'));
  assert.ok(diff.blockAddedIds.includes('paragraph-1'));
  assert.ok(diff.blockRemovedIds.includes('heading-1'));
  assert.equal(diff.changedBlocks.some((entry) => entry.change === 'added'), true);
  assert.equal(diff.changedBlocks.some((entry) => entry.change === 'removed'), true);
});
