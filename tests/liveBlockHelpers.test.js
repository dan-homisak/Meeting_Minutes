import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import {
  blockContainsLine,
  isFencedCodeBlock,
  shouldSkipEmptyTrailingBoundaryBlock,
  splitBlockAroundActiveLine
} from '../src/core/render/LiveBlockHelpers.js';

function docFrom(text) {
  return EditorState.create({ doc: text }).doc;
}

function renderStub(source) {
  return `<p>${source}</p>`;
}

test('splitBlockAroundActiveLine renders before and after fragments', () => {
  const doc = docFrom('# Title\nactive\nafter\n');
  const block = { from: 0, to: doc.length };
  const activeLine = doc.line(2);

  const fragments = splitBlockAroundActiveLine(doc, block, activeLine, renderStub);
  assert.equal(fragments.length, 2);
  assert.equal(doc.sliceString(fragments[0].from, fragments[0].to), '# Title\n');
  assert.equal(doc.sliceString(fragments[1].from, fragments[1].to), 'after\n');
});

test('isFencedCodeBlock detects and rejects partial fenced ranges', () => {
  const doc = docFrom('```js\nconst n = 1;\n```\n');
  const full = { from: 0, to: doc.length };
  const partial = { from: 0, to: doc.line(2).to };

  assert.equal(isFencedCodeBlock(doc, full), true);
  assert.equal(isFencedCodeBlock(doc, partial), false);
});

test('shouldSkipEmptyTrailingBoundaryBlock skips trailing empty boundary line', () => {
  const activeEmptyBoundaryLine = { from: 120, to: 120 };
  const trailingBoundaryBlock = { from: 80, to: 120 };

  assert.equal(
    shouldSkipEmptyTrailingBoundaryBlock(activeEmptyBoundaryLine, trailingBoundaryBlock, false),
    true
  );
});

test('blockContainsLine identifies overlap with line range', () => {
  const block = { from: 10, to: 20 };
  assert.equal(blockContainsLine(block, { from: 5, to: 10 }), true);
  assert.equal(blockContainsLine(block, { from: 20, to: 25 }), false);
});
