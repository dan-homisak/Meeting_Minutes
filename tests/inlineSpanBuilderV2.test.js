import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInlineSpansForBlocks } from '../src/core/parser/InlineSpanBuilder.js';

test('buildInlineSpansForBlocks detects wikilink and embed spans', () => {
  const source = 'Reference [[Project Plan|Plan]] and ![[diagram.png]].';
  const blocks = [{ from: 0, to: source.length }];
  const spans = buildInlineSpansForBlocks(source, blocks);

  assert.ok(spans.some((span) => span.type === 'wikilink'));
  assert.ok(spans.some((span) => span.type === 'wikilink-target'));
  assert.ok(spans.some((span) => span.type === 'wikilink-alias'));
  assert.ok(spans.some((span) => span.type === 'embed'));
  assert.ok(spans.some((span) => span.type === 'embed-target'));
});
