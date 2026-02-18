import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveSnapshotController } from '../src/live/liveSnapshotController.js';

function createLiveDebugSpy() {
  const calls = {
    trace: [],
    info: []
  };
  return {
    calls,
    trace(event, data) {
      calls.trace.push({ event, data });
    },
    info(event, data) {
      calls.info.push({ event, data });
    },
    getLevel() {
      return 'trace';
    }
  };
}

test('recordInputSignal stores signal and readRecentInputSignal respects TTL', () => {
  let now = 1000;
  const liveDebugDiagnostics = {
    lastInputSignal: null
  };
  const controller = createLiveSnapshotController({
    app: {},
    liveDebug: createLiveDebugSpy(),
    liveDebugDiagnostics,
    liveDebugInputTtlMs: 900,
    nowFn: () => now
  });

  const signal = controller.recordInputSignal('keyboard', {
    trigger: 'keydown',
    key: 'ArrowDown'
  });
  assert.equal(signal.at, 1000);
  assert.equal(signal.kind, 'keyboard');
  assert.equal(liveDebugDiagnostics.lastInputSignal.kind, 'keyboard');

  now = 1400;
  const recent = controller.readRecentInputSignal();
  assert.equal(recent.ageMs, 400);
  assert.equal(recent.key, 'ArrowDown');

  now = 2500;
  assert.equal(controller.readRecentInputSignal(), null);
});

test('captureLiveDebugSnapshot logs unavailable when editor view is missing', () => {
  const liveDebug = createLiveDebugSpy();
  const controller = createLiveSnapshotController({
    app: {
      viewMode: 'live',
      currentPath: 'notes/test.md',
      hasUnsavedChanges: false
    },
    liveDebug,
    liveDebugDiagnostics: {
      lastInputSignal: null
    },
    getEditorView() {
      return null;
    }
  });

  controller.captureLiveDebugSnapshot('manual');

  assert.equal(liveDebug.calls.trace.length, 1);
  assert.equal(liveDebug.calls.trace[0].event, 'snapshot.unavailable');
  assert.equal(liveDebug.calls.info.length, 0);
});

test('captureLiveDebugSnapshot logs editor context with active block and recent input', () => {
  let now = 2000;
  const liveDebug = createLiveDebugSpy();
  const doc = {
    length: 120,
    lines: 3,
    lineAt(position) {
      if (position < 40) {
        return { number: 1, from: 0, to: 39 };
      }
      if (position < 80) {
        return { number: 2, from: 40, to: 79 };
      }
      return { number: 3, from: 80, to: 119 };
    }
  };
  const controller = createLiveSnapshotController({
    app: {
      viewMode: 'live',
      currentPath: 'notes/test.md',
      hasUnsavedChanges: true
    },
    liveDebug,
    liveDebugDiagnostics: {
      lastInputSignal: null
    },
    liveDebugInputTtlMs: 900,
    getEditorView() {
      return {
        state: {
          doc,
          selection: {
            main: {
              anchor: 45,
              head: 45
            }
          }
        }
      };
    },
    readLivePreviewState() {
      return {
        blocks: [
          { from: 0, to: 30 },
          { from: 40, to: 80 }
        ]
      };
    },
    findBlockContainingPosition(blocks, position) {
      return blocks.find((block) => position >= block.from && position < block.to) ?? null;
    },
    findNearestBlockForPosition() {
      return null;
    },
    readDomSelectionForLog() {
      return { hasSelection: true };
    },
    getQueuedUploadEntryCount() {
      return 7;
    },
    nowFn: () => now
  });

  controller.recordInputSignal('keyboard', {
    trigger: 'keydown',
    key: 'ArrowDown'
  });
  now = 2150;
  controller.captureLiveDebugSnapshot('manual');

  assert.equal(liveDebug.calls.info.length, 1);
  const payload = liveDebug.calls.info[0];
  assert.equal(payload.event, 'snapshot.editor');
  assert.equal(payload.data.currentPath, 'notes/test.md');
  assert.equal(payload.data.docLength, 120);
  assert.equal(payload.data.lineCount, 3);
  assert.equal(payload.data.selectionHead, 45);
  assert.equal(payload.data.selectionLineNumber, 2);
  assert.equal(payload.data.blockCount, 2);
  assert.equal(payload.data.activeBlockFrom, 40);
  assert.equal(payload.data.activeBlockTo, 80);
  assert.equal(payload.data.queuedUploadEntries, 7);
  assert.equal(payload.data.recentInputKey, 'ArrowDown');
  assert.equal(payload.data.recentInputAgeMs, 150);
});
