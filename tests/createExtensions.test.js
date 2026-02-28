import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensions } from '../src/bootstrap/createExtensions.js';

test('createExtensions composes refresh effect, live preview controller, and editor extensions', () => {
  const calls = {
    createRefreshLivePreviewEffect: 0,
    createLivePreviewController: [],
    createLiveEditorExtensions: []
  };
  const refreshLivePreviewEffect = { id: 'refresh-effect' };
  const livePreviewStateField = { id: 'state-field' };
  const livePreviewController = { id: 'preview-controller', livePreviewStateField };
  const livePreviewPointerHandlers = { id: 'pointer-handlers' };
  const livePreviewAtomicRanges = { id: 'atomic-ranges' };
  const app = { id: 'app' };
  const liveDebug = { id: 'live-debug' };
  const markdownEngine = { id: 'markdown-engine' };
  const documentSession = { id: 'document-session' };
  const liveRuntimeHelpers = { id: 'runtime-helpers' };
  const liveDebugKeylogKeys = new Set(['Enter']);

  const extensions = createExtensions({
    app,
    liveDebug,
    markdownEngine,
    documentSession,
    liveDebugKeylogKeys,
    liveRuntimeHelpers,
    factories: {
      createRefreshLivePreviewEffect() {
        calls.createRefreshLivePreviewEffect += 1;
        return refreshLivePreviewEffect;
      },
      createLivePreviewController(args) {
        calls.createLivePreviewController.push(args);
        return livePreviewController;
      },
      createLiveEditorExtensions(args) {
        calls.createLiveEditorExtensions.push(args);
        return {
          livePreviewPointerHandlers,
          livePreviewAtomicRanges
        };
      }
    }
  });

  assert.equal(calls.createRefreshLivePreviewEffect, 1);
  assert.equal(calls.createLivePreviewController.length, 1);
  assert.equal(calls.createLiveEditorExtensions.length, 1);
  assert.equal(calls.createLivePreviewController[0].app, app);
  assert.equal(calls.createLivePreviewController[0].liveDebug, liveDebug);
  assert.equal(calls.createLivePreviewController[0].markdownEngine, markdownEngine);
  assert.equal(calls.createLivePreviewController[0].documentSession, documentSession);
  assert.equal(calls.createLivePreviewController[0].refreshLivePreviewEffect, refreshLivePreviewEffect);
  assert.equal(calls.createLiveEditorExtensions[0].app, app);
  assert.equal(calls.createLiveEditorExtensions[0].liveDebug, liveDebug);
  assert.equal(calls.createLiveEditorExtensions[0].liveDebugKeylogKeys, liveDebugKeylogKeys);
  assert.equal(calls.createLiveEditorExtensions[0].liveRuntimeHelpers, liveRuntimeHelpers);

  assert.equal(extensions.refreshLivePreviewEffect, refreshLivePreviewEffect);
  assert.equal(extensions.livePreviewController, livePreviewController);
  assert.equal(extensions.livePreviewStateField, livePreviewStateField);
  assert.equal(extensions.livePreviewPointerHandlers, livePreviewPointerHandlers);
  assert.equal(extensions.livePreviewAtomicRanges, livePreviewAtomicRanges);
});
