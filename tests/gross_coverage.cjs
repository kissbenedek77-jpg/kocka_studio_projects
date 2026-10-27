'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const docs = require('../server/docs.cjs');

function textParagraph(text, start = 1) {
  const content = text + '\n';
  return {
    startIndex: start,
    endIndex: start + content.length,
    paragraph: {
      elements: [{startIndex: start, endIndex: start + content.length, textRun: {content}}],
      paragraphStyle: {alignment: 'START'}
    }
  };
}

function tableCell(text) {
  return {content: [textParagraph(text)]};
}

function tableRow(cells) {
  return {tableCells: cells.map(tableCell)};
}

function fakeGoogle({area = '252,3', percent = '22,53%', caption}) {
  const paragraph = textParagraph(caption);
  const table = {
    startIndex: 500,
    endIndex: 560,
    table: {tableRows: [tableRow(['Beépítési százalék:', '25 %', '21,9 %'])]}
  };
  const doc = {body: {content: [paragraph, table]}};
  const requests = [];
  return {
    requests,
    async valuesIn() {return [[area, '', percent]];},
    async getDoc() {return doc;},
    async batchUpdateDoc(id, batch) {requests.push(...batch); return {};}
  };
}

function insertedText(requests) {
  return requests.filter(request => request.insertText).map(request => request.insertText.text);
}

test('Bruttó beépítési százalék a H2/J2 adatokból a bekezdésbe és a táblázatba kerül', async () => {
  const google = fakeGoogle({caption: 'Bruttó beépítési százalék földszinten:\t\t\t21,9% (220,99 m2)'});
  await docs.refreshTechnicalGrossCoverage(google, 'doc', {id: 'sheet'});
  const texts = insertedText(google.requests);
  assert.ok(texts.some(text => text === 'Bruttó beépítési százalék földszinten:\t\t\t22,53% (252,3 m²)'),
    texts.map(text => JSON.stringify(text)).join('|'));
  assert.ok(texts.includes('22,53%'), texts.join('|'));
});

test('Hiányzó H2/J2 esetén a szinkron hibát jelez', async () => {
  const google = fakeGoogle({percent: '', caption: 'Bruttó beépítési százalék földszinten:\t21,9%'});
  await assert.rejects(() => docs.refreshTechnicalGrossCoverage(google, 'doc', {id: 'sheet'}),
    /H2\/J2/);
});
