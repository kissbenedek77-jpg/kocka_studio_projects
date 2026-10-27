'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {conditionalRequests} = require('../server/conditional_docs.cjs');

function doc(lines) {
  let index=1;
  return {body:{content:lines.map(line => {
    const startIndex=index;
    const text=line+'\n';
    index+=text.length;
    return {startIndex,endIndex:index,paragraph:{elements:[{startIndex,
      textRun:{content:text}}]}};
  })}};
}

test('A feltételes ajánlatblokk szinkronkor visszaáll a forrássablonból', () => {
  const source=doc(['Első','{{#IF Neve!=Új építés}}','Felmérés','{{/IF}}','Utolsó']);
  const hidden=doc(['Első','{{#IF Neve!=Új építés}}','{{/IF}}','Utolsó']);
  const show=conditionalRequests(source,hidden,{Neve:'Bővítés'});
  assert.equal(show.find(item=>item.insertText)?.insertText.text,'Felmérés\n');
  const hide=conditionalRequests(source,source,{Neve:'Új építés'});
  assert.equal(hide.filter(item=>item.deleteContentRange).length,1);
  assert.equal(hide.filter(item=>item.insertText).length,0);
  assert.throws(()=>conditionalRequests(source,hidden,{}),/Hiányzó feltételes/);
});
