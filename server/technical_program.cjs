'use strict';

// A tervezési program a)–p) pontjának kanonikus szövege. A szövegek adatként
// viselkednek: a generátor nem fogalmazza újra őket, csak a {{...}} jelölők
// helyére ír projektadatot. A projekt „Tervezési program” lapján szerkesztett
// szöveg elsőbbséget élvez; ez a lista az alapérték és a hiánypótlás.
const PROGRAM_TEXTS = {
  a: 'A tervezési feladat modern, korszerű, de gazdaságosan kivitelezhető családi otthon '+
    'építése. Fontos szempont a települési arculat figyelembe vétele úgy, hogy a megbízó '+
    'igényei maradéktalanul megvalósuljanak.',
  b: 'A telekről részletes tervezési felmérési térkép készült.',
  c: 'Az ingatlan {{telepules}} belterületi részén helyezkedik el. A telek az {{ovezet}} '+
    'övezetben található, mely lehetővé teszi lakóingatlan építését.',
  d: 'A környéken kialakult építészeti arculat nincs. A szomszédos telkeken álló épületek '+
    'egytől egyig magastetősek, változatos tetőidomokkal, méretekkel. A terv igyekszik a '+
    'meglévő településszövetnek megfelelő léptékű, korszerű épületeket létrehozni. A terv '+
    'figyelembe veszi a HÉSZ által támasztott követelményeket.',
  e: 'A beruházás költségkerete nincs meghatározva.',
  f: 'Az ingatlan Balatonfűzfő belterületi részén helyezkedik el. A telek az Lke-8 '+
    'övezetben található, mely lehetővé teszi lakóingatlan építését.',
  g: 'Külső:\n'+
    'Modern, {{szintek}}, közepes méretű családi ház az elképzelés. A ház leendő bruttó '+
    'alapterülete cca. 200–230 m². A ház építésénél az elsődleges szempont a modernség és a '+
    'költséghatékonyság közti egyensúly megtalálása: legyen modern, környezetbarát, de '+
    'mindenképpen a környék építészeti arculatát figyelembe vevő. A modern kinézetű legyen, '+
    'változatos, finom anyaghasználattal (kő, fa, egyéb) – figyelembe véve a rendelkezésre '+
    'álló pénzügyi keretet.\n\n'+
    'A belső:\n'+
    'A ház belseje is legyen modern, világos, nagy ablakokkal és teraszajtókkal oldjuk meg, '+
    'hogy minél több fény jusson a lakótérbe. A megrendelő egyik legfontosabb igénye a '+
    'rendelkezésre álló tér/terek maximális kihasználtsága.\n\n'+
    'Helyiségek:\n{{helyisegek}}'+
    '\n\nA nappali, a konyha és az étkező legyen egy légtérben, mindkettőből lehessen '+
    'kimenni a kertbe vagy a teraszra. A konyha legyen nagyon nagy, sok szekrénnyel, '+
    'kamraszekrényekkel. Az étkező 6–12 személy fogadására, vendéglátására kell, hogy '+
    'elegendő helyet biztosítson. Ha megoldható, az étkező kapjon erkélyajtót, hogy ki '+
    'lehessen nyitni, legyen kertkapcsolat.\n\n'+
    'A nappali legyen funkcionális, tévézős, beszélgetős, játszóhelyiség, kertkapcsolattal, '+
    'nagy terasszal, ahová ki lehet ülni pihenni, beszélgetni, enni.\n\n'+
    'Emellett legyen {{haloszobak}}, méretük legalább 10–15 m². A gyerekszobákban lehet kis '+
    '„dolgozó sarok”, ahol leckét írhatnak, rajzolgathat a megrendelő gyermekei.\n\n'+
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
const PROGRAM_LETTERS = Object.keys(PROGRAM_TEXTS);
const GAP = '[KIEGÉSZÍTENDŐ:';

// A helyiséglista alapján eldönthető, mely helyiségcsoportok szerepeljenek a
// programban. Amelyik csoportnak nincs nyoma a listában, az kimarad.
const ROOM_GROUPS = [
  {bullet:'előszoba/szélfogó', match:/eloszoba|szelfogo|eloter/i},
  {bullet:'nappali-konyha-étkező', match:/nappali|konyha|etkezo/i},
  {bullet:'szülői hálószoba blokk (fürdő/gardrób)', match:/haloszoba|gardrob/i},
  {bullet:null, match:/gyerek/i},
  {bullet:'iroda/vendégszoba', match:/iroda|dolgozo|vendegszoba/i},
  {bullet:'közlekedő funkcionális', match:/kozlekedo|folyos[oó]|hall/i},
  {bullet:'mosókonyha/gépészeti helyiség', match:/mosokonyha|gepeszet|kazanhaz/i}
];

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}

