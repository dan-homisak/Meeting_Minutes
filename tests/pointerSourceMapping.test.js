import test from 'node:test';
import assert from 'node:assert/strict';
import { createPointerSourceMapping } from '../src/live/pointerSourceMapping.js';

class ElementMock {
  constructor(attrs = {}, rect = null) {
    this.attrs = attrs;
    this.rect = rect;
    this.children = [];
    this.parentElement = null;
  }

  append(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  querySelector(selector) {
    if (selector !== '[data-src-from][data-src-to]') {
      return null;
    }

    const queue = [...this.children];
    while (queue.length > 0) {
      const node = queue.shift();
      if (
        node?.getAttribute('data-src-from') !== null &&
        node?.getAttribute('data-src-to') !== null
      ) {
        return node;
      }
      queue.push(...(node?.children ?? []));
    }

    return null;
  }

  getBoundingClientRect() {
    return (
      this.rect ?? {
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        right: 0,
        bottom: 0
      }
    );
  }
}

function createDocStub() {
  const lines = [
    { number: 1, from: 0, to: 4 },
    { number: 2, from: 5, to: 9 },
    { number: 3, from: 10, to: 14 }
  ];

  return {
    lineAt(position) {
      return lines.find((line) => position >= line.from && position <= line.to) ?? lines[lines.length - 1];
    },
    line(number) {
      return lines[number - 1];
    }
  };
}

test('findRenderedSourceRangeTarget resolves ancestor token range', () => {
  const probe = createPointerSourceMapping({
    elementConstructor: ElementMock
  });
  const renderedBlock = new ElementMock();
  const rangeElement = renderedBlock.append(
    new ElementMock({
      'data-src-from': '5',
      'data-src-to': '10'
    })
  );
  const target = rangeElement.append(new ElementMock());

  const result = probe.findRenderedSourceRangeTarget(target, renderedBlock);

  assert.equal(result.element, rangeElement);
  assert.deepEqual(result.range, { from: 5, to: 10, source: 'token-attrs' });
});

test('findRenderedSourceRangeTarget falls back to child or block attributes', () => {
  const probe = createPointerSourceMapping({
    elementConstructor: ElementMock
  });

  const renderedWithChild = new ElementMock();
  const targetWithChild = renderedWithChild.append(new ElementMock());
  const nestedRange = targetWithChild.append(
    new ElementMock({
      'data-src-from': '8',
      'data-src-to': '12'
    })
  );
  const childResult = probe.findRenderedSourceRangeTarget(targetWithChild, renderedWithChild);
  assert.equal(childResult.element, nestedRange);
  assert.deepEqual(childResult.range, { from: 8, to: 12, source: 'token-attrs' });

  const renderedWithBlockRange = new ElementMock({
    'data-source-from': '20',
    'data-source-to': '40'
  });
  const targetNoRange = renderedWithBlockRange.append(new ElementMock());
  const blockResult = probe.findRenderedSourceRangeTarget(targetNoRange, renderedWithBlockRange);
  assert.equal(blockResult.element, renderedWithBlockRange);
  assert.deepEqual(blockResult.range, { from: 20, to: 40, source: 'block-attrs' });
});

test('resolvePositionFromRenderedSourceRange maps coordinates to source line and clamps fallback', () => {
  const probe = createPointerSourceMapping({
    clampNumber(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }
  });
  const doc = createDocStub();
  const sourceRangeElement = new ElementMock({}, { top: 100, height: 30, left: 0, width: 50, right: 50, bottom: 130 });

  const preferredFallback = probe.resolvePositionFromRenderedSourceRange(
    doc,
    { from: 0, to: 14 },
    sourceRangeElement,
    { y: 115 },
    6
  );
  const mappedLineStart = probe.resolvePositionFromRenderedSourceRange(
    doc,
    { from: 0, to: 14 },
    sourceRangeElement,
    { y: 115 },
    12
  );
  const clampedNoCoords = probe.resolvePositionFromRenderedSourceRange(
    doc,
    { from: 0, to: 14 },
    sourceRangeElement,
    null,
    99
  );

  assert.equal(preferredFallback, 6);
  assert.equal(mappedLineStart, 5);
  assert.equal(clampedNoCoords, 13);
});

test('resolvePointerPosition prefers coordinates, then DOM, and traces DOM failures', () => {
  const tracedErrors = [];
  const probe = createPointerSourceMapping({
    traceDomPosFailure(error) {
      tracedErrors.push(error instanceof Error ? error.message : String(error));
    }
  });

  const mappedPos = probe.resolvePointerPosition(
    {
      posAtCoords() {
        return 22;
      },
      posAtDOM() {
        return 9;
      }
    },
    {},
    { x: 10, y: 10 }
  );
  const domFallbackPos = probe.resolvePointerPosition(
    {
      posAtCoords() {
        return null;
      },
      posAtDOM() {
        return 7;
      }
    },
    {},
    { x: 11, y: 12 }
  );
  const domFailurePos = probe.resolvePointerPosition(
    {
      posAtCoords() {
        return null;
      },
      posAtDOM() {
        throw new Error('dom-failure');
      }
    },
    {},
    { x: 15, y: 16 }
  );

  assert.equal(mappedPos, 22);
  assert.equal(domFallbackPos, 7);
  assert.equal(domFailurePos, null);
  assert.deepEqual(tracedErrors, ['dom-failure']);
});
