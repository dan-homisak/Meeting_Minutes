import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyLiveDocModel,
  normalizeLiveBlockType,
  toLiveDocModel
} from '../../src/live-v4/model/LiveDocModel.js';

test('normalizeLiveBlockType maps unknown and list aliases', () => {
  assert.equal(normalizeLiveBlockType('heading'), 'heading');
  assert.equal(normalizeLiveBlockType('ordered-list'), 'list');
  assert.equal(normalizeLiveBlockType('rule'), 'hr');
  assert.equal(normalizeLiveBlockType('unknown-type'), 'paragraph');
});

test('toLiveDocModel creates strict obsidian-core shape', () => {
  const model = toLiveDocModel({
    version: 4,
    text: '# hello\n- [ ] task\n',
    blocks: [
      {
        id: 'h1',
        type: 'heading',
        from: 0,
        to: 7,
        lineFrom: 1,
        lineTo: 1,
        attrs: { level: 1 }
      },
      {
        id: 't1',
        type: 'task',
        from: 8,
        to: 18,
        lineFrom: 2,
        lineTo: 2,
        attrs: { checked: false, depth: 0 }
      }
    ],
    inlineSpans: [
      { from: 2, to: 7, type: 'emphasis' }
    ],
    meta: {
      parser: 'incremental',
      reparsedFrom: 0,
      reparsedTo: 18
    }
  });

  assert.equal(model.meta.dialect, 'obsidian-core');
  assert.equal(model.meta.parser, 'incremental');
  assert.equal(model.blocks.length, 2);
  assert.equal(model.blocks[0].depth, null);
  assert.equal(model.blocks[1].depth, 0);
  assert.equal(model.inlines.length, 1);
  assert.equal(model.inlines[0].type, 'emphasis');
});

test('createEmptyLiveDocModel returns empty canonical model', () => {
  const model = createEmptyLiveDocModel();
  assert.equal(model.version, 0);
  assert.equal(model.text, '');
  assert.deepEqual(model.blocks, []);
  assert.deepEqual(model.inlines, []);
  assert.equal(model.meta.dialect, 'obsidian-core');
});
