import MarkdownIt from 'markdown-it';

export const MARKDOWN_ENGINE_OPTIONS = Object.freeze({
  html: true,
  linkify: true,
  typographer: false,
  breaks: false
});

export function createMarkdownEngine(overrides = {}) {
  const engine = new MarkdownIt({
    ...MARKDOWN_ENGINE_OPTIONS,
    ...overrides
  });

  const defaultImageRule = engine.renderer.rules.image ??
    ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));

  engine.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const src = token?.attrGet?.('src') ?? '';
    if (/^(?:https?:|data:|blob:|\/)/i.test(src)) {
      return defaultImageRule(tokens, index, options, env, self);
    }

    const alt = token?.content ?? '';
    const label = alt.trim() || src.trim() || 'image';
    return `<span class="mm-live-v4-image-placeholder">${engine.utils.escapeHtml(label)}</span>`;
  };

  return engine;
}
