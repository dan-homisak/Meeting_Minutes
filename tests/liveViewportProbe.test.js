import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveViewportProbe } from '../src/live/liveViewportProbe.js';

function rect({ left, top, width, height }) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height
  };
}

function createWindowStub() {
  return {
    getComputedStyle() {
      return {
        lineHeight: '18px',
        display: 'block',
        visibility: 'visible',
        whiteSpace: 'pre',
        fontSize: '14px',
        marginTop: '0px',
        marginBottom: '0px',
        paddingTop: '0px',
        paddingBottom: '0px',
        overflowY: 'visible'
      };
    }
  };
}

test('readCursorVisibilityForLog returns hasView false without editor view', () => {
  const probe = createLiveViewportProbe({
    normalizeLogString: (value) => String(value),
    windowObject: createWindowStub()
  });

  const result = probe.readCursorVisibilityForLog(null);
  assert.deepEqual(result, { hasView: false });
});

test('readCursorVisibilityForLog reports cursor and line metrics for active view', () => {
  const cursorElement = {
    getBoundingClientRect() {
      return rect({ left: 40, top: 20, width: 1, height: 16 });
    }
  };
  const activeLineElement = {
    textContent: '  active line text',
    getBoundingClientRect() {
      return rect({ left: 8, top: 18, width: 240, height: 20 });
    }
  };
  const view = {
    defaultLineHeight: 16,
    contentDOM: { id: 'content' },
    scrollDOM: {
      scrollTop: 24,
      scrollHeight: 400,
      clientHeight: 200,
      getBoundingClientRect() {
        return rect({ left: 0, top: 0, width: 300, height: 200 });
      }
    },
    dom: {
      querySelector(selector) {
        if (selector === '.cm-cursor') {
          return cursorElement;
        }
        if (selector === '.cm-activeLine') {
          return activeLineElement;
        }
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '.cm-cursor') {
          return [cursorElement];
        }
        return [];
      }
    },
    coordsAtPos() {
      return {
        left: 40,
        right: 41,
        top: 20,
        bottom: 36
      };
    },
    lineBlockAt() {
      return {
        from: 0,
        to: 12,
        top: 20,
        height: 16
      };
    }
  };
  const probe = createLiveViewportProbe({
    normalizeLogString: (value) => String(value).trim(),
    windowObject: createWindowStub()
  });

  const result = probe.readCursorVisibilityForLog(view, 4);

  assert.equal(result.hasView, true);
  assert.equal(result.cursorCount, 1);
  assert.equal(result.hasCursorElement, true);
  assert.equal(result.cursorHeight, 16);
  assert.equal(result.lineHeight, 18);
  assert.equal(result.lineHeightSource, 'content-style');
  assert.equal(result.activeLineElementPresent, true);
  assert.equal(result.activeLineTextPreview, 'active line text');
  assert.equal(result.inVerticalViewport, true);
  assert.equal(result.inHorizontalViewport, true);
});

test('readGutterVisibilityForLog counts visible gutter lines in viewport', () => {
  const gutters = {
    getBoundingClientRect() {
      return rect({ left: 0, top: 0, width: 34, height: 200 });
    }
  };
  const gutterElements = [
    {
      getBoundingClientRect() {
        return rect({ left: 0, top: 12, width: 20, height: 14 });
      }
    },
    {
      getBoundingClientRect() {
        return rect({ left: 0, top: 280, width: 20, height: 14 });
      }
    }
  ];
  const view = {
    scrollDOM: {
      getBoundingClientRect() {
        return rect({ left: 0, top: 0, width: 300, height: 200 });
      }
    },
    dom: {
      querySelector(selector) {
        if (selector === '.cm-gutters') {
          return gutters;
        }
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '.cm-lineNumbers .cm-gutterElement') {
          return gutterElements;
        }
        return [];
      }
    }
  };
  const probe = createLiveViewportProbe({
    normalizeLogString: (value) => String(value),
    windowObject: createWindowStub()
  });

  const result = probe.readGutterVisibilityForLog(view);

  assert.equal(result.hasView, true);
  assert.equal(result.hasGutters, true);
  assert.equal(result.totalLineNumberCount, 2);
  assert.equal(result.visibleLineNumberCount, 1);
  assert.equal(result.display, 'block');
  assert.equal(result.visibility, 'visible');
  assert.equal(result.width, 34);
});
