import { diffDocModels } from '../../core/model/ModelDiff.js';

function toLegacyModel(model) {
  if (!model || typeof model !== 'object') {
    return {
      text: '',
      blocks: [],
      inlineSpans: []
    };
  }

  return {
    text: typeof model.text === 'string' ? model.text : '',
    blocks: Array.isArray(model.blocks)
      ? model.blocks.map((block) => ({
        id: block.id,
        type: block.type,
        from: block.from,
        to: block.to,
        lineFrom: block.lineFrom,
        lineTo: block.lineTo,
        attrs: block.attrs
      }))
      : [],
    inlineSpans: Array.isArray(model.inlines)
      ? model.inlines.map((inline) => ({
        from: inline.from,
        to: inline.to,
        type: inline.type
      }))
      : []
  };
}

export function diffLiveDocModels(previousModel, nextModel) {
  return diffDocModels(toLegacyModel(previousModel), toLegacyModel(nextModel));
}
