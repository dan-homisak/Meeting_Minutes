import { StateEffect } from '@codemirror/state';
import { createLivePreviewController as createLivePreviewControllerFactory } from '../live/livePreviewController.js';
import { createLiveEditorExtensions as createLiveEditorExtensionsFactory } from './createLiveEditorExtensions.js';

export function createExtensions({
  app,
  liveDebug,
  markdownEngine,
  renderMarkdownHtml,
  normalizeLogString,
  sourceFirstMode = true,
  fragmentCacheMax = 2500,
  slowBuildWarnMs = 12,
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
    renderMarkdownHtml,
    normalizeLogString,
    sourceFirstMode,
    refreshLivePreviewEffect,
    fragmentCacheMax,
    slowBuildWarnMs
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
