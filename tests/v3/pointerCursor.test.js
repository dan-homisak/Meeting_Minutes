import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { createPointerController } from '../../src/live-v4/PointerController.js';
import { createCursorController } from '../../src/live-v4/CursorController.js';

function createDoc(text) {
  const lines = text.split('\n');
  const records = [];
  let offset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index];
    const from = offset;
    const to = from + lineText.length;
    records.push({ from, to, number: index + 1, text: lineText });
    offset = to + 1;
  }

  return {
    get length() {
      return text.length;
    },
    get lines() {
      return records.length;
    },
    toString() {
      return text;
    },
    sliceString(from, to) {
      return text.slice(from, to);
    },
    line(number) {
      return records[number - 1];
    },
    lineAt(position) {
      const pos = Math.max(0, Math.min(text.length, Math.trunc(position)));
      for (let index = 0; index < records.length; index += 1) {
        const line = records[index];
        if (pos <= line.to) {
          return line;
        }
      }
      return records[records.length - 1];
    },
    applyChange(change) {
      text = text.slice(0, change.from) + change.insert + text.slice(change.to);
      return createDoc(text);
    }
  };
}

function createPointerView(text, interactionMap = []) {
  const doc = createDoc(text);
  let selectionHead = 0;
  let currentDoc = doc;
  const opened = [];

  const view = {
    state: {
      get doc() {
        return currentDoc;
      },
      get selection() {
        return {
          main: {
            anchor: selectionHead,
            head: selectionHead,
            empty: true
          }
        };
      }
    },
    contentDOM: {
      ownerDocument: {
        defaultView: {
          open(href) {
            opened.push(href);
          }
        }
      }
    },
    dispatch(transaction) {
      if (transaction.changes) {
        currentDoc = currentDoc.applyChange(transaction.changes);
        return;
      }
      if (transaction.selection && Number.isFinite(transaction.selection.head)) {
        selectionHead = transaction.selection.head;
      }
    },
    focus() {},
    posAtCoords() {
      return null;
    },
    posAtDOM() {
      return null;
    }
  };

  return {
    view,
    readDocText: () => currentDoc.toString(),
    readSelectionHead: () => selectionHead,
    opened,
    interactionMap
  };
}

test('pointer controller toggles task and modifier-opens links', () => {
  const ctx = createPointerView('- [ ] item');
  const controller = createPointerController({
    liveDebug: { trace() {}, warn() {} },
    readInteractionMapForView: () => ctx.interactionMap
  });

  const taskTarget = {
    checked: false,
    getAttribute(name) {
      if (name === 'data-task-source-from') {
        return '0';
      }
      return null;
    },
    closest(selector) {
      if (selector === '[data-task-source-from]') {
        return this;
      }
      return null;
    }
  };

  const taskEvent = {
    target: taskTarget,
    preventDefault() {}
  };

  const toggled = controller.handlePointer(ctx.view, taskEvent, 'mousedown');
  assert.equal(toggled, true);
  assert.equal(ctx.readDocText().includes('- [x] item'), true);

  const linkTarget = {
    getAttribute(name) {
      if (name === 'href') {
        return 'https://example.com';
      }
      return null;
    },
    closest(selector) {
      if (selector === '[data-task-source-from]') {
        return null;
      }
      if (selector === 'a[href]') {
        return this;
      }
      return null;
    }
  };

  const linkEvent = {
    target: linkTarget,
    metaKey: true,
    preventDefault() {}
  };

  const opened = controller.handlePointer(ctx.view, linkEvent, 'mousedown');
  assert.equal(opened, true);
  assert.deepEqual(ctx.opened, ['https://example.com']);
});

