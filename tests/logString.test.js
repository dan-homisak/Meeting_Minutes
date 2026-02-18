import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLogString } from '../src/live/logString.js';

test('normalizeLogString handles non-strings, whitespace compaction, and truncation', () => {
  assert.equal(normalizeLogString(null), '');
  assert.equal(normalizeLogString(42), '');
  assert.equal(normalizeLogString('  hello   world  '), 'hello world');
  assert.equal(normalizeLogString('abcdef', 6), 'abcdef');
  assert.equal(normalizeLogString('abcdefghijklmnopqrstuvwxyz', 10), 'abcdefghij...');
});
