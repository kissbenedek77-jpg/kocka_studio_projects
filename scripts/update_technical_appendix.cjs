'use strict';

// A műszaki leírás sablon dokumentumába írja be a hosszú, fix fejezetszövegek
// appendixét ([[TUZVEDELMI]], [[SZERKEZETEK]], [[NYILATKOZAT]]). A generátor
// ezt a részt a kész példányból törli, a benne lévő {{...}} jelölőket pedig
// projektadattal tölti ki.
//
// Alapértéken csak tervez (dry-run). Élesítés: node scripts/update_technical_appendix.cjs --apply

const fs = require('node:fs');
const path = require('node:path');
const {google} = require('googleapis');
const {readTrackingCredential} = require('../server/tracking_credential.cjs');

const DOC_ID = process.env.TECHNICAL_TEMPLATE_DOC_ID ||
  '1TIGIBSACypr0ZvMZ2xXRABEcPArkQTwM_AqfnMNVtoA';
const ENV_FILE = path.join(__dirname, '..', '.env');
const APPLY = process.argv.includes('--apply');
const HEADING = 'SABLONSZÖVEGEK';

const FIRE = [
  'Az épület mértékadó kockázati osztálya: NAK',
  'Megengedett tűzszakasz nagyság: 1000 m²',
  'A mértékadó tűzszakasz nagysága: {{tuzszakasz_m2}} m²',
  '',
  'Az épületszerkezetek tűzvédelmi osztályának és tűzállósági határértékeinek vizsgálata:',
  '•\tteherhordó falak min. D REI 15\t{{retegrend:fal_vastagsag}} vtg. {{retegrend:fal_anyag}}\tmegfelel',
  '•\tfödémek min. D REI 15\t\t{{retegrend:fodem}}\tmegfelel',
  '•\tfedélszerkezet min. D\t\t{{retegrend:fedelszek}}\tmegfelel',
  '',
  'Kijáratok száma: {{kijarat_db}} db',
  'Villámvédelem: az OTSZ alapján nem kötelező',
  '',
  'Igény esetén – a szakági tervek alapján – az épületen a vonatkozó szabványsorozat szerinti ' +
    'villámvédelmi berendezést kell létesíteni. Az épület kiürítése az előírt normaidőkön belül már ' +
    'az első szakaszban biztosított. A mértékadó tűzszakasz szükséges oltóvíz mennyisége az OTSZ ' +
    'alapján 600 liter/perc, melyet 0,5 órán át kell folyamatosan biztosítani. Ezen oltóvíz ' +
    'mennyiséget a közelben (100 m-en belül) található utcai tűzcsapokról biztosítani lehet. Az ' +
    'épületen belül fali tűzcsapot nem kell létesíteni, valamint beépített tűzjelző berendezést ' +
    'sem kell kialakítani.',
  'Tűzjelzés mobiltelefonról biztosítható lesz.',
  'A hő- és füstelvezetés nem előírás.'
];