test('pointer controller maps rendered source attrs and cursor controller moves by line', () => {
  const ctx = createPointerView('# One\nTwo\nThree', [
    {
      id: 'entry1',
      kind: 'block',
      blockId: 'b1',
      fragmentId: 'frag-1',
      sourceFrom: 0,
      sourceTo: 5,
      priority: 140
    }
  ]);

  const pointer = createPointerController({
    liveDebug: { trace() {}, warn() {} },
    readInteractionMapForView: () => ctx.interactionMap
  });

  const target = {
    getAttribute(name) {
      if (name === 'data-src-from') {
        return '6';
      }
      if (name === 'data-src-to') {
        return '9';
      }
      return null;
    },
    closest(selector) {
      if (selector === '.mm-live-v4-block-widget') {
        return this;
      }
      if (selector === '[data-src-from][data-src-to], [data-fragment-id]') {
        return this;
      }
      return null;
    }
  };

  const activated = pointer.handlePointer(ctx.view, {
    target,
    preventDefault() {}
  }, 'mousedown');

  assert.equal(activated, true);
  assert.equal(ctx.readSelectionHead(), 6);

  const state = EditorState.create({
    doc: '# One\nTwo\nThree',
    selection: { anchor: 0 }
  });

  let activeState = state;
  const cursor = createCursorController({
    liveDebug: { trace() {} }
  });
  const cursorView = {
    get state() {
      return activeState;
    },
    dispatch(transaction) {
      activeState = activeState.update(transaction).state;
    },
    focus() {}
  };

  const moved = cursor.moveCursorVertically(cursorView, 1, 'ArrowDown');
  assert.equal(moved, true);
  assert.equal(activeState.selection.main.head > 0, true);
});

test('cursor controller skips list/task marker gap positions horizontally', () => {
  let activeState = EditorState.create({
    doc: '- [ ] Task item\n1. Numbered item\n- Bullet item',
    selection: { anchor: 0 }
  });

  const cursor = createCursorController({
    liveDebug: { trace() {} }
  });
  const cursorView = {
    get state() {
      return activeState;
    },
    dispatch(transaction) {
      activeState = activeState.update(transaction).state;
    },
    focus() {}
  };

  function setCursorByLineColumn(lineNumber, column) {
    const line = activeState.doc.line(lineNumber);
    const position = Math.min(line.to, line.from + Math.max(0, Math.trunc(column)));
    activeState = activeState.update({
      selection: {
        anchor: position,
        head: position
      }
    }).state;
    return position;
  }

  setCursorByLineColumn(1, 5);
  assert.equal(cursor.moveCursorHorizontally(cursorView, 1, 'ArrowRight'), true);
  assert.equal(activeState.selection.main.head, activeState.doc.line(1).from + 6);
  assert.equal(cursor.moveCursorHorizontally(cursorView, -1, 'ArrowLeft'), true);
  assert.equal(activeState.selection.main.head, activeState.doc.line(1).from + 5);

  setCursorByLineColumn(2, 2);
  assert.equal(cursor.moveCursorHorizontally(cursorView, 1, 'ArrowRight'), true);
  assert.equal(activeState.selection.main.head, activeState.doc.line(2).from + 3);
  assert.equal(cursor.moveCursorHorizontally(cursorView, -1, 'ArrowLeft'), true);
  assert.equal(activeState.selection.main.head, activeState.doc.line(2).from + 2);

  setCursorByLineColumn(3, 1);
  assert.equal(cursor.moveCursorHorizontally(cursorView, 1, 'ArrowRight'), true);
  assert.equal(activeState.selection.main.head, activeState.doc.line(3).from + 2);
  assert.equal(cursor.moveCursorHorizontally(cursorView, -1, 'ArrowLeft'), true);
  assert.equal(activeState.selection.main.head, activeState.doc.line(3).from + 1);
});

test('pointer controller passes through non-rendered targets to native editor behavior', () => {
  const ctx = createPointerView('# One\nTwo\nThree', []);
  const pointer = createPointerController({
    liveDebug: { trace() {}, warn() {} },
    readInteractionMapForView: () => ctx.interactionMap
  });

  const target = {
    closest(selector) {
      if (selector === '[data-task-source-from]') {
        return null;
      }
      if (selector === 'a[href]') {
        return null;
      }
      if (selector === '.mm-live-v4-block-widget') {
        return null;
      }
      if (selector === '[data-src-from][data-src-to], [data-fragment-id]') {
        return null;
      }
      return null;
    }
  };

  const handled = pointer.handlePointer(ctx.view, {
    target,
    preventDefault() {}
  }, 'mousedown');

  assert.equal(handled, false);
  assert.equal(ctx.readSelectionHead(), 0);
});
