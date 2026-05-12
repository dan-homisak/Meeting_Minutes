import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import {
  buildInlineShiftLatchToggleSpec,
  resolveInlineShiftLatchBindingFromKeyboardEvent,
  resolveInlineShiftLatchMarker,
  buildInlineSurroundingUnwrapSpec,
  buildInlineUnwrapSpec,
  buildInlineWrapSpec,
  countSurroundingInlineMarkerPairs,
  runInlineLinkWrapCommand
} from '../../src/bootstrap/createEditor.js';

function applyInlineWrap(docText, from, to, text) {
  const state = EditorState.create({
    doc: docText,
    selection: {
      anchor: from,
      head: to
    }
  });
  const spec = buildInlineWrapSpec(state, { from, to, text });
  if (!spec) {
    return {
      spec: null,
      text: state.doc.toString(),
      selection: state.selection.main
    };
  }

  const nextState = state.update(spec).state;
  return {
    spec,
    text: nextState.doc.toString(),
    selection: nextState.selection.main
  };
}

test('inline wrap with star applies emphasis and preserves inner selection', () => {
  const firstPass = applyInlineWrap('hello world', 6, 11, '*');
  assert.ok(firstPass.spec);
  assert.equal(firstPass.text, 'hello *world*');
  assert.equal(firstPass.selection.from, 7);
  assert.equal(firstPass.selection.to, 12);

  const secondPass = applyInlineWrap(firstPass.text, firstPass.selection.from, firstPass.selection.to, '*');
  assert.ok(secondPass.spec);
  assert.equal(secondPass.text, 'hello **world**');
  assert.equal(secondPass.selection.from, 8);
  assert.equal(secondPass.selection.to, 13);
});

test('inline wrap with tilde twice produces strikethrough markers', () => {
  const firstPass = applyInlineWrap('alpha beta', 6, 10, '~');
  assert.ok(firstPass.spec);
  assert.equal(firstPass.text, 'alpha ~beta~');

  const secondPass = applyInlineWrap(firstPass.text, firstPass.selection.from, firstPass.selection.to, '~');
  assert.ok(secondPass.spec);
  assert.equal(secondPass.text, 'alpha ~~beta~~');
});

test('inline wrap with bracket twice produces wikilink markers', () => {
  const firstPass = applyInlineWrap('note', 0, 4, '[');
  assert.ok(firstPass.spec);
  assert.equal(firstPass.text, '[note]');
  assert.equal(firstPass.selection.from, 1);
  assert.equal(firstPass.selection.to, 5);

  const secondPass = applyInlineWrap(firstPass.text, firstPass.selection.from, firstPass.selection.to, '[');
  assert.ok(secondPass.spec);
  assert.equal(secondPass.text, '[[note]]');
});

test('inline wrap with equals twice produces highlight markers', () => {
  const firstPass = applyInlineWrap('alpha beta', 6, 10, '=');
  assert.ok(firstPass.spec);
  assert.equal(firstPass.text, 'alpha =beta=');

  const secondPass = applyInlineWrap(firstPass.text, firstPass.selection.from, firstPass.selection.to, '=');
  assert.ok(secondPass.spec);
  assert.equal(secondPass.text, 'alpha ==beta==');
});

test('inline unwrap removes matching marker pairs from selected boundaries', () => {
  let state = EditorState.create({
    doc: '**bold**',
    selection: { anchor: 0, head: 8 }
  });

  const firstSpec = buildInlineUnwrapSpec(state, { from: 0, to: 8, text: '*' });
  assert.ok(firstSpec);
  state = state.update(firstSpec).state;
  assert.equal(state.doc.toString(), '*bold*');
  assert.equal(state.selection.main.from, 0);
  assert.equal(state.selection.main.to, 6);

  const secondSpec = buildInlineUnwrapSpec(state, {
    from: state.selection.main.from,
    to: state.selection.main.to,
    text: '*'
  });
  assert.ok(secondSpec);
  state = state.update(secondSpec).state;
  assert.equal(state.doc.toString(), 'bold');
  assert.equal(state.selection.main.from, 0);
  assert.equal(state.selection.main.to, 4);
});

test('inline unwrap no-ops when marker pair is missing', () => {
  const state = EditorState.create({
    doc: 'plain',
    selection: { anchor: 0, head: 5 }
  });

  const spec = buildInlineUnwrapSpec(state, { from: 0, to: 5, text: '*' });
  assert.equal(spec, null);
});

test('shift latch key binding resolves physical bracket, equal, and backquote keys', () => {
  const bracketBinding = resolveInlineShiftLatchBindingFromKeyboardEvent({
    shiftKey: true,
    code: 'BracketLeft',
    key: '{'
  });
  assert.deepEqual(bracketBinding, {
    id: 'shift:BracketLeft',
    domain: ['[']
  });

  const equalBinding = resolveInlineShiftLatchBindingFromKeyboardEvent({
    shiftKey: true,
    code: 'Equal',
    key: '+'
  });
  assert.deepEqual(equalBinding, {
    id: 'shift:Equal',
    domain: ['=']
  });

  const backquoteBinding = resolveInlineShiftLatchBindingFromKeyboardEvent({
    shiftKey: true,
    code: 'Backquote',
    key: '~'
  });
  assert.deepEqual(backquoteBinding, {
    id: 'shift:Backquote',
    domain: ['~', '`']
  });
});

