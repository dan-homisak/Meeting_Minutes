import DOMPurify from 'dompurify';

export function createMarkdownRenderer({
  markdownEngine,
  previewElement,
  annotateMarkdownTokensWithSourceRanges
} = {}) {
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

    return DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true }
    });
  }

  function renderPreview(markdownText) {
    if (previewElement) {
      previewElement.innerHTML = renderMarkdownHtml(markdownText);
    }
  }

  return {
    renderMarkdownHtml,
    renderPreview
  };
}
