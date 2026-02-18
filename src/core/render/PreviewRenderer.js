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

export function createPreviewRenderer({
  renderMarkdownHtml,
  previewFragmentCacheMax = 1200
} = {}) {
  const previewFragmentCache = new Map();

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

  function renderPreview(markdownText, options = null) {
    const documentModel = options?.documentModel;
    const canUseModel =
      documentModel &&
      typeof documentModel.text === 'string' &&
      documentModel.text === markdownText;

    if (canUseModel) {
      return renderPreviewFromDocumentModel(documentModel);
    }

    return renderMarkdownHtml(markdownText);
  }

  return {
    renderPreview,
    renderPreviewFromDocumentModel
  };
}
