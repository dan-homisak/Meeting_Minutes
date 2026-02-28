import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import {
  blockContainsLine,
  isFencedCodeBlock
} from '../src/core/render/LiveBlockHelpers.js';

function docFrom(text) {
  return EditorState.create({ doc: text }).doc;
}

test('isFencedCodeBlock detects and rejects partial fenced ranges', () => {
  const doc = docFrom('```js\nconst n = 1;\n```\n');
  const full = { from: 0, to: doc.length };
  const partial = { from: 0, to: doc.line(2).to };

  assert.equal(isFencedCodeBlock(doc, full), true);
  assert.equal(isFencedCodeBlock(doc, partial), false);
});

test('blockContainsLine identifies overlap with line range', () => {
  const block = { from: 10, to: 20 };
  assert.equal(blockContainsLine(block, { from: 5, to: 10 }), true);
  assert.equal(blockContainsLine(block, { from: 20, to: 25 }), false);
});
