'use strict';

// A műszaki leírás sablonjában a fejezet- és alpontszövegeket a helyükre írja,
// és névre szóló tartományba (KOCKA_SZOVEG_*) foglalja, hogy a generátor innen
// olvassa az alapértéket. A korábbi SABLONSZÖVEGEK appendixet törli.
//
// Alapértéken csak tervez (dry-run). Élesítés:
//   node scripts/update_technical_inline_texts.cjs --apply

const fs = require('node:fs');
const path = require('node:path');
const {google} = require('googleapis');
const {readTrackingCredential} = require('../server/tracking_credential.cjs');
const {textTemplates} = require('../server/technical_texts.cjs');

const DOC_ID = process.env.TECHNICAL_TEMPLATE_DOC_ID ||
  '1TIGIBSACypr0ZvMZ2xXRABEcPArkQTwM_AqfnMNVtoA';
const ENV_FILE = path.join(__dirname, '..', '.env');
const APPLY = process.argv.includes('--apply');
const HEADING = 'SABLONSZÖVEGEK';
const PREFIX = 'KOCKA_SZOVEG_';

// A tervezési program a)–p) pontjának alapértelmezett szövege. Ez az egyszeri
// feltöltés forrása: a továbbiakban a sablon dokumentum az irányadó.
const PROGRAM_TEXTS = {
  a: 'A tervezési feladat modern, korszerű, de gazdaságosan kivitelezhető családi otthon '+
    'építése. Fontos szempont a települési arculat figyelembe vétele úgy, hogy a megbízó '+
    'igényei maradéktalanul megvalósuljanak.',
  b: 'A telekről részletes tervezési felmérési térkép készült.',
  c: 'Az ingatlan {{telepules}} belterületi részén helyezkedik el. A telek az '+
    '{{tervadatok_munkalap:ovezet}} övezetben található, mely lehetővé teszi lakóingatlan '+
    'építését.',
  d: 'A környéken kialakult építészeti arculat nincs. A szomszédos telkeken álló épületek '+
    'egytől egyig magastetősek, változatos tetőidomokkal, méretekkel. A terv igyekszik a '+
    'meglévő településszövetnek megfelelő léptékű, korszerű épületeket létrehozni. A terv '+
    'figyelembe veszi a HÉSZ által támasztott követelményeket.',
  e: 'A beruházás költségkerete nincs meghatározva.',
  f: 'Az ingatlan {{telepules}} belterületi részén helyezkedik el. A telek az '+
    '{{tervadatok_munkalap:ovezet}} övezetben található, mely lehetővé teszi lakóingatlan '+
    'építését.',
  g: 'Külső:\n'+
    'Modern, {{szintek}}, közepes méretű családi ház az elképzelés. A ház leendő bruttó '+
    'alapterülete cca. {{alapterulet_sav}} m2-t. A ház építésénél az elsődleges szempont a modernség és a '+
    'költséghatékonyság közti egyensúly megtalálása, legyen modern, környezetbarát, de '+
    'mindenképpen a környék építészeti arculatát figyelembe véve,\n\n'+
    'A modern kinézetű legyen, változatos, finom anyaghasználattal (kő, fa, egyéb) – '+
    'figyelembe véve a rendelkezésre álló pénzügyi keretet.\n\n'+
    'A belső:\n'+
    'A ház belseje is legyen modern, világos, nagy ablakokkal és teraszajtókkal oldjuk meg, '+
    'hogy minél több fény jusson a lakótérbe. A megrendelő egyik legfontosabb igénye a '+
    'rendelkezésre álló tér/terek maximális kihasználtsága.\n\n'+
    'Helyiségek:\n{{helyisegek}}'+
    '\n\nA nappali, a konyha és az étkező legyen egy légtérben, mindkettőből lehessen '+
    'kimenni a kertbe vagy a teraszra. A konyha legyen nagyon nagy, sok szekrénnyel, '+
    'kamraszekrényekkel. Az étkező 6-12 személy fogadására, vendéglátására kell, hogy '+
    'elegendő helyet biztosítson. Ha megoldható, az étkező kapjon erkélyajtót, hogy ki '+
    'lehessen nyitni, legyen kertkapcsolat.\n\n'+
    'A nappali legyen funkcionális, tévézős, beszélgetős, játszóhelyiség, kertkapcsolattal, '+
    'nagy terasszal, ahová ki lehet ülni pihenni, beszélgetni, enni.\n\n'+
    'Emellett legyen egy {{haloszobak}}, méretük legalább 10-15 m². A gyerekszobákban lehet '+
    'kis „dolgozó sarok”, ahol leckét írhatnak, rajzolgathat a megrendelő gyermekei.\n\n'+
    'Fürdőszoba blokkok külön az egyes hálószoba zónákhoz, lehetőség szerint külön wc-vel. '+
    'Lehetőleg külön mosókonyha is szükséges, itt elhelyezhetők a szükséges gépészeti '+
    'berendezések.\n\n{{iroda}}',
  h: 'az építményben üzemelendő technológiák: a lakófunkcióhoz tartozó szokásos háztartási '+
    'és gépészeti berendezések.',
  i: 'a telken {{parkolo}} gépjármű elhelyezésére van igény.',
  j: 'Megújuló energiák hasznosítását a tervezés során figyelembe vesszük. Döntés a '+
    'tervezési folyamat részeként.',
  k: 'az akadálymentesítésre igény nem merült fel.',
  l: 'az építmény nem műemlék.',
  m: 'a tervezés során statikai, épületgépészeti és épületvillamossági szakági tervező '+
    'közreműködése szükséges a bejelentéshez szükséges munkarészek elkészítése céljából.',
  n: 'az egyéb meghatározó követelmény nincs.',
  o: 'a tervezendő építmény használatának, üzemeltetésének, karbantartásának különleges '+
    'feltétele nincs.',
  p: 'a helyszínen nem áll fenn régészeti érintettség.'
};

