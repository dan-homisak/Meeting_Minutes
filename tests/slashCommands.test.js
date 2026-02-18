import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKDOWN_SLASH_COMMANDS, slashCommandCompletion } from '../src/editor/slashCommands.js';

function contextFrom(input, explicit = true) {
  const cursor = input.length;
  return {
    explicit,
    matchBefore(pattern) {
      const source = input.slice(0, cursor);
      const match = source.match(pattern);
      if (!match) {
        return null;
      }
      const text = match[0] ?? '';
      return {
        from: cursor - text.length,
        to: cursor,
        text
      };
    }
  };
}

test('slashCommandCompletion returns suggestions for slash-prefixed token', () => {
  const completion = slashCommandCompletion(contextFrom('/h'));

  assert.ok(completion);
  assert.equal(completion.from, 0);
  assert.deepEqual(completion.options, MARKDOWN_SLASH_COMMANDS);
});

test('slashCommandCompletion returns null for empty implicit token', () => {
  const completion = slashCommandCompletion(contextFrom('', false));
  assert.equal(completion, null);
});
