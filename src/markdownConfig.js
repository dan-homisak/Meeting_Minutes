import MarkdownIt from 'markdown-it';

export const MARKDOWN_ENGINE_OPTIONS = Object.freeze({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true
});

export function createMarkdownEngine(overrides = {}) {
  return new MarkdownIt({
    ...MARKDOWN_ENGINE_OPTIONS,
    ...overrides
  });
}
