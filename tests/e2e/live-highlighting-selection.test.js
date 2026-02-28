import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorSelection, EditorState, StateEffect } from '@codemirror/state';
import { createLivePreviewController } from '../../src/live/livePreviewController.js';

function createLiveDebugSpy() {
  const calls = {
    trace: [],
    warn: [],
    error: [],
    info: []
  };
  return {
    calls,
    trace(event, data) {
      calls.trace.push({ event, data });
    },
    warn(event, data) {
      calls.warn.push({ event, data });
    },
    error(event, data) {
      calls.error.push({ event, data });
    },
    info(event, data) {
      calls.info.push({ event, data });
    }
  };
}

test('same-line selection updates are skipped and cross-line updates rebuild decorations', () => {
  const liveDebug = createLiveDebugSpy();
  const refreshLivePreviewEffect = StateEffect.define();
  const controller = createLivePreviewController({
    app: { viewMode: 'live' },
    liveDebug,
    markdownEngine: {
      parse() {
        return [];
      }
    },
    refreshLivePreviewEffect
  });

  const state = EditorState.create({
    doc: 'alpha\nbeta\ngamma',
    selection: EditorSelection.cursor(1),
    extensions: [controller.livePreviewStateField]
  });
  const initialFieldState = state.field(controller.livePreviewStateField);

  const traceCountBeforeSameLine = liveDebug.calls.trace.length;
  const sameLineTransaction = state.update({
    selection: EditorSelection.cursor(2)
  });
  const sameLineFieldState = sameLineTransaction.state.field(controller.livePreviewStateField);
  const sameLineTraceEvents = liveDebug.calls.trace.slice(traceCountBeforeSameLine);
  const sameLineSkipped = sameLineTraceEvents.filter(
    (entry) => entry.event === 'plugin.update.selection-skipped'
  );
  const sameLineRebuild = sameLineTraceEvents.filter((entry) => entry.event === 'plugin.update');

  assert.equal(sameLineFieldState, initialFieldState);
  assert.equal(sameLineSkipped.length, 1);
  assert.equal(sameLineRebuild.length, 0);
  assert.equal(
    sameLineSkipped[0].data.previousSelectionLineFrom,
    sameLineSkipped[0].data.currentSelectionLineFrom
  );

  const traceCountBeforeLineChange = liveDebug.calls.trace.length;
  const lineChangeTransaction = sameLineTransaction.state.update({
    selection: EditorSelection.cursor(6)
  });
  const lineChangeFieldState = lineChangeTransaction.state.field(controller.livePreviewStateField);
  const lineChangeTraceEvents = liveDebug.calls.trace.slice(traceCountBeforeLineChange);
  const lineChangeRebuild = lineChangeTraceEvents.filter((entry) => entry.event === 'plugin.update');
  const lineChangeDecorations = lineChangeTraceEvents.filter(
    (entry) => entry.event === 'decorations.source-first-built'
  );

  assert.notEqual(lineChangeFieldState, sameLineFieldState);
  assert.equal(lineChangeRebuild.length, 1);
  assert.equal(lineChangeRebuild[0].data.selectionLineChanged, true);
  assert.notEqual(
    lineChangeRebuild[0].data.previousSelectionLineFrom,
    lineChangeRebuild[0].data.currentSelectionLineFrom
  );
  assert.equal(lineChangeDecorations.length, 1);
});
