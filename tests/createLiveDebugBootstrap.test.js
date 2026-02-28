import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveDebugBootstrap } from '../src/bootstrap/createLiveDebugBootstrap.js';

test('createLiveDebugBootstrap resolves level, persists, attaches, and logs startup metadata', () => {
  const calls = {
    readStored: [],
    resolveLevel: [],
    createLogger: [],
    persist: [],
    attach: [],
    setLevel: [],
    info: []
  };

  const bootstrap = createLiveDebugBootstrap({
    windowObject: {
      location: {
        search: '?debugLive=off'
      },
      localStorage: {
        id: 'storage'
      }
    },
    isDevBuild: true,
    markdownEngineOptions: {
      breaks: true
    },
    scope: 'test-scope',
    factories: {
      readStoredLiveDebugLevel(storage) {
        calls.readStored.push(storage);
        return 'off';
      },
      resolveLiveDebugLevel(payload) {
        calls.resolveLevel.push(payload);
        return 'off';
      },
      createLiveDebugLogger(payload) {
        calls.createLogger.push(payload);
        return {
          setLevel(level) {
            calls.setLevel.push(level);
            return level;
          },
          getLevel() {
            return 'trace';
          },
          info(event, data) {
            calls.info.push({ event, data });
          }
        };
      },
      persistLiveDebugLevel(storage, level) {
        calls.persist.push({ storage, level });
      },
      attachLiveDebugToWindow(windowObject, liveDebug, setLiveDebugLevel) {
        calls.attach.push({ windowObject, liveDebug, setLiveDebugLevel });
      }
    }
  });

  assert.equal(bootstrap.configuredLiveDebugLevel, 'off');
  assert.equal(bootstrap.initialLiveDebugLevel, 'trace');
  assert.equal(typeof bootstrap.setLiveDebugLevel, 'function');
  assert.equal(calls.readStored.length, 1);
  assert.equal(calls.resolveLevel.length, 1);
  assert.equal(calls.createLogger.length, 1);
  assert.equal(calls.createLogger[0].scope, 'test-scope');
  assert.equal(calls.createLogger[0].level, 'trace');
  assert.deepEqual(calls.persist, [
    {
      storage: { id: 'storage' },
      level: 'trace'
    }
  ]);
  assert.equal(calls.attach.length, 1);
  assert.deepEqual(
    calls.info.map((entry) => entry.event),
    ['markdown.engine.config', 'live.mode.architecture']
  );
  assert.deepEqual(calls.info[1].data, {
    renderer: 'hybrid-v2',
    sourceOfTruth: 'markdown'
  });

  const nextLevel = bootstrap.setLiveDebugLevel('debug');
  assert.equal(nextLevel, 'debug');
  assert.equal(calls.setLevel.at(-1), 'debug');
  assert.deepEqual(calls.persist.at(-1), {
    storage: { id: 'storage' },
    level: 'debug'
  });
});
