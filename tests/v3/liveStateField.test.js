import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import { createLiveStateField } from '../../src/live-v3/LiveStateField.js';

function createModel(text, version = 1) {
  return {
    version,
    text,
    blocks: [
      {
        id: 'b1',
        type: 'paragraph',
        from: 0,
        to: text.length,
        lineFrom: 1,
        lineTo: 1,
        depth: null,
        attrs: {}
      }
    ],
    inlines: [],
    meta: {
      dialect: 'obsidian-core',
      parser: 'full',
      reparsedFrom: null,
      reparsedTo: null
    }
  };
}

test('live state field tracks model/projection and updates on doc changes + refresh', () => {
  let version = 1;
  const parser = {
    ensureText(text) {
      return {
        model: createModel(text, version)
      };
    },
    applyEditorTransaction(transaction) {
      version += 1;
      return {
        model: createModel(transaction.state.doc.toString(), version)
      };
    },
    getModel() {
      return createModel('', version);
    }
  };

  const renderer = {
    buildRenderProjection(state, model, viewportWindow) {
      return {
        activeBlockId: model.blocks[0]?.id ?? null,
        renderedBlocks: [],
        interactionMap: [],
        metrics: {
          renderedBlockCount: 0,
          virtualizedBlockCount: 1,
          budgetTruncated: false,
          renderMs: 0
        },
        viewportWindow: viewportWindow ?? { from: 0, to: state.doc.length },
        decorations: Decoration.none
      };
    }
  };

  const live = createLiveStateField({
    parser,
    renderer,
    liveDebug: { trace() {} }
  });

  const state = EditorState.create({
    doc: 'alpha',
    extensions: [live.liveStateField]
  });

  const initial = state.field(live.liveStateField);
  assert.equal(initial.model.text, 'alpha');
  assert.equal(initial.version, 1);

  const updatedState = state.update({
    changes: { from: 5, to: 5, insert: ' beta' }
  }).state;
  const updated = updatedState.field(live.liveStateField);
  assert.equal(updated.model.text, 'alpha beta');
  assert.equal(updated.version > initial.version, true);

  const refreshDispatches = [];
  live.requestRefresh(
    {
      state: updatedState,
      dispatch(transaction) {
        refreshDispatches.push(transaction);
      }
    },
    'manual'
  );
  assert.equal(refreshDispatches.length, 1);
  assert.equal(refreshDispatches[0].effects.is(live.refreshEffect), true);
});
