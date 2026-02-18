const SLASH_COMMAND_PATTERN = /\/[a-z-]*/i;

export const MARKDOWN_SLASH_COMMANDS = Object.freeze([
  {
    label: 'h1',
    type: 'keyword',
    detail: 'Heading 1',
    apply: '# '
  },
  {
    label: 'h2',
    type: 'keyword',
    detail: 'Heading 2',
    apply: '## '
  },
  {
    label: 'h3',
    type: 'keyword',
    detail: 'Heading 3',
    apply: '### '
  },
  {
    label: 'bullet',
    type: 'keyword',
    detail: 'Bullet list',
    apply: '- '
  },
  {
    label: 'numbered',
    type: 'keyword',
    detail: 'Numbered list',
    apply: '1. '
  },
  {
    label: 'task',
    type: 'keyword',
    detail: 'Task checkbox',
    apply: '- [ ] '
  },
  {
    label: 'quote',
    type: 'keyword',
    detail: 'Blockquote',
    apply: '> '
  },
  {
    label: 'code',
    type: 'keyword',
    detail: 'Code fence',
    apply: '```\n\n```'
  },
  {
    label: 'link',
    type: 'keyword',
    detail: 'Markdown link',
    apply: '[label](https://example.com)'
  },
  {
    label: 'image',
    type: 'keyword',
    detail: 'Markdown image',
    apply: '![alt text](image-path.png)'
  },
  {
    label: 'table',
    type: 'keyword',
    detail: 'Basic table',
    apply: '| Column | Value |\n| --- | --- |\n| Item | Detail |'
  }
]);

export function slashCommandCompletion(context, commands = MARKDOWN_SLASH_COMMANDS) {
  const token = context.matchBefore(SLASH_COMMAND_PATTERN);

  if (!token) {
    return null;
  }

  if (!context.explicit && token.from === token.to) {
    return null;
  }

  return {
    from: token.from,
    options: commands,
    validFor: SLASH_COMMAND_PATTERN
  };
}
