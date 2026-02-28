import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocModel } from '../src/core/model/DocModel.js';

test('createDocModel enriches V2 block metadata and frontmatter reference', () => {
  const text = [
    '---',
    'title: Demo',
    '---',
    '',
    '# Title',
    '',
    '- [x] done',
    '',
    '[[Wiki]]',
    '',
    '![[image.png]]',
    ''
  ].join('\n');

  const frontmatterTo = text.indexOf('\n\n# Title');
  const headingFrom = text.indexOf('# Title');
  const headingTo = headingFrom + '# Title\n'.length;
  const taskFrom = text.indexOf('- [x] done');
  const taskTo = taskFrom + '- [x] done\n'.length;
  const wikiFrom = text.indexOf('[[Wiki]]');
  const wikiTo = wikiFrom + '[[Wiki]]\n'.length;
  const embedFrom = text.indexOf('![[image.png]]');
  const embedTo = embedFrom + '![[image.png]]\n'.length;

  const model = createDocModel({
    version: 1,
    text,
    blocks: [
      { from: 0, to: frontmatterTo },
      { from: headingFrom, to: headingTo },
      { from: taskFrom, to: taskTo },
      { from: wikiFrom, to: wikiTo },
      { from: embedFrom, to: embedTo }
    ],
    inlineSpans: []
  });

  assert.equal(model.frontmatter?.type, 'frontmatter');
  assert.ok(model.blocks.every((block) => typeof block.id === 'string' && block.id.length > 0));
  assert.equal(model.blocks.find((block) => block.type === 'heading')?.attrs.level, 1);
  assert.equal(model.blocks.find((block) => block.type === 'task')?.attrs.checked, true);
  assert.equal(model.blocks.find((block) => block.type === 'wikilink')?.type, 'wikilink');
  assert.equal(model.blocks.find((block) => block.type === 'embed')?.type, 'embed');
  assert.equal(Array.isArray(model.inline), true);
});
