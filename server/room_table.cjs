'use strict';

// A helyiséglista a dokumentumban kétdobozos táblázatként jelenik meg: a
// szintfejek, az alszummák és a teljes összeg saját sorban, a fejléc félkövér.
// A modul csak kéréseket állít elő, a Google Docs hívásokat a hívó végzi.

const MARKER = '{{HELYISEGLISTA}}';

function paragraphText(item) {
  return (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
}

function findMarker(document) {
  for (const item of document?.body?.content || []) {
    if (!item.paragraph) continue;
    if (paragraphText(item).trim() !== MARKER) continue;
    const startIndex = item.startIndex + paragraphText(item).indexOf(MARKER);
    return {startIndex, endIndex:startIndex + MARKER.length};
  }
  return null;
}

// 1. fázis: a jelölő szövegének törlése és a táblázat beszúrása a helyére.
function insertRequests(marker, rows, columns = 2) {
  if (!marker || !Array.isArray(rows) || rows.length < 2) return [];
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

// 3. fázis: a cellák feltöltése és a fejléc félkövérré tétele.
function fillRequests(table, rows) {
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
      if (rowIndex === 0) narrow.push({start, end:start + text.length});
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

module.exports = {MARKER,findMarker,insertRequests,findEmptyTable,fillRequests};
