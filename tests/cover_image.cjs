const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function iterator(items) {
  let index = 0;
  return {hasNext: () => index < items.length, next: () => items[index++]};
}

function file(name, mime = 'image/jpeg') {
  return {
    getName: () => name,
    getMimeType: () => mime,
    getLastUpdated: () => new Date('2026-09-28T12:00:00Z'),
    getBlob: () => name
  };
}

let names = [
  file('a_1 - Photo.jpg'),
  file('b_1 - Photo.jpg'),
  file('b_2 - Photo.jpg'),
  file('b11.lsf', 'video/x-la-asf'),
  file('d_1 - Photo.jpg'),
  file('d_2 - Photo.jpg')
];
const folder = {getFiles: () => iterator(names)};
const project = {getFoldersByName: name => iterator(name === 'Render' ? [folder] : [])};

let removed = '';
let added = null;
const oldImage = {
  getId: () => 'cover-old',
  getWidth: () => 808,
  getHeight: () => 454,
  getLayout: () => 'ABOVE_TEXT',
  getLeftOffset: () => -84,
  getTopOffset: () => -72
};
const firstParagraph = {
  getText: () => '',
  getPositionedImages: () => [oldImage],
  addPositionedImage(blob) {
    added = {
      blob,
      setWidth(value) { this.width = value; return this; },
      setHeight(value) { this.height = value; return this; },
      setLayout(value) { this.layout = value; return this; },
      setLeftOffset(value) { this.left = value; return this; },
      setTopOffset(value) { this.top = value; return this; }
    };
    return added;
  },
  removePositionedImage: id => { removed = id; }
};
let saves = 0;
const doc = {
  getBody: () => ({getParagraphs: () => [firstParagraph, {
    getText: () => 'Címoldal', getPositionedImages: () => []
  }]}),
  saveAndClose: () => { saves++; }
};
const context = vm.createContext({DocumentApp: {openById: () => doc}});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Kód.js'), 'utf8'), context);

assert.equal(context.getLatestRenderCoverFile_(project).getName(), 'd_1 - Photo.jpg');
assert.equal(context.refreshTechnicalCoverImage_('doc', project), true);
assert.deepEqual(
  {blob: added.blob, width: added.width, height: added.height,
    layout: added.layout, left: added.left, top: added.top},
  {blob: 'd_1 - Photo.jpg', width: 808, height: 454,
    layout: 'ABOVE_TEXT', left: -84, top: -72}
);
assert.equal(removed, 'cover-old');
assert.equal(saves, 1);

names = [file('a_1 - Photo.jpg'), file('b_2 - Photo.jpg')];
assert.throws(
  () => context.getLatestRenderCoverFile_(project),
  /hiányzik az 1\. számú kép/
);
names = [file('notes.txt', 'text/plain')];
assert.equal(context.refreshTechnicalCoverImage_('doc', project), false);

console.log('Render címlapkép kiválasztása és formázása: OK');