const STRUCTURES = [
  'Alapozás',
  'Az épület alatt sávalap készül, méretezett alapgerendákkal. Az alapozás kivitelezése a ' +
    'tartószerkezeti tervek szerint készüljön!',
  '',
  'Teherhordó szerkezetek',
  'Az épület tartószerkezete teherhordó kerámia falakból, valamint vasbeton pillérekből áll. ' +
    'Az épület külső teherhordó falai {{retegrend:fal_anyag}} falazóelemből, ' +
    '{{retegrend:fal_vastagsag}} vastagságban készülnek. A vasbeton szerkezetek kivitelezése a ' +
    'tartószerkezeti tervek szerint készül.',
  '',
  'Kémények',
  'Az új épületrészben új kerámia kémény készül.',
  '',
  'Válaszfalak',
  'Az épületben lévő válaszfalak 10 cm-es Porotherm válaszfalelemből épülnek. A válaszfalakat a ' +
    'födémsüllyedésből kialakuló falrepedések elkerülése végett PUR-habbal kell kiékelni.',
  '',
  'Aljzatok, feltöltések',
  'A földszinten a padló úsztatott padlóként lesz kialakítva, a padlóburkolatok aljzatát a ' +
    'szigetelésre kerülő aljzatbeton adja. Az aljzatbetonok kivitelezését kb. 20-25 m²-enként, és a ' +
    'falak mentén is el kell dilatálni 0,5 cm Therwoolin csíkkal. Az aljzatbetonba a beton utólagos ' +
    'repedésének elkerülése végett acélhálót kell fektetni.',
  '',
  'Tetőszerkezet, héjalás',
  'Az épület felett magastető készül {{retegrend:teto}} fedéssel, rejtett csapadékvíz elvezetéssel.',
  '',
  'Bádogozás',
  'A bádogos szerkezetek antracit színű porszórt alumínium lemezből készülnek a szükséges ' +
    'kiegészítőkkel. A tető vápái, oromszegélyei, kémény- és falszegélyei is antracit színű ' +
    'porszórt alumínium lemezből készülnek.',
  'Vízszigetelés',
  'Az újonnan készülő aljzatbetonra két réteg bitumenes szigetelést fektetünk.',
  'A belső vizes terekben a burkolat alá cementbázisú kent szigetelés kerül beépítésre, széleken ' +
    'és sarkokon hajlaterősítő szalaggal megerősítve, a burkolaton átszivárgó víz elleni védelem miatt.',
  '',
  'Hőszigetelés',
  'Az épület minden külső térrel érintkező szerkezete hőszigetelt.',
  'A földszinti padlóba 20 cm vastagságú lépésálló EPS hő- és hangszigetelés kerül. Koszorúk ' +
    'vasbetonszerkezetei 8 cm XPS, vagy Expert FIX előtét hablemezt kapnak, bentmaradó zsaluzatként. ' +
    'A felmenő szerkezet, külső homlokzat {{retegrend:fal_hoszigeteles}} hőszigetelő rendszerrel ' +
    'lesz ellátva.',
  'A magastető hőszigetelése 10+10 cm kőzetgyapot hőszigeteléssel készül. A nyílászárók hézagait, ' +
    'a vonalmenti hőhidakat PUR hab tömítéssel kell elzárni.',
  '',
  'Vakolatok',
  'A belső falvakolatok átlagosan 10-15 mm vastagságban készülnek a páraáteresztő zsákos gépi ' +
    'vakolattal, a mennyezet felületeken festés előtt glettelés készítendő. Vakolandó vb. ' +
    'szerkezeteknél tapadóhidat kell alkalmazni.',
  '',
  'Homlokzat képzés',
  'A homlokzati felületek szilikonbázisú vékonyvakolattal készülnek. Az alapvakolat zsákos gépi ' +
    'alapvakolat. Egyes helyeken hasított kőburkolat készül fagyálló ragasztással rögzítve, impregnálva',
  '',
  'Nyílászáró szerkezetek',
  'Az épületben hőhídmentes műanyag külső nyílászárók lesznek hőszigetelt üvegezéssel. A földszinti ' +
    'homlokzati üvegezés belső oldalára színtelen betörésvédő fólia kerül. A homlokzati nyílászárók ' +
    'vasalata és keresztmetszeti kialakítása a gyártmánynak megfelelően történik. A belső nyílászárók ' +
    'dekorfóliás MDF ajtók. A lakásbejárati ajtók biztonsági ajtók. A nyílászárók beépítése ' +
    'horganyzott acél tartókonzolokra, hézagolása RAL rendszer szerint történjen!',
  '',
  'Gipszkartonok',
  'A szükséges kétrétegű gipszkarton burkolat készül, fa vázra szerelve, csavarozott kötésekkel. A ' +
    'gipszkarton táblák illesztését és a falcsatlakozásokat hibahálóval kell kiépíteni a repedések ' +
    'elkerülése miatt.',
  '',
  'Felületképzések',
  'Belső terek felületképzése a vakolt felületen legalább kétszeri glettelés, és legalább két réteg ' +
    'festés. A faszerkezetek finomcsiszolás után kapnak pácolást választott színben. A homlokzati ' +
    'rozsdamentesített, tüzihorganyzott acélszerkezetek tüzihorganyzott kapcsolóelemekkel kapcsolódnak ' +
    'a tartószerkezethez. A lábazatok mögé bitumenes lemezszigetelés készül.',
  '',
  'Padlóburkolatok',
  'A vizes helyiségekben kerámia burkolat lesz lefektetve padozatnak. A lapburkolatok az Építtető ' +
    'által választott anyagból készülnek, hálós kötésben, nyitott hézaggal, fugázva.',
  'A kültéri burkolatok fagyálló minőségű csúszásmentes kerámiaburkolatok fagyálló, vízzáró és ' +
    'flexibilis ragasztóval ragasztva, nyitott hézaggal, fugázva. A padlóburkolatokhoz azonos anyagú ' +
    'lábazat készül az oldalfalakon. Kerámiaburkolatoknál 10 cm magas kísérőlábazat készül ragasztva, ' +
    'egységes színben.',
  '',
  'Asztalosszerkezetek',
  'Asztalosszerkezetekként készülnek még a homlokzati ablakok belső könyöklői Helopal, vagy ehhez ' +
    'hasonló profilból.',
  '',
  'Lakatosszerkezetek, korlátok',
  'A látszó acélszerkezetek rozsdamentesítve, horganyozva kerülnek beépítésre. A nem látszó, ' +
    'beépített acélszerkezetek rozsdamentesítve és tüzihorganyozva ill. alapmázolva készülnek. ' +
    'Tartószerkezethez történő csatlakozásnál a csatlakozóidom tüzihorganyzott kivitelben készül.',
  '',
  'Szellőzés',
  'A nyílászáróval rendelkező helyiségekben természetes módon oldjuk meg a szellőzést.',
  '',
  'Energiaellátás',
  'Részletes ismertetés a villamos rendszerleírásban olvasható.'
];

