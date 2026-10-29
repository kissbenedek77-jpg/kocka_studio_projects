'use strict';

// A már létező DRAFT-ok tartalmát és névvel jelölt mezőit megőrizzük.
// Az új fejezeteket a régi sablon megfelelő pontjai elé illesztjük be.
const ADDITIONS = [
  {anchor:'Adatok',guard:'Iratjegyzék',text:'Iratjegyzék\n{{IRATJEGYZEK}}\n'},
  {anchor:'Beépítési paraméterek',guard:'Helyszín és tervelőzmények',text:
    'Helyszín és tervelőzmények\nTervezési előzmények: {{HELYSZIN:elozmenyek}}\nA telek és a meglévő építmények állapota: {{HELYSZIN:meglevo_allapot}}\nTerepviszonyok és felszíni vízelvezetés: {{HELYSZIN:terep_es_viz}}\nMegközelítés és parkolás: {{HELYSZIN:megkozelites}}\nÉpítészeti koncepció\nRendeltetés és önálló egységek: {{KONCEPCIO:rendeltetes}}\nTelepítés a telken: {{KONCEPCIO:elhelyezes}}\nTömeg, szintek és tetőforma: {{KONCEPCIO:tomeg_es_szintek}}\nTájolás és térkapcsolatok: {{KONCEPCIO:tajolas}}\nHomlokzati kialakítás: {{KONCEPCIO:homlokzat}}\nFunkcionális rend: {{KONCEPCIO:funkcio}}\n'},
  {anchor:'Épület adatai',guard:'Igazoló beépítési mérleg',text:
    'Igazoló beépítési mérleg\n{{BEEPITESI_MERLEG}}\nTerület- és arányadatok egyeztetése: {{ADAT_EGYEZTETES}}\n'},
  {anchor:'Tűzvédelem',guard:'Tervlapok és szakági összhang',text:
    'Tervlapok és szakági összhang\nKapcsolódó építészeti tervlapok: {{TERV_HIVATKOZAS}}\nSzakági munkarészek és egyeztetések: {{SZAKAG:egyeztetes}}\n'}
];
// A kivett dokumentumadatok: a régi DRAFT-okból is eltávolítjuk őket.
const REMOVED = [/^Tervfázis:/i,/^Tervszám:/i,/^Revízió(?:\s+jele)?:/i];

function paragraphs(document) {
  return (document?.body?.content || []).filter(item => item.paragraph).map(item => ({
    index:item.startIndex,
    end:item.endIndex,
    text:(item.paragraph.elements || []).map(part => part.textRun?.content || '').join('').trim()
  }));
}

function technicalSupplementRequests(document) {
  const lines = paragraphs(document);
  const fullText = lines.map(item => item.text).join('\n');
  const requests = ADDITIONS.filter(item => !fullText.includes(item.guard)).map(item => {
    const anchor = lines.find(line => line.text === item.anchor);
    if (!anchor) throw new Error('A régi műszaki DRAFT nem bővíthető automatikusan: '+item.anchor);
    return {insertText:{location:{index:anchor.index},text:item.text}};
  });
  for (const line of lines) {
    if (!REMOVED.some(pattern => pattern.test(line.text))) continue;
    if (line.end > line.index)
      requests.push({deleteContentRange:{range:{startIndex:line.index,endIndex:line.end}}});
  }
  return requests.sort((a,b) => (b.insertText?.location.index ??
    b.deleteContentRange.range.startIndex) - (a.insertText?.location.index ??
    a.deleteContentRange.range.startIndex));
}

module.exports = {technicalSupplementRequests,REMOVED};
