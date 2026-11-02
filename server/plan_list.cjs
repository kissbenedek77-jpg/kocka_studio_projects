'use strict';

// A tervjegyzék kétdobozos, keret és cellakitöltés nélküli táblázat: a bal
// oszlopban a tervlap címe, a jobb oszlopban a lépték, a lap jobb széléhez
// igazítva. A modul csak kéréseket állít elő, a Google Docs hívásokat a hívó
// végzi (beszúrás és cellakitöltés: server/room_table.cjs).

const MARKER = '{{TERVJEGYZEK}}';
const TAB = '\t';
// A Google Docs hosszúság-egységei PT-ben.
const PT_PER_UNIT = {PT:1,IN:72,CM:72/2.54,MM:72/25.4,PX:0.75};
// A4 álló lap szövegtükre a szokásos 2,5 cm-es margókkal, ha a dokumentum
// stílusa nem ad használható lapszélességet (595,28 − 2 × 70,85 PT).
const A4_TEXT_WIDTH_PT = 453.57;
// A lépték oszlopa csak a „M=1:200” típusú szöveget tartalmazza.
const SCALE_COLUMN_PT = 120;
// A keret elrejtése: nulla szélesség. A színt meg kell adni, mert a Docs API a
// szín nélküli (átlátszó) keretet akkor is elutasítja, ha a szélessége nulla.
const NO_BORDER = {color:{color:{rgbColor:{red:0,green:0,blue:0}}},
  width:{magnitude:0,unit:'PT'},dashStyle:'SOLID'};
const NO_PADDING = {magnitude:0,unit:'PT'};

function toPt(length) {
  if (!length) return null;
  const magnitude = Number(length.magnitude);
  if (!Number.isFinite(magnitude)) return null;
  const factor = PT_PER_UNIT[String(length.unit || 'PT').toUpperCase()];
  return factor ? magnitude * factor : null;
}

// A táblázat a szövegtükör teljes szélességét kitölti; a jobb szél a
// lapszélesség és a két margó különbsége.
function rightEdge(documentStyle) {
  const width = toPt(documentStyle?.pageSize?.width);
  const left = toPt(documentStyle?.marginLeft);
  const right = toPt(documentStyle?.marginRight);
  const textWidth = width != null && left != null && right != null ? width - left - right : null;
  return Math.max(60,textWidth != null && textWidth > 60 ? textWidth : A4_TEXT_WIDTH_PT);
}

// A tervjegyzék értéke soronként „cím<TAB>lépték”; a lépték elmaradhat.
function planRows(value) {
  return String(value ?? '').split('\n').map(line => line.trim()).filter(Boolean)
    .map(line => {
      const [title,...rest] = line.split(TAB);
      return [title.trim(),rest.join(' ').trim()];
    }).filter(row => row[0]);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

// A beszúrt táblázat elrendezése: keskeny léptékoszlop a lap jobb szélén,
// láthatatlan keret és nulla cellakitöltés.
function layoutRequests(tableStartIndex, documentStyle) {
  const width = rightEdge(documentStyle);
  const scaleWidth = Math.min(SCALE_COLUMN_PT,Math.max(40,width / 3));
  const titleWidth = Math.max(60,width - scaleWidth);
  const column = (index,columnWidth) => ({updateTableColumnProperties:{
    tableStartLocation:{index:tableStartIndex},
    columnIndices:[index],
    tableColumnProperties:{widthType:'FIXED_WIDTH',
      width:{magnitude:round(columnWidth),unit:'PT'}},
    fields:'widthType,width'
  }});
  return [
    column(0,titleWidth),
    column(1,scaleWidth),
    {updateTableCellStyle:{tableStartLocation:{index:tableStartIndex},
      tableCellStyle:{borderTop:NO_BORDER,borderBottom:NO_BORDER,borderLeft:NO_BORDER,
        borderRight:NO_BORDER,paddingTop:NO_PADDING,paddingBottom:NO_PADDING,
        paddingLeft:NO_PADDING,paddingRight:NO_PADDING,contentAlignment:'TOP'},
      fields:'borderTop,borderBottom,borderLeft,borderRight,'+
        'paddingTop,paddingBottom,paddingLeft,paddingRight,contentAlignment'}}
  ];
}

// A lépték a cella jobb széléhez igazodik, ezért a második oszlop bekezdései
// jobbra (END) igazítottak.
function alignRequests(table) {
  const requests = [];
  for (const row of table?.table?.tableRows || []) {
    const cell = (row.tableCells || [])[1];
    const content = cell?.content || [];
    const first = content[0];
    const last = content[content.length - 1];
    if (!first?.startIndex) continue;
    requests.push({updateParagraphStyle:{
      range:{startIndex:first.startIndex,
        endIndex:Math.max(first.startIndex + 1,(last?.endIndex || first.endIndex || 2) - 1)},
      paragraphStyle:{alignment:'END'},fields:'alignment'}});
  }
  return requests;
}

// A beszúrt táblázat újrakeresése a friss dokumentumban a kezdő indexe alapján.
function findTable(document, startIndex) {
  return (document?.body?.content || []).find(item => item.table && item.startIndex === startIndex) || null;
}

module.exports = {MARKER,TAB,rightEdge,planRows,layoutRequests,alignRequests,findTable};
