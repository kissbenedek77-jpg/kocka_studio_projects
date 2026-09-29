const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function iterator(items) {
  let index = 0;
  return {hasNext: () => index < items.length, next: () => items[index++]};
}

function paragraph(text, attributes = {fontFamily: 'Arial Narrow'}) {
  return {
    text, attributes,
    getType() { return 'PARAGRAPH'; },
    getText() { return this.text; },
    getAttributes() { return this.attributes; },
    setAttributes(value) { this.attributes = value; return this; }
  };
}

const children = [
  paragraph('Építészeti tervrajzok'),
  paragraph('EK-01 Régi helyszínrajz\tM=1:200'),
  paragraph('EK-02 Régi alaprajz\tM=1:50'),
  paragraph('[ELLENŐRIZENDŐ: tervpecsét]'),
  paragraph('Adatok')
];
const body = {
  getNumChildren: () => children.length,
  getChild: index => children[index],
  removeChild(child) { children.splice(children.indexOf(child), 1); },
  insertParagraph(index, text) {
    const child = paragraph(text);
    children.splice(index, 0, child);
    return child;
  }
};
let saveCount = 0;
const doc = {getBody: () => body, saveAndClose: () => { saveCount++; }};
let names = [
  'EK-02 Udvari szint alaprajza.pdf',
  'EK-01 Helyszínrajz.pdf',
  'Homlokzati részlet.pdf',
  'Egyéb.pdf',
  'Olvasd el.txt'
];
const pdfFolder = {
  getFiles: () => iterator(names.map(name => ({getName: () => name})))
};
const projectFolder = {
  getFoldersByName: name => iterator(name === 'PDFA' ? [pdfFolder] : [])
};
const context = vm.createContext({
  DocumentApp: {
    openById: () => doc,
    ElementType: {PARAGRAPH: 'PARAGRAPH'}
  }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Kód.js'), 'utf8'), context);

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
  assert.equal(context.getPlanScaleForTitle_(name), expected, name);
});
context.getDashboardAnswers_ = () => ({'scale:Egyéb': 'M=1:100'});
assert.equal(context.getProjectPlanEntries_(projectFolder, 'ABC123')
  .find(entry => entry.title === 'Egyéb').scale, 'M=1:100');

assert.equal(context.refreshTechnicalPlanList_('doc', projectFolder), 4);
assert.deepEqual(children.slice(1, 5).map(child => child.getText()), [
  'EK-01 Helyszínrajz\tM=1:200',
  'EK-02 Udvari szint alaprajza\tM=1:50',
  'Egyéb\tméretarány ellenőrizendő',
  'Homlokzati részlet\tM=1:5, 1:10'
]);
assert.equal(children[5].getText(), '[ELLENŐRIZENDŐ: tervpecsét]');

names = ['EK-03 Bejárati szint alaprajza.pdf'];
assert.equal(context.refreshTechnicalPlanList_('doc', projectFolder), 1);
assert.deepEqual(children.slice(1, 4).map(child => child.getText()), [
  'EK-03 Bejárati szint alaprajza\tM=1:50',
  '[ELLENŐRIZENDŐ: tervpecsét]',
  'Adatok'
]);
assert.equal(context.refreshTechnicalPlanList_('doc', projectFolder), 1);
assert.equal(saveCount, 3);

names = [];
assert.equal(context.refreshTechnicalPlanList_('doc', projectFolder), 0);
assert.equal(children[1].getText(), 'Nincs PDF tervlap a PDFA mappában.');

console.log('Dinamikus tervjegyzék és méretarányok: OK');
