import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import MarkdownIt from 'markdown-it';
import {
  annotateMarkdownTokensWithSourceRanges,
  buildLiveBlockIndex,
  buildLineStartOffsets,
  clampSelectionToBlockRange,
  collectTopLevelBlocksFromTokens,
  detectLiveBlockType,
  findBlockBySourceFrom,
  findBlockContainingPosition,
  findIndexedBlockAtPosition,
  findNearestBlockForPosition,
  isFencedCodeBlock,
  parseSourceFromAttribute,
  readFenceVisibilityState,
  resolveActivationBlockBounds,
  resolveLiveBlockSelection,
  resolveSourceRangeFromTokenMap,
  shouldPreferRenderedDomAnchorPosition,
  shouldPreferSourceFromForRenderedBoundaryClick,
  shouldPreferSourceFromForRenderedFencedClick,
  shouldSkipEmptyTrailingBoundaryBlock,
  splitBlockAroundActiveLine
} from '../src/livePreviewCore.js';

function docFrom(text) {
  return EditorState.create({ doc: text }).doc;
}

function renderStub(source) {
  return `<p>${source}</p>`;
}

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

test('collectTopLevelBlocksFromTokens ignores invalid and whitespace-only ranges', () => {
  const doc = docFrom('First\n\n\nLast\n');

  const tokens = [
    { block: true, map: [1, 3], level: 0, nesting: 1 },
    { block: true, map: [0, 1], level: 0, nesting: 1 },
    { block: true, map: [3, 4], level: 0, nesting: 1 },
    { block: true, map: [5, 2], level: 0, nesting: 1 },
    { block: true, map: [0, 1], level: 1, nesting: 1 },
    { block: true, map: [0, 1], level: 0, nesting: -1 }
  ];

  const blocks = collectTopLevelBlocksFromTokens(doc, tokens);
  assert.equal(blocks.length, 2);
  assert.equal(doc.sliceString(blocks[0].from, blocks[0].to), 'First\n');
  assert.equal(doc.sliceString(blocks[1].from, blocks[1].to), 'Last\n');
});

test('splitBlockAroundActiveLine returns before and after fragments around active line', () => {
  const doc = docFrom('# Title\nactive\nafter\nend');
  const block = { from: 0, to: doc.length };
  const activeLine = doc.line(2);

  const fragments = splitBlockAroundActiveLine(doc, block, activeLine, renderStub);

  assert.equal(fragments.length, 2);
  assert.equal(doc.sliceString(fragments[0].from, fragments[0].to), '# Title\n');
  assert.equal(doc.sliceString(fragments[1].from, fragments[1].to), 'after\nend');
});

test('splitBlockAroundActiveLine returns whole fragment when active line is outside block', () => {
  const doc = docFrom('# Title\nline\nline');
  const block = { from: doc.line(2).from, to: doc.length };
  const activeLine = doc.line(1);

  const fragments = splitBlockAroundActiveLine(doc, block, activeLine, renderStub);

  assert.equal(fragments.length, 1);
  assert.equal(doc.sliceString(fragments[0].from, fragments[0].to), 'line\nline');
});

test('splitBlockAroundActiveLine excludes blank active line and surrounding newline', () => {
  const doc = docFrom('alpha\n\nbeta\n');
  const block = { from: 0, to: doc.length };
  const activeLine = doc.line(2);

  const fragments = splitBlockAroundActiveLine(doc, block, activeLine, renderStub);

  assert.equal(fragments.length, 2);
  assert.equal(doc.sliceString(fragments[0].from, fragments[0].to), 'alpha\n');
  assert.equal(doc.sliceString(fragments[1].from, fragments[1].to), 'beta\n');
});

test('splitBlockAroundActiveLine keeps only trailing fragment when active line is block start', () => {
  const doc = docFrom('first\nsecond\nthird\n');
  const block = { from: 0, to: doc.length };
  const activeLine = doc.line(1);

  const fragments = splitBlockAroundActiveLine(doc, block, activeLine, renderStub);

  assert.equal(fragments.length, 1);
  assert.equal(doc.sliceString(fragments[0].from, fragments[0].to), 'second\nthird\n');
});

