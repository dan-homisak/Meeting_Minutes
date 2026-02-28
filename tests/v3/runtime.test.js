import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveRuntime } from '../../src/live-v4/LiveRuntime.js';

test('createLiveRuntime returns live-v4 state/pointer/cursor contracts', () => {
  const runtime = createLiveRuntime({
    app: {},
    liveDebug: { trace() {}, info() {}, warn() {}, error() {} }
  });

  assert.equal(typeof runtime.parser.ensureText, 'function');
  assert.equal(typeof runtime.renderer.buildRenderProjection, 'function');
  assert.equal(typeof runtime.requestRefresh, 'function');
  assert.equal(typeof runtime.readLiveState, 'function');
  assert.equal(typeof runtime.moveCursorVertically, 'function');
  assert.ok(runtime.liveStateField);
  assert.ok(runtime.livePointerHandlers);
  assert.ok(runtime.liveAtomicRanges);
});
