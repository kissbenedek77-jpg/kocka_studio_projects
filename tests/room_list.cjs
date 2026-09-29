const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function iterator(items) {
  let index = 0;
  return {hasNext: () => index < items.length, next: () => items[index++]};
}
function paragraph(text, type = 'PARAGRAPH') {
  return {
    getType: () => type,
    getText: () => text,
    editAsText: () => ({
      deleteText(start, end) { text = text.slice(0, start) + text.slice(end + 1); },
      insertText(start, value) { text = text.slice(0, start) + value + text.slice(start); },
      setForegroundColor() {}
    })
  };
}
function table(rows) {
  return {
    rows,
    widths: {},
    getType: () => 'TABLE',
    getNumRows: () => rows.length,
    setColumnWidth(column, width) { this.widths[column] = width; return this; },
    getRow: r => ({getText: () => rows[r].join(' '), getNumCells: () => rows[r].length, getCell: c => ({getText: () => rows[r][c]})}),
    getCell: (r, c) => ({
      getText: () => rows[r][c],
      setPaddingTop(value) { this.paddingTop = value; return this; },
      setPaddingBottom(value) { this.paddingBottom = value; return this; },
      setPaddingLeft(value) { this.paddingLeft = value; return this; },
      setPaddingRight(value) { this.paddingRight = value; return this; },
      getChild: () => ({asParagraph: () => ({editAsText: () => ({setBold() {}})})})
    })
  };
}

