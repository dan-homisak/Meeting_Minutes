import test from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import {
  annotateMarkdownTokensWithSourceRanges,
  buildLineStartOffsets,
  resolveSourceRangeFromTokenMap
} from '../src/core/mapping/SourceRangeMapper.js';

test('buildLineStartOffsets tracks start offsets for each source line', () => {
  assert.deepEqual(buildLineStartOffsets('alpha\nbeta\n'), [0, 6, 11]);
  assert.deepEqual(buildLineStartOffsets('alpha\nbeta'), [0, 6, 10]);
  assert.deepEqual(buildLineStartOffsets(''), [0]);
});

test('resolveSourceRangeFromTokenMap converts token line map to absolute source range', () => {
  const offsets = buildLineStartOffsets('alpha\nbeta\ngamma\n');
  const range = resolveSourceRangeFromTokenMap([1, 3], offsets, 100, 117);

  assert.deepEqual(range, {
    from: 106,
    to: 117,
    startLine: 1,
    endLineExclusive: 3
  });

  assert.equal(resolveSourceRangeFromTokenMap([2, 2], offsets, 100, 117), null);
  assert.equal(resolveSourceRangeFromTokenMap([9, 10], offsets, 100, 117), null);
});

test('annotateMarkdownTokensWithSourceRanges applies source attributes to mapped markdown tokens', () => {
  const source = '## Heading\n\nParagraph line one.\nParagraph line two.\n';
  const sourceFrom = 200;
  const sourceTo = sourceFrom + source.length;
  const md = new MarkdownIt();
  const tokens = md.parse(source, {});

  const result = annotateMarkdownTokensWithSourceRanges(tokens, source, sourceFrom, sourceTo);
  assert.ok(result.annotatedCount > 0);

  const headingToken = tokens.find((token) => token.type === 'heading_open');
  const paragraphToken = tokens.find((token) => token.type === 'paragraph_open');
  assert.ok(headingToken);
  assert.ok(paragraphToken);

  assert.equal(Number(headingToken.attrGet('data-src-from')), 200);
  assert.equal(Number(headingToken.attrGet('data-src-to')), 211);
  assert.equal(Number(paragraphToken.attrGet('data-src-from')), 212);
  assert.equal(Number(paragraphToken.attrGet('data-src-to')), sourceTo);
});
