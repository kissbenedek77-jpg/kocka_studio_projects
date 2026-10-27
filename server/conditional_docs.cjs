'use strict';

function paragraphText(item) {
  return (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
}

function conditionalBlocks(document) {
  const content = document.body?.content || [];
  const blocks = [];
  let open = null;
  for (let index=0; index<content.length; index++) {
    const text = paragraphText(content[index]).trim();
    const start = text.match(/^\{\{#IF\s+(.+?)\s*(!=|=)\s*(.*?)\s*\}\}$/);
    if (start) {
      if (open) throw new Error('Egymásba ágyazott feltételes Docs blokkok nem támogatottak.');
      open = {start:index,field:start[1].trim(),operator:start[2],expected:start[3].trim()};
    } else if (text === '{{/IF}}') {
      if (!open) throw new Error('Lezáró feltételes jel van nyitó jel nélkül.');
      blocks.push({...open,end:index});
      open = null;
    }
  }
  if (open) throw new Error('Nincs lezárva a feltételes Docs blokk: '+open.field);
  return blocks;
}

function conditionalRequests(source, target, values) {
  const originals = conditionalBlocks(source);
  const current = conditionalBlocks(target);
  if (originals.length !== current.length)
    throw new Error('A feltételes blokkok száma eltér a sablontól.');
  const requests = [];
  for (const block of current) {
    for (const position of [block.start,block.end]) {
      const item = target.body.content[position];
      requests.push({updateTextStyle:{range:{startIndex:item.startIndex,
        endIndex:item.endIndex-1},textStyle:{foregroundColor:{color:{rgbColor:{red:1,green:1,blue:1}}},
          fontSize:{magnitude:1,unit:'PT'}},fields:'foregroundColor,fontSize'}});
    }
  }
  for (let index=current.length-1; index>=0; index--) {
    const from = originals[index], to = current[index];
    if (from.field !== to.field || from.operator !== to.operator || from.expected !== to.expected)
      throw new Error('A feltételes blokk eltér a sablontól: '+from.field);
    const sourceItems = source.body.content.slice(from.start+1,from.end);
    if (sourceItems.some(item => !item.paragraph))
      throw new Error('Nem támogatott táblázat vagy kép a feltételes blokkban.');
    const actual = String(values[from.field] ?? '').trim();
    if (!actual && from.expected) throw new Error('Hiányzó feltételes sablonmező: '+from.field);
    const matched = from.operator === '!=' ? actual !== from.expected : actual === from.expected;
    const text = matched ? sourceItems.map(paragraphText).join('') : '';
    const startIndex = target.body.content[to.start].endIndex;
    const endIndex = target.body.content[to.end].startIndex;
    if (endIndex > startIndex) requests.push({deleteContentRange:{range:{startIndex,endIndex}}});
    if (text) requests.push({insertText:{location:{index:startIndex},text}});
  }
  return requests;
}

module.exports = {conditionalBlocks,conditionalRequests};
