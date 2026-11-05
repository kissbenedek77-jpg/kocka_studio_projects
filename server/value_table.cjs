'use strict';

// Az építményérték-táblázat kitöltése. A táblázat a sablonban áll: az első
// adatsor a minta (rendeltetési kategória neve, egység, egységár, terület,
// érték), az utolsó sor pedig a „MINDÖSSZESEN”. A kitöltés a minta alapján
// írja a cím és az egységár oszlopot, a terület és az egységár szorzatából
// számítja az értéket, az utolsó sorban pedig összegez. A modul csak
// kéréseket állít elő, a Google Docs hívásokat a hívó végzi.
//
// Oszlopok (a sablon és a korábbi működés szerint):
//   0 = cím (rendeltetési kategória), 1 = egység, 2 = egységár,
//   3 = terület, 4 = érték.

const TOTAL_LABEL = 'MINDÖSSZESEN';
const COLUMN = {label:0,unit:1,price:2,area:3,value:4};
const DEFAULT_VALUE_UNIT = 'E Ft';

function paragraphText(item) {
  return (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
}

function cellText(tableCell) {
  return (tableCell?.content || []).map(item => item.paragraph ? paragraphText(item) : '')
    .join('').replace(/\n$/,'');
}

// A táblázatot a záró „MINDÖSSZESEN” soráról ismerjük fel. A helyiséglista
// utolsó sora „Mindösszesen”, ezért csak a csupa nagybetűs alak számít, és a
// táblázatnak legalább öt oszlopa kell legyen.
function findValueTable(document) {
  for (const item of document?.body?.content || []) {
    if (!item.table) continue;
    const rows = item.table.tableRows || [];
    if (rows.length < 2) continue;
    if ((rows[0]?.tableCells || []).length <= COLUMN.value) continue;
    const last = rows[rows.length - 1];
    if (cellText(last.tableCells?.[0]).trim() !== TOTAL_LABEL) continue;
    return item;
  }
  return null;
}

// Szám a cella szövegéből. A magyar alakot (ezres pont, tizedes vessző) és az
// angol alakot is kezeli: „45,28 m²”, „1 234,5”, „45.28”.
function parseNumber(text) {
  const raw = String(text ?? '').replace(/[^\d.,-]/g,'').trim();
  if (!raw) return null;
  let normalized = raw;
  if (raw.includes(',')) normalized = raw.replace(/\./g,'').replace(',','.');
  else if ((raw.match(/\./g) || []).length > 1) normalized = raw.replace(/\./g,'');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function formatNumber(value, decimals) {
  const text = decimals ? value.toFixed(decimals) : String(Math.round(value));
  return text.replace('.',',').replace(/\B(?=(\d{3})+(?!\d)(?:,|$))/g,' ');
}

// A számot a cella meglévő szövegében cseréli, így a minta szerinti utótag
// (például „ m²”, „ E Ft/m²”) és a környező szöveg megmarad.
function replaceNumber(text, value, decimals) {
  const original = String(text ?? '');
  const match = /-?\d[\d\s\u00a0.,]*/.exec(original);
  if (!match) return formatNumber(value,decimals);
  // A záró szóköz a mértékegység előtt maradjon meg.
  const matched = match[0].replace(/[\s\u00a0]+$/,'');
  return original.slice(0,match.index) + formatNumber(value,decimals) +
    original.slice(match.index + matched.length);
}

// Egy cella teljes tartalmának helye (az első bekezdés eleje – az utolsó vége).
function cellRange(tableCell) {
  const content = tableCell?.content || [];
  const start = content[0]?.startIndex;
  const end = content[content.length - 1]?.endIndex;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  return {start,end:Math.max(start,end - 1)};
}

function setCell(edits, tableCell, text) {
  const range = cellRange(tableCell);
  if (!range) return false;
  const current = cellText(tableCell).trim();
  if (current === String(text).trim()) return false;
  edits.push({...range,text:String(text)});
  return true;
}

function toRequests(edits) {
  return edits.sort((a,b) => b.start - a.start).map(edit => {
    const parts = [];
    if (edit.end > edit.start)
      parts.push({deleteContentRange:{range:{startIndex:edit.start,endIndex:edit.end}}});
    if (edit.text) parts.push({insertText:{location:{index:edit.start},text:edit.text}});
    return parts;
  }).flat();
}

// Az érték oszlop mindig „E Ft” utótaggal jelenik meg.
function ensureValueUnit(text) {
  const value = String(text ?? '');
  return /E\s*Ft\s*$/i.test(value.trim()) ? value : value + ' ' + DEFAULT_VALUE_UNIT;
}

// A /technical űrlapról érkező, jogszabályi soronkénti területek alapján
// kitölti a dokumentum építményérték-táblázatát. Csak a megadott sorokat
// tölti ki, a többit üríti; az utolsó sor az összesítés.
function valueTableRowRequests(table, rows = []) {
  const tableRows = table?.table?.tableRows || [];
  const totalIndex = tableRows.length - 1;
  if (totalIndex < 0) return {requests:[],rows:[],total:0};
  const dataRows = tableRows.slice(0,totalIndex);
  const edits = [];
  let total = 0;
  rows.forEach((row,index) => {
    const cells = dataRows[index]?.tableCells || [];
    if (cells.length <= COLUMN.value) return;
    const price = Number(row.price) || 0;
    const area = Number(row.area) || 0;
    const value = area * price;
    setCell(edits,cells[COLUMN.label],`${row.number}. ${row.label}`);
    setCell(edits,cells[COLUMN.unit],'E Ft/m2');
    setCell(edits,cells[COLUMN.price],formatNumber(price,0));
    setCell(edits,cells[COLUMN.area],formatNumber(area,2)+' m²');
    setCell(edits,cells[COLUMN.value],formatNumber(value,0)+' E Ft');
    total += value;
  });
  for (let index=rows.length; index<dataRows.length; index++) {
    const cells = dataRows[index].tableCells || [];
    if (cells.length <= COLUMN.value) continue;
    for (const column of [COLUMN.label,COLUMN.unit,COLUMN.price,COLUMN.area,COLUMN.value])
      setCell(edits,cells[column],'');
  }
  const totalCells = tableRows[totalIndex]?.tableCells || [];
  if (totalCells.length > COLUMN.value)
    setCell(edits,totalCells[COLUMN.value],formatNumber(total,0)+' E Ft');
  return {requests:toRequests(edits),rows,total};
}

// A táblázat kitöltése. A `fallback` a minta hiányzó celláinak tartaléka
// (rendeltetési kategória neve és egységára soronként), hogy a cím és az
// egységár a jogszabályi mintából is bekerülhessen.
function valueTableRequests(document, {fallback = []} = {}) {
  const table = findValueTable(document);
  if (!table) return null;
  const rows = table.table.tableRows || [];
  const totalIndex = rows.length - 1;
  const edits = [];
  const summary = [];
  let total = 0;
  for (let rowIndex = 0; rowIndex < totalIndex; rowIndex++) {
    const cells = rows[rowIndex].tableCells || [];
    if (cells.length <= COLUMN.value) continue;
    const area = parseNumber(cellText(cells[COLUMN.area]));
    if (!area || area <= 0) continue;
    const price = parseNumber(cellText(cells[COLUMN.price])) ??
      parseNumber(fallback[rowIndex]?.price);
    // Egységár nélkül nem számolunk értéket: adatot nem találunk ki.
    if (!price || price <= 0) continue;
    const areaCents = Math.round(area * 100);
    const value = areaCents * price / 100;
    const label = cellText(cells[COLUMN.label]).trim() ||
      String(fallback[rowIndex]?.label || '').trim();
    if (label) setCell(edits,cells[COLUMN.label],label);
    setCell(edits,cells[COLUMN.price],replaceNumber(cellText(cells[COLUMN.price]),price,0));
    setCell(edits,cells[COLUMN.area],replaceNumber(cellText(cells[COLUMN.area]),areaCents/100,2));
    const valueText = ensureValueUnit(replaceNumber(cellText(cells[COLUMN.value]),value,0));
    setCell(edits,cells[COLUMN.value],valueText);
    total += value;
    summary.push({label,area:areaCents/100,price,value});
  }
  if (!summary.length) return {requests:[],rows:summary,total:0};
  const totalCells = rows[totalIndex].tableCells || [];
  if (totalCells.length > COLUMN.value) {
    const totalText = ensureValueUnit(
      replaceNumber(cellText(totalCells[COLUMN.value]),total,0));
    setCell(edits,totalCells[COLUMN.value],totalText);
  }
  return {requests:toRequests(edits),rows:summary,total};
}

module.exports = {TOTAL_LABEL,COLUMN,findValueTable,cellText,parseNumber,formatNumber,
  replaceNumber,valueTableRequests,valueTableRowRequests};
