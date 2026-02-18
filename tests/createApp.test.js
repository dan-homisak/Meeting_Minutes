import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/bootstrap/createApp.js';

test('createApp exports an app bootstrap function', () => {
  assert.equal(typeof createApp, 'function');
});