test('isFencedCodeBlock detects triple-backtick fenced blocks', () => {
  const doc = docFrom('```js\nconst total = 1;\n```\n');
  const block = { from: 0, to: doc.length };

  assert.equal(isFencedCodeBlock(doc, block), true);
});

test('isFencedCodeBlock rejects non-fenced and partial ranges', () => {
  const doc = docFrom('```js\nconst total = 1;\n```\n');
  const nonFenceBlock = { from: doc.line(2).from, to: doc.line(2).to };
  const partialFenceBlock = { from: 0, to: doc.line(2).to };

  assert.equal(isFencedCodeBlock(doc, nonFenceBlock), false);
  assert.equal(isFencedCodeBlock(doc, partialFenceBlock), false);
});

test('shouldSkipEmptyTrailingBoundaryBlock skips empty trailing boundary for all block types', () => {
  const activeEmptyBoundaryLine = { from: 120, to: 120 };
  const trailingBoundaryBlock = { from: 80, to: 120 };

  assert.equal(
    shouldSkipEmptyTrailingBoundaryBlock(activeEmptyBoundaryLine, trailingBoundaryBlock, false),
    true
  );
  assert.equal(
    shouldSkipEmptyTrailingBoundaryBlock(activeEmptyBoundaryLine, trailingBoundaryBlock, true),
    true
  );
});

test('shouldPreferSourceFromForRenderedFencedClick keeps fenced PRE/CODE clicks on source block near boundary drift', () => {
  assert.equal(
    shouldPreferSourceFromForRenderedFencedClick({
      targetTagName: 'pre',
      sourceFromBlockIsFencedCode: true,
      sourcePosDistanceToSourceFromBlock: 4,
      sourcePosLineDeltaAfterSourceFromBlock: 2
    }),
    true
  );

  assert.equal(
    shouldPreferSourceFromForRenderedFencedClick({
      targetTagName: 'h2',
      sourceFromBlockIsFencedCode: true,
      sourcePosDistanceToSourceFromBlock: 4,
      sourcePosLineDeltaAfterSourceFromBlock: 2
    }),
    false
  );

  assert.equal(
    shouldPreferSourceFromForRenderedFencedClick({
      targetTagName: 'pre',
      sourceFromBlockIsFencedCode: true,
      sourcePosDistanceToSourceFromBlock: 14,
      sourcePosLineDeltaAfterSourceFromBlock: 2
    }),
    false
  );

  assert.equal(
    shouldPreferSourceFromForRenderedFencedClick({
      targetTagName: 'pre',
      sourceFromBlockIsFencedCode: true,
      sourcePosDistanceToSourceFromBlock: 4,
      sourcePosLineDeltaAfterSourceFromBlock: -1
    }),
    false
  );
});

test('shouldPreferSourceFromForRenderedBoundaryClick keeps non-fenced heading/paragraph clicks on source block near lower boundary', () => {
  assert.equal(
    shouldPreferSourceFromForRenderedBoundaryClick({
      targetTagName: 'h2',
      sourceFromBlockIsFencedCode: false,
      sourcePosDistanceToSourceFromBlock: 7,
      sourcePosLineDeltaAfterSourceFromBlock: 2,
      pointerDistanceToBlockBottom: 4.29,
      pointerRatioY: 0.7789
    }),
    true
  );

  assert.equal(
    shouldPreferSourceFromForRenderedBoundaryClick({
      targetTagName: 'p',
      sourceFromBlockIsFencedCode: false,
      sourcePosDistanceToSourceFromBlock: 25,
      sourcePosLineDeltaAfterSourceFromBlock: 3,
      pointerDistanceToBlockBottom: 1.8,
      pointerRatioY: 0.964
    }),
    true
  );

  assert.equal(
    shouldPreferSourceFromForRenderedBoundaryClick({
      targetTagName: 'h2',
      sourceFromBlockIsFencedCode: true,
      sourcePosDistanceToSourceFromBlock: 7,
      sourcePosLineDeltaAfterSourceFromBlock: 2,
      pointerDistanceToBlockBottom: 4.29,
      pointerRatioY: 0.7789
    }),
    false
  );

  assert.equal(
    shouldPreferSourceFromForRenderedBoundaryClick({
      targetTagName: 'h2',
      sourceFromBlockIsFencedCode: false,
      sourcePosDistanceToSourceFromBlock: 31,
      sourcePosLineDeltaAfterSourceFromBlock: 2,
      pointerDistanceToBlockBottom: 4.29,
      pointerRatioY: 0.7789
    }),
    false
  );

  assert.equal(
    shouldPreferSourceFromForRenderedBoundaryClick({
      targetTagName: 'h2',
      sourceFromBlockIsFencedCode: false,
      sourcePosDistanceToSourceFromBlock: 7,
      sourcePosLineDeltaAfterSourceFromBlock: 4,
      pointerDistanceToBlockBottom: 4.29,
      pointerRatioY: 0.7789
    }),
    false
  );
});

