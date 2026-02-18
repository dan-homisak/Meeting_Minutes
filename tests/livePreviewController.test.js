import test from 'node:test';
import assert from 'node:assert/strict';
import { StateEffect } from '@codemirror/state';
import { createLivePreviewController } from '../src/live/livePreviewController.js';

function createLiveDebugStub() {
  return {
    trace() {},
    warn() {},
    error() {},
    info() {}
  };
}

test('requestLivePreviewRefresh emits trace and dispatches refresh effect', () => {
  const refreshLivePreviewEffect = StateEffect.define();
  const traceCalls = [];
  const liveDebug = {
    ...createLiveDebugStub(),
    trace(event, data) {
      traceCalls.push({ event, data });
    }
  };

  const controller = createLivePreviewController({
    app: { viewMode: 'live' },
    liveDebug,
    markdownEngine: {
      parse() {
        return [];
      }
    },
    renderMarkdownHtml() {
      return '';
    },
    normalizeLogString(value) {
      return String(value);
    },
    sourceFirstMode: true,
    refreshLivePreviewEffect
  });

  const dispatched = [];
  controller.requestLivePreviewRefresh(
    {
      dispatch(transaction) {
        dispatched.push(transaction);
      }
    },
    'manual'
  );

  assert.equal(traceCalls.length, 1);
  assert.equal(traceCalls[0].event, 'refresh.requested');
  assert.equal(traceCalls[0].data.mode, 'live');
  assert.equal(traceCalls[0].data.reason, 'manual');
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].effects.is(refreshLivePreviewEffect), true);
});

test('emitFenceVisibilityState is a no-op when not in live mode', () => {
  const controller = createLivePreviewController({
    app: { viewMode: 'raw' },
    liveDebug: createLiveDebugStub(),
    markdownEngine: {
      parse() {
        return [];
      }
    },
    renderMarkdownHtml() {
      return '';
    },
    normalizeLogString(value) {
      return String(value);
    },
    sourceFirstMode: true,
    refreshLivePreviewEffect: StateEffect.define()
  });

  assert.doesNotThrow(() => {
    controller.emitFenceVisibilityState(
      {
        state: {
          selection: { main: { head: 0 } },
          doc: {}
        }
      },
      'manual'
    );
  });
});
