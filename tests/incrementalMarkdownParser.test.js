import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { createIncrementalMarkdownParser } from '../src/core/parser/IncrementalMarkdownParser.js';
import { createDocModel } from '../src/core/model/DocModel.js';
import { classifyEditorTransaction } from '../src/core/document/TransactionClassifier.js';
import { createMarkdownEngine } from '../src/markdownConfig.js';

test('parseFull builds block and inline models for markdown source', () => {
  const parser = createIncrementalMarkdownParser({
    markdownEngine: createMarkdownEngine()
  });

  const parsed = parser.parseFull('# Title\n\nParagraph with `code`.\n');
  assert.ok(parsed.blocks.length > 0);
  assert.ok(parsed.inlineSpans.some((span) => span.type === 'inline-code'));
  assert.equal(parsed.meta.parser, 'full');
});

test('parseIncremental reparses only an impacted window and matches full block ranges', () => {
  const markdownEngine = createMarkdownEngine();
  const parser = createIncrementalMarkdownParser({
    markdownEngine
  });
  const startText = [
    '# Title',
    '',
    'Paragraph one.',
    '',
    '## Heading',
    '',
    'Paragraph two.',
    '',
    'Paragraph three.'
  ].join('\n');
  const startState = EditorState.create({
    doc: startText
  });
  const replaceFrom = startText.indexOf('two');
  const replaceTo = replaceFrom + 'two'.length;
  const transaction = startState.update({
    changes: {
      from: replaceFrom,
      to: replaceTo,
      insert: 'TWO (edited)'
    }
  });
  const classification = classifyEditorTransaction(transaction);
  const previousParsed = parser.parseFull(startText, {
    reason: 'seed'
  });
  const previousModel = createDocModel({
    version: 1,
    text: startText,
    blocks: previousParsed.blocks,
    inlineSpans: previousParsed.inlineSpans
  });
  const nextText = transaction.state.doc.toString();

  const incrementalParsed = parser.parseIncremental({
    previousModel,
    nextText,
    changeRanges: classification.changeRanges,
    mapPosition: (position, assoc) => transaction.changes.mapPos(position, assoc)
  });
  const fullParsed = parser.parseFull(nextText, {
    reason: 'verification'
  });

  assert.equal(incrementalParsed.meta.parser, 'incremental');
  assert.ok(incrementalParsed.meta.reparsedCharLength < nextText.length);
  assert.deepEqual(incrementalParsed.blocks, fullParsed.blocks);
});

test('parseIncremental falls back to full parse when the reparse window exceeds budget', () => {
  const markdownEngine = createMarkdownEngine();
  const parser = createIncrementalMarkdownParser({
    markdownEngine,
    maxIncrementalWindowChars: 12
  });
  const startText = '# Title\n\nParagraph one.\n\nParagraph two.\n';
  const previousParsed = parser.parseFull(startText, {
    reason: 'seed'
  });
  const previousModel = createDocModel({
    version: 1,
    text: startText,
    blocks: previousParsed.blocks,
    inlineSpans: previousParsed.inlineSpans
  });
  const startState = EditorState.create({
    doc: startText
  });
  const transaction = startState.update({
    changes: {
      from: startText.indexOf('Paragraph'),
      to: startText.indexOf('two'),
      insert: 'Paragraph replacement that is long.'
    }
  });
  const classification = classifyEditorTransaction(transaction);

  const parsed = parser.parseIncremental({
    previousModel,
    nextText: transaction.state.doc.toString(),
    changeRanges: classification.changeRanges,
    mapPosition: (position, assoc) => transaction.changes.mapPos(position, assoc)
  });

  assert.equal(parsed.meta.parser, 'full');
  assert.equal(parsed.meta.reason, 'incremental-window-too-large');
});