test('shouldPreferRenderedDomAnchorPosition keeps rendered click anchored when coordinate mapping drifts out of block', () => {
  assert.equal(
    shouldPreferRenderedDomAnchorPosition({
      sourcePosDistanceToSourceFromBlock: 7,
      domTargetDistanceToSourceFromBlock: 0,
      domBlockDistanceToSourceFromBlock: 0
    }),
    true
  );

  assert.equal(
    shouldPreferRenderedDomAnchorPosition({
      sourcePosDistanceToSourceFromBlock: 25,
      domTargetDistanceToSourceFromBlock: null,
      domBlockDistanceToSourceFromBlock: 0
    }),
    true
  );

  assert.equal(
    shouldPreferRenderedDomAnchorPosition({
      sourcePosDistanceToSourceFromBlock: 0,
      domTargetDistanceToSourceFromBlock: 0,
      domBlockDistanceToSourceFromBlock: 0
    }),
    false
  );

  assert.equal(
    shouldPreferRenderedDomAnchorPosition({
      sourcePosDistanceToSourceFromBlock: 7,
      domTargetDistanceToSourceFromBlock: 2,
      domBlockDistanceToSourceFromBlock: 3
    }),
    false
  );

  assert.equal(
    shouldPreferRenderedDomAnchorPosition({
      sourcePosDistanceToSourceFromBlock: 48,
      domTargetDistanceToSourceFromBlock: 0,
      domBlockDistanceToSourceFromBlock: 0,
      maxSourcePosDistance: 40
    }),
    false
  );
});

test('resolveLiveBlockSelection falls back and clamps mapped positions', () => {
  assert.equal(resolveLiveBlockSelection(100, 10, Number.NaN), 10);
  assert.equal(resolveLiveBlockSelection(100, -5, Number.NaN), 0);
  assert.equal(resolveLiveBlockSelection(100, 10, 120), 100);
  assert.equal(resolveLiveBlockSelection(100, 10, 37.8), 37);
  assert.equal(resolveLiveBlockSelection(100, 10, 37.8, { from: 20, to: 30 }), 29);
  assert.equal(resolveLiveBlockSelection(100, 10, 8, { from: 20, to: 30 }), 20);
});

test('parseSourceFromAttribute parses valid numbers and rejects invalid values', () => {
  assert.equal(parseSourceFromAttribute('42'), 42);
  assert.equal(parseSourceFromAttribute('12.5'), 12.5);
  assert.equal(parseSourceFromAttribute('nan'), null);
  assert.equal(parseSourceFromAttribute(''), null);
  assert.equal(parseSourceFromAttribute(null), null);
});

test('findBlockContainingPosition and findBlockBySourceFrom resolve expected block', () => {
  const blocks = [
    { from: 0, to: 10 },
    { from: 12, to: 20 }
  ];

  assert.equal(findBlockContainingPosition(blocks, 5), blocks[0]);
  assert.equal(findBlockContainingPosition(blocks, 10), null);
  assert.equal(findBlockContainingPosition(blocks, 19), blocks[1]);
  assert.equal(findBlockBySourceFrom(blocks, 12), blocks[1]);
  assert.equal(findBlockBySourceFrom(blocks, 13), null);
});