const LETTERS = 'abcdefghijklmnop'.split('');

function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if (value.length > 1 && ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function authorize() {
  const secret = String(process.env.SESSION_SECRET || '').trim();
  const encrypted = String(process.env.GOOGLE_TRACKING_CREDENTIAL || '').trim();
  const owner = String(process.env.OWNER_EMAIL || '').trim();
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!secret || !encrypted || !owner || !clientId || !clientSecret)
    throw new Error('Nincs Google-hitelesítő a .env fájlban.');
  const oauth = new google.auth.OAuth2(clientId, clientSecret);
  oauth.setCredentials({refresh_token:readTrackingCredential(secret,encrypted,owner)});
  return oauth;
}

function paragraphText(item) {
  return (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
}

function sectionSpecs(templates) {
  const specs = LETTERS.map(letter => ({
    marker:'{{TERVEZESI_PROGRAM:'+letter+'}}',
    name:PREFIX+'PROGRAM_'+letter.toUpperCase(),
    text:PROGRAM_TEXTS[letter]
  }));
  specs.push({marker:'{{TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG}}',
    name:PREFIX+'TUZVEDELMI',text:templates.TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG});
  specs.push({marker:'{{SZERKEZETEK LEÍRÁSA}}',
    name:PREFIX+'SZERKEZETEK',text:templates['SZERKEZETEK LEÍRÁSA']});
  specs.push({marker:'{{TERVEZOI_NYILATKOZAT_JOVAHAGYOTT_SZOVEG}}',
    name:PREFIX+'NYILATKOZAT',text:templates.TERVEZOI_NYILATKOZAT_JOVAHAGYOTT_SZOVEG});
  return specs;
}

// A jelölő pontos helye a dokumentumban.
function markerRange(document, marker) {
  for (const item of document?.body?.content || []) {
    if (!item.paragraph) continue;
    const text = paragraphText(item);
    const offset = text.indexOf(marker);
    if (offset < 0) continue;
    const start = (Number.isInteger(item.startIndex) ? item.startIndex
      : item.paragraph.elements?.[0]?.startIndex) + offset;
    if (!Number.isInteger(start)) continue;
    return {startIndex:start,endIndex:start+marker.length};
  }
  return null;
}

function appendixRange(document) {
  const content = document?.body?.content || [];
  const index = content.findIndex(item => item.paragraph &&
    paragraphText(item).trim().toUpperCase().startsWith(HEADING));
  if (index < 0) return null;
  const last = content[content.length-1];
  const start = content[index].startIndex;
  const end = Math.max(start,(last?.endIndex || start+1) - 1);
  return end > start ? {startIndex:start,endIndex:end} : null;
}

async function main() {
  loadEnvFile();
  const docs = google.docs({version:'v1', auth:authorize()});
  const read = async () => (await docs.documents.get({documentId:DOC_ID,
    includeTabsContent:false})).data;

  const before = await read();
  process.stdout.write('Dokumentum: '+before.title+'\n');
  const existing = Object.keys(before.namedRanges || {})
    .filter(name => name.startsWith(PREFIX));
  if (existing.length) {
    process.stdout.write('A névre szóló tartományok már léteznek ('+existing.join(', ')+
      '), nincs teendő.\n');
    return;
  }
  const templates = textTemplates(before);
  for (const key of ['TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG','SZERKEZETEK LEÍRÁSA',
    'TERVEZOI_NYILATKOZAT_JOVAHAGYOTT_SZOVEG'])
    if (!String(templates[key] || '').trim())
      throw new Error('A sablon appendixéből nem olvasható ki: '+key);

  const specs = sectionSpecs(templates);
  const sections = specs.map(spec => ({...spec,range:markerRange(before,spec.marker)}));
  const missing = sections.filter(item => !item.range);
  if (missing.length) throw new Error('Nem található jelölő: '+
    missing.map(item => item.marker).join(', '));

  const appendix = appendixRange(before);
  const total = sections.reduce((sum,item) => sum + item.text.length,0);
  process.stdout.write('Fejezetek: '+sections.length+', összesen '+total+' karakter.\n');
  for (const item of sections)
    process.stdout.write('  '+item.range.startIndex+'  '+item.name+'  ('+
      item.text.length+' kar.)\n');
  process.stdout.write('Appendix: '+(appendix ?
    appendix.startIndex+'–'+appendix.endIndex : 'nincs')+'\n');

  if (!APPLY) {
    process.stdout.write('\nDRY-RUN: semmi nem módosult. Élesítés: ' +
      'node scripts/update_technical_inline_texts.cjs --apply\n');
    return;
  }

  // A kérések sorrendben futnak, ezért először a dokumentum végén lévő appendixet
  // töröljük, majd a fejezeteket csökkenő index szerint írjuk be. Így a korábbi
  // (kisebb indexű) jelölők helye nem csúszik el.
  const requests = [];
  if (appendix) requests.push({deleteContentRange:{range:appendix}});
  const ordered = sections.slice().sort((a,b) => b.range.startIndex - a.range.startIndex);
  for (const item of ordered) {
    const start = item.range.startIndex;
    requests.push({deleteContentRange:{range:item.range}});
    requests.push({insertText:{location:{index:start},text:item.text}});
    requests.push({createNamedRange:{name:item.name,
      range:{startIndex:start,endIndex:start+item.text.length}}});
  }
  await docs.documents.batchUpdate({documentId:DOC_ID,requestBody:{requests,
    ...(before.revisionId ? {writeControl:{requiredRevisionId:before.revisionId}} : {})}});

  const check = await read();
  const {sectionTexts} = require('../server/technical_texts.cjs');
  const texts = sectionTexts(check);
  const names = Object.keys(check.namedRanges || {}).filter(name => name.startsWith(PREFIX));
  process.stdout.write('\nKész. Létrehozott tartományok: '+names.length+'\n');
  for (const name of names.sort())
    process.stdout.write('  '+name+'\n');
  const readBack = Object.keys(texts).length;
  process.stdout.write('Visszaolvasott szövegek: '+readBack+'/'+sections.length+'\n');
  if (readBack !== sections.length)
    throw new Error('Nem olvasható vissza minden fejezetszöveg a tartományokból.');
  if (appendixRange(check))
    throw new Error('A SABLONSZÖVEGEK appendix törlése nem sikerült.');
}

if (require.main === module) main().catch(error => {
  process.stderr.write('Hiba: '+(error.message || String(error))+'\n');
  process.exitCode = 1;
});

module.exports = {PROGRAM_TEXTS,LETTERS,PREFIX};
