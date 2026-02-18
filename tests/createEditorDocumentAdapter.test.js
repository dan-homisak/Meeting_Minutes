import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorDocumentAdapter } from '../src/bootstrap/createEditorDocumentAdapter.js';

test('createEditorDocumentAdapter reads and writes editor document with diagnostics', () => {
  const traces = [];
  const dispatches = [];
  const app = {
    isLoadingFile: false
  };
  const liveDebugDiagnostics = {
    lastProgrammaticSelectionAt: 0
  };
  const editorView = {
    state: {
      doc: {
        length: 5,
        value: 'hello',
        toString() {
          return this.value;
        }
      },
      selection: {
        main: {
          head: 2
        }
      }
    },
    dispatch(payload) {
      dispatches.push(payload);
      this.state.doc.value = payload.changes.insert;
      this.state.doc.length = payload.changes.insert.length;
      this.state.selection.main.head = payload.selection.anchor;
    }
  };

  const adapter = createEditorDocumentAdapter({
    app,
    liveDebug: {
      trace(event, data) {
        traces.push({ event, data });
      }
    },
    liveDebugDiagnostics,
    getEditorView: () => editorView,
    nowFn: () => 99
  });

  assert.equal(adapter.getEditorText(), 'hello');
  adapter.setEditorText('updated');

  assert.equal(app.isLoadingFile, false);
  assert.equal(liveDebugDiagnostics.lastProgrammaticSelectionAt, 99);
  assert.equal(dispatches.length, 1);
  assert.deepEqual(dispatches[0], {
    changes: {
      from: 0,
      to: 5,
      insert: 'updated'
    },
    selection: {
      anchor: 0
    },
    scrollIntoView: true
  });
  assert.equal(editorView.state.doc.toString(), 'updated');
  assert.equal(editorView.state.selection.main.head, 0);
  assert.deepEqual(traces, [
    {
      event: 'editor.text.set.programmatic',
      data: {
        previousLength: 5,
        nextLength: 7,
        previousHead: 2,
        nextHead: 0
      }
    }
  ]);
});
