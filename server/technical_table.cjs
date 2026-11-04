'use strict';

// A műszaki leírás „Tervezési adatok” táblázatának projekt szintű igazítása.
//
// A dokumentumsablon statikus: mindig tartalmazza az összes beépítési paraméter
// sort és a „Meglévő” oszlopot. A generált példányból viszont el kell hagyni
// azokat a részeket, amelyek mögött nincs tényszerű adat:
//   - „Meglévő” oszlop: csak akkor marad, ha a Munkalap1 E6/E8/E9 és L2/L5/L7
//     celláiban van érték (tehát van meglévő épületre vonatkozó adat). A telek
//     területe (E2/I2) szándékosan nem számít, mert az nem meglévő építmény;
//   - beépítési paraméter sor: csak akkor marad, ha legalább egy adatcellájában
//     van kitöltött érték. Az üres sor a kész dokumentumban nem jelenik meg.
//
// A függvény tiszta: a dokumentum kiolvasott szerkezetéből és a behelyettesítendő
// értékekből számolja a Google Docs batchUpdate kéréseit.

const HEADER = 'Megengedett';
const EXISTING_COLUMN = 'Meglévő';
const FLOOR_AREA_ROW = 'Szintterületi mutató';
const EXISTING_ADDRESSES = ['E6','E8','E9','L2','L5','L7'];
const MARKER = /\{\{([^{}]+)\}\}/g;

function cellText(cell) {
  return (cell?.content || []).map(item => (item.paragraph?.elements || [])
    .map(part => part.textRun?.content || '').join('')).join('')
    .replace(/\s+/g,' ').trim();
}

function tableRows(table) {
  return (table?.tableRows || []).map(row => (row.tableCells || []).map(cellText));
}

function findDataTable(document) {
  for (const item of document?.body?.content || []) {
    if (!item.table) continue;
    const rows = tableRows(item.table);
    if (rows[0]?.some(text => text.includes(HEADER)))
      return {startIndex:item.startIndex, rows};
  }
  return null;
}

function hasExistingData(values = {}) {
  return EXISTING_ADDRESSES.some(address =>
    String(values['TERVEZESI_ADATOK:Munkalap1!'+address] ?? '').trim());
}

function hasFloorAreaRatio(values = {}) {
  return Boolean(String(values['TERVEZESI_ADATOK:Munkalap1!B7'] ?? '').trim());
}

// Egy táblázatcella akkor tartalmaz adatot, ha a benne lévő {{...}} jelölők
// helyére tényleges érték kerül, vagy ha a cella saját (jelölőn kívüli) szövege
// nem üres. Az ismeretlen jelölő üresnek számít: a kész dokumentumban sem
// jelenne meg mögötte adat.
function cellHasData(text, values = {}) {
  let hasData = false;
  const literal = String(text ?? '').replace(MARKER, (all,rawKey) => {
    const value = String(values[String(rawKey).trim()] ?? '').trim();
    if (value) hasData = true;
    return value;
  }).trim();
  return hasData || Boolean(literal);
}

function rowHasData(row, values = {}, skipColumn = -1) {
  for (let column = 1; column < row.length; column++) {
    if (column === skipColumn) continue;
    if (cellHasData(row[column],values)) return true;
  }
  return false;
}

function technicalTableRequests(document, values = {}) {
  const table = findDataTable(document);
  if (!table) return [];
  const requests = [];
  const columnIndex = table.rows[0].findIndex(text => text.includes(EXISTING_COLUMN));
  const deleteColumn = columnIndex >= 0 && !hasExistingData(values);
  if (deleteColumn) requests.push({deleteTableColumn:{tableCellLocation:{
    tableStartLocation:{index:table.startIndex}, rowIndex:0, columnIndex}}});
  // A fejlécet nem töröljük. Az üres sorokat alulról felfelé töröljük, hogy a
  // korábbi sorok indexe érvényben maradjon. A törölt „Meglévő” oszlop tartalma
  // nem számít adatnak, hiszen az a kész dokumentumból eltűnik.
  const skipColumn = deleteColumn ? columnIndex : -1;
  const emptyRows = new Set();
  for (let rowIndex = 1; rowIndex < table.rows.length; rowIndex++)
    if (!rowHasData(table.rows[rowIndex],values,skipColumn)) emptyRows.add(rowIndex);
  // A szintterületi mutató sora csak akkor marad, ha van rá előírás (B7). A sor
  // saját „m²/m²” utótagja miatt egyébként adattal rendelkezőnek látszana.
  if (!hasFloorAreaRatio(values)) {
    const floorAreaRow = table.rows.findIndex(row =>
      String(row?.[0] || '').includes(FLOOR_AREA_ROW));
    if (floorAreaRow > 0) emptyRows.add(floorAreaRow);
  }
  [...emptyRows].sort((a,b) => b-a).forEach(rowIndex => requests.push({deleteTableRow:{
    tableCellLocation:{tableStartLocation:{index:table.startIndex},rowIndex,columnIndex:0}}}));
  return requests;
}

module.exports = {hasExistingData, hasFloorAreaRatio, findDataTable, cellHasData, rowHasData,
  technicalTableRequests};
