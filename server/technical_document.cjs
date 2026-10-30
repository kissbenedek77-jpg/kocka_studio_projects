'use strict';

const {documentValues} = require('./doc_merge.cjs');
const {ADDRESSES, SHEET_PREFIX, technicalSheetValues, technicalProgramLines} = require('./technical_sheet.cjs');
const {programReplacements,exitCount} = require('./technical_program.cjs');
const {renderTemplate} = require('./technical_texts.cjs');
const {planScale, extractPdfScale} = require('./plans.cjs');

const FIELD_SHEET = 'Műszaki leírás';
const MANUAL_FIELDS = [
  ['TERV_TARGYA','A terv pontos tárgya és eljárása'],
  ['EPITES_JELLEGE','Az építés jellege'],
  ['OVEZET:max_pinceszinti_beepites','Igazolt pinceszinti beépíthetőség'],
  ['OVEZET:forras_url','Hatályos HÉSZ és szabályozási terv forrása'],
  ['OVEZET:ellenorzes_datuma','A forrás ellenőrzésének dátuma'],
  ['OVEZET:ellenorzes_allapota','Helyrajzi szám és övezet kézi ellenőrzése'],
  ['TERVEZESI_ADATOK:epitmeny_osszes_szintterulet_m2','Összes szintterület m²'],
  ['TERVEZESI_ADATOK:megengedett_lakasszam_db','Megengedett lakásszám'],
  ['EPITMENYERTEK:rendeltetesi_kategoria','Építményérték rendeltetési kategória'],
  ['EPITMENYERTEK:egysegar_eFt_m2','Jogszabály alapján igazolt egységár, E Ft/m²'],
  ['SZAMITOTT_EPITMENYERTEK','Jóváhagyott számított építményérték, E Ft'],
  ['EPITMENYERTEK:jogszabaly_es_modszer','Ellenőrzött jogszabály és számítási módszer'],
  ['HELYISEGLISTA','Helyiségek és területek; a PLN/helyiségek.txt alapján ellenőrizve'],
  ['TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG','Jóváhagyott tűzvédelmi leírás'],
  ...['alapozas','teherhordo','kemenyek','valaszfalak','aljzatok','teto','badogozas',
    'vizszigeteles','hoszigeteles','vakolatok','homlokzat','nyilaszarok','gipszkarton',
    'feluletkepzes','padloburkolatok','asztalos','lakatos']
    .map(name => [`SZERKEZET:${name}`,`Szerkezet: ${name} — helye, anyaga, mérete/vastagsága, tervlap vagy rétegrend hivatkozása`]),
  ['GEPESZET:szellozes','Szellőzés'],
  ['GEPESZET:energiaellatas','Energiaellátás'],
  ['KORNYEZET:kitermelt_asvanyi_nyersanyag','Kitermelt ásványi nyersanyag'],
  ['VILLAMOS:teljesitmeny','Elektromos teljesítmény'],
  ['RETEGRENDEK_JOVAHAGYOTT_SZOVEG','Jóváhagyott rétegrendek: azonosító, rétegek kívülről befelé, vastagság és érintett tervlap'],
  ['TERVEZOI_NYILATKOZAT_JOVAHAGYOTT_SZOVEG','Tervező által jóváhagyott nyilatkozat'],
  ['DOKUMENTUM:kiadas_datuma','Kiadás dátuma (ÉÉÉÉ.HH.NN.)'],
  ['HELYSZIN:elozmenyek','Tervezési előzmények; ha nincsenek, ezt egyértelműen írd le'],
  ['HELYSZIN:meglevo_allapot','Telek és meglévő építmények tényszerű állapota'],
  ['HELYSZIN:terep_es_viz','Terepviszonyok és felszíni vízelvezetés tervezett módja'],
  ['HELYSZIN:megkozelites','Gyalogos és gépjármű megközelítés, parkolás'],
  ['KONCEPCIO:rendeltetes','Rendeltetés, önálló rendeltetési egységek és területeik'],
  ['KONCEPCIO:elhelyezes','Épület elhelyezése a telken; elő-, oldal- és hátsókert'],
  ['KONCEPCIO:tomeg_es_szintek','Tömegformálás, szintek és tetőforma'],
  ['KONCEPCIO:tajolas','Tájolás, benapozás és a fő helyiségek kapcsolata'],
  ['KONCEPCIO:homlokzat','Homlokzati megjelenés, jellemző anyagok és színek'],
  ['KONCEPCIO:funkcio','Helyiségek kapcsolata és használati rend'],
  ['SZAKAG:egyeztetes','Szakági munkarészek és felelős tervezők egyeztetése'],
  ['TERV_HIVATKOZAS','A leíráshoz tartozó helyszínrajz, alaprajz, metszet és homlokzat tervlapjele']
];
const FIELD_KEYS = new Set(MANUAL_FIELDS.map(([key]) => key));
// A felületen a hosszú fejezetszövegek alapértéke a sablon dokumentumból jön.
const CHAPTER_KEYS = ['TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG','SZERKEZETEK LEÍRÁSA',
  'RETEGRENDEK_JOVAHAGYOTT_SZOVEG','TERVEZOI_NYILATKOZAT_JOVAHAGYOTT_SZOVEG'];
function validIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0,10) === value;
}
function validHungarianDate(value) {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})\.?$/.exec(String(value || '').trim());
  if (!match) return false;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  return validIsoDate(iso);
}
// A dokumentumban a kiadás dátuma ÉÉÉÉ.HH.NN. alakban jelenik meg.
function displayDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (validIsoDate(text)) return text.replace(/-/g,'.')+'.';
  return text;
}

// A kiadás dátuma a generálás napja, ha a műszaki adatlapon nincs megadva.
// A formátum mindig ÉÉÉÉ.HH.NN. (a felhasználói előírás szerint).
function hungarianToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('hu-HU',{timeZone:'Europe/Budapest',
    year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part = type => String(parts.find(item => item.type === type)?.value || '');
  return `${part('year')}.${part('month')}.${part('day')}.`;
}

// A sablonban maradó, adattal nem kitölthető mezők helyére kerülő szöveg.
// A táblázatcellákban üres érték marad (a felhasználói döntés szerint), a
// folyószövegben viszont egyértelmű hiányjelölés, hogy a véglegesítés
// elutasítsa a piszkozatot.
const DATA_MARKER = /^(?:TERVEZESI_ADATOK:|EPITMENYERTEK:|SZAMITOTT_EPITMENYERTEK$|PARKOLOEGYENLEG_ERTEKELES$|BEEPITESI_MERLEG$|ADAT_EGYEZTETES$|TERVJEGYZEK$|IRATJEGYZEK$)/;
const GAP_LABELS = {
  'TERV_TARGYA':'a terv tárgya és az engedélyezési eljárás megnevezése',
  'EPITES_JELLEGE':'az építés jellege',
  'OVEZET:max_pinceszinti_beepites':'az igazolt pinceszinti beépíthetőség az övezeti előírásból',
  'OVEZET:forras_url':'a hatályos HÉSZ vagy szabályozási terv forrásának URL-je',
  'OVEZET:ellenorzes_datuma':'az övezeti adat ellenőrzésének dátuma',
  'OVEZET:ellenorzes_allapota':'a helyrajzi szám és az övezet kézi ellenőrzésének állapota',
  'EPITMENYERTEK:rendeltetesi_kategoria':'az építményérték rendeltetési kategóriája',
  'EPITMENYERTEK:egysegar_eFt_m2':'a jogszabály alapján igazolt egységár (E Ft/m²)',
  'EPITMENYERTEK:jogszabaly_es_modszer':'az építményérték számításának jogszabályi alapja és módszere',
  'TERV_HIVATKOZAS':'a leíráshoz tartozó tervlapok jele',
  'SZAKAG:egyeztetes':'a szakági munkarészek és a felelős tervezők egyeztetése',
  'HELYSZIN:elozmenyek':'a tervezési előzmények',
  'HELYSZIN:meglevo_allapot':'a telek és a meglévő építmények állapota',
  'HELYSZIN:terep_es_viz':'a terepviszonyok és a felszíni vízelvezetés',
  'HELYSZIN:megkozelites':'a megközelítés és a parkolás',
  'KONCEPCIO:rendeltetes':'a rendeltetés és az önálló rendeltetési egységek',
  'KONCEPCIO:elhelyezes':'az épület elhelyezése a telken',
  'KONCEPCIO:tomeg_es_szintek':'a tömegformálás, a szintek és a tetőforma',
  'KONCEPCIO:tajolas':'a tájolás és a benapozás',
  'KONCEPCIO:homlokzat':'a homlokzati megjelenés',
  'KONCEPCIO:funkcio':'a helyiségek kapcsolata és használati rendje',
  'GEPESZET:szellozes':'a szellőzés módja',
  'GEPESZET:energiaellatas':'az energiaellátás módja',
  'KORNYEZET:kitermelt_asvanyi_nyersanyag':'a kitermelt ásványi nyersanyag mennyisége',
  'VILLAMOS:teljesitmeny':'az elektromos csatlakozási teljesítmény'
};
function gapText(key) {
  const label = GAP_LABELS[key] || ('a(z) „'+key+'” adat');
  return '[KIEGÉSZÍTENDŐ: '+label+'.]';
}

function validateTechnicalField(key,value) {
  if (key === 'DOKUMENTUM:kiadas_datuma' && value &&
      !validIsoDate(value) && !validHungarianDate(value))
    throw new Error('A kiadás dátuma ÉÉÉÉ.HH.NN. formátumú és valós naptári nap legyen.');
  if (key === 'OVEZET:ellenorzes_datuma' && value && !validIsoDate(value) &&
      !validHungarianDate(value))
    throw new Error('A dátum ÉÉÉÉ.HH.NN. formátumú és valós naptári nap legyen.');
}

function fieldSheetRows() {
  return [['Mező','Érték','Kitöltési útmutató'],
    ...MANUAL_FIELDS.map(([key,help]) => [key,'',help])];
}

function manualValues(rows) {
  const result = {};
  for (const row of rows || []) {
    const key = String(row?.[0] || '').trim();
    if (!FIELD_KEYS.has(key)) continue;
    const value = String(row?.[1] ?? '').trim();
    if (value.length > 50000) throw new Error('Túl hosszú műszaki adat: '+key);
    if (value && !/\{\{[^{}]+\}\}/.test(value)) result[key] = value;
  }
  return result;
}

function numberFromSheet(value) {
  const cleaned = String(value ?? '').replace(/\s/g,'').replace('%','')
    .replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.');
  return cleaned && /^-?\d+(?:\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
}

function technicalReview(sheet, manual) {
  const read = address => numberFromSheet(sheet[`TERVEZESI_ADATOK:Munkalap1!${address}`]);
  // Az arányok (M2, M5, M7) a sheet képletei: a tervezett érték / telekterület.
  // A J2 (bruttó alapterület) és J5 (zöldfelület m²) csak keresztellenőrzésre kell;
  // a táblázatban nem jelennek meg.
  const land = read('E2'), footprint = read('J2'), builtRatio = read('M2');
  const greenArea = read('J5'), greenRatio = read('M5');
  const checks = [];
  if ([land,builtRatio,greenRatio].some(value => value === null))
    checks.push('A telek, a beépítés vagy a zöldfelület számításához hiányzik adat.');
  if (land !== null && land <= 0) checks.push('A telekterület nem pozitív.');
  if ([footprint,greenArea].some(value => value !== null && value < 0))
    checks.push('A beépített terület vagy a zöldfelület negatív.');
  if (land > 0 && [footprint,greenArea].some(value => value !== null && value > land))
    checks.push('A beépített terület vagy a zöldfelület nagyobb a telekterületnél.');
  if ([builtRatio,greenRatio].some(value => value !== null && (value < 0 || value > 100)))
    checks.push('A beépítési vagy zöldfelületi arány kívül esik a 0–100% tartományon.');
  if (land > 0 && footprint !== null && builtRatio !== null &&
      Math.abs(footprint / land * 100 - builtRatio) > 0.15)
    checks.push('A beépített terület és a beépítési százalék eltér.');
  if (land > 0 && greenArea !== null && greenRatio !== null &&
      Math.abs(greenArea / land * 100 - greenRatio) > 0.15)
    checks.push('A zöldfelület területe és százaléka eltér.');
  // A szintterületi mutató csak akkor ellenőrizhető, ha van rá előírás (B7).
  const rows = [
    ['Földszinti beépítettség',read('B3'),builtRatio,'max',' %'],
    ['Építménymagasság',read('B6'),read('F6'),'max',' m'],
    ['Zöldfelületi arány',read('B5'),greenRatio,'min',' %'],
    ['Szintterületi mutató',read('B7'),read('M7'),'max',' m²/m²']
  ];
  const approved = /^ellenőrizve$/i.test(String(manual['OVEZET:ellenorzes_allapota'] || ''));
  // Csak az a sor hasonlítható össze, amelyhez van előírás. A szintterületi
  // mutató sora például csak akkor kerül a mérlegbe, ha a B7 ki van töltve.
  const comparable = rows.filter(([,limit,planned]) => limit !== null && planned !== null);
  for (const [name,limit,planned] of rows)
    if (limit !== null && planned === null)
      checks.push(`${name}: az előírás megvan, a tervezett érték hiányzik.`);
  const fmt = value => String(value).replace('.',',');
  const comparison = approved && comparable.length
    ? comparable.map(([name,limit,planned,rule,unit]) => {
      const compliant = rule === 'min' ? planned >= limit : planned <= limit;
      if (!compliant) checks.push(`${name}: a tervezett érték nem teljesíti az előírást.`);
      return (
      `${name}: előírt ${rule === 'min' ? 'min.' : 'max.'} ${fmt(limit)}${unit}; `+
      `tervezett ${fmt(planned)}${unit}; `+
      `${compliant ? 'megfelel' : 'nem felel meg'}`);
    })
    : [];
  // A szöveges mérleg csak ellenőrzött övezeti adatokból készülhet.
  return {issues:checks,comparison:comparison.join('\n')};
}

function technicalReplacements({project, sheetRows, programRows, fieldRows, pdfFiles = [],
  writtenFiles = [], roomData = null, plans = [], textTemplates = {}, extraValues = {},
  templateMarkers = [], now = new Date()}, warnings = []) {
  const warn = message => {
    const text = String(message || '').trim().slice(0,500);
    if (text && !warnings.includes(text)) warnings.push(text);
  };
  const sheet = technicalSheetValues(sheetRows);
  const manual = manualValues(fieldRows);
  const review = String(manual['OVEZET:ellenorzes_allapota'] || '').trim();
  const source = String(manual['OVEZET:forras_url'] || '').trim();
  const date = String(manual['OVEZET:ellenorzes_datuma'] || '').trim();
  if (!/^ellenőrizve$/i.test(review) || !/^https:\/\/\S+$/i.test(source) ||
      !validIsoDate(date))
    delete manual['OVEZET:ellenorzes_allapota'];
  const values = {...documentValues(project),...manual};
  // A számított rétegrend-értékek a forrásadatokból jönnek; a kézzel mentett
  // fejezetszöveg viszont mindig elsőbbséget élvez.
  for (const [key,value] of Object.entries(extraValues || {})) {
    if (!String(value ?? '').trim()) continue;
    if (String(manual[key] || '').trim()) continue;
    values[key] = String(value);
  }
  if (manual['DOKUMENTUM:kiadas_datuma']) {
    values['DOKUMENTUM:kiadas_datuma'] =
      displayDate(manual['DOKUMENTUM:kiadas_datuma']);
    values['Mai dátum'] = values['DOKUMENTUM:kiadas_datuma'];
  } else {
    // Ha a műszaki adatlapon nincs kiadási dátum, a generálás napja kerül a
    // dokumentumba, ÉÉÉÉ.HH.NN. alakban, egy figyelmeztetéssel.
    const today = hungarianToday(now);
    values['DOKUMENTUM:kiadas_datuma'] = today;
    values['Mai dátum'] = today;
    warn('A kiadás dátuma nem volt megadva a műszaki adatlapon, ezért a generálás '+
      'napja került a dokumentumba ('+today+'). Ellenőrizd, hogy ez a kiadás tényleges dátuma.');
  }
  if (manual['OVEZET:ellenorzes_datuma'])
    values['OVEZET:ellenorzes_datuma'] = displayDate(manual['OVEZET:ellenorzes_datuma']);
  if (roomData?.listing && !values.HELYISEGLISTA) values.HELYISEGLISTA = roomData.listing;
  for (const [key,value] of Object.entries(sheet)) if (String(value).trim()) values[key] = value;
  // A hosszú fejezetszövegek alapértéke a sablon dokumentum appendixéből jön; a
  // benne lévő jelölőket a projekt adatai töltik ki. A mentett vagy jóváhagyott
  // szöveg mindig elsőbbséget élvez.
  // A tűzszakasz a helyiségek területeinek összege; a kijáratok száma a
  // földszinti bejárati/előtér helyiségekből becsülhető.
  const exits = exitCount(roomData);
  // A tűzszakasz a helyiségek területeinek összege, a nem zárt térként kezelt
  // teraszok/erkélyek nélkül. Ha nincs külső terület, a teljes összeg.
  const enclosed = roomData
    ? (roomData.externalCents ? roomData.totalCents - roomData.externalCents
      : roomData.totalCents)
    : null;
  values['tuzszakasz_m2'] = enclosed === null ? '' :
    (enclosed/100).toFixed(2).replace('.',',');
  values['kijarat_db'] = exits ? String(exits) : '';
  if (roomData && !exits)
    warn('A kijáratok száma nem állapítható meg a helyiséglistából; a tűzvédelmi '+
      'leírásban [KIEGÉSZÍTENDŐ: …] jelölés marad. Ellenőrizd az alaprajzokon.');
  if (roomData && exits)
    warn('A kijáratok számát a földszinti bejárati/előtér helyiségek alapján becsültük ('+
      exits+' db); ellenőrizd az alaprajzokon.');
  const context = {...values,...sheet};
  for (const [key,text] of Object.entries(textTemplates || {})) {
    if (String(values[key] || '').trim()) continue;
    values[key] = renderTemplate(text,context);
  }
  const reviewResult = technicalReview(sheet,manual);
  if (reviewResult.comparison) values.BEEPITESI_MERLEG = reviewResult.comparison;
  values.ADAT_EGYEZTETES = reviewResult.issues.length ?
    '[ELLENŐRIZENDŐ: '+reviewResult.issues.join(' ')+']' :
    'A megadott terület- és arányadatok között nincs számítási eltérés.';
  const coverage = String(sheet['TERVEZESI_ADATOK:Munkalap1!M2'] || '').trim();
  if (coverage) values['TERVEZESI_ADATOK:tervezett_foldszinti_beepites_szazalek'] =
    coverage.replace(/\s*%\s*$/,'');
  const footprint = String(sheet['TERVEZESI_ADATOK:Munkalap1!J2'] || '').trim();
  if (footprint) values['TERVEZESI_ADATOK:tervezett_foldszinti_beepites_m2'] = footprint;
  const required = numberFromSheet(sheet['TERVEZESI_ADATOK:Munkalap1!B9']);
  const planned = numberFromSheet(sheet['TERVEZESI_ADATOK:Munkalap1!F9']);
  if (required !== null && planned !== null)
    values.PARKOLOEGYENLEG_ERTEKELES =
      `Előírt: ${required} db; tervezett: ${planned} db; különbség: ${planned-required} db.`;
  // A tervezési program dinamikus értékei: település, övezet, szintek,
  // hálószobák, helyiségcsoportok, iroda és parkoló.
  const programData = programReplacements({project,sheetValues:sheet,roomData,plans});
  for (const warning of programData.warnings) warn(warning);
  const program = technicalProgramLines(programRows, {...values,...programData.values});
  program.forEach((lines,index) => {
    const letter = String.fromCharCode(97+index);
    values[`TERVEZESI_PROGRAM:${letter}`] = lines.join('\n').replace(new RegExp(`^${letter}\\)\\s*`),'');
  });
  // A tervjegyzék csak olyan tervlapot tartalmaz, amelyhez ismert a méretarány.
  // Lépték nélkül a lista üres marad, legfeljebb egy figyelmeztetéssel.
  const plansWithScale = pdfFiles.map(file => {
    const title = String(file.name || '').replace(/\.pdf$/i,'')
      .replace(/[\r\n\t]/g,' ').trim();
    const pdfBytes = file.bytes ? Buffer.from(file.bytes) : undefined;
    return {title, scale:planScale(title, pdfBytes)};
  }).filter(item => item.title && item.scale);
  if (plansWithScale.length) {
    values.TERVJEGYZEK = plansWithScale
      .map(item => `${item.title}\t${item.scale}`)
      .sort((a,b) => a.localeCompare(b,'hu')).join('\n');
  }
  if (pdfFiles.length && !plansWithScale.length)
    warn('A tervjegyzék üres: egyetlen tervlaphoz sem ismert a méretarány. Egészítsd ki '+
      'a fájlnevet (például „alaprajz”), vagy a „Tervjegyzék szabályok” munkalapot.');
  values.IRATJEGYZEK = ['Építészeti műszaki leírás (jelen dokumentum)',
    ...writtenFiles.filter(file => file.mimeType === 'application/vnd.google-apps.document' ||
      file.mimeType === 'application/pdf').map(file => String(file.name || '').trim())
      .filter(Boolean).filter(name => !/^Építész műszaki leírás/i.test(name))]
    .filter((name,index,array) => array.indexOf(name) === index)
    .sort((a,b) => a.localeCompare(b,'hu')).join('\n');
  // A sablon táblázata közvetlen cellahivatkozásokat használ. Ha egy cella üres,
  // a helyén üres érték marad – nem maradhat nyers {{...}} jelölő. Ezért a mező
  // létezik, az értéke viszont lehet üres; hiányzó adatot nem találunk ki.
  // A sablon szöveges szakaszai ugyanígy számítanak a szemantikus kulcsokra.
  const optionalKeys = new Set([...ADDRESSES.map(address => SHEET_PREFIX+address),
    'TERVEZESI_ADATOK:megengedett_lakasszam_db',
    'TERVEZESI_ADATOK:tervezett_foldszinti_beepites_szazalek',
    'TERVEZESI_ADATOK:tervezett_foldszinti_beepites_m2',
    'PARKOLOEGYENLEG_ERTEKELES','BEEPITESI_MERLEG','TERVJEGYZEK','IRATJEGYZEK',
    // A tűzvédelmi és szerkezeti leírás adat-helyőrzői: ha a forrásadat hiányzik,
    // a mező létezik, de üres – a szövegben hiányjelölés lesz, nem nyers jelölő.
    'tuzszakasz_m2','kijarat_db','retegrend:fal_anyag','retegrend:fal_vastagsag',
    'retegrend:fal_hoszigeteles','retegrend:fodem','retegrend:fedelszek','retegrend:teto',
    ...CHAPTER_KEYS]);
  // A sablon minden jelölőjét kitöltjük, hogy a kész példányban ne maradjon
  // nyers {{...}}. A táblázatcellában és az adatjelölőknél üres érték marad (a
  // felhasználói döntés szerint), a folyószövegben viszont hiányjelölés.
  const keep = new Set([...optionalKeys, ...templateMarkers.map(marker => marker.key)]);
  for (const marker of templateMarkers) {
    const key = marker.key;
    if (String(values[key] ?? '').trim()) continue;
    values[key] = marker.inTable || DATA_MARKER.test(key) ? '' : gapText(key);
  }
  for (const key of optionalKeys) if (!(key in values)) values[key] = '';
  for (const key of CHAPTER_KEYS) if (!String(values[key] || '').trim())
    values[key] = '[KIEGÉSZÍTENDŐ: '+key+' – a sablon dokumentum appendixében vagy a '+
      'műszaki adatlapon add meg a szöveget.]';
  return Object.fromEntries(Object.entries(values).filter(([key,value]) =>
    keep.has(key) || String(value ?? '').trim()));
}

module.exports = {FIELD_SHEET,MANUAL_FIELDS,CHAPTER_KEYS,validateTechnicalField,fieldSheetRows,
  manualValues,numberFromSheet,technicalReview,technicalReplacements,displayDate,validIsoDate,
  validHungarianDate,hungarianToday,gapText,DATA_MARKER};
