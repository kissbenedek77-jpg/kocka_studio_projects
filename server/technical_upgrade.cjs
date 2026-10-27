'use strict';

// A már létező DRAFT-ok tartalmát és névvel jelölt mezőit megőrizzük.
// Az új fejezeteket a régi sablon megfelelő pontjai elé illesztjük be.
const ADDITIONS = [
  {anchor:'Tartalomjegyzék',guard:'Tervfázis:',text:
    'Tervfázis: {{DOKUMENTUM:tervfazis}}\nTervszám: {{DOKUMENTUM:tervszam}} · Revízió: {{DOKUMENTUM:revizio}}\nKiadás dátuma: {{DOKUMENTUM:kiadas_datuma}}\n'},
  {anchor:'Adatok',guard:'Iratjegyzék',text:'Iratjegyzék\n{{IRATJEGYZEK}}\n'},
  {anchor:'Beépítési paraméterek',guard:'Helyszín és tervelőzmények',text:
    'Helyszín és tervelőzmények\nTervezési előzmények: {{HELYSZIN:elozmenyek}}\nA telek és a meglévő építmények állapota: {{HELYSZIN:meglevo_allapot}}\nTerepviszonyok és felszíni vízelvezetés: {{HELYSZIN:terep_es_viz}}\nMegközelítés és parkolás: {{HELYSZIN:megkozelites}}\nÉpítészeti koncepció\nRendeltetés és önálló egységek: {{KONCEPCIO:rendeltetes}}\nTelepítés a telken: {{KONCEPCIO:elhelyezes}}\nTömeg, szintek és tetőforma: {{KONCEPCIO:tomeg_es_szintek}}\nTájolás és térkapcsolatok: {{KONCEPCIO:tajolas}}\nHomlokzati kialakítás: {{KONCEPCIO:homlokzat}}\nFunkcionális rend: {{KONCEPCIO:funkcio}}\n'},
  {anchor:'Épület adatai',guard:'Igazoló beépítési mérleg',text:
    'Igazoló beépítési mérleg\n{{BEEPITESI_MERLEG}}\nTerület- és arányadatok egyeztetése: {{ADAT_EGYEZTETES}}\n'},
  {anchor:'Tűzvédelem',guard:'Tervlapok és szakági összhang',text:
    'Tervlapok és szakági összhang\nKapcsolódó építészeti tervlapok: {{TERV_HIVATKOZAS}}\nSzakági munkarészek és egyeztetések: {{SZAKAG:egyeztetes}}\n'}
];

function technicalSupplementRequests(document) {
  const paragraphs=(document.body?.content || []).filter(item => item.paragraph).map(item => ({
    index:item.startIndex,
    text:(item.paragraph.elements || []).map(part => part.textRun?.content || '').join('').trim()
  }));
  const fullText=paragraphs.map(item => item.text).join('\n');
  return ADDITIONS.filter(item => !fullText.includes(item.guard)).map(item => {
    const anchor=paragraphs.find(line => line.text === item.anchor);
    if (!anchor) throw new Error('A régi műszaki DRAFT nem bővíthető automatikusan: '+item.anchor);
    return {insertText:{location:{index:anchor.index},text:item.text}};
  }).sort((a,b) => b.insertText.location.index-a.insertText.location.index);
}

module.exports={technicalSupplementRequests};
