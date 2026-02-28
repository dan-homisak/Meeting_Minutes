import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBlockRangesFromMarkdown } from '../src/core/parser/BlockGraphBuilder.js';
import { createMarkdownEngine } from '../src/markdownConfig.js';

test('buildBlockRangesFromMarkdown keeps leading frontmatter as first block range', () => {
  const source = [
    '---',
    'title: demo',
    'tags: [a, b]',
    '---',
    '',
    '# Heading',
    '',
    'Body'
  ].join('\n');

  const ranges = buildBlockRangesFromMarkdown({
    markdownEngine: createMarkdownEngine(),
    source,
    offset: 0
  });

  assert.ok(ranges.length >= 2);
  const first = ranges[0];
  const frontmatterSource = source.slice(first.from, first.to);
  assert.match(frontmatterSource, /^---\n[\s\S]*\n---\n$/);
  assert.ok(ranges[1].from >= first.to);
});
