'use strict';

// A tervjegyzék léptéke a lap jobb szélén, jobbra igazítva jelenik meg. A
// sablonban a {{TERVJEGYZEK}} helyére soronként „cím<TAB>lépték” kerül, a
// jobbra igazított tabulátor-stopot pedig utólag, a névre szóló tartomány
// (KOCKA_MERGE_TERVJEGYZEK) bekezdésein állítjuk be. A modul csak kéréseket
// állít elő, a Google Docs hívásokat a hívó végzi.

const RANGE_NAME = 'KOCKA_MERGE_TERVJEGYZEK';
const TAB = '\t';
// A Google Docs hosszúság-egységei PT-ben (a tabulátor-stop PT-ben értendő).
const PT_PER_UNIT = {PT:1,IN:72,CM:72/2.54,MM:72/25.4,PX:0.75};
// A4 álló lap szövegtükre a szokásos 2,54 cm-es margókkal, ha a dokumentum
// stílusa nem ad használható lapszélességet.
const A4_TEXT_WIDTH_PT = 451.28;

function toPt(length) {
  if (!length) return null;
  const magnitude = Number(length.magnitude);
  if (!Number.isFinite(magnitude)) return null;
  const factor = PT_PER_UNIT[String(length.unit || 'PT').toUpperCase()];
  return factor ? magnitude * factor : null;
}

// A tabulátor-stop helye a bal margótól számít, ezért a jobb szél a
// lapszélesség és a két margó különbsége, csökkentve a bekezdés jobb
// behúzásával. Az érték a dokumentum stílusából jön, nem becsült érték.
function rightEdge(documentStyle, paragraphStyle) {
  const width = toPt(documentStyle?.pageSize?.width);
  const left = toPt(documentStyle?.marginLeft);
  const right = toPt(documentStyle?.marginRight);
  const indentEnd = Math.max(0,toPt(paragraphStyle?.indentEnd) || 0);
  const textWidth = width != null && left != null && right != null ? width - left - right : null;
  const usable = textWidth != null && textWidth > 0 ? textWidth : A4_TEXT_WIDTH_PT;
  return Math.max(36,usable - indentEnd);
}

function paragraphText(item) {
  return (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
}

function bodyParagraphs(document) {
  return (document?.body?.content || []).filter(item => item.paragraph).map(item => ({
    startIndex:item.startIndex,
    endIndex:item.endIndex,
    text:paragraphText(item),
    paragraphStyle:item.paragraph.paragraphStyle
  }));
}

function namedRanges(document) {
  const named = document?.namedRanges?.[RANGE_NAME];
  return (named?.namedRanges || []).flatMap(item => item.ranges || []);
}

// A névre szóló tartomány a bekezdésekbe esik; a több soros tervjegyzék
// tartománya több bekezdést is átfoghat, ezért metszés alapján keresünk.
function planParagraphs(document) {
  const ranges = namedRanges(document);
  if (!ranges.length) return [];
  const paragraphs = bodyParagraphs(document);
  const found = [];
  for (const range of ranges) {
    const start = Number(range.startIndex) || 0;
    const end = Math.max(start,Number(range.endIndex) || start);
    const hits = paragraphs.filter(item => item.endIndex > start && item.startIndex < end);
    const containing = hits.length ? hits
      : paragraphs.filter(item => start >= item.startIndex && start < item.endIndex);
    for (const item of containing)
      if (!found.some(existing => existing.startIndex === item.startIndex)) found.push(item);
  }
  return found.sort((a,b) => a.startIndex - b.startIndex);
}

// Csak azokra a bekezdésekre kell tabulátor-stop, amelyekben ténylegesen van
// tabulátor; a lépték nélküli tervlap sora érintetlen marad.
function tabStopRequests(document) {
  const paragraphs = planParagraphs(document);
  const requests = [];
  for (const item of paragraphs) {
    if (!item.text.includes(TAB)) continue;
    const offset = rightEdge(document?.documentStyle,item.paragraphStyle);
    requests.push({updateParagraphStyle:{
      range:{startIndex:item.startIndex,endIndex:item.endIndex},
      paragraphStyle:{tabStops:[{alignment:'END',
        offset:{magnitude:Math.round(offset * 100) / 100,unit:'PT'}}]},
      fields:'tabStops'
    }});
  }
  return requests;
}

module.exports = {RANGE_NAME,TAB,rightEdge,planParagraphs,tabStopRequests};
