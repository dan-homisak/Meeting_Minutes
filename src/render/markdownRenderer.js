import DOMPurify from 'dompurify';

export function createMarkdownRenderer({
  markdownEngine,
  previewElement,
  annotateMarkdownTokensWithSourceRanges,
  previewFragmentCacheMax = 1200
} = {}) {
  const previewFragmentCache = new Map();
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

  function readBlockSource(text, block) {
    if (!block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
      return null;
    }

    const from = Math.max(0, Math.min(text.length, Math.trunc(block.from)));
    const to = Math.max(from, Math.min(text.length, Math.trunc(block.to)));
    if (to <= from) {
      return null;
    }

    const source = text.slice(from, to);
    if (!source.trim()) {
      return null;
    }

    return source;
  }

  function renderPreviewFromDocumentModel(documentModel) {
    const text = typeof documentModel?.text === 'string' ? documentModel.text : '';
    const blocks = Array.isArray(documentModel?.blocks) ? documentModel.blocks : [];
    if (!text) {
      return '';
    }

    if (blocks.length === 0) {
      return renderMarkdownHtml(text);
    }

    const parts = [];
    for (const block of blocks) {
      const blockSource = readBlockSource(text, block);
      if (!blockSource) {
        continue;
      }

      const cacheKey = blockSource;
      let html = previewFragmentCache.get(cacheKey);
      if (typeof html !== 'string') {
        html = renderMarkdownHtml(blockSource);
        previewFragmentCache.set(cacheKey, html);
        if (previewFragmentCache.size > previewFragmentCacheMax) {
          previewFragmentCache.clear();
          previewFragmentCache.set(cacheKey, html);
        }
      }

      parts.push(html);
    }

    if (parts.length === 0) {
      return renderMarkdownHtml(text);
    }

    return parts.join('\n');
  }

  function renderMarkdownHtml(markdownText, options = null) {
    const sourceFrom = Number(options?.sourceFrom);
    const sourceTo = Number(options?.sourceTo);
    const shouldAnnotateSourceRanges = Number.isFinite(sourceFrom) && Number.isFinite(sourceTo);

    let rendered = '';
    if (shouldAnnotateSourceRanges) {
      const tokens = markdownEngine.parse(markdownText, {});
      annotateMarkdownTokensWithSourceRanges(tokens, markdownText, sourceFrom, sourceTo);
      rendered = markdownEngine.renderer.render(tokens, markdownEngine.options, {});
    } else {
      rendered = markdownEngine.render(markdownText);
    }

    return sanitizeHtml(rendered);
  }

  function renderPreview(markdownText, options = null) {
    const documentModel = options?.documentModel;
    const canUseModel =
      documentModel &&
      typeof documentModel.text === 'string' &&
      documentModel.text === markdownText;
    const rendered = canUseModel
      ? renderPreviewFromDocumentModel(documentModel)
      : renderMarkdownHtml(markdownText);

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