let rows = [
  ['| Helyiség szintjének neve | Helyiségkategória kódja | Helyiségkategória neve | Helyiség száma | Helyiség neve | Padlószint | Belmagasság | Mért terület'],
  ['1 | Udvari szint | | Általános | <Szobaszám> | fürdő | 0,00 | 3,30 | 7,20'],
  ['3 | Udvari szint | | Általános | <Szobaszám> | szoba | 0,00 | 3,30 | 41,28'],
  ['1 | Bejárati szint | | Általános | <Szobaszám> | előtér | 3,30 | 2,80 | 10,05'],
  ['| | | | | | | | 58,52']
];
let summaryValue = '';
let summaryFormat = '';
let summaryRange = '';
const summaryCell = {
  getValue: () => summaryValue,
  setValue(value) { summaryValue = value; },
  setNumberFormat(value) { summaryFormat = value; }
};
const summarySheet = {getRange: key => { summaryRange = key; return summaryCell; }};
const children = [
  paragraph('Helyiségek', 'LIST_ITEM'),
  paragraph('Helyiséglista: régi placeholder'),
  paragraph(''),
  table([['Db', 'Szint', 'Helyiség'], ['1', 'Udvari szint', 'fürdő']]),
  paragraph('[ELLENŐRIZENDŐ: a Sheetben a 3 szoba együtt 41,28 m².]'),
  paragraph('Következő szakasz'),
  paragraph('Lakószintek összes nettó alapterülete összesen:\t\t251,55 m2')
];
let insertCount = 0;
const body = {
  getNumChildren: () => children.length,
  getChild: index => children[index],
  removeChild: child => children.splice(children.indexOf(child), 1),
  insertTable(index, cells) { insertCount++; const child = table(cells); children.splice(index, 0, child); return child; },
  insertParagraph(index, text) { const child = paragraph(text); children.splice(index, 0, child); return child; }
};
const projectFolder = {
  getFoldersByName: name => iterator(name === 'Írásos'
    ? [{getFilesByType: () => iterator([{getName: () => 'Tervezési adatok - próba', getId: () => 'sheet'}])}]
    : name === 'PLN'
      ? [{getFiles: () => iterator([{getName: () => 'helyiséglista.txt', getBlob: () => ({getDataAsString: () => rows.map(row => row[0]).join('\n')})}])}]
      : []),
  getFilesByType: () => iterator([])
};
const context = vm.createContext({
  MimeType: {GOOGLE_SHEETS: 'sheet'},
  SpreadsheetApp: {openById: () => ({getSheetByName: name => name === 'Munkalap1' ? summarySheet : null})},
  DocumentApp: {openById: () => ({getBody: () => body, saveAndClose() {}}), ElementType: {PARAGRAPH: 'PARAGRAPH', LIST_ITEM: 'LIST_ITEM', TABLE: 'TABLE'}}
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Kód.js'), 'utf8'), context);

assert.equal(context.refreshTechnicalRoomList_('doc', projectFolder), 3);
assert.deepEqual(children[1].widths, {0: 210, 1: 80});
assert.equal(summaryValue, 58.53);
assert.equal(summaryRange, 'H7');
assert.equal(summaryFormat, '0.00');
assert.match(children.at(-1).getText(), /58,53 m²$/);
assert.deepEqual(JSON.parse(JSON.stringify(children[1].rows)), [
  ['Helyiség', 'Terület (m²)'],
  ['Udvari szint', ''],
  ['fürdő', '7,20'],
  ['szoba', '41,28'],
  ['Udvari szint összesen', '48,48'],
  ['Bejárati szint', ''],
  ['előtér', '10,05'],
  ['Bejárati szint összesen', '10,05'],
  ['Teljes összesen', '58,53']
]);
assert.match(children[2].getText(), /58,53 m².*58,52 m²/);
assert.equal(children[3].getText(), 'Következő szakasz');

rows[4][0] = '| | | | | | | | 58,53';
assert.equal(context.refreshTechnicalRoomList_('doc', projectFolder), 3);
assert.equal(children[2].getText(), 'Következő szakasz');
assert.equal(context.refreshTechnicalRoomList_('doc', projectFolder), 3);
assert.equal(insertCount, 2);

const valueRows = [
  ['Lakó, üdülő, kulturális épület', 'E Ft/m2', '180', '251,55 m2', '45.279e'],
  ['MINDÖSSZESEN', '', '', '', '45.279e']
];
const valueTable = {
  getType: () => 'TABLE',
  getNumRows: () => valueRows.length,
  getRow: rowIndex => ({
    getNumCells: () => valueRows[rowIndex].length,
    getCell: colIndex => ({
      getText: () => valueRows[rowIndex][colIndex],
      getChild: () => ({asParagraph: () => ({editAsText: () => ({
        deleteText(start, end) {
          const value = valueRows[rowIndex][colIndex];
          valueRows[rowIndex][colIndex] = value.slice(0, start) + value.slice(end + 1);
        },
        insertText(start, text) {
          const value = valueRows[rowIndex][colIndex];
          valueRows[rowIndex][colIndex] = value.slice(0, start) + text + value.slice(start);
        },
        setForegroundColor() {}
      })})})
    })
  })
};
const valueBody = {getNumChildren: () => 1, getChild: () => valueTable};
assert.equal(context.writeBuildingValueToDocument_(valueBody, 11053), true);
assert.deepEqual(valueRows[0].slice(2), ['600', '110,53 m²', '66 318 E Ft']);
assert.equal(valueRows[1][4], '66 318 E Ft');
assert.equal(context.writeBuildingValueToDocument_(valueBody, 11053), true);
assert.throws(() => context.writeBuildingValueToDocument_(valueBody, 0), /nettó helyiségterület/);

const fireChildren = [
  paragraph('A mértékadó tűzszakasz nagysága: \t251,55 m2'),
  paragraph('teherhordó falak min. D REI 15 \t30 cm vtg. vázkerámia \tmegfelel'),
  paragraph('födémek min. D REI 15 \tmonolit vb födém\tmegfelel'),
  paragraph('fedélszerkezet min. D \tfa tetőszerkezet \tmegfelel'),
  paragraph('Rétegrendek:'),
  paragraph('F1 Határoló fal'),
  paragraph('38 cm \tPorotherm N+F 38 kerámia falazóelem'),
  paragraph('F3 Pincefal'),
  paragraph('30 cm \tPorotherm 30 kerámia pincefalazó elem'),
  paragraph('P2 Belső padló'),
  paragraph('15 cm \tmonolit vasbeton födém tartószerkezeti terv szerint'),
  paragraph('T4 Magastető'),
  paragraph('szaruzat')
];
const fireBody = {getNumChildren: () => fireChildren.length, getChild: index => fireChildren[index]};
context.writeFireProtectionFromLayers_(fireBody, 11053);
assert.match(fireChildren[0].getText(), /110,53 m²/);
assert.match(fireChildren[1].getText(), /38 cm Porotherm N\+F 38.*30 cm Porotherm 30/);
assert.match(fireChildren[2].getText(), /15 cm monolit vasbeton födém \(P2\)/);
assert.match(fireChildren[3].getText(), /szaruzat \(T4\)/);
assert.ok(fireChildren.slice(1, 4).every(item => /ellenőrizendő/.test(item.getText())));
const fireResult = fireChildren.slice(0, 4).map(item => item.getText());
context.writeFireProtectionFromLayers_(fireBody, 11053);
assert.deepEqual(fireChildren.slice(0, 4).map(item => item.getText()), fireResult);
context.writeFireProtectionFromLayers_(fireBody, 12000, 11053);
assert.match(fireChildren[0].getText(), /120,00 m²/);
const manualFireChildren = fireChildren.slice();
manualFireChildren[0] = paragraph('A mértékadó tűzszakasz nagysága: 90,00 m²');
context.writeFireProtectionFromLayers_(
  {getNumChildren: () => manualFireChildren.length, getChild: index => manualFireChildren[index]},
  13000, 12000
);
assert.match(manualFireChildren[0].getText(), /90,00 m²/);

const spaces = '\u00a0'.repeat(8);
const variantChildren = [
  paragraph('·' + spaces + 'teherhordó falak min. D REI 15' + spaces + '30 cm vtg. vázkerámia' + spaces + 'megfelel'),
  paragraph('·' + spaces + 'födémek min. D REI 15' + spaces + 'fa födém tűzgátló gk burkolattal' + spaces + 'megfelel'),
  paragraph('·' + spaces + 'fedélszerkezet min. D' + spaces + 'fa tetőszerkezet' + spaces + 'megfelel'),
  paragraph('Rétegrendek:'),
  paragraph('F1 Határoló fal'),
  paragraph('30 cm vtg. vázkerámia falazat'),
  paragraph('P2 Belső födém'),
  paragraph('20 cm fa födém'),
  paragraph('2 × 15 mm tűzgátló gipszkarton burkolat'),
  paragraph('T4 Magastető'),
  paragraph('fa tetőszerkezet')
];
const variantBody = {getNumChildren: () => variantChildren.length, getChild: index => variantChildren[index]};
context.writeFireProtectionFromLayers_(variantBody, 11053);
assert.match(variantChildren[0].getText(), /30 cm vtg\. vázkerámia falazat \(F1\)/);
assert.match(variantChildren[1].getText(), /20 cm fa födém; 2 × 15 mm tűzgátló gipszkarton burkolat \(P2\)/);
assert.match(variantChildren[2].getText(), /fa tetőszerkezet \(T4\)/);
assert.ok(variantChildren.slice(0, 3).every(item => /ellenőrizendő/.test(item.getText())));
const variantResult = variantChildren.slice(0, 3).map(item => item.getText());
context.writeFireProtectionFromLayers_(variantBody, 11053);
assert.deepEqual(variantChildren.slice(0, 3).map(item => item.getText()), variantResult);

const placeholder = paragraph('Lakószintek összes nettó alapterülete összesen: {{TERVEZESI_ADATOK:Munkalap1!H7}} m²');
context.writeRoomTotalToDocument_({getNumChildren: () => 1, getChild: () => placeholder}, 11053);
assert.equal(placeholder.getText(), 'Lakószintek összes nettó alapterülete összesen: 110,53 m²');
let areaValue = '251,55 m2';
const areaText = {
  deleteText(start, end) { areaValue = areaValue.slice(0, start) + areaValue.slice(end + 1); },
  insertText(start, value) { areaValue = areaValue.slice(0, start) + value + areaValue.slice(start); },
  setForegroundColor() {}
};
const areaTable = {
  getType: () => 'TABLE',
  getNumRows: () => 1,
  getRow: () => ({
    getNumCells: () => 3,
    getCell: index => index === 0
      ? {getText: () => 'Az építmény összes szintterülete:'}
      : index === 2
        ? {getText: () => areaValue, getChild: () => ({asParagraph: () => ({editAsText: () => areaText})})}
        : {getText: () => '-'}
  })
};
const areaBody = {getNumChildren: () => 1, getChild: () => areaTable};
context.writeRoomTotalToBuildingAreaTable_(areaBody, 11053);
assert.equal(areaValue, '110,53 m2');
context.writeRoomTotalToBuildingAreaTable_(areaBody, 11053);
assert.equal(areaValue, '110,53 m2');
assert.equal(context.buildRoomList_({rooms: [7.20, 3.10, 5.08, 14.18, 8.63, 21.49, 8.33, 41.28, 1.24].map((area, i) => ({floor: 'Udvari szint', name: String(i), area: Math.round(area * 100)})), sourceTotal: 11052}).totalCents, 11053);

const plnRooms = [
  ['terasz', '27,74'], ['szélfogó', '9,36'], ['szoba', '15,50'],
  ['közlekedő', '9,07'], ['nappali', '21,50'], ['konyha+étkező', '13,72'],
  ['gardrób', '2,95'], ['wc', '1,12'], ['fürdő', '6,96'],
  ['háztartási helyiség', '4,90'], ['szoba', '12,31'], ['szoba', '12,99']
];
const plnText = [
  ' | Helyiség szintjének neve | Helyiségkategória kódja | Helyiségkategória neve | Helyiség száma | Helyiség neve | Padlószint | Belmagasság | Mért terület',
  '---|---|---|---|---|---|---|---|---'
].concat(plnRooms.map((room, index) =>
  `1 | Udvari szint | | Általános | ${index + 1} | ${room[0]} | 0,00 | 3,30 | ${room[1]}`
)).concat([' | | | | | | | | 138,12']).join('\r\n');
const plnData = context.parseProjectRoomText_(plnText, 'PLN/helyiséglista.txt');
const plnResult = context.buildRoomList_(plnData);
const preferredFile = context.findProjectRoomFile_({
  getFoldersByName: name => iterator(name === 'PLN' ? [{
    getFiles: () => iterator([
      {getName: () => 'helyiséglista.txt'},
      {getName: () => 'helyiségek.txt'}
    ])
  }] : [])
});
assert.equal(preferredFile.getName(), 'helyiségek.txt');
assert.equal(plnData.rooms.length, 12);
assert.equal(plnData.sourceTotal, 13812);
assert.equal(plnResult.totalCents, 13812);
assert.equal(plnResult.fireAreaCents, 11038);
assert.equal(plnResult.warning, '');
assert.deepEqual(JSON.parse(JSON.stringify(plnResult.rows.slice(-2))), [
  ['Teljes összesen', '138,12'], ['Terasz nélkül', '110,38']
]);
const fireAreaAfterNetUpdate = [paragraph('A mértékadó tűzszakasz nagysága: 110,38 m²')];
context.writeFireProtectionFromLayers_(
  {getNumChildren: () => 1, getChild: () => fireAreaAfterNetUpdate[0]},
  12000, 13812, 11038
);
assert.match(fireAreaAfterNetUpdate[0].getText(), /120,00 m²/);

rows[1][0] = '1 | Udvari szint | | Általános | <Szobaszám> | fürdő | 0,00 | 3,30 | hibás';
assert.throws(() => context.getProjectRoomData_(projectFolder), /2\. sorában/);
rows = plnText.split('\r\n').map(line => [line]);
children.push(paragraph('A mértékadó tűzszakasz nagysága: 58,53 m²'));
assert.equal(context.refreshTechnicalRoomList_('doc', projectFolder), 12);
assert.equal(summaryValue, 138.12);
assert.match(children.find(item => item.getText && /^A mértékadó tűzszakasz nagysága:/.test(item.getText())).getText(), /110,38 m²/);
assert.match(children.find(item => item.getText && /^Lakószintek összes nettó alapterülete/.test(item.getText())).getText(), /138,12 m²/);
rows[3][0] = rows[3][0].replace('9,36', '9,37');
assert.equal(context.refreshTechnicalRoomList_('doc', projectFolder), 12);
assert.equal(summaryValue, 138.13);
assert.match(children.find(item => item.getText && /^A mértékadó tűzszakasz nagysága:/.test(item.getText())).getText(), /110,39 m²/);
console.log('Szintenkénti helyiséglista és összegek: OK');
