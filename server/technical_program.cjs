'use strict';

// A tervezési program a) - p) pontjának alapértelmezett szövege a sablon
// dokumentumban, a helyén áll (KOCKA_SZOVEG_PROGRAM_* névre szóló tartomány).
// A generátor onnan olvassa ki; a kód saját alapértelmezett fejezetszöveget nem
// tartalmaz, csak a {{...}} jelölők kitöltését végzi.
const PROGRAM_LETTERS = 'abcdefghijklmnop'.split('');
const GAP = '[KIEGÉSZÍTENDŐ:';
// A helyiséglista alapján eldönthető, mely helyiségcsoportok szerepeljenek a
// programban. Amelyik csoportnak nincs nyoma a listában, az kimarad.
const ROOM_GROUPS = [
  {bullet:'előszoba/szélfogó', match:/eloszoba|szelfogo|eloter/i},
  {bullet:'nappali-konyha-étkező', match:/nappali|konyha|etkezo/i},
  {bullet:null, parent:true, match:/szuloi|haloszoba/},
  {bullet:null, match:/gyerek/},
  {bullet:'iroda/vendégszoba', match:/iroda|dolgozo|vendegszoba/i},
  {bullet:'közlekedő funkcionális', match:/kozlekedo|folyos[oó]|hall/i},
  {bullet:'háztartási helyiség/mosókonyha', match:/haztartasi|mosokonyha|gepeszeti|kazanhaz/i}
];
const NON_BEDROOM = /eloszoba|eloter|szelfogo|nappali|etkezo|konyha|vendeg|iroda|dolgozo|gardrob|furdo|wc|haztartasi|mosokonyha|kozlekedo|terasz/;

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}

function roomNames(roomData) {
  return (roomData?.rooms || []).map(room => String(room?.name || '')).filter(Boolean);
}

// A szintek száma elsődlegesen az alaprajzi tervlapokból (a felhasználói
// előírás szerint): egy alaprajz → földszintes, több → többszintes. Csak ha a
// tervjegyzékből nem derül ki, esünk vissza a helyiséglista szintjeire.
function floorCount(roomData, plans = []) {
  const planFloors = (plans || []).filter(plan =>
    /alaprajz/i.test(String(plan?.name || ''))).length;
  if (planFloors) return planFloors;
  const floors = new Set((roomData?.rooms || []).map(room => normalize(room.floor))
    .filter(name => name && !/osszesen|helyisegek/.test(name)));
  return floors.size;
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

// A program g) pontjában a bruttó alapterület helyett a nettó, terasz nélküli
// alapterülethez illeszkedő, 5 m²-re kerekített sávot írjuk (pl. 125-140 m2).
// A sáv a tényleges érték ±5%-a, hogy a szöveg ne ígérjen nagyobb házat.
function areaInterval(area) {
  if (!Number.isFinite(area) || area <= 0) return '';
  const lower = Math.max(5,Math.floor(area*0.95/5)*5);
  const upper = Math.max(lower+5,Math.ceil(area*1.05/5)*5);
  return lower+'-'+upper;
}

function roomBullets(roomData) {
  const names = roomNames(roomData).map(normalize);
  if (!names.length) return GAP+' helyiségcsoportok – a PLN/helyiségek.txt alapján.]';
  const lines = [];
  for (const group of ROOM_GROUPS) {
    const hits = names.filter(name => group.match.test(name));
    if (!hits.length) continue;
    let label = group.bullet;
    if (group.parent) {
      // A szülői blokk csak akkor jelenik meg, ha van hálószoba a listában.
      const bedrooms = hits.filter(name => !NON_BEDROOM.test(name)).length;
      if (!bedrooms) continue;
      const bathrooms = names.some(name => /furdo|gardrob/.test(name));
      label = 'szülői hálószoba'+(bathrooms ? ' blokk (fürdő/gardrób)' : '');
    } else if (!label) {
      const bedrooms = hits.filter(name => !NON_BEDROOM.test(name)).length;
      if (!bedrooms) continue;
      label = numberWord(bedrooms)+' hálószoba gyerekek részére külön vizesblokkal';
    }
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
  const gross = read('J2');
  if (!gross) warnings.push('A bruttó alapterület (Munkalap1!J2) hiányzik, ezért a tervezési '+
    'program g) pontjában hiányjelölés marad.');
  // A g) pont a nettó, terasz nélküli alapterülethez illeszkedő sávot mutatja.
  const netArea = roomData && Number.isFinite(roomData.totalCents)
    ? (roomData.totalCents-(Number(roomData.externalCents) || 0))/100 : 0;
  const areaRange = areaInterval(netArea);
  if (!areaRange) warnings.push('A nettó alapterület (Munkalap2, terasz nélkül) nem '+
    'állapítható meg, ezért a tervezési program g) pontjában hiányjelölés marad.');
  const zoneText = zone || GAP+' övezeti besorolás a hatályos szabályozási tervből.]';
  return {
    values: {
      telepules: town || GAP+' település neve.]',
      ovezet: zoneText,
      'tervadatok_munkalap:ovezet': zoneText,
      brutto_alapterulet: gross ? gross.replace(/\s*m2\s*$/i,'')+' m²' :
        GAP+' bruttó alapterület a tervezési adatlapról.]',
      alapterulet_sav: areaRange || GAP+' nettó alapterület a helyiséglistából, terasz nélkül.]',
      szintek: levels || GAP+' földszintes vagy többszintes – az alaprajzok száma alapján.]',
      haloszobak: bedroomText(roomData),
      helyisegek: roomBullets(roomData),
      iroda: office ? 'Legyen egy iroda/dolgozó közel a bejárathoz.' : '',
      parkolo: parking || GAP+' tervezett parkolószám a tervezési adatlapról.]'
    },
    facts: {floors, bedrooms, office, parking, town, zone, gross, netArea, areaRange},
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

function programLines(rows, replacements = {}, defaults = {}) {
  const output = [];
  for (const [index, letter] of PROGRAM_LETTERS.entries()) {
    const row = rows?.[index] || [];
    const fromSheet = String(row[1] ?? '').trim();
    const raw = fromSheet || String(defaults?.[letter] ?? '').trim() ||
      GAP+' a tervezési program '+letter+') pontjának szövege a sablonban.]';
    output.push(raw.split(/\r?\n/).map(line => renderProgramText(line,replacements))
      .map(line => line.trimEnd()).filter((line,position,array) =>
        line.trim() || (position > 0 && position < array.length-1)));
  }
  return output;
}

module.exports = {PROGRAM_LETTERS,programReplacements,renderProgramText,
  programLines,bedroomCount,hasOffice,exitCount,floorCount,roomBullets,normalize};
