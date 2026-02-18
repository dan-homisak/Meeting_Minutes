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
      { from: 12, to: 16, blockFrom: 10, blockTo: 20 },
      { from: 0, to: 8, blockFrom: 0, blockTo: 8 }
    ],
    activeLine: { from: 11, to: 14 }
  });

  assert.equal(sourceMapIndex.length, 4);
  assert.equal(sourceMapIndex[0].sourceFrom, 0);
  assert.equal(sourceMapIndex[1].sourceFrom, 0);
  assert.equal(sourceMapIndex[2].sourceFrom, 10);
  assert.equal(sourceMapIndex[3].sourceFrom, 12);
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
      { from: 0, to: 5 },
      { from: 0, to: 5 },
      { from: 6, to: 6 }
    ],
    renderedFragments: [
      { from: 1, to: 3, blockFrom: 0, blockTo: 5 },
      { from: 1, to: 3, blockFrom: 0, blockTo: 5 },
      { from: 2, to: 2, blockFrom: 0, blockTo: 5 }
    ]
  });

  assert.equal(sourceMapIndex.length, 2);
  assert.equal(sourceMapIndex[0].kind, 'block');
  assert.equal(sourceMapIndex[1].kind, 'rendered-fragment');
});

test('findSourceMapEntriesAtPosition returns covering entries for source position', () => {
  const sourceMapIndex = buildSourceMapIndex({
    blocks: [{ from: 0, to: 10 }],
    renderedFragments: [{ from: 2, to: 4, blockFrom: 0, blockTo: 10 }]
  });

  const matchesAtThree = findSourceMapEntriesAtPosition(sourceMapIndex, 3);
  assert.equal(matchesAtThree.length, 2);
  assert.equal(matchesAtThree[0].kind, 'block');
  assert.equal(matchesAtThree[1].kind, 'rendered-fragment');

  const matchesAtNine = findSourceMapEntriesAtPosition(sourceMapIndex, 9);
  assert.equal(matchesAtNine.length, 1);
  assert.equal(matchesAtNine[0].kind, 'block');
});
