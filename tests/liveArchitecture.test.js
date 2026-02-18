import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSourceFirstFlag,
  readStoredSourceFirstFlag,
  resolveLiveSourceFirstMode
} from '../src/liveArchitecture.js';

test('parseSourceFirstFlag supports truthy and falsy aliases', () => {
  assert.equal(parseSourceFirstFlag('true'), true);
  assert.equal(parseSourceFirstFlag('source-first'), true);
  assert.equal(parseSourceFirstFlag('legacy'), false);
  assert.equal(parseSourceFirstFlag('off'), false);
  assert.equal(parseSourceFirstFlag('unknown'), null);
});

test('readStoredSourceFirstFlag returns parsed value from storage', () => {
  const storage = {
    getItem(key) {
      assert.equal(key, 'meetingMinutes.liveSourceFirst');
      return 'source-first';
    }
  };

  assert.equal(readStoredSourceFirstFlag(storage), true);
});

test('resolveLiveSourceFirstMode prioritizes URL override over storage', () => {
  const storage = {
    getItem() {
      return 'legacy';
    }
  };

  const resolved = resolveLiveSourceFirstMode('?liveSourceFirst=true', storage);
  assert.equal(resolved.value, true);
  assert.equal(resolved.sourceFirstFromQuery, true);
  assert.equal(resolved.sourceFirstFromStorage, false);
});
