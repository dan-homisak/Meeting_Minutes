import { StateEffect } from '@codemirror/state';
import { createLivePreviewController as createLivePreviewControllerFactory } from '../live/livePreviewController.js';
import { createLiveEditorExtensions as createLiveEditorExtensionsFactory } from './createLiveEditorExtensions.js';

export function createExtensions({
  app,
  liveDebug,
  markdownEngine,
  documentSession,
  renderMarkdownHtml,
  normalizeLogString,
  sourceFirstMode = true,
  fragmentCacheMax = 2500,
  slowBuildWarnMs = 12,
  viewportLineBuffer = 8,
  viewportMinimumLineSpan = 24,
  maxViewportBlocks = 160,
  maxViewportCharacters = 24000,
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
    renderMarkdownHtml,
    normalizeLogString,
    sourceFirstMode,
    refreshLivePreviewEffect,
    fragmentCacheMax,
    slowBuildWarnMs,
    viewportLineBuffer,
    viewportMinimumLineSpan,
    maxViewportBlocks,
    maxViewportCharacters
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
