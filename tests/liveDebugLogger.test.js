import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveDebugLogger, resolveLiveDebugLevel } from '../src/liveDebugLogger.js';

test('resolveLiveDebugLevel prioritizes query param over stored value', () => {
  const level = resolveLiveDebugLevel({
    search: '?debugLive=warn',
    storedValue: 'trace'
  });

  assert.equal(level, 'warn');
});

test('resolveLiveDebugLevel supports aliases', () => {
  assert.equal(resolveLiveDebugLevel({ search: '?debugLive=1' }), 'trace');
  assert.equal(resolveLiveDebugLevel({ search: '?debugLive=true' }), 'trace');
  assert.equal(resolveLiveDebugLevel({ search: '?debugLive=off' }), 'off');
  assert.equal(resolveLiveDebugLevel({ storedValue: 'debug' }), 'trace');
});

test('createLiveDebugLogger emits only events at or below current level', () => {
  const logger = createLiveDebugLogger({ level: 'warn' });

  logger.trace('trace.event', { id: 1 });
  logger.info('info.event', { id: 2 });
  logger.warn('warn.event', { id: 3 });
  logger.error('error.event', { id: 4 });

  const entries = logger.getEntries();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].event, 'warn.event');
  assert.equal(entries[1].event, 'error.event');
});

test('createLiveDebugLogger bounds the in-memory timeline', () => {
  const logger = createLiveDebugLogger({
    level: 'trace',
    maxEntries: 2
  });

  logger.trace('event.1');
  logger.trace('event.2');
  logger.trace('event.3');

  const entries = logger.getEntries();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].event, 'event.2');
  assert.equal(entries[1].event, 'event.3');
});

test('createLiveDebugLogger notifies subscribers on state changes', () => {
  const logger = createLiveDebugLogger({ level: 'off' });
  const notifications = [];

  const unsubscribe = logger.subscribe((event) => {
    notifications.push(event?.type ?? 'none');
  });

  logger.trace('trace.event');
  assert.equal(notifications.length, 0);

  logger.setLevel('trace');
  logger.trace('trace.event');
  logger.clearEntries();
  unsubscribe();
  logger.setLevel('warn');

  assert.deepEqual(notifications, ['level', 'entry', 'clear']);
});
