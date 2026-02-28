import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveDiagnosticsLogHelpers } from '../src/live/liveDiagnosticsLogHelpers.js';

class ElementMock {
  constructor({
    tagName = 'DIV',
    id = '',
    className = '',
    textContent = '',
    attrs = {}
  } = {}) {
    this.tagName = tagName;
    this.id = id;
    this.className = className;
    this.textContent = textContent;
    this.attrs = attrs;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
}

class NodeMock {}
NodeMock.TEXT_NODE = 3;

test('describeElementForLog returns normalized element summary', () => {
  const helpers = createLiveDiagnosticsLogHelpers({
    normalizeLogString(value, maxLength = 120) {
      return String(value ?? '').trim().slice(0, maxLength);
    },
    elementConstructor: ElementMock,
    nodeConstructor: NodeMock
  });
  const element = new ElementMock({
    tagName: 'SPAN',
    id: 'demo',
    className: '  alpha beta  ',
    textContent: '  hello world  ',
    attrs: {
      'data-src-from': '11',
      'data-fragment-from': '7'
    }
  });

  const summary = helpers.describeElementForLog(element);
  assert.deepEqual(summary, {
    tagName: 'SPAN',
    id: 'demo',
    className: 'alpha beta',
    sourceFrom: '11',
    fragmentFrom: '7',
    textPreview: 'hello world'
  });
});

test('readDomSelectionForLog returns no-selection payload with active element summary', () => {
  const helpers = createLiveDiagnosticsLogHelpers({
    normalizeLogString: (value) => String(value).trim(),
    elementConstructor: ElementMock,
    nodeConstructor: NodeMock
  });
  const activeElement = new ElementMock({
    tagName: 'TEXTAREA',
    className: ' cm-content ',
    textContent: ' text '
  });

  const result = helpers.readDomSelectionForLog({
    getSelection() {
      return null;
    },
    document: {
      activeElement
    }
  });

  assert.equal(result.hasSelection, false);
  assert.equal(result.activeElement.tagName, 'TEXTAREA');
  assert.equal(result.activeElement.className, 'cm-content');
});

test('readDomSelectionForLog includes anchor/focus node details for text selection', () => {
  const helpers = createLiveDiagnosticsLogHelpers({
    normalizeLogString: (value) => String(value).trim(),
    elementConstructor: ElementMock,
    nodeConstructor: NodeMock
  });
  const parentElement = new ElementMock({
    tagName: 'P',
    className: ' paragraph '
  });
  const anchorTextNode = {
    nodeType: NodeMock.TEXT_NODE,
    textContent: '  anchor text  ',
    parentElement
  };
  const focusElement = new ElementMock({
    tagName: 'STRONG',
    className: ' strong '
  });

  const result = helpers.readDomSelectionForLog({
    getSelection() {
      return {
        rangeCount: 1,
        isCollapsed: false,
        anchorOffset: 2,
        focusOffset: 6,
        anchorNode: anchorTextNode,
        focusNode: focusElement
      };
    },
    document: {
      activeElement: parentElement
    }
  });

  assert.equal(result.hasSelection, true);
  assert.equal(result.anchorNode.nodeType, 'text');
  assert.equal(result.anchorNode.textPreview, 'anchor text');
  assert.equal(result.anchorNode.parentTag, 'P');
  assert.equal(result.anchorNode.parentClass, 'paragraph');
  assert.equal(result.focusNode.tagName, 'STRONG');
  assert.equal(result.activeElement.tagName, 'P');
});

test('readDomSelectionForLog handles selection access errors', () => {
  const helpers = createLiveDiagnosticsLogHelpers({
    elementConstructor: ElementMock,
    nodeConstructor: NodeMock
  });

  const result = helpers.readDomSelectionForLog({
    getSelection() {
      throw new Error('selection-blocked');
    }
  });

  assert.deepEqual(result, {
    hasSelection: false,
    error: 'selection-blocked'
  });
});
