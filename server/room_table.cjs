'use strict';

// A helyiséglista a dokumentumban kétdobozos táblázatként jelenik meg: a
// szintfejek, az alszummák és a teljes összeg saját sorban, a fejléc félkövér.
// A modul csak kéréseket állít elő, a Google Docs hívásokat a hívó végzi.

const MARKER = '{{HELYISEGLISTA}}';
// A Google Docs hosszúság-egységei PT-ben.
const PT_PER_UNIT = {PT:1,IN:72,CM:72/2.54,MM:72/25.4,PX:0.75};
// A4 álló lap szövegtükre a szokásos 2,5 cm-es margókkal, ha a dokumentum
// stílusa nem ad használható lapszélességet (595,28 − 2 × 70,85 PT).
const A4_TEXT_WIDTH_PT = 453.57;
// A cellakitöltés 0,1 cm (1 cm = 28,3465 PT).
const PADDING_PT = 2.83;
// A helyiségnevek és az alszummák behúzása kb. 1 cm-rel.
const INDENT_PT = 28.35;
// A táblázat a szövegtükör felét tölti ki; azon belül a megnevezés 7/8, a
// terület 1/8.
const TABLE_WIDTH_RATIO = 0.5;
// A teljes összeg nagyobb betűvel, a fejléc és az alszummák félkövéren.
const GRAND_TOTAL_PT = 11;