const DECLARATION = [
  'Felelős tervezőként kijelentem, hogy a tárgyi ingatlanra készített építészeti-műszaki ' +
    'tervdokumentációt a 280/2024. (IX. 30.) Korm. rendelet, a 2023. évi C. törvény és a 281/2024. ' +
    '(IX. 30.) Korm. rendelet figyelembe vételével készítettem el.',
  '',
  'Kijelentem, hogy az általam tervezett építmény megfelel a rendeltetési célja szerint:',
  '•\taz állékonyság és a mechanikai szilárdság,',
  '•\ta tűzbiztonság,',
  '•\ta higiénia, az egészség- és a környezetvédelem,',
  '•\ta biztonságos használat és akadálymentesség,',
  '•\ta zaj és rezgés elleni védelem,',
  '•\taz energiatakarékosság és hővédelem,',
  '•\taz élet- és vagyonvédelem, valamint',
  '•\ta természeti erőforrások fenntartható használata',
  'alapvető követelményeinek, és a tervezési programban részletezett elvárásoknak.',
  '',
  'A 281/2024. (IX. 30.) Korm. rendelet 8. § (4) alapján felelős tervezőként igazolom továbbá, hogy ' +
    'azáltalam elkészített tervdokumentációban az TÉKA 71. § (1-2) bekezdésében meghatározott ' +
    'követelmények – a vonatkozó magyar nemzeti szabványok alkalmazásával – teljesülnek.',
  '',
  'Nyilatkozom továbbá, hogy a tervezett épület megfelel a 2018. évi CXXXIX. törvény (Magyarország ' +
    'és egyes kiemelt térségeinek területrendezési tervéről) előírásainak.',
  '',
  'A tervezett égéstermék elvezetők az érvényben lévő előírásoknak és jogszabályoknak és ' +
    'szabványoknak megfelelnek.'
];

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
  oauth.setCredentials({refresh_token: readTrackingCredential(secret, encrypted, owner)});
  return oauth;
}

function paragraphText(item) {
  return (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
}

function appendixText() {
  return ['', HEADING + ' – innen olvassa a generátor a fejezetszövegeket; a kész példányból ez a ' +
    'rész törlődik.', '[[TUZVEDELMI]]', ...FIRE, '[[/TUZVEDELMI]]', '[[SZERKEZETEK]]',
  ...STRUCTURES, '[[/SZERKEZETEK]]', '[[NYILATKOZAT]]', ...DECLARATION, '[[/NYILATKOZAT]]']
    .join('\n') + '\n';
}

async function main() {
  loadEnvFile();
  const docs = google.docs({version:'v1', auth:authorize()});
  const read = async () => (await docs.documents.get({documentId:DOC_ID,
    includeTabsContent:false})).data;

  const before = await read();
  process.stdout.write(`Dokumentum: ${before.title}\n`);
  const paragraphs = (before.body?.content || []).filter(item => item.paragraph)
    .map(item => paragraphText(item).trim());
  if (paragraphs.some(text => text.toUpperCase().startsWith(HEADING))) {
    process.stdout.write('A sablonszöveg-appendix már létezik, nincs teendő.\n');
    return;
  }
  const forgotten = paragraphs.filter(text =>
    /DOKUMENTUM:(?:tervfazis|tervszam|revizio)/.test(text));
  if (forgotten.length) {
    process.stdout.write('\nFigyelem: a dokumentumban még vannak eltávolítandó jelölők:\n' +
      forgotten.map(text => '  - ' + text).join('\n') + '\n');
  }
  const text = appendixText();
  const content = before.body?.content || [];
  const last = content[content.length - 1];
  const index = Math.max(1, (last?.endIndex || 2) - 1);
  process.stdout.write(`Appendix: ${text.split('\n').length} sor, beszúrás a ${index}. indexre.\n`);

  if (!APPLY) {
    process.stdout.write('\nDRY-RUN: semmi nem módosult. Élesítés: ' +
      'node scripts/update_technical_appendix.cjs --apply\n');
    return;
  }

  await docs.documents.batchUpdate({documentId:DOC_ID, requestBody:{requests:[
    {insertText:{location:{index}, text}}
  ], ...(before.revisionId ? {writeControl:{requiredRevisionId:before.revisionId}} : {})}});

  const check = await read();
  const {textTemplates} = require('../server/technical_texts.cjs');
  const templates = textTemplates(check);
  process.stdout.write('\nKész. Kiolvasott blokkok: ' +
    Object.entries(templates).map(([key,value]) => `${key} (${value.length} kar.)`).join(', ') + '\n');
  if (!templates.TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG ||
      !templates['SZERKEZETEK LEÍRÁSA'] ||
      !templates.TERVEZOI_NYILATKOZAT_JOVAHAGYOTT_SZOVEG)
    throw new Error('Az appendix beírása után nem olvasható vissza mindhárom blokk.');
}

main().catch(error => {
  process.stderr.write('Hiba: ' + (error.message || String(error)) + '\n');
  process.exitCode = 1;
});
