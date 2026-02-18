import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveControllerOptions } from '../src/bootstrap/createLiveControllerOptions.js';

test('createLiveControllerOptions composes config, helper delegates, and runtime', () => {
  const sentinel = {
    normalizeLogString: () => {},
    liveRuntimeHelpers: {
      readLineInfoForPosition: () => {},
      clampNumber: () => {},
      readBlockLineBoundsForLog: () => {},
      buildCoordSamples: () => {},
      resolvePointerPosition: () => {},
      summarizeRectForLog: () => {},
      readComputedStyleSnapshotForLog: () => {},
      liveBlocksForView: () => {},
      normalizePointerTarget: () => {},
      readPointerCoordinates: () => {},
      describeElementForLog: () => {},
      recordInputSignal: () => {},
      findRenderedSourceRangeTarget: () => {},
      resolvePositionFromRenderedSourceRange: () => {},
      distanceToBlockBounds: () => {},
      buildRenderedPointerProbe: () => {},
      summarizeLineNumbersForCoordSamples: () => {},
      readCursorVisibilityForLog: () => {},
      readDomSelectionForLog: () => {},
      readGutterVisibilityForLog: () => {},
      requestLivePreviewRefresh: () => {},
      captureLiveDebugSnapshot: () => {},
      scheduleCursorVisibilityProbe: () => {},
      isCursorVisibilitySuspect: () => {},
      moveLiveCursorVertically: () => {},
      readRecentInputSignal: () => {},
      liveSourceMapIndexForView: () => {},
      emitFenceVisibilityState: () => {}
    },
    resolveActivationBlockBounds: () => {},
    resolveLiveBlockSelection: () => {},
    findBlockContainingPosition: () => {},
    findNearestBlockForPosition: () => {},
    isFencedCodeBlock: () => {},
    parseSourceFromAttribute: () => {},
    shouldPreferRenderedDomAnchorPosition: () => {},
    shouldPreferSourceFromForRenderedFencedClick: () => {},
    shouldPreferSourceFromForRenderedBoundaryClick: () => {},
    isRefreshEffect: () => {},
    renderPreview: () => {},
    updateActionButtons: () => {},
    setStatus: () => {},
    scheduleAutosave: () => {},
    readDocumentModel: () => {},
    requestAnimationFrameFn: () => {},
    createCursorSelection: () => {},
    nowFn: () => {},
    transactionUserEventAnnotation: { id: 'user-event' },
    performanceObserverClass: class PerformanceObserverStub {},
    elementConstructor: class ElementStub {},
    nodeConstructor: class NodeStub {}
  };
  const options = createLiveControllerOptions({
    app: { id: 'app' },
    liveDebug: { id: 'live-debug' },
    liveDebugDiagnostics: { id: 'diagnostics' },
    sourceFirstMode: false,
    config: { id: 'config' },
    normalizeLogString: sentinel.normalizeLogString,
    liveRuntimeHelpers: sentinel.liveRuntimeHelpers,
    resolveActivationBlockBounds: sentinel.resolveActivationBlockBounds,
    resolveLiveBlockSelection: sentinel.resolveLiveBlockSelection,
    findBlockContainingPosition: sentinel.findBlockContainingPosition,
    findNearestBlockForPosition: sentinel.findNearestBlockForPosition,
    isFencedCodeBlock: sentinel.isFencedCodeBlock,
    parseSourceFromAttribute: sentinel.parseSourceFromAttribute,
    shouldPreferRenderedDomAnchorPosition: sentinel.shouldPreferRenderedDomAnchorPosition,
    shouldPreferSourceFromForRenderedFencedClick:
      sentinel.shouldPreferSourceFromForRenderedFencedClick,
    shouldPreferSourceFromForRenderedBoundaryClick:
      sentinel.shouldPreferSourceFromForRenderedBoundaryClick,
    isRefreshEffect: sentinel.isRefreshEffect,
    renderPreview: sentinel.renderPreview,
    updateActionButtons: sentinel.updateActionButtons,
    setStatus: sentinel.setStatus,
    scheduleAutosave: sentinel.scheduleAutosave,
    readDocumentModel: sentinel.readDocumentModel,
    windowObject: { id: 'window' },
    documentObject: { id: 'document' },
    requestAnimationFrameFn: sentinel.requestAnimationFrameFn,
    createCursorSelection: sentinel.createCursorSelection,
    transactionUserEventAnnotation: sentinel.transactionUserEventAnnotation,
    performanceObserverClass: sentinel.performanceObserverClass,
    elementConstructor: sentinel.elementConstructor,
    nodeConstructor: sentinel.nodeConstructor,
    nowFn: sentinel.nowFn
  });

  assert.equal(options.app.id, 'app');
  assert.equal(options.liveDebug.id, 'live-debug');
  assert.equal(options.liveDebugDiagnostics.id, 'diagnostics');
  assert.equal(options.sourceFirstMode, false);
  assert.equal(options.config.id, 'config');

  assert.equal(options.helpers.normalizeLogString, sentinel.normalizeLogString);
  assert.equal(options.helpers.readLineInfoForPosition, sentinel.liveRuntimeHelpers.readLineInfoForPosition);
  assert.equal(options.helpers.findBlockContainingPosition, sentinel.findBlockContainingPosition);
  assert.equal(options.helpers.shouldPreferRenderedDomAnchorPosition, sentinel.shouldPreferRenderedDomAnchorPosition);
  assert.equal(options.helpers.isRefreshEffect, sentinel.isRefreshEffect);
  assert.equal(options.helpers.renderPreview, sentinel.renderPreview);
  assert.equal(options.helpers.scheduleAutosave, sentinel.scheduleAutosave);
  assert.equal(options.helpers.readDocumentModel, sentinel.readDocumentModel);
  assert.equal(
    options.helpers.liveSourceMapIndexForView,
    sentinel.liveRuntimeHelpers.liveSourceMapIndexForView
  );

  assert.equal(options.runtime.windowObject.id, 'window');
  assert.equal(options.runtime.documentObject.id, 'document');
  assert.equal(options.runtime.requestAnimationFrameFn, sentinel.requestAnimationFrameFn);
  assert.equal(options.runtime.createCursorSelection, sentinel.createCursorSelection);
  assert.equal(options.runtime.transactionUserEventAnnotation, sentinel.transactionUserEventAnnotation);
  assert.equal(options.runtime.performanceObserverClass, sentinel.performanceObserverClass);
  assert.equal(options.runtime.elementConstructor, sentinel.elementConstructor);
  assert.equal(options.runtime.nodeConstructor, sentinel.nodeConstructor);
  assert.equal(options.runtime.nowFn, sentinel.nowFn);
});
