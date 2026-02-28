import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInteractionMap,
  findInteractionEntriesAtPosition,
  resolveInteractionSourceFromTarget
} from '../../src/live-v4/InteractionMap.js';

test('buildInteractionMap normalizes and deduplicates entries', () => {
  const map = buildInteractionMap([
    {
      kind: 'block',
      blockId: 'b1',
      fragmentId: 'f1',
      sourceFrom: 0,
      sourceTo: 8,
      priority: 140
    },
    {
      kind: 'block',
      blockId: 'b1',
      fragmentId: 'f1',
      sourceFrom: 0,
      sourceTo: 8,
      priority: 140
    }
  ]);

  assert.equal(map.length, 1);
  const entries = findInteractionEntriesAtPosition(map, 3);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].fragmentId, 'f1');
});

test('resolveInteractionSourceFromTarget uses direct source attrs and fragment fallback', () => {
  const map = buildInteractionMap([
    {
      kind: 'block',
      blockId: 'b1',
      fragmentId: 'frag-b1',
      sourceFrom: 10,
      sourceTo: 20,
      priority: 120
    }
  ]);

  const directTarget = {
    getAttribute(name) {
      if (name === 'data-src-from') {
        return '4';
      }
      if (name === 'data-src-to') {
        return '9';
      }
      return null;
    },
    closest() {
      return null;
    }
  };
  const directResolved = resolveInteractionSourceFromTarget(directTarget, map);
  assert.equal(directResolved.sourceFrom, 4);
  assert.equal(directResolved.sourceTo, 9);

  const fragmentTarget = {
    getAttribute(name) {
      if (name === 'data-fragment-id') {
        return 'frag-b1';
      }
      return null;
    },
    closest() {
      return null;
    }
  };
  const fragmentResolved = resolveInteractionSourceFromTarget(fragmentTarget, map);
  assert.equal(fragmentResolved.sourceFrom, 10);
  assert.equal(fragmentResolved.sourceTo, 20);
});
