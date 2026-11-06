'use strict';

// A már létező DRAFT-ok tartalmát és névvel jelölt mezőit megőrizzük.
// Az új fejezeteket a régi sablon megfelelő pontjai elé illesztjük be.
const ADDITIONS = [
  {anchor:'Épület adatai',guard:'Igazoló beépítési mérleg',text:
    'Igazoló beépítési mérleg\n{{BEEPITESI_MERLEG}}\nTerület- és arányadatok egyeztetése: {{ADAT_EGYEZTETES}}\n'},
  {anchor:'Tűzvédelem',guard:'Tervlapok és szakági összhang',text:
    'Tervlapok és szakági összhang\nKapcsolódó építészeti tervlapok: {{TERV_HIVATKOZAS}}\nSzakági munkarészek és egyeztetések: {{SZAKAG:egyeztetes}}\n'}
];
// A kivett dokumentumadatok: a régi DRAFT-okból is eltávolítjuk őket.
const REMOVED = [/^Tervfázis:/i,/^Tervszám:/i,/^Revízió(?:\s+jele)?:/i];
// A korábbi verzió két szakaszt illesztett a DRAFT-ba (iratjegyzék, valamint
// helyszín- és koncepciófejezet). Ezekre nincs szükség, ezért a régi DRAFT-okból
// eltávolítjuk. Csak akkor törlünk, ha a blokk pontosan a generált tartalmat
// tartalmazza, hogy a kézzel írt, eltérő szöveget ne veszítse el.
const IRAT_TITLE = 'Iratjegyzék';
const IRAT_MARKER = 'Építészeti műszaki leírás (jelen dokumentum)';
const NARRATIVE_TITLE = 'Helyszín és tervelőzmények';
const NARRATIVE_MARKERS = ['Tervezési előzmények:','A telek és a meglévő építmények állapota:',
  'Építészeti koncepció','Funkcionális rend:'];
const NARRATIVE_ENDS = new Set(['Beépítési paraméterek','Épület adatai']);

function paragraphs(document) {
  return (document?.body?.content || []).filter(item => item.paragraph).map(item => ({
    index:item.startIndex,
    end:item.endIndex,
    text:(item.paragraph.elements || []).map(part => part.textRun?.content || '').join('').trim()
  }));
}

// Egy cím és a következő fejezetcím közötti blokk törlése, ha a blokk tartalma
// megegyezik a korábban automatikusan beillesztett szöveggel.
function blockRange(lines, {title,ends,markers = [],text = ''}) {
  const start = lines.findIndex(line => line.text === title);
  if (start < 0) return null;
  const end = lines.findIndex((line,index) => index > start && ends.has(line.text));
  if (end < 0) return null;
  const block = lines.slice(start,end).map(line => line.text).join('\n');
  if (text && !block.includes(text)) return null;
  if (!markers.every(marker => block.includes(marker))) return null;
  return {startIndex:lines[start].index,endIndex:lines[end].index};
}

function technicalSupplementRequests(document) {
  const lines = paragraphs(document);
  const fullText = lines.map(item => item.text).join('\n');
  const requests = ADDITIONS.filter(item => !fullText.includes(item.guard)).map(item => {
    const anchor = lines.find(line => line.text === item.anchor);
    if (!anchor) throw new Error('A régi műszaki DRAFT nem bővíthető automatikusan: '+item.anchor);
    return {insertText:{location:{index:anchor.index},text:item.text}};
  });
  const irat = blockRange(lines, {title:IRAT_TITLE,ends:new Set(['Adatok']),text:IRAT_MARKER});
  if (irat) requests.push({deleteContentRange:{range:irat}});
  const narrative = blockRange(lines, {title:NARRATIVE_TITLE,ends:NARRATIVE_ENDS,
    markers:NARRATIVE_MARKERS});
  if (narrative) requests.push({deleteContentRange:{range:narrative}});
  for (const line of lines) {
    if (!REMOVED.some(pattern => pattern.test(line.text))) continue;
    if (line.end > line.index)
      requests.push({deleteContentRange:{range:{startIndex:line.index,endIndex:line.end}}});
  }
  return requests.sort((a,b) => (b.insertText?.location.index ??
    b.deleteContentRange.range.startIndex) - (a.insertText?.location.index ??
    a.deleteContentRange.range.startIndex));
}

module.exports = {technicalSupplementRequests,REMOVED,NARRATIVE_TITLE,IRAT_TITLE};
