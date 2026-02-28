import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveControllers } from '../src/bootstrap/createLiveControllers.js';

function createConfig() {
  return new Proxy(
    {
      liveDebugKeylogKeys: new Set(['Enter'])
    },
    {
      get(target, property) {
        if (property in target) {
          return target[property];
        }
        return 0;
      }
    }
  );
}

function createHelpers() {
  const noOp = () => null;
  return new Proxy(
    {},
    {
      get() {
        return noOp;
      }
    }
  );
}

function createFactorySpy(returnValue) {
  const calls = [];
  const factory = (args) => {
    calls.push(args);
    return typeof returnValue === 'function' ? returnValue(args) : returnValue;
  };
  return {
    calls,
    factory
  };
}

test('createLiveControllers wires factories and preserves selection/update delegation', () => {
  const selectionUpdates = [];
  const liveDebug = {
    trace() {}
  };
  const runtime = {
    windowObject: { id: 'window' },
    documentObject: { id: 'document' },
    requestAnimationFrameFn: (callback) => callback('raf'),
    createCursorSelection: (position, assoc) => ({ cursor: `${position}:${assoc}` }),
    transactionUserEventAnnotation: { id: 'user-event' },
    performanceObserverClass: class PerformanceObserverStub {},
    elementConstructor: class ElementStub {},
    nodeConstructor: class NodeStub {},
    nowFn: () => 42
  };
  const sentinels = {
    liveViewportProbe: { id: 'viewport' },
    pointerActivationController: { id: 'pointer-activation' },
    cursorVisibilityController: { id: 'cursor-visibility' },
    cursorNavigationController: { id: 'cursor-navigation' },
    liveDiagnosticsController: { id: 'live-diagnostics' },
    selectionDiagnosticsController: {
      id: 'selection-diagnostics',
      handleSelectionUpdate(update) {
        selectionUpdates.push(update);
      }
    },
    editorUpdateController: { id: 'editor-update' }
  };

  const viewportFactory = createFactorySpy(sentinels.liveViewportProbe);
  const activationFactory = createFactorySpy(sentinels.pointerActivationController);
  const visibilityFactory = createFactorySpy(sentinels.cursorVisibilityController);
  const navigationFactory = createFactorySpy(sentinels.cursorNavigationController);
  const diagnosticsFactory = createFactorySpy(sentinels.liveDiagnosticsController);
  const selectionFactory = createFactorySpy(sentinels.selectionDiagnosticsController);
  const editorUpdateFactory = createFactorySpy(sentinels.editorUpdateController);

  const controllers = createLiveControllers({
    app: { viewMode: 'live' },
    liveDebug,
    liveDebugDiagnostics: { id: 'diagnostics-state' },
    config: createConfig(),
    helpers: createHelpers(),
    runtime,
    factories: {
      createLiveViewportProbe: viewportFactory.factory,
      createPointerActivationController: activationFactory.factory,
      createCursorVisibilityController: visibilityFactory.factory,
      createCursorNavigationController: navigationFactory.factory,
      createLiveDiagnosticsController: diagnosticsFactory.factory,
      createSelectionDiagnosticsController: selectionFactory.factory,
      createEditorUpdateController: editorUpdateFactory.factory
    }
  });

  assert.equal(viewportFactory.calls.length, 1);
  assert.equal(activationFactory.calls.length, 1);
  assert.equal(visibilityFactory.calls.length, 1);
  assert.equal(navigationFactory.calls.length, 1);
  assert.equal(diagnosticsFactory.calls.length, 1);
  assert.equal(selectionFactory.calls.length, 1);
  assert.equal(editorUpdateFactory.calls.length, 1);
  assert.deepEqual(controllers, sentinels);

  assert.equal(visibilityFactory.calls[0].createCursorSelection, runtime.createCursorSelection);
  assert.equal(visibilityFactory.calls[0].requestAnimationFrameFn, runtime.requestAnimationFrameFn);
  assert.equal(
    diagnosticsFactory.calls[0].performanceObserverClass,
    runtime.performanceObserverClass
  );
  assert.equal(
    selectionFactory.calls[0].transactionUserEventAnnotation,
    runtime.transactionUserEventAnnotation
  );
  assert.equal(selectionFactory.calls[0].nowFn(), 42);

  const updatePayload = { id: 'selection-update' };
  editorUpdateFactory.calls[0].handleSelectionUpdate(updatePayload);
  assert.deepEqual(selectionUpdates, [updatePayload]);
});

test('createLiveControllers uses runtime fallbacks for cursor selection and raf consumers', () => {
  const activationFactory = createFactorySpy({ id: 'pointer-activation' });
  const visibilityFactory = createFactorySpy({ id: 'cursor-visibility' });

  createLiveControllers({
    app: { viewMode: 'live' },
    liveDebug: {
      trace() {}
    },
    liveDebugDiagnostics: {},
    config: createConfig(),
    helpers: createHelpers(),
    factories: {
      createLiveViewportProbe: () => ({ id: 'viewport' }),
      createPointerActivationController: activationFactory.factory,
      createCursorVisibilityController: visibilityFactory.factory,
      createCursorNavigationController: () => ({ id: 'cursor-navigation' }),
      createLiveDiagnosticsController: () => ({ id: 'live-diagnostics' }),
      createSelectionDiagnosticsController: () => ({ id: 'selection-diagnostics' }),
      createEditorUpdateController: () => ({ id: 'editor-update' })
    }
  });

  let rafCalled = false;
  visibilityFactory.calls[0].requestAnimationFrameFn(() => {
    rafCalled = true;
  });
  assert.equal(rafCalled, true);
  assert.equal(activationFactory.calls[0].requestAnimationFrameFn, undefined);
  assert.deepEqual(visibilityFactory.calls[0].createCursorSelection(9, -1), {
    position: 9,
    assoc: -1
  });
});
