import test from 'node:test';
import assert from 'node:assert/strict';
import { createLivePreviewBridge } from '../src/live/livePreviewBridge.js';

test('requestLivePreviewRefresh delegates only when controller and view are available', () => {
  const refreshCalls = [];
  const controller = {
    requestLivePreviewRefresh(view, reason) {
      refreshCalls.push({ view, reason });
    }
  };
  const view = { id: 'editor-view' };
  let enabled = true;
  const bridge = createLivePreviewBridge({
    getLivePreviewController: () => (enabled ? controller : null),
    getEditorView: () => (enabled ? view : null)
  });

  bridge.requestLivePreviewRefresh('mode-change');
  enabled = false;
  bridge.requestLivePreviewRefresh('mode-change');

  assert.deepEqual(refreshCalls, [
    {
      view,
      reason: 'mode-change'
    }
  ]);
});

test('readLivePreviewState/liveBlocksForView/emitFenceVisibilityState delegate with fallbacks', () => {
  const emitted = [];
  const controller = {
    readLivePreviewState(state) {
      return {
        fromState: state.id
      };
    },
    liveBlocksForView(view) {
      return [{ from: 0, to: 10, viewId: view.id }];
    },
    liveSourceMapIndexForView(view) {
      return [{ sourceFrom: 0, sourceTo: 10, viewId: view.id }];
    },
    emitFenceVisibilityState(view, reason) {
      emitted.push({ view, reason });
    }
  };
  const bridge = createLivePreviewBridge({
    getLivePreviewController: () => controller,
    getEditorView: () => ({})
  });

  assert.deepEqual(bridge.readLivePreviewState({ id: 'state-1' }), {
    fromState: 'state-1'
  });
  assert.deepEqual(bridge.liveBlocksForView({ id: 'view-1' }), [
    { from: 0, to: 10, viewId: 'view-1' }
  ]);
  assert.deepEqual(bridge.liveSourceMapIndexForView({ id: 'view-1' }), [
    { sourceFrom: 0, sourceTo: 10, viewId: 'view-1' }
  ]);
  bridge.emitFenceVisibilityState({ id: 'view-2' }, 'selection-changed');
  assert.deepEqual(emitted, [
    {
      view: { id: 'view-2' },
      reason: 'selection-changed'
    }
  ]);

  const missingBridge = createLivePreviewBridge({
    getLivePreviewController: () => null,
    getEditorView: () => null
  });
  assert.equal(missingBridge.readLivePreviewState({ id: 'state-x' }), null);
  assert.deepEqual(missingBridge.liveBlocksForView({ id: 'view-x' }), []);
  assert.deepEqual(missingBridge.liveSourceMapIndexForView({ id: 'view-x' }), []);
});
