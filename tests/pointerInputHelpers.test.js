import test from 'node:test';
import assert from 'node:assert/strict';
import { createPointerInputHelpers } from '../src/live/pointerInputHelpers.js';

class ElementMock {}
class NodeMock {}

test('distanceToBlockBounds reports in-block and out-of-block distances', () => {
  const helpers = createPointerInputHelpers();

  assert.equal(helpers.distanceToBlockBounds(Number.NaN, { from: 1, to: 5 }), null);
  assert.equal(helpers.distanceToBlockBounds(3, { from: 1, to: 5 }), 0);
  assert.equal(helpers.distanceToBlockBounds(0, { from: 1, to: 5 }), 1);
  assert.equal(helpers.distanceToBlockBounds(7, { from: 1, to: 5 }), 3);
});

test('normalizePointerTarget returns element or node parent element', () => {
  const helpers = createPointerInputHelpers({
    elementConstructor: ElementMock,
    nodeConstructor: NodeMock
  });
  const element = new ElementMock();
  const parentElement = new ElementMock();
  const node = new NodeMock();
  node.parentElement = parentElement;

  assert.equal(helpers.normalizePointerTarget(element), element);
  assert.equal(helpers.normalizePointerTarget(node), parentElement);
  assert.equal(helpers.normalizePointerTarget({}), null);
});

test('readPointerCoordinates supports mouse and touch events', () => {
  const helpers = createPointerInputHelpers();

  const mouse = helpers.readPointerCoordinates({
    clientX: 12,
    clientY: 34
  });
  assert.deepEqual(mouse, { x: 12, y: 34 });

  const touch = helpers.readPointerCoordinates({
    touches: [
      {
        clientX: 56,
        clientY: 78
      }
    ]
  });
  assert.deepEqual(touch, { x: 56, y: 78 });

  assert.equal(helpers.readPointerCoordinates({}), null);
});
