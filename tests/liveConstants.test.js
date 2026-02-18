import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAUNCHER_HEARTBEAT_MS,
  LIVE_DEBUG_INPUT_TTL_MS,
  LIVE_DEBUG_KEYLOG_KEYS,
  LIVE_PREVIEW_FRAGMENT_CACHE_MAX,
  NAVIGATION_KEYS
} from '../src/bootstrap/liveConstants.js';

test('live constants expose expected key timings and key sets', () => {
  assert.equal(LAUNCHER_HEARTBEAT_MS, 4000);
  assert.equal(LIVE_PREVIEW_FRAGMENT_CACHE_MAX, 2500);
  assert.equal(LIVE_DEBUG_INPUT_TTL_MS, 900);

  assert.equal(NAVIGATION_KEYS.has('ArrowUp'), true);
  assert.equal(NAVIGATION_KEYS.has('ArrowDown'), true);
  assert.equal(NAVIGATION_KEYS.has('Home'), true);
  assert.equal(LIVE_DEBUG_KEYLOG_KEYS.has('ArrowUp'), true);
  assert.equal(LIVE_DEBUG_KEYLOG_KEYS.has('Enter'), true);
  assert.equal(LIVE_DEBUG_KEYLOG_KEYS.has('Escape'), true);
  assert.equal(LIVE_DEBUG_KEYLOG_KEYS.has('a'), false);
});
