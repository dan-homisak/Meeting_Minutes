import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import {
  buildLiveBlockIndex,
  detectLiveBlockType,
  findBlockContainingPosition,
  findIndexedBlockAtPosition,
  readFenceVisibilityState
} from '../src/core/render/LiveBlockIndex.js';

function docFrom(text) {
  return EditorState.create({ doc: text }).doc;
}

test('detectLiveBlockType classifies heading/list/quote/fence/paragraph blocks', () => {
  const headingDoc = docFrom('## Heading\nParagraph\n');
  assert.equal(detectLiveBlockType(headingDoc, { from: 0, to: headingDoc.line(1).to + 1 }), 'heading');

  const listDoc = docFrom('- One\n- Two\n');
  assert.equal(detectLiveBlockType(listDoc, { from: 0, to: listDoc.length }), 'list');

  const quoteDoc = docFrom('> Quote\n> Quote 2\n');
  assert.equal(detectLiveBlockType(quoteDoc, { from: 0, to: quoteDoc.length }), 'blockquote');

  const fenceDoc = docFrom('```js\nconst n = 1;\n```\n');
  assert.equal(detectLiveBlockType(fenceDoc, { from: 0, to: fenceDoc.length }), 'fence');

  const paragraphDoc = docFrom('plain paragraph text\nsecond line\n');
  assert.equal(detectLiveBlockType(paragraphDoc, { from: 0, to: paragraphDoc.length }), 'paragraph');
});

test('buildLiveBlockIndex and findIndexedBlockAtPosition resolve in-range entries', () => {
  const doc = docFrom('# One\n\nParagraph\n');
  const blocks = [
    { from: 0, to: doc.line(1).to + 1 },
    { from: doc.line(3).from, to: doc.length }
  ];

  const blockIndex = buildLiveBlockIndex(doc, blocks);
  assert.equal(blockIndex.length, 2);
  assert.equal(blockIndex[0].type, 'heading');
  assert.equal(blockIndex[1].type, 'paragraph');
  assert.equal(findIndexedBlockAtPosition(blockIndex, 2), blockIndex[0]);
  assert.equal(findIndexedBlockAtPosition(blockIndex, doc.line(3).from + 1), blockIndex[1]);
});

test('findBlockContainingPosition returns matching range', () => {
  const blocks = [
    { from: 0, to: 10 },
    { from: 12, to: 20 }
  ];

  assert.equal(findBlockContainingPosition(blocks, 5), blocks[0]);
  assert.equal(findBlockContainingPosition(blocks, 10), null);
  assert.equal(findBlockContainingPosition(blocks, 19), blocks[1]);
});

test('readFenceVisibilityState reports inside/outside fenced block', () => {
  const doc = docFrom('Title\n\n```js\nconst n = 1;\n```\nAfter\n');
  const blocks = [
    { from: doc.line(1).from, to: doc.line(1).to + 1 },
    { from: doc.line(3).from, to: doc.line(5).to + 1 },
    { from: doc.line(6).from, to: doc.length }
  ];

  const insideState = readFenceVisibilityState(doc, blocks, doc.line(4).from + 1);
  assert.equal(insideState.insideFence, true);
  assert.equal(insideState.openingFenceVisible, true);
  assert.equal(insideState.closingFenceVisible, true);

  const outsideState = readFenceVisibilityState(doc, blocks, doc.line(1).from);
  assert.equal(outsideState.insideFence, false);
});