function roomNames(roomData) {
  return (roomData?.rooms || []).map(room => String(room?.name || '')).filter(Boolean);
}

function floorCount(roomData, plans = []) {
  const floors = new Set((roomData?.rooms || []).map(room => normalize(room.floor))
    .filter(name => name && !/osszesen|helyisegek/.test(name)));
  if (floors.size) return floors.size;
  return (plans || []).filter(plan => /alaprajz/i.test(String(plan?.name || ''))).length;
}

// A hálószobák száma a helyiséglistából. A nappali, a vendégszoba és az iroda
// nem számít hálószobának.
function bedroomCount(roomData) {
  return roomNames(roomData).filter(name => {
    const text = normalize(name);
    if (/eloszoba|eloter|szelfogo|nappali|etkezo|konyha|vendeg|iroda|dolgozo|gardrob|furdo|wc/.test(text))
      return false;
    return /haloszoba|gyerekszoba|szoba/.test(text);
  }).length;
}

function hasOffice(roomData) {
  return roomNames(roomData).some(name => /iroda|dolgozo/.test(normalize(name)));
}

// A kijáratok száma a földszinti bejárati/előtér helyiségek alapján becsülhető.
// Ha nincs ilyen a listában, null → hiányjelölés, mert az alaprajzot nem látjuk.
function exitCount(roomData) {
  const rooms = roomData?.rooms || [];
  if (!rooms.length) return null;
  const floors = [...new Set(rooms.map(room => normalize(room.floor)))];
  const ground = floors[0] || '';
  const count = rooms.filter(room => normalize(room.floor) === ground &&
    /eloszoba|eloter|bejarat|szelfogo|hall/.test(normalize(room.name))).length;
  return count || null;
}

// Számnév jelzői (főnév előtti) alakban: „két gyerek”, nem „kettő gyerek”.
function numberWord(value) {
  const words = ['nulla','egy','két','három','négy','öt','hat','hét','nyolc','kilenc'];
  return Number.isInteger(value) && value >= 0 && value < words.length ? words[value] : String(value);
}

function bedroomText(roomData) {
  const count = bedroomCount(roomData);
  if (!count) return GAP+' hálószobák száma – az alaprajzról vagy a PLN helyiséglistából.]';
  if (count === 1) return 'egy hálószoba';
  const children = count - 1;
  return 'szülői és '+numberWord(children)+' gyerek hálószoba';
}

function roomBullets(roomData) {
  const names = roomNames(roomData).map(normalize);
  if (!names.length) return GAP+' helyiségcsoportok – a PLN/helyiségek.txt alapján.]';
  const lines = [];
  for (const group of ROOM_GROUPS) {
    const hits = names.filter(name => group.match.test(name));
    if (!hits.length) continue;
    const bedrooms = group.bullet ? 0 : hits.filter(name => /haloszoba|gyerekszoba|szoba/.test(name)).length;
    const label = group.bullet || (bedrooms ? numberWord(bedrooms)+' hálószoba gyerekek részére külön vizesblokkal'
      : 'gyerekszoba');
    if (!lines.some(line => line.endsWith(label))) lines.push('•\t'+label);
  }
  return lines.length ? lines.join('\n') : GAP+' helyiségcsoportok – a PLN/helyiségek.txt alapján.]';
}

