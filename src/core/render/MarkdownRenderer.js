import DOMPurify from 'dompurify';
import { createPreviewRenderer } from './PreviewRenderer.js';

export function createMarkdownRenderer({
  markdownEngine,
  previewElement,
  annotateMarkdownTokensWithSourceRanges,
  previewFragmentCacheMax = 1200
} = {}) {
  const sanitizerInstance = (() => {
    if (typeof DOMPurify?.sanitize === 'function') {
      return DOMPurify;
    }

    if (typeof window !== 'undefined' && typeof DOMPurify === 'function') {
      try {
        const instance = DOMPurify(window);
        if (instance && typeof instance.sanitize === 'function') {
          return instance;
        }
      } catch {
        return null;
      }
    }

    return null;
  })();

  function sanitizeHtml(rendered) {
    if (sanitizerInstance && typeof sanitizerInstance.sanitize === 'function') {
      return sanitizerInstance.sanitize(rendered, {
        USE_PROFILES: { html: true }
      });
    }

    return rendered;
  }

  function renderMarkdownHtml(markdownText, options = null) {
    const sourceFrom = Number(options?.sourceFrom);
    const sourceTo = Number(options?.sourceTo);
    const shouldAnnotateSourceRanges = Number.isFinite(sourceFrom) && Number.isFinite(sourceTo);

    let rendered = '';
    if (shouldAnnotateSourceRanges) {
      const tokens = markdownEngine.parse(markdownText, {});
      if (typeof annotateMarkdownTokensWithSourceRanges === 'function') {
        annotateMarkdownTokensWithSourceRanges(tokens, markdownText, sourceFrom, sourceTo);
      }
      rendered = markdownEngine.renderer.render(tokens, markdownEngine.options, {});
    } else {
      rendered = markdownEngine.render(markdownText);
    }

    return sanitizeHtml(rendered);
  }

  const previewRenderer = createPreviewRenderer({
    renderMarkdownHtml,
    previewFragmentCacheMax
  });

  function renderPreview(markdownText, options = null) {
    const rendered = previewRenderer.renderPreview(markdownText, options);

    if (previewElement) {
      previewElement.innerHTML = rendered;
    }

    return rendered;
  }

  return {
    renderMarkdownHtml,
    renderPreview
  };
}
