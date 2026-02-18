import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import {
  collectTopLevelBlocks,
  collectTopLevelBlocksFromTokens,
  lineIndexToPos
} from '../src/core/parser/BlockRangeCollector.js';

function docFrom(text) {
  return EditorState.create({ doc: text }).doc;
}

test('lineIndexToPos clamps line indexes to doc bounds', () => {
  const doc = docFrom('alpha\nbeta\ngamma\n');
  assert.equal(lineIndexToPos(doc, -2), 0);
  assert.equal(lineIndexToPos(doc, 0), 0);
  assert.equal(lineIndexToPos(doc, 1), doc.line(2).from);
  assert.equal(lineIndexToPos(doc, 99), doc.length);
});

test('collectTopLevelBlocksFromTokens merges overlaps and ignores duplicates', () => {
  const doc = docFrom('# One\nA\nB\nC\nD\n');
  const tokens = [
    { block: true, map: [0, 2], level: 0, nesting: 1 },
    { block: true, map: [0, 2], level: 0, nesting: 1 },
    { block: true, map: [1, 4], level: 0, nesting: 1 },
    { block: true, map: [4, 5], level: 0, nesting: 1 }
  ];

  const blocks = collectTopLevelBlocksFromTokens(doc, tokens);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { from: 0, to: doc.line(5).from });
  assert.deepEqual(blocks[1], { from: doc.line(5).from, to: doc.length });
});

test('collectTopLevelBlocks delegates token parsing and filters invalid spans', () => {
  const doc = docFrom('First\n\nLast\n');
  const blocks = collectTopLevelBlocks(doc, () => [
    { block: true, map: [0, 1], level: 0, nesting: 1 },
    { block: true, map: [1, 1], level: 0, nesting: 1 },
    { block: true, map: [2, 3], level: 0, nesting: 1 }
  ]);

  assert.equal(blocks.length, 2);
  assert.equal(doc.sliceString(blocks[0].from, blocks[0].to), 'First\n');
  assert.equal(doc.sliceString(blocks[1].from, blocks[1].to), 'Last\n');
});