// A {{...}} jelölők értékei. Hiányzó adatnál a jelölő helyén hiányjelölés marad,
// és a hívó figyelmeztetést kap – adatot nem találunk ki.
function programReplacements({project = {}, sheetValues = {}, roomData = null, plans = []} = {}) {
  const warnings = [];
  const read = address => String(sheetValues['TERVEZESI_ADATOK:Munkalap1!'+address] ?? '').trim();
  const town = String(project.projekt_varos || '').trim();
  const zone = read('B2');
  const hrsz = String(project.hrsz || '').trim();
  if (hrsz.startsWith('0'))
    warnings.push('A helyrajzi szám 0-val kezdődik ('+hrsz+'); lehet, hogy az ingatlan nem '+
      'belterületi. Ellenőrizd az övezeti besorolást a hatályos szabályozási tervben.');
  if (!town) warnings.push('A település neve hiányzik, ezért a tervezési program c) pontjában '+
    'hiányjelölés marad.');
  if (!zone) warnings.push('Az övezeti besorolás (Munkalap1!B2) hiányzik, ezért a tervezési '+
    'program c) pontjában hiányjelölés marad.');
  const parking = read('F9');
  if (!parking) warnings.push('A tervezett parkolószám (Munkalap1!F9) hiányzik, ezért a '+
    'tervezési program i) pontjában hiányjelölés marad.');
  const floors = floorCount(roomData, plans);
  const levels = floors > 1 ? 'többszintes' : floors === 1 ? 'földszintes' : '';
  if (!levels) warnings.push('Az alaprajzok száma nem állapítható meg, ezért a tervezési '+
    'program g) pontjában hiányjelölés marad a szinteknél.');
  const bedrooms = bedroomCount(roomData);
  if (!bedrooms) warnings.push('A hálószobák száma nem olvasható ki a helyiséglistából, ezért '+
    'a tervezési program g) pontjában hiányjelölés marad.');
  const office = hasOffice(roomData);
  return {
    values: {
      telepules: town || GAP+' település neve.]',
      ovezet: zone || GAP+' övezeti besorolás a hatályos szabályozási tervből.]',
      szintek: levels || GAP+' földszintes vagy többszintes – az alaprajzok száma alapján.]',
      haloszobak: bedroomText(roomData),
      helyisegek: roomBullets(roomData),
      iroda: office ? 'Legyen egy iroda/dolgozó közel a bejárathoz.' : '',
      parkolo: parking || GAP+' tervezett parkolószám a tervezési adatlapról.]'
    },
    facts: {floors, bedrooms, office, parking, town, zone},
    warnings
  };
}

// A szövegben maradt ismeretlen jelölőt hiányjelöléssé alakítjuk, hogy a
// véglegesítés biztosan elutasítsa.
function renderProgramText(text, replacements) {
  return String(text || '').replace(/\{\{([^{}]+)\}\}/g,(marker,key) => {
    const value = replacements[key];
    if (key === 'iroda' && value !== undefined) return String(value);
    return value === undefined || value === null || !String(value).trim()
      ? GAP+' '+key+'.]' : String(value);
  });
}

function programLines(rows, replacements = {}) {
  const output = [];
  for (const [index, letter] of PROGRAM_LETTERS.entries()) {
    const row = rows?.[index] || [];
    const fromSheet = String(row[1] ?? '').trim();
    const raw = fromSheet || PROGRAM_TEXTS[letter];
    output.push(raw.split(/\r?\n/).map(line => renderProgramText(line,replacements))
      .map(line => line.trimEnd()).filter((line,position,array) =>
        line.trim() || (position > 0 && position < array.length-1)));
  }
  return output;
}

module.exports = {PROGRAM_TEXTS,PROGRAM_LETTERS,programReplacements,renderProgramText,
  programLines,bedroomCount,hasOffice,exitCount,floorCount,roomBullets,normalize};
