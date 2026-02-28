function readBlockSource(text, block) {
  if (typeof text !== 'string' || !block || !Number.isFinite(block.from) || !Number.isFinite(block.to)) {
    return '';
  }

  const from = Math.max(0, Math.min(text.length, Math.trunc(block.from)));
  const to = Math.max(from, Math.min(text.length, Math.trunc(block.to)));
  if (to <= from) {
    return '';
  }

  return text.slice(from, to);
}

export function renderBlockHtml({
  text,
  block,
  renderMarkdownHtml
} = {}) {
  if (!block || typeof renderMarkdownHtml !== 'function') {
    return '';
  }

  const source = readBlockSource(text, block);
  if (!source.trim()) {
    return '';
  }

  return renderMarkdownHtml(source, {
    sourceFrom: block.from,
    sourceTo: block.to,
    blockType: block.type,
    blockAttrs: block.attrs ?? {},
    blockDepth: Number.isFinite(block.depth) ? block.depth : null,
    fragmentKind: 'block'
  });
}
