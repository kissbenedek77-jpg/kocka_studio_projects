'use strict';

const {documentValues} = require('./doc_merge.cjs');
const {technicalSheetValues, technicalProgramLines} = require('./technical_sheet.cjs');
const {planScale} = require('./plans.cjs');

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
  ['DOKUMENTUM:tervfazis','Tervfázis: egyszerű bejelentési / építési engedélyezési / kivitelezési'],
  ['DOKUMENTUM:tervszam','Tervszám vagy dokumentumazonosító'],
  ['DOKUMENTUM:revizio','Revízió jele'],
  ['DOKUMENTUM:kiadas_datuma','Kiadás dátuma (ÉÉÉÉ-HH-NN)'],
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
const PLAN_PHASES = ['Egyszerű bejelentési','Építési engedélyezési','Kivitelezési'];
function validIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0,10) === value;
}

function validateTechnicalField(key,value) {
  if (key === 'DOKUMENTUM:tervfazis' && value && !PLAN_PHASES.includes(value))
    throw new Error('A tervfázist a megadott lehetőségek közül válaszd.');
  if (['DOKUMENTUM:kiadas_datuma','OVEZET:ellenorzes_datuma'].includes(key) &&
      value && !validIsoDate(value))
    throw new Error('A dátum ÉÉÉÉ-HH-NN formátumú és valós naptári nap legyen.');
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
  const land = read('E2'), footprint = read('H2'), builtRatio = read('J2');
  const greenArea = read('H5'), greenRatio = read('J5');
  const checks = [];
  if ([land,footprint,builtRatio,greenArea,greenRatio].some(value => value === null))
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
  const rows = [
    ['Földszinti beépítettség',read('B3'),builtRatio,'max'],
    ['Épületmagasság',read('B6'),read('E6'),'max'],
    ['Zöldfelületi arány',read('B5'),greenRatio,'min']
  ];
  const approved = /^ellenőrizve$/i.test(String(manual['OVEZET:ellenorzes_allapota'] || ''));
  const comparison = approved && rows.every(([,limit,planned]) => limit !== null && planned !== null)
    ? rows.map(([name,limit,planned,rule]) => {
      const compliant = rule === 'min' ? planned >= limit : planned <= limit;
      if (!compliant) checks.push(`${name}: a tervezett érték nem teljesíti az előírást.`);
      return (
      `${name}: előírt ${rule === 'min' ? 'min.' : 'max.'} ${limit}${name === 'Épületmagasság' ? ' m' : ' %'}; `+
      `tervezett ${planned}${name === 'Épületmagasság' ? ' m' : ' %'}; `+
      `${compliant ? 'megfelel' : 'nem felel meg'}`);
    })
    : [];
  // A szöveges mérleg csak ellenőrzött övezeti adatokból készülhet.
  return {issues:checks,comparison:comparison.join('\n')};
}

function technicalReplacements({project, sheetRows, programRows, fieldRows, pdfFiles = [],
  writtenFiles = [],
  scaleAnswers = {}, roomData = null}) {
  const sheet = technicalSheetValues(sheetRows);
  const manual = manualValues(fieldRows);
  const review = String(manual['OVEZET:ellenorzes_allapota'] || '').trim();
  const source = String(manual['OVEZET:forras_url'] || '').trim();
  const date = String(manual['OVEZET:ellenorzes_datuma'] || '').trim();
  if (!/^ellenőrizve$/i.test(review) || !/^https:\/\/\S+$/i.test(source) ||
      !validIsoDate(date))
    delete manual['OVEZET:ellenorzes_allapota'];
  const values = {...documentValues(project),...manual};
  if (manual['DOKUMENTUM:kiadas_datuma']) values['Mai dátum'] = manual['DOKUMENTUM:kiadas_datuma'];
  if (roomData?.listing && !values.HELYISEGLISTA) values.HELYISEGLISTA = roomData.listing;
  for (const [key,value] of Object.entries(sheet)) if (String(value).trim()) values[key] = value;
  const reviewResult = technicalReview(sheet,manual);
  if (reviewResult.comparison) values.BEEPITESI_MERLEG = reviewResult.comparison;
  values.ADAT_EGYEZTETES = reviewResult.issues.length ?
    '[ELLENŐRIZENDŐ: '+reviewResult.issues.join(' ')+']' :
    'A megadott terület- és arányadatok között nincs számítási eltérés.';
  const coverage = String(sheet['TERVEZESI_ADATOK:Munkalap1!J2'] || '').trim();
  if (coverage) values['TERVEZESI_ADATOK:tervezett_foldszinti_beepites_szazalek'] =
    coverage.replace(/\s*%\s*$/,'');
  const footprint = String(sheet['TERVEZESI_ADATOK:Munkalap1!H2'] || '').trim();
  if (footprint) values['TERVEZESI_ADATOK:tervezett_foldszinti_beepites_m2'] = footprint;
  const required = numberFromSheet(sheet['TERVEZESI_ADATOK:Munkalap1!B9']);
  const planned = numberFromSheet(sheet['TERVEZESI_ADATOK:Munkalap1!E9']);
  if (required !== null && planned !== null)
    values.PARKOLOEGYENLEG_ERTEKELES =
      `Előírt: ${required} db; tervezett: ${planned} db; különbség: ${planned-required} db.`;
  const program = technicalProgramLines(programRows, values);
  program.forEach((lines,index) => {
    const letter = String.fromCharCode(97+index);
    values[`TERVEZESI_PROGRAM:${letter}`] = lines.join('\n').replace(new RegExp(`^${letter}\\)\\s*`),'');
  });
  if (pdfFiles.length) values.TERVJEGYZEK = pdfFiles.map(file => {
    const title = String(file.name || '').replace(/\.pdf$/i,'').replace(/[\r\n\t]/g,' ').trim();
    return `${title}\t${scaleAnswers[title] || planScale(title) || '[méretarány ellenőrzendő]'}`;
  }).filter(Boolean).sort((a,b) => a.localeCompare(b,'hu')).join('\n');
  values.IRATJEGYZEK = ['Építészeti műszaki leírás (jelen dokumentum)',
    ...writtenFiles.filter(file => file.mimeType === 'application/vnd.google-apps.document' ||
      file.mimeType === 'application/pdf').map(file => String(file.name || '').trim())
      .filter(Boolean).filter(name => !/^Építész műszaki leírás/i.test(name))]
    .filter((name,index,array) => array.indexOf(name) === index)
    .sort((a,b) => a.localeCompare(b,'hu')).join('\n');
  return Object.fromEntries(Object.entries(values).filter(([,value]) =>
    String(value ?? '').trim()));
}

module.exports = {FIELD_SHEET,MANUAL_FIELDS,PLAN_PHASES,validateTechnicalField,fieldSheetRows,manualValues,
  numberFromSheet,technicalReview,technicalReplacements};
