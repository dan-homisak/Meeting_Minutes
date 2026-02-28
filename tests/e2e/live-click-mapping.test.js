import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveEditorExtensions } from '../../src/bootstrap/createLiveEditorExtensions.js';
import { createPointerActivationController } from '../../src/core/selection/ActivationController.js';

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

function createDoc(text) {
  const lines = text.split('\n');
  const lineRecords = [];
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index];
    const from = offset;
    const to = from + lineText.length;
    lineRecords.push({
      from,
      to,
      number: index + 1,
      text: lineText
    });
    offset = to + 1;
  }

  const length = text.length;
  return {
    length,
    lines: lineRecords.length,
    sliceString(from, to) {
      return text.slice(from, to);
    },
    line(number) {
      return lineRecords[number - 1];
    },
    lineAt(position) {
      const clamped = Math.max(0, Math.min(length, Math.trunc(position)));
      for (let index = 0; index < lineRecords.length; index += 1) {
        const line = lineRecords[index];
        const nextLine = lineRecords[index + 1] ?? null;
        if (clamped <= line.to) {
          return line;
        }
        if (nextLine && clamped < nextLine.from) {
          return line;
        }
      }
      return lineRecords[lineRecords.length - 1];
    }
  };
}

function createView({
  text = 'alpha\nbeta\ngamma',
  head = 0,
  mappedPos = 0
} = {}) {
  const doc = createDoc(text);
  const dispatched = [];
  let focusCount = 0;
  let mappedPosition = mappedPos;

  const view = {
    state: {
      doc,
      selection: {
        main: {
          anchor: head,
          head,
          empty: true
        }
      }
    },
    dispatch(transaction) {
      dispatched.push(transaction);
      if (!transaction?.selection) {
        return;
      }
      const selection = transaction.selection;
      if (selection.main) {
        this.state.selection = selection;
        return;
      }
      const anchor = Number.isFinite(selection.anchor) ? selection.anchor : null;
      const headPosition = Number.isFinite(selection.head) ? selection.head : anchor;
      if (anchor === null || headPosition === null) {
        return;
      }
      this.state.selection = {
        main: {
          anchor,
          head: headPosition,
          empty: anchor === headPosition
        }
      };
    },
    focus() {
      focusCount += 1;
    },
    posAtCoords() {
      return mappedPosition;
    },
    posAtDOM() {
      return mappedPosition;
    },
    setMappedPosition(nextMappedPosition) {
      mappedPosition = nextMappedPosition;
    }
  };

  return {
    view,
    dispatched,
    readFocusCount: () => focusCount
  };
}

function distanceToBlockBounds(position, blockBounds) {
  if (!Number.isFinite(position) || !blockBounds) {
    return null;
  }
  if (position < blockBounds.from) {
    return blockBounds.from - position;
  }
  if (position >= blockBounds.to) {
    return position - (blockBounds.to - 1);
  }
  return 0;
}

function resolveNearestBlock(blocks, position) {
  if (!Array.isArray(blocks) || blocks.length === 0 || !Number.isFinite(position)) {
    return null;
  }

  let nearestBlock = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const block of blocks) {
    const distance = distanceToBlockBounds(position, block);
    if (distance === null || distance >= nearestDistance) {
      continue;
    }
    nearestDistance = distance;
    nearestBlock = block;
  }
  return nearestBlock;
}

function createTestPointerController({
  app,
  liveDebug,
  blocks
}) {
  return createPointerActivationController({
    app,
    liveDebug,
    liveBlocksForView() {
      return blocks;
    },
    normalizePointerTarget(target) {
      return target ?? null;
    },
    readPointerCoordinates(event) {
      if (Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
        return { x: event.clientX, y: event.clientY };
      }
      return null;
    },
    describeElementForLog(target) {
      if (!target) {
        return null;
      }
      const sourceFromRaw = typeof target.getAttribute === 'function'
        ? target.getAttribute('data-src-from')
        : null;
      const sourceFrom = Number(sourceFromRaw);
      return {
        tagName: target.tagName ?? null,
        className: typeof target.className === 'string' ? target.className : null,
        sourceFrom: Number.isFinite(sourceFrom) ? sourceFrom : null
      };
    },
    recordInputSignal(_kind, payload) {
      return payload;
    },
    resolvePointerPosition(view, _targetElement, coordinates) {
      return view.posAtCoords(coordinates);
    },
    readLineInfoForPosition(doc, position) {
      if (!doc || !Number.isFinite(position)) {
        return null;
      }
      const line = doc.lineAt(position);
      return {
        lineNumber: line.number,
        from: line.from,
        to: line.to
      };
    },
    readBlockLineBoundsForLog(doc, blockBounds) {
      if (!doc || !blockBounds) {
        return null;
      }
      const startLine = doc.lineAt(blockBounds.from);
      const endLine = doc.lineAt(Math.max(blockBounds.from, blockBounds.to - 1));
      return {
        startLineNumber: startLine.number,
        endLineNumber: endLine.number
      };
    },
    resolveActivationBlockBounds(nextBlocks, sourceFrom, preferredPosition = null) {
      const lookupPosition = Number.isFinite(preferredPosition) ? preferredPosition : sourceFrom;
      const containingBlock = (
        Array.isArray(nextBlocks)
          ? nextBlocks.find((block) => (
            Number.isFinite(lookupPosition) &&
            lookupPosition >= block.from &&
            lookupPosition < block.to
          ))
          : null
      );
      if (containingBlock) {
        return containingBlock;
      }
      return resolveNearestBlock(nextBlocks, lookupPosition ?? sourceFrom);
    }
  });
}

function createPointerHandlers({ app, liveDebug, pointerController }) {
  const { livePreviewPointerHandlers } = createLiveEditorExtensions({
    app,
    liveDebug,
    liveDebugKeylogKeys: new Set(),
    liveRuntimeHelpers: {
      handleLivePointerActivation(view, event, trigger) {
        return pointerController.handleLivePointerActivation(view, event, trigger);
      },
      recordInputSignal(_kind, payload) {
        return payload;
      },
      scheduleCursorVisibilityProbe() {}
    },
    factories: {
      createDomEventHandlers(handlers) {
        return handlers;
      },
      createAtomicRanges(provider) {
        return provider;
      },
      decorationNone: {}
    }
  });
  return livePreviewPointerHandlers;
}

test('hybrid click mapping activates source position from rendered content', () => {
  const app = { viewMode: 'live' };
  const liveDebug = createLiveDebugSpy();
  const blocks = [{ from: 6, to: 14 }];
  const { view, dispatched } = createView({
    text: 'alpha\nbeta\ngamma',
    head: 0,
    mappedPos: 9
  });
  const pointerController = createTestPointerController({
    app,
    liveDebug,
    blocks
  });
  const pointerHandlers = createPointerHandlers({
    app,
    liveDebug,
    pointerController
  });

  let prevented = false;
  const handled = pointerHandlers.mousedown(
    {
      target: {
        tagName: 'SPAN',
        className: 'cm-inline-token',
        closest() {
          return null;
        }
      },
      clientX: 104,
      clientY: 40,
      preventDefault() {
        prevented = true;
      }
    },
    view
  );

  const traceEvents = liveDebug.calls.trace.map((entry) => entry.event);
  assert.equal(handled, true);
  assert.equal(prevented, true);
  assert.equal(dispatched.length, 1);
  assert.equal(view.state.selection.main.head, 9);
  assert.ok(traceEvents.includes('input.pointer'));
  assert.ok(traceEvents.includes('pointer.map.native'));
  assert.ok(traceEvents.includes('block.activate.request'));
});
