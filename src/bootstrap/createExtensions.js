import { StateEffect } from '@codemirror/state';
import { createLivePreviewController as createLivePreviewControllerFactory } from '../live/livePreviewController.js';
import { createLiveEditorExtensions as createLiveEditorExtensionsFactory } from './createLiveEditorExtensions.js';

export function createExtensions({
  app,
  liveDebug,
  markdownEngine,
  documentSession,
  liveDebugKeylogKeys,
  liveRuntimeHelpers,
  factories = {}
} = {}) {
  const createRefreshLivePreviewEffect =
    factories.createRefreshLivePreviewEffect ?? (() => StateEffect.define());
  const createLivePreviewController =
    factories.createLivePreviewController ?? createLivePreviewControllerFactory;
  const createLiveEditorExtensions =
    factories.createLiveEditorExtensions ?? createLiveEditorExtensionsFactory;

  const refreshLivePreviewEffect = createRefreshLivePreviewEffect();
  const livePreviewController = createLivePreviewController({
    app,
    liveDebug,
    markdownEngine,
    documentSession,
    refreshLivePreviewEffect,
  });
  const livePreviewStateField = livePreviewController.livePreviewStateField;
  const { livePreviewPointerHandlers, livePreviewAtomicRanges } = createLiveEditorExtensions({
    app,
    liveDebug,
    liveDebugKeylogKeys,
    liveRuntimeHelpers
  });

  return {
    refreshLivePreviewEffect,
    livePreviewController,
    livePreviewStateField,
    livePreviewPointerHandlers,
    livePreviewAtomicRanges
  };
}
