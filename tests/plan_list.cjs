'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../server/domain.cjs');
const projectSheet = require('../server/project-sheet.cjs');
const docs = require('../server/docs.cjs');

function docModel(lines) {
  const content = [];
  let index = 1;
  lines.forEach(line => {
    const text = line + '\n';
    content.push({
      startIndex: index,
      endIndex: index + text.length,
      paragraph: {elements: [{startIndex: index, endIndex: index + text.length, textRun: {content: text}}]}
    });
    index += text.length;
  });
  return {body: {content}};
}

function fakeGoogle({lines, children = []}) {
  const doc = docModel(lines);
  const requests = [];
  return {
    doc, requests,
    async getDoc() {return doc;},
    async batchUpdateDoc(id, batch) {requests.push(...batch); return {};},
    async listChildren() {return children;}
  };
}

test('Tervfajták méretaránya a fájlnévből ismerhető fel', () => {
  const examples = [
    ['HELYSZÍNRAJZ', 'M=1:200'],
    ['udvari szint alaprajza', 'M=1:50'],
    ['Tetőfelülnézet', 'M=1:50'],
    ['Metszetek 2', 'M=1:50'],
    ['Hirdetményi homlokzatok', 'M=1:50'],
    ['Idomtervek', 'M=1:500, 1:200'],
    ['Geodéziai felmérés', 'M=1:200'],
    ['Tervezési program', 'M=1:200'],
    ['Nyílászáró konszignáció', 'M=1:20, 1:50'],
    ['Tető részlet', 'M=1:5, 1:10'],
    ['Kerítés', 'M=1:50'],
    ['Helyszinrajz', 'M=1:200'],
    ['Egyéb', '']
  ];
  examples.forEach(([name, expected]) => {
    assert.equal(domain.getPlanScaleForTitle(name), expected, name);
  });
});

test('PDFA mappából épül a rendezett tervjegyzék, a válasz kiegészíti a méretarányt', async () => {
  const files = [
    {id: '1', name: 'EK-02 Udvari szint alaprajza.pdf', mimeType: 'application/pdf'},
    {id: '2', name: 'EK-01 Helyszínrajz.pdf', mimeType: 'application/pdf'},
    {id: '3', name: 'Homlokzati részlet.pdf', mimeType: 'application/pdf'},
    {id: '4', name: 'Egyéb.pdf', mimeType: 'application/pdf'},
    {id: '5', name: 'Olvasd el.txt', mimeType: 'text/plain'}
  ];
  const google = {
    async listChildren() {
      return [{id: 'pdfa', name: 'PDFA', mimeType: 'application/vnd.google-apps.folder'}];
    }
  };
  google.listChildren = async id => id === 'project'
    ? [{id: 'pdfa', name: 'PDFA', mimeType: 'application/vnd.google-apps.folder'}]
    : files;
  const entries = await projectSheet.getProjectPlanEntries(google, 'project', 'ABC123', {'scale:Egyéb': 'M=1:100'});
  assert.deepEqual(entries.map(entry => [entry.title, entry.scale]), [
    ['EK-01 Helyszínrajz', 'M=1:200'],
    ['EK-02 Udvari szint alaprajza', 'M=1:50'],
    ['Egyéb', 'M=1:100'],
    ['Homlokzati részlet', 'M=1:5, 1:10']
  ]);
});

test('A tervjegyzék csak az ismert sorokat cseréli, a jelölést megtartja', async () => {
  const google = fakeGoogle({
    lines: ['Építészeti tervrajzok', 'EK-01 Régi helyszínrajz\tM=1:200',
      'EK-02 Régi alaprajz\tM=1:50', '[ELLENŐRIZENDŐ: tervpecsét]', 'Adatok']
  });
  assert.equal(await docs.refreshTechnicalPlanList(google, 'doc', []), 0);
  const text = google.requests
    .filter(request => request.insertText)
    .map(request => request.insertText.text)
    .join('');
  assert.match(text, /Nincs PDF tervlap a PDFA mappában\./);
});

test('Változatlan tervjegyzék nem ír a dokumentumba', async () => {
  const google = fakeGoogle({
    lines: ['Építészeti tervrajzok', 'EK-01 Helyszínrajz\tM=1:200', 'Adatok']
  });
  assert.equal(await docs.refreshTechnicalPlanList(google, 'doc',
    [{title: 'EK-01 Helyszínrajz', scale: 'M=1:200'}]), 1);
  assert.equal(google.requests.length, 0);
});