test('shift latch marker resolver prefers existing surrounding wrappers in domain', () => {
  const codeState = EditorState.create({
    doc: '`text`',
    selection: { anchor: 1, head: 5 }
  });

  const fromCode = resolveInlineShiftLatchMarker(codeState, {
    from: 1,
    to: 5,
    domain: ['~', '`'],
    typedText: '~'
  });
  assert.equal(fromCode, '`');

  const strikeState = EditorState.create({
    doc: '~text~',
    selection: { anchor: 1, head: 5 }
  });
  const fromStrike = resolveInlineShiftLatchMarker(strikeState, {
    from: 1,
    to: 5,
    domain: ['~', '`'],
    typedText: '~'
  });
  assert.equal(fromStrike, '~');

  const plainState = EditorState.create({
    doc: 'text',
    selection: { anchor: 0, head: 4 }
  });
  const fromPlain = resolveInlineShiftLatchMarker(plainState, {
    from: 0,
    to: 4,
    domain: ['~', '`'],
    typedText: '~'
  });
  assert.equal(fromPlain, '~');
});

test('surrounding marker pair counter detects nested wrappers around selection', () => {
  const state = EditorState.create({
    doc: '**bold**',
    selection: { anchor: 2, head: 6 }
  });

  const depth = countSurroundingInlineMarkerPairs(state, {
    from: 2,
    to: 6,
    text: '*'
  });
  assert.equal(depth, 2);
});

test('surrounding unwrap removes outer wrappers while preserving selected content', () => {
  const state = EditorState.create({
    doc: '**bold**',
    selection: { anchor: 2, head: 6 }
  });

  const spec = buildInlineSurroundingUnwrapSpec(state, {
    from: 2,
    to: 6,
    text: '*'
  });
  assert.ok(spec);

  const nextState = state.update(spec).state;
  assert.equal(nextState.doc.toString(), '*bold*');
  assert.equal(nextState.selection.main.from, 1);
  assert.equal(nextState.selection.main.to, 5);
});

test('surrounding unwrap supports bracket pair wrappers around selection', () => {
  const state = EditorState.create({
    doc: '[[note]]',
    selection: { anchor: 2, head: 6 }
  });

  const firstSpec = buildInlineSurroundingUnwrapSpec(state, {
    from: 2,
    to: 6,
    text: '['
  });
  assert.ok(firstSpec);
  const firstPass = state.update(firstSpec).state;
  assert.equal(firstPass.doc.toString(), '[note]');
  assert.equal(firstPass.selection.main.from, 1);
  assert.equal(firstPass.selection.main.to, 5);

  const secondSpec = buildInlineSurroundingUnwrapSpec(firstPass, {
    from: firstPass.selection.main.from,
    to: firstPass.selection.main.to,
    text: '['
  });
  assert.ok(secondSpec);
  const secondPass = firstPass.update(secondSpec).state;
  assert.equal(secondPass.doc.toString(), 'note');
  assert.equal(secondPass.selection.main.from, 0);
  assert.equal(secondPass.selection.main.to, 4);
});

test('shift latch toggle unwraps repeatedly then switches to wrapping', () => {
  let state = EditorState.create({
    doc: '**bold**',
    selection: { anchor: 2, head: 6 }
  });
  let mode = null;

  const pressOnce = () => {
    const result = buildInlineShiftLatchToggleSpec(state, {
      from: state.selection.main.from,
      to: state.selection.main.to,
      text: '*',
      mode
    });
    assert.ok(result?.spec);
    mode = result.mode;
    state = state.update(result.spec).state;
  };

  pressOnce();
  assert.equal(mode, 'unwrap');
  assert.equal(state.doc.toString(), '*bold*');
  assert.equal(state.selection.main.from, 1);
  assert.equal(state.selection.main.to, 5);

  pressOnce();
  assert.equal(mode, 'unwrap');
  assert.equal(state.doc.toString(), 'bold');
  assert.equal(state.selection.main.from, 0);
  assert.equal(state.selection.main.to, 4);

  pressOnce();
  assert.equal(mode, 'wrap');
  assert.equal(state.doc.toString(), '*bold*');
  assert.equal(state.selection.main.from, 1);
  assert.equal(state.selection.main.to, 5);

  pressOnce();
  assert.equal(mode, 'wrap');
  assert.equal(state.doc.toString(), '**bold**');
  assert.equal(state.selection.main.from, 2);
  assert.equal(state.selection.main.to, 6);
});

test('inline wrap does not apply for empty or multiline selections', () => {
  const empty = applyInlineWrap('text', 2, 2, '*');
  assert.equal(empty.spec, null);

  const multiline = applyInlineWrap('line one\nline two', 0, 10, '*');
  assert.equal(multiline.spec, null);
});

test('mod-k link wrapper surrounds selected text and places cursor in url slot', () => {
  let activeState = EditorState.create({
    doc: 'hello world',
    selection: {
      anchor: 6,
      head: 11
    }
  });

  const view = {
    get state() {
      return activeState;
    },
    dispatch(transaction) {
      activeState = activeState.update(transaction).state;
    }
  };

  const handled = runInlineLinkWrapCommand(view);
  assert.equal(handled, true);
  assert.equal(activeState.doc.toString(), 'hello [world]()');
  assert.equal(activeState.selection.main.head, 14);
});
