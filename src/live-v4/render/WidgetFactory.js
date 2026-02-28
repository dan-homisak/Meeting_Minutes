import { WidgetType } from '@codemirror/view';

export class RenderedBlockWidget extends WidgetType {
  constructor({
    html,
    fragmentId,
    blockId,
    sourceFrom,
    sourceTo
  }) {
    super();
    this.html = typeof html === 'string' ? html.trim() : '';
    this.fragmentId = fragmentId;
    this.blockId = blockId;
    this.sourceFrom = sourceFrom;
    this.sourceTo = sourceTo;
  }

  eq(other) {
    return (
      other instanceof RenderedBlockWidget &&
      this.html === other.html &&
      this.fragmentId === other.fragmentId &&
      this.blockId === other.blockId &&
      this.sourceFrom === other.sourceFrom &&
      this.sourceTo === other.sourceTo
    );
  }

  toDOM() {
    const wrapper = document.createElement('section');
    wrapper.className = 'mm-live-v4-block-widget';
    wrapper.setAttribute('data-fragment-id', this.fragmentId);
    wrapper.setAttribute('data-block-id', this.blockId);
    wrapper.setAttribute('data-src-from', String(this.sourceFrom));
    wrapper.setAttribute('data-src-to', String(this.sourceTo));
    wrapper.innerHTML = this.html;
    return wrapper;
  }

  ignoreEvent() {
    return false;
  }
}
