'use strict';

// A műszaki leírás „Tervezési adatok” táblázatának projekt szintű igazítása.
//
// A dokumentumsablon statikus: mindig tartalmazza a „Meglévő” oszlopot és a
// „Szintterületi mutató” sort. A generált példányból viszont el kell hagyni őket,
// ha nincs mögöttük tényszerű adat:
//   - „Meglévő” oszlop: csak akkor marad, ha a Munkalap1 E6/E8/E9 és L2/L5/L7
//     celláiban van érték (tehát van meglévő épületre vonatkozó adat);
//   - „Szintterületi mutató” sor: csak akkor marad, ha a B7 cellában van
//     övezeti/hatósági követelmény.
//
// A függvény tiszta: a dokumentum kiolvasott szerkezetéből és a behelyettesítendő
// értékekből számolja a Google Docs batchUpdate kéréseit.

const HEADER = 'Megengedett';
const EXISTING_COLUMN = 'Meglévő';
const FLOOR_AREA_ROW = 'Szintterületi mutató';
const EXISTING_ADDRESSES = ['E6','E8','E9','L2','L5','L7'];

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

function technicalTableRequests(document, values = {}) {
  const table = findDataTable(document);
  if (!table) return [];
  const requests = [];
  if (!hasExistingData(values)) {
    const columnIndex = table.rows[0].findIndex(text => text.includes(EXISTING_COLUMN));
    if (columnIndex >= 0) requests.push({deleteTableColumn:{tableCellLocation:{
      tableStartLocation:{index:table.startIndex}, rowIndex:0, columnIndex}}});
  }
  if (!hasFloorAreaRatio(values)) {
    const rowIndex = table.rows.findIndex(row => String(row[0] || '').includes(FLOOR_AREA_ROW));
    if (rowIndex > 0) requests.push({deleteTableRow:{tableCellLocation:{
      tableStartLocation:{index:table.startIndex}, rowIndex, columnIndex:0}}});
  }
  return requests;
}

module.exports = {hasExistingData, hasFloorAreaRatio, findDataTable, technicalTableRequests};
