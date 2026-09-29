const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function iterator(items) {
  let index = 0;
  return {hasNext: () => index < items.length, next: () => items[index++]};
}

let nextId = 1;
function folder(name, parent = null) {
  const value = {
    id: String(nextId++), name, parent, children: [],
    getId() { return this.id; },
    getName() { return this.name; },
    getUrl() { return 'https://drive.google.com/drive/folders/' + this.id; },
    getParents() { return iterator(this.parent ? [this.parent] : []); },
    getFoldersByName(target) { return iterator(this.children.filter(child => child.name === target)); },
    createFolder(target) { return folder(target, this); },
    moveTo(destination) {
      this.parent.children = this.parent.children.filter(child => child !== this);
      this.parent = destination;
      destination.children.push(this);
    }
  };
  if (parent) parent.children.push(value);
  return value;
}

const started = folder('Projektek');
const preparation = folder('Előkészítés', started);
let project = folder('Próba projekt', preparation);
const documents = folder('írásos', project);
const messages = [];
let confirmation = 'NO';
let finalizations = 0;
const ui = {
  ButtonSet: {YES_NO: 'YES_NO'}, Button: {YES: 'YES'},
  alert(...args) {
    messages.push(args);
    return args.length === 3 ? confirmation : undefined;
  }
};

const context = vm.createContext({SpreadsheetApp: {getUi: () => ui}});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Kód.js'), 'utf8'), context);
context.getActiveProjectContext = () => ({uid: 'TEST-UID'});
context.getProjectsParentFolder = () => preparation;
context.getExistingProjectFolder = () => project;
context.getFinalizableProjectRecords_ = () => [{type: 'ajanlat'}];
context.finalizeProjectDocuments_ = () => {
  finalizations++;
  return {finalized: 1, pdfCreated: 1, pdfUpdated: 0};
};

context.startSelectedProject();
assert.equal(project.parent, preparation, 'A megszakított indítás nem mozgathat mappát.');
assert.equal(finalizations, 0, 'A megszakított indítás nem véglegesíthet.');

confirmation = 'YES';
context.startSelectedProject();
assert.equal(project.parent, started, 'Az indítás egy szinttel feljebb mozgat.');
assert.equal(finalizations, 1, 'Az indítás véglegesíti a belső dokumentumokat.');

confirmation = 'NO';
context.closeSelectedProject();
assert.equal(project.parent, started, 'A megszakított lezárás nem mozgathat mappát.');
assert.equal(started.getFoldersByName('_Lezárt').hasNext(), false, 'Megszakításkor archív mappa sem jöhet létre.');

confirmation = 'YES';
context.closeSelectedProject();
assert.equal(project.parent.name, '_Lezárt', 'A lezárás az archívumba mozgat.');
assert.equal(project.parent.parent, started, 'Az archívum az aktív projektek alatt van.');
assert.equal(documents.parent, project, 'Az almappák a projektmappában maradnak.');

project = folder('Ütköző projekt', preparation);
folder('Ütköző projekt', started);
context.startSelectedProject();
assert.equal(project.parent, preparation, 'Névütközéskor a projekt helyben marad.');
assert.equal(finalizations, 1, 'Névütközéskor nincs részleges véglegesítés.');
assert.match(String(messages.at(-1)[0]), /már van ilyen nevű projektmappa/);

console.log('Projektindítás és lezárás szimuláció: OK');
