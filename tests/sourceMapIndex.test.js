import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSourceMapIndex,
  findSourceMapEntriesAtPosition
} from '../src/core/mapping/SourceMapIndex.js';

test('buildSourceMapIndex creates deterministic sorted entries with active block flag', () => {
  const sourceMapIndex = buildSourceMapIndex({
    blocks: [
      { from: 10, to: 20 },
      { from: 0, to: 8 }
    ],
    renderedFragments: [
      { kind: 'line-fragment', sourceFrom: 12, sourceTo: 16, blockId: 'b1', fragmentId: 'f1' },
      { kind: 'line-fragment', sourceFrom: 0, sourceTo: 8, blockId: 'b0', fragmentId: 'f0' }
    ],
    activeLine: { from: 11, to: 14 }
  });

  assert.equal(sourceMapIndex.length, 4);
  assert.equal(sourceMapIndex.at(0).sourceFrom, 0);
  assert.equal(sourceMapIndex.at(-1).sourceFrom, 12);
  assert.equal(
    sourceMapIndex.some(
      (entry) => entry.kind === 'block' && entry.sourceFrom === 10 && entry.active === true
    ),
    true
  );
});

test('buildSourceMapIndex deduplicates repeated entries and ignores invalid ranges', () => {
  const sourceMapIndex = buildSourceMapIndex({
    blocks: [
      { id: 'same-block', from: 0, to: 5 },
      { id: 'same-block', from: 0, to: 5 },
      { from: 6, to: 6 }
    ],
    renderedFragments: [
      { kind: 'line-fragment', fragmentId: 'same-fragment', blockId: 'same-block', sourceFrom: 1, sourceTo: 3 },
      { kind: 'line-fragment', fragmentId: 'same-fragment', blockId: 'same-block', sourceFrom: 1, sourceTo: 3 },
      { kind: 'line-fragment', fragmentId: 'invalid-fragment', blockId: 'same-block', sourceFrom: 2, sourceTo: 2 }
    ]
  });

  assert.equal(sourceMapIndex.length, 2);
  assert.equal(sourceMapIndex.some((entry) => entry.kind === 'block'), true);
  assert.equal(sourceMapIndex.some((entry) => entry.kind === 'line-fragment'), true);
});

test('findSourceMapEntriesAtPosition returns covering entries for source position', () => {
  const sourceMapIndex = buildSourceMapIndex({
    blocks: [{ from: 0, to: 10 }],
    renderedFragments: [{ kind: 'line-fragment', sourceFrom: 2, sourceTo: 4, blockId: 'b0', fragmentId: 'f0' }]
  });

  const matchesAtThree = findSourceMapEntriesAtPosition(sourceMapIndex, 3);
  assert.equal(matchesAtThree.length, 2);
  assert.equal(matchesAtThree[0].kind, 'line-fragment');
  assert.equal(matchesAtThree[1].kind, 'block');

  const matchesAtNine = findSourceMapEntriesAtPosition(sourceMapIndex, 9);
  assert.equal(matchesAtNine.length, 1);
  assert.equal(matchesAtNine[0].kind, 'block');
});
