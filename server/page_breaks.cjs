'use strict';

// Fejezet- és alcímek magányos oldalvégen. A Google Docs nem ad oldaltördelési
// információt, ezért a dokumentum PDF-exportjának szövegéből állapítjuk meg,
// melyik oldal utolsó tartalmi sora egy fejezet- vagy alcím. Az ilyen cím elé
// oldaltörést szúrunk. A „Rétegrendek” fejezet mindig új oldalon kezdődik.
// A függvények tiszták: a dokumentum szerkezetéből és a PDF szövegéből
// számolnak, a Google-hívásokat a hívó végzi.

const PAGE_NUMBER = /^\d+(?:\s*[./]\s*\d+)?\.?$/;
const BULLET = /^[•·▪◦*\-–—]\s*/;

function paragraphText(item) {
  return (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
}

function normalize(value) {
  return String(value || '').replace(BULLET,'').replace(/\s+/g,' ').trim();
}

// A dokumentum fejezet- és alcím-jelöltjei a szövegükkel és kezdőindexükkel.
function headingCandidates(document) {
  const paragraphs = (document?.body?.content || []).filter(item => item.paragraph);
  const result = [];
  let structures = false;
  for (let i = 0; i < paragraphs.length; i++) {
    const item = paragraphs[i];
    const text = normalize(paragraphText(item).replace(/\r?\n$/,''));
    if (!text) continue;
    const start = item.startIndex;
    if (!Number.isInteger(start)) continue;
    const bullet = Boolean(item.paragraph.bullet);
    const named = String(item.paragraph.paragraphStyle?.namedStyleType || '');
    if (/^Szerkezetek leírása/i.test(text)) structures = true;
    else if (structures && bullet) structures = false;
    const isChapter = (/^HEADING/.test(named) || (bullet && text.length <= 90)) &&
      /^[A-ZÁÉÍÓÖŐÚÜŰ]/.test(text) && !text.includes(':');
    const isSubheading = structures && !bullet && text.length <= 60 &&
      !/[.!?:;,]$/.test(text) && !text.includes('\t');
    if (isChapter || isSubheading) result.push({text,startIndex:start});
  }
  return result;
}

function pageLines(page) {
  return String(page || '').split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !/^[\u200b\u00a0]+$/.test(line))
    .filter(line => !PAGE_NUMBER.test(line));
}

function findPage(pages, text) {
  for (let i = pages.length - 1; i >= 0; i--)
    if (pages[i].some(line => normalize(line) === text)) return i;
  return -1;
}

// Az export minden oldal tetejére teszi a dokumentum fejlécét (cím, telefon,
// e-mail, oldalszám); ezek nem tartalom, ezért eltávolítjuk. Fejlécnek azt a
// sort vesszük, amely legalább két oldal első sorai között szerepel.
function stripPageHeaders(pages) {
  const counts = new Map();
  for (const lines of pages)
    for (const line of lines.slice(0,5)) {
      const key = normalize(line);
      counts.set(key,(counts.get(key) || 0)+1);
    }
  for (const lines of pages)
    while (lines.length && counts.get(normalize(lines[0])) >= 2) lines.shift();
  return pages;
}

function hasBreakBefore(document, startIndex) {
  const content = document?.body?.content || [];
  for (let i = 1; i < content.length; i++) {
    if (content[i].startIndex !== startIndex) continue;
    return Boolean((content[i-1].paragraph?.elements || []).some(element => element.pageBreak));
  }
  return false;
}

// Egymás után beszúrt oldaltörések: csak az első marad meg. A korábbi
// ellenőrzések ismételt futása ne hozzon létre üres oldalakat.
function duplicateBreakRequests(document) {
  const content = document?.body?.content || [];
  const breaks = content.filter(item =>
    (item.paragraph?.elements || []).some(element => element.pageBreak));
  const requests = [];
  for (let i = 1; i < breaks.length; i++) {
    if (breaks[i].startIndex > breaks[i-1].endIndex) continue;
    requests.push({deleteContentRange:{range:{
      startIndex:breaks[i].startIndex,endIndex:breaks[i].endIndex}}});
  }
  return requests.sort((a,b) =>
    b.deleteContentRange.range.startIndex - a.deleteContentRange.range.startIndex);
}

// Ezek a fejezetek mindig új oldalon kezdődnek.
const NEW_PAGE_CHAPTERS = new Set(['Rétegrendek','Helyiségek']);

function isBulleted(document, startIndex) {
  for (const item of document?.body?.content || [])
    if (item.startIndex === startIndex) return Boolean(item.paragraph?.bullet);
  return false;
}

// A korábban beszúrt oldaltörés-bekezdések a címsor felsorolás-jelölését
// örökölhették; az üres szám/bullet eltávolítása.
function breakBulletRequests(document) {
  const requests = [];
  for (const item of document?.body?.content || []) {
    if (!(item.paragraph?.elements || []).some(element => element.pageBreak)) continue;
    if (!item.paragraph.bullet) continue;
    requests.push({deleteParagraphBullets:{range:{
      startIndex:item.startIndex,endIndex:item.endIndex}}});
  }
  return requests.sort((a,b) =>
    b.deleteParagraphBullets.range.startIndex - a.deleteParagraphBullets.range.startIndex);
}

function orphanRequests(document, pdfText) {
  const headings = headingCandidates(document);
  const pages = stripPageHeaders(String(pdfText || '').split('\f').map(pageLines));
  const requests = [];
  const seen = new Set();
  const add = heading => {
    if (seen.has(heading.startIndex)) return;
    if (hasBreakBefore(document,heading.startIndex)) return;
    seen.add(heading.startIndex);
    const start = heading.startIndex;
    // A beszúrt oldaltörés bekezdése a címsor felsorolás-jelölését örökli,
    // ezért az üres szám/bullet eltávolítjuk.
    const cleanup = isBulleted(document,start)
      ? [{deleteParagraphBullets:{range:{startIndex:start,endIndex:start + 2}}}]
      : [];
    requests.push({index:start,
      requests:[{insertPageBreak:{location:{index:start}}},...cleanup]});
  };
  for (const heading of headings) {
    const pageIndex = findPage(pages,heading.text);
    if (pageIndex < 0) continue;
    const lines = pages[pageIndex];
    if (!lines.length) continue;
    const first = normalize(lines[0]);
    const last = normalize(lines[lines.length-1]);
    const tail = normalize(lines.slice(-2).join(' '));
    if (NEW_PAGE_CHAPTERS.has(heading.text)) {
      if (first !== heading.text) add(heading);
      continue;
    }
    // A cím az oldal utolsó tartalmi sora, vagy egy tördelt cím utolsó sora.
    if (last === heading.text || tail === heading.text ||
        (last.length > 8 && heading.text.endsWith(last))) add(heading);
  }
  // A dokumentum végéről visszafelé szúrjuk be az oldaltöréseket, hogy a
  // beszúrás ne tolja el a későbbi indexeket.
  return requests.sort((a,b) => b.index - a.index).flatMap(item => item.requests);
}

module.exports = {headingCandidates,orphanRequests,duplicateBreakRequests,breakBulletRequests,
  hasBreakBefore,pageLines,normalize};