function paragraphText(item) {
  return (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
}

function findMarker(document, marker = MARKER) {
  for (const item of document?.body?.content || []) {
    if (!item.paragraph) continue;
    if (!paragraphText(item).includes(marker)) continue;
    const base = Number.isInteger(item.startIndex) ? item.startIndex
      : item.paragraph.elements?.[0]?.startIndex;
    if (!Number.isInteger(base)) continue;
    const startIndex = base + paragraphText(item).indexOf(marker);
    return {startIndex, endIndex:startIndex + marker.length};
  }
  return null;
}

// 1. fázis: a jelölő szövegének törlése és a táblázat beszúrása a helyére.
// A tervjegyzék egyetlen tervlapnál is táblázat, ezért ott az egy soros
// táblázat is megengedett.
function insertRequests(marker, rows, columns = 2, {allowSingleRow = false} = {}) {
  if (!marker || !Array.isArray(rows) || rows.length < (allowSingleRow ? 1 : 2)) return [];
  return [
    {deleteContentRange:{range:{startIndex:marker.startIndex,endIndex:marker.endIndex}}},
    {insertTable:{location:{index:marker.startIndex},rows:rows.length,columns}}
  ];
}

// 2. fázis: a beszúrt, még üres táblázat megkeresése a friss dokumentumban.
function findEmptyTable(document, rows, columns = 2) {
  for (const item of document?.body?.content || []) {
    if (!item.table) continue;
    const tableRows = item.table.tableRows || [];
    if (tableRows.length !== rows.length) continue;
    if ((tableRows[0]?.tableCells || []).length !== columns) continue;
    const empty = tableRows.every(row => (row.tableCells || []).every(cell =>
      (cell.content || []).every(part => !paragraphText(part).trim())));
    if (empty) return item;
  }
  return null;
}

// 3. fázis: a cellák feltöltése és a fejléc félkövérré tétele. A fejléc nélküli
// táblázatnál (például a tervjegyzék) a félkövér kiemelés elmarad.
function fillRequests(table, rows, {header = true} = {}) {
  const values = [];
  const narrow = [];
  (table.table.tableRows || []).forEach((row, rowIndex) => {
    (row.tableCells || []).forEach((cell, columnIndex) => {
      const text = String(rows[rowIndex]?.[columnIndex] ?? '').trim();
      if (!text) return;
      const content = cell.content || [];
      const start = content[0]?.startIndex;
      const end = content[content.length - 1]?.endIndex;
      if (start === undefined) return;
      values.push({start, end:(end ?? start + 1) - 1, text});
      if (header && rowIndex === 0) narrow.push({start, end:start + text.length});
    });
  });
  const requests = values.sort((a, b) => b.start - a.start).map(edit => {
    const parts = [];
    if (edit.end > edit.start)
      parts.push({deleteContentRange:{range:{startIndex:edit.start,endIndex:edit.end}}});
    parts.push({insertText:{location:{index:edit.start},text:edit.text}});
    return parts;
  }).flat();
  const styles = narrow.sort((a, b) => b.start - a.start).map(range => ({updateTextStyle:{
    range:{startIndex:range.start,endIndex:range.end},
    textStyle:{bold:true},fields:'bold'}}));
  return [...requests, ...styles].sort((a, b) => {
    const index = request => request.insertText?.location.index ??
      request.deleteContentRange?.range.startIndex ?? request.updateTextStyle?.range.startIndex ?? 0;
    return index(b) - index(a);
  });
}

// 4. fázis: a táblázat elrendezése. A táblázat a szövegtükör felét tölti ki:
// azon belül a megnevezés oszlop 7/8, a terület oszlop 1/8; minden cella
// kitöltése 0,1 cm.
function toPt(length) {
  if (!length) return null;
  const magnitude = Number(length.magnitude);
  if (!Number.isFinite(magnitude)) return null;
  const factor = PT_PER_UNIT[String(length.unit || 'PT').toUpperCase()];
  return factor ? magnitude * factor : null;
}

function textWidth(documentStyle) {
  const width = toPt(documentStyle?.pageSize?.width);
  const left = toPt(documentStyle?.marginLeft);
  const right = toPt(documentStyle?.marginRight);
  const textWidth = width != null && left != null && right != null ? width - left - right : null;
  return Math.max(60,textWidth != null && textWidth > 60 ? textWidth : A4_TEXT_WIDTH_PT);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function layoutRequests(tableStartIndex, documentStyle) {
  const width = textWidth(documentStyle) * TABLE_WIDTH_RATIO;
  const areaWidth = width / 8;
  const nameWidth = width - areaWidth;
  const padding = {magnitude:PADDING_PT,unit:'PT'};
  const column = (index,columnWidth) => ({updateTableColumnProperties:{
    tableStartLocation:{index:tableStartIndex},
    columnIndices:[index],
    tableColumnProperties:{widthType:'FIXED_WIDTH',
      width:{magnitude:round(columnWidth),unit:'PT'}},
    fields:'widthType,width'
  }});
  return [
    column(0,nameWidth),
    column(1,areaWidth),
    {updateTableCellStyle:{tableStartLocation:{index:tableStartIndex},
      tableCellStyle:{paddingTop:padding,paddingBottom:padding,
        paddingLeft:padding,paddingRight:padding},
      fields:'paddingTop,paddingBottom,paddingLeft,paddingRight'}}
  ];
}

// 5. fázis: a terület oszlop jobbra igazítása, a helyiségnevek és az alszummák
// behúzása, a fejléc és az összesítő sorok kiemelése. A teljes összeg nagyobb
// betűt kap, hogy a többi szummától is elváljon.
function styleRequests(table, kinds = []) {
  const requests = [];
  (table?.table?.tableRows || []).forEach((row,rowIndex) => {
    const kind = kinds[rowIndex] || '';
    (row.tableCells || []).forEach((cell,columnIndex) => {
      const content = cell.content || [];
      const first = content[0];
      const last = content[content.length - 1];
      if (!Number.isInteger(first?.startIndex)) return;
      const start = first.startIndex;
      const end = Math.max(start + 1,(last?.endIndex || first.endIndex || 2) - 1);
      const range = {startIndex:start,endIndex:end};
      const paragraphStyle = {};
      if (columnIndex === 1) paragraphStyle.alignment = 'END';
      if (columnIndex === 0 && (kind === 'room' || kind === 'subtotal'))
        paragraphStyle.indentStart = {magnitude:INDENT_PT,unit:'PT'};
      if (Object.keys(paragraphStyle).length)
        requests.push({updateParagraphStyle:{range,paragraphStyle,
          fields:Object.keys(paragraphStyle).join(',')}});
      const textStyle = {};
      if (['header','subtotal','total','external'].includes(kind)) textStyle.bold = true;
      if (kind === 'total') textStyle.fontSize = {magnitude:GRAND_TOTAL_PT,unit:'PT'};
      if (Object.keys(textStyle).length)
        requests.push({updateTextStyle:{range,textStyle,
          fields:Object.keys(textStyle).join(',')}});
    });
  });
  return requests;
}

// A beszúrt táblázat újrakeresése a friss dokumentumban a kezdő indexe alapján.
function findTable(document, startIndex) {
  return (document?.body?.content || [])
    .find(item => item.table && item.startIndex === startIndex) || null;
}

module.exports = {MARKER,findMarker,insertRequests,findEmptyTable,fillRequests,
  layoutRequests,styleRequests,findTable};

