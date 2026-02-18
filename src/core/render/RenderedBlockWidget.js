import { WidgetType } from '@codemirror/view';

export class RenderedBlockWidget extends WidgetType {
  constructor(
    html,
    sourceFrom,
    sourceTo = sourceFrom,
    fragmentFrom = sourceFrom,
    fragmentTo = sourceTo
  ) {
    super();
    this.html = html;
    this.sourceFrom = sourceFrom;
    this.sourceTo = sourceTo;
    this.fragmentFrom = fragmentFrom;
    this.fragmentTo = fragmentTo;
  }

  eq(other) {
    return (
      other.html === this.html &&
      other.sourceFrom === this.sourceFrom &&
      other.sourceTo === this.sourceTo &&
      other.fragmentFrom === this.fragmentFrom &&
      other.fragmentTo === this.fragmentTo
    );
  }

  toDOM() {
    const element = document.createElement('div');
    element.className = 'cm-rendered-block';
    element.dataset.sourceFrom = String(this.sourceFrom);
    element.dataset.sourceTo = String(this.sourceTo);
    element.dataset.fragmentFrom = String(this.fragmentFrom);
    element.dataset.fragmentTo = String(this.fragmentTo);
    element.innerHTML = this.html;
    return element;
  }

  ignoreEvent() {
    return false;
  }
}
