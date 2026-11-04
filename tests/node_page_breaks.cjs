'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {headingCandidates,orphanRequests,duplicateBreakRequests} = require('../server/page_breaks.cjs');

function paragraph(start,text,bullet) {
  return {startIndex:start,endIndex:start + text.length + 1,
    paragraph:{elements:[{startIndex:start,textRun:{content:text + '\n'}}],
      ...(bullet ? {bullet:{listId:'lista'}} : {})}};
}

const document = {body:{content:[
  paragraph(1,'Tűzvédelem',true),
  paragraph(20,'Rétegrendek',true),
  paragraph(40,'F1 Határoló fal')
]}};

test('A fejezet- és alcímjelöltek felismerhetők', () => {
  const headings = headingCandidates(document);
  assert.deepEqual(headings.map(item => item.text),['Tűzvédelem','Rétegrendek']);
});

test('A magányos oldalvégi fejezetcím elé oldaltörés kerül', () => {
  const pdf = 'Első oldal szövege\nTűzvédelem\n\fRétegrendek\nF1 Határoló fal\n';
  const requests = orphanRequests(document,pdf);
  assert.deepEqual(requests,[
    {insertPageBreak:{location:{index:1}}},
    {deleteParagraphBullets:{range:{startIndex:1,endIndex:3}}}
  ], 'A törés után az üres felsorolás-jelölés nem maradhat meg.');
});

test('A Rétegrendek fejezet mindig új oldalra kerül', () => {
  const pdf = 'Első oldal\nTűzvédelem\nF1 Határoló fal\nRétegrendek\n';
  const requests = orphanRequests(document,pdf);
  assert.ok(requests.some(request => request.insertPageBreak.location.index === 20),
    'A Rétegrendek fejezet nem kezdődhet a szöveg közepén.');
});

test('Ha a cím már az oldal élén áll, nincs szükség oldaltörésre', () => {
  const pdf = 'Első oldal\nTűzvédelem\nTovábbi szöveg\n\fRétegrendek\nF1 Határoló fal\n';
  const requests = orphanRequests(document,pdf);
  assert.deepEqual(requests,[]);
});

test('Az egymás után beszúrt oldaltörésekből csak egy marad', () => {
  const brk = start => ({startIndex:start,endIndex:start + 2,paragraph:{elements:[
    {startIndex:start,endIndex:start + 1,pageBreak:{}},
    {startIndex:start + 1,endIndex:start + 2,textRun:{content:'\n'}}]}});
  const doc = {body:{content:[brk(100),brk(102),brk(104),
    {startIndex:106,endIndex:120,paragraph:{elements:[{textRun:{content:'Rétegrendek\n'}}]}}]}};
  const requests = duplicateBreakRequests(doc);
  assert.equal(requests.length,2);
  assert.deepEqual(requests[0].deleteContentRange.range,{startIndex:104,endIndex:106});
});