test('findNearestBlockForPosition resolves boundary clicks with tolerance', () => {
  const blocks = [
    { from: 0, to: 10 },
    { from: 12, to: 20 }
  ];

  assert.equal(findNearestBlockForPosition(blocks, 10, 1), blocks[0]);
  assert.equal(findNearestBlockForPosition(blocks, 11, 1), blocks[1]);
  assert.equal(findNearestBlockForPosition(blocks, 20, 1), blocks[1]);
  assert.equal(findNearestBlockForPosition(blocks, 25, 1), null);
});

test('resolveActivationBlockBounds falls back from fragment sourceFrom to containing block', () => {
  const blocks = [
    { from: 0, to: 100 },
    { from: 180, to: 277 }
  ];

  assert.equal(resolveActivationBlockBounds(blocks, 180, null), blocks[1]);
  assert.equal(resolveActivationBlockBounds(blocks, 202, null), blocks[1]);
  assert.equal(resolveActivationBlockBounds(blocks, 999, 181), blocks[1]);
  assert.equal(resolveActivationBlockBounds(blocks, 999, 277), blocks[1]);
  assert.equal(resolveActivationBlockBounds(blocks, 999, 400), null);
});

test('clampSelectionToBlockRange constrains selection to block interior', () => {
  const block = { from: 20, to: 30 };

  assert.equal(clampSelectionToBlockRange(100, 25, block), 25);
  assert.equal(clampSelectionToBlockRange(100, 7, block), 20);
  assert.equal(clampSelectionToBlockRange(100, 88, block), 29);
  assert.equal(clampSelectionToBlockRange(100, 88, null), 88);
});

test('detectLiveBlockType classifies headings, lists, quotes, fences, and paragraphs', () => {
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

test('buildLiveBlockIndex returns stable ids and line bounds', () => {
  const doc = docFrom('## Heading\n\nParagraph one\n\n```js\nconst n = 1;\n```\n');
  const blocks = [
    { from: 0, to: doc.line(1).to + 1 },
    { from: doc.line(3).from, to: doc.line(3).to + 1 },
    { from: doc.line(5).from, to: doc.length }
  ];

  const index = buildLiveBlockIndex(doc, blocks);
  assert.equal(index.length, 3);
  assert.equal(index[0].type, 'heading');
  assert.equal(index[1].type, 'paragraph');
  assert.equal(index[2].type, 'fence');
  assert.ok(typeof index[0].id === 'string' && index[0].id.length > 0);
  assert.equal(index[2].startLineNumber, 5);
  assert.equal(index[2].endLineNumber, 7);
});

test('findIndexedBlockAtPosition resolves in-range and boundary positions', () => {
  const blockIndex = [
    { id: 'a', from: 0, to: 10, type: 'paragraph' },
    { id: 'b', from: 12, to: 20, type: 'paragraph' }
  ];

  assert.equal(findIndexedBlockAtPosition(blockIndex, 5), blockIndex[0]);
  assert.equal(findIndexedBlockAtPosition(blockIndex, 11), blockIndex[1]);
  assert.equal(findIndexedBlockAtPosition(blockIndex, 40), null);
});

test('readFenceVisibilityState reports fence marker visibility while cursor is inside fenced block', () => {
  const doc = docFrom('Before\n\n```js\nconst total = 1;\n```\n\nAfter\n');
  const fencedBlock = { from: doc.line(3).from, to: doc.line(5).to + 1 };
  const blocks = [
    { from: 0, to: doc.line(1).to + 1 },
    fencedBlock,
    { from: doc.line(7).from, to: doc.length }
  ];

  const insideState = readFenceVisibilityState(doc, blocks, doc.line(4).from + 2);
  assert.equal(insideState.insideFence, true);
  assert.equal(insideState.openingFenceLineNumber, 3);
  assert.equal(insideState.closingFenceLineNumber, 5);
  assert.equal(insideState.openingFenceVisible, true);
  assert.equal(insideState.closingFenceVisible, true);

  const outsideState = readFenceVisibilityState(doc, blocks, doc.line(1).from);
  assert.equal(outsideState.insideFence, false);
});
