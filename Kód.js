// MARK: Beállítások és sablonok
/*************************************************
 * BEÁLLÍTÁSOK
 *************************************************/

const SHEET_ID = '1BqQ0F4QjWJQfpCB3zSOibKCZ41xk6GzW7V3W6gdNp7I';
const SHEET_NAME = 'Adatok';
const MERGE_INDEX_SHEET = '_DokumentumIndex'; // UID + dokumentum ID + DRAFT/FINAL
const MERGE_PREFIX = 'KOCKA_MERGE_';

const TEMPLATE_ROOT_FOLDER_ID = '1yw8ts2OTQTK0y2dn8TnovvR5HbWSqHWd';
const PROJECT_DATA_TEMPLATE_ID = '1NZPw7bJAQFfQbTNl3yzObRly1bjyt2hRfQ0QHhCN4Dg';

// MARK: Tervfajták fájlnév alapján felismert méretarányai
// A tervjegyzék sorai mindig a projekt PDFA mappájából jönnek.
// Csak a fájlnévben szereplő részszöveghez tartozó méretarány állandó.
const PLAN_TYPE_SCALES = Object.freeze({
  'helyszínrajz': 'M=1:200',
  'alaprajza': 'M=1:50',
  'tető': 'M=1:50',
  'metszet': 'M=1:50',
  'homlokzat': 'M=1:50',
  'idomterv': 'M=1:500, 1:200',
  'geodézia': 'M=1:200',
  'tervezési': 'M=1:200',
  'konszignáció': 'M=1:20, 1:50',
  'részlet': 'M=1:5, 1:10',
  'kerítés': 'M=1:50'
});

const PLAN_SCALE_MATCH_ORDER = [
  'konszignáció', 'részlet', 'idomterv', 'helyszínrajz',
  'geodézia', 'tervezési', 'alaprajza', 'tető',
  'metszet', 'homlokzat', 'kerítés'
];

function normalizePlanName_(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getPlanScaleForTitle_(title) {
  const name = normalizePlanName_(title);
  const keyword = PLAN_SCALE_MATCH_ORDER.filter(function(key) {
    return name.indexOf(normalizePlanName_(key)) !== -1;
  })[0];
  return keyword ? PLAN_TYPE_SCALES[keyword] : '';
}

const DOCUMENT_TEMPLATES = {
  ajanlat: {
    title: 'Ajánlat',
    templateId: '1xfu7b6o0BzGOPNDjeqKfkIkaBZq-7pPuVIU2TeYGRLM',
    targetFolder: '_Belső'
  },
  szerzodes: {
    title: 'Építész szerződés',
    templateId: '1ZlTFxOAzccEReFsQ93Xmtd3T1d8CnpeWpY3j7ClWR1s',
    targetFolder: '_Belső'
  },
  muszakiLeiras: {
    title: 'Építész műszaki leírás',
    templateId: '1gMPWPJZsD1a9npfmQ2yFo1ZFmL5bKIo5ZE_SbMRKAgs',
    targetFolder: 'írásos'
  },
  meghatalmazas: {
    title: 'Meghatalmazás',
    templateId: '1mWGG9qcx7BCRTFKdq4WSGFB8mj7gJ91r_3Kcnx1NnOE',
    targetFolder: 'írásos'
  },
  alairolap: {
    title: 'Aláírólap',
    templateId: '154O4ujYA_Y4erOeKFv2QCLl34REOOuYSzQsK2yKFmHk',
    targetFolder: 'írásos'
  }
};

const PROJECT_SUBFOLDERS = [
  'írásos',
  '_Belső',
  'PDFA',
  'DWG',
  'Adat társtervezőktől',
  'PLN',
  'Render'
];

/*
 * A telepített Web App /exec URL-je.
 *
 * Példa:
 * https://script.google.com/macros/s/XXXXXXXXXXXX/exec
 */
const WEB_APP_URL =
  'https://script.google.com/macros/s/AKfycbwmN9Kz3fUH5iH_0wD7vUa9qpaPTUvAPUtCEHCgLkzZSgcYAjUGsFo-NhliKIppxlfLNA/exec';


/*************************************************
 * WEB APP
 *************************************************/

// MARK: Web app belépési pont
function doGet(e) {

  if (e && e.parameter && e.parameter.view === 'dashboard') {
    assertDashboardAccess_();
    const dashboard = HtmlService.createTemplateFromFile('dashboard_v2');
    dashboard.clientFormUrl = WEB_APP_URL;
    return dashboard.evaluate()
      .setTitle('Projekt dashboard')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  }

  const template = HtmlService.createTemplateFromFile('index');

  template.uid =
    e &&
    e.parameter &&
    e.parameter.uid
      ? String(e.parameter.uid)
          .trim()
          .toUpperCase()
      : '';

  const output = template
    .evaluate()
    .setTitle('Adatbekérő')
    .setXFrameOptionsMode(
      HtmlService.XFrameOptionsMode.ALLOWALL
    );

  output.addMetaTag(
    'viewport',
    'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover'
  );

  return output;
}

/*************************************************
 * SHEET MENÜ
 *************************************************/

// MARK: Sheet menü és megnyitás
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Projekt')
    .addItem('Dashboard megnyitása', 'openProjectDashboard')
    .addToUi();
}


function openUrlDialog_(url, title) {
  if (!url) {
    throw new Error('A megnyitandó hivatkozás nem található.');
  }

  const safeUrl = escapeHtml_(url);
  const html = HtmlService.createHtmlOutput(
    '<!doctype html><html><head><base target="_blank"><style>' +
    'body{font:14px Arial,sans-serif;color:#333;padding:18px;margin:0}' +
    'p{line-height:1.5;margin:0 0 14px}' +
    '.btn{display:inline-block;padding:10px 16px;background:#3e3e3e;color:#fff;text-decoration:none;border-radius:3px}' +
    '</style></head><body>' +
    '<p>A böngésző biztonsági szabályai miatt a hivatkozást innen tudod megnyitni:</p>' +
    '<a class="btn" href="' + safeUrl + '" onclick="google.script.host.close()">Megnyitás</a>' +
    '</body></html>'
  ).setWidth(420).setHeight(150);

  SpreadsheetApp.getUi().showModalDialog(html, title || 'Megnyitás');
}


function editSelectedClientData() {
  try {
    const context = getActiveProjectContext();
    const url = buildClientUrl(context.uid);
    openUrlDialog_(url, 'Adatok módosítása');
  } catch (err) {
    SpreadsheetApp.getUi().alert(err.message || String(err));
  }
}


function openSelectedProjectFolder() {
  try {
    const context = getActiveProjectContext();
    const folder = ensureProjectFolder(context);
    openUrlDialog_(folder.getUrl(), 'Projektmappa megnyitása');
  } catch (err) {
    SpreadsheetApp.getUi().alert(err.message || String(err));
  }
}



/*************************************************
 * ADATBEKÉRŐ E-MAIL ELŐKÉSZÍTÉSE A KIJELÖLT SORBÓL
 *************************************************/

// MARK: Adatbekérő e-mail előkészítése
function prepareClientFormEmail() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const range = sheet.getActiveRange();

  if (!sheet || sheet.getName() !== SHEET_NAME || !range || range.getRow() < 2) {
    ui.alert('Jelölj ki egy ügyfélrekordot az Adatok munkalapon.');
    return;
  }

  const rowNumber = range.getRow();
  const row = sheet.getRange(rowNumber, 1, 1, Math.max(sheet.getLastColumn(), 40)).getDisplayValues()[0];

  const uid = String(row[0] || '').trim();          // A
  const vezeteknev = String(row[7] || '').trim();  // H
  const keresztnev = String(row[8] || '').trim();  // I
  const email = String(row[27] || '').trim();      // AB
  const storedLink = String(row[3] || '').trim();  // D
  const clientLink = storedLink || (uid ? buildClientUrl(uid) : '');

  if (!uid) {
    ui.alert('A kijelölt rekordnak nincs UID-ja.');
    return;
  }

  if (!email) {
    ui.alert('A kijelölt rekordban nincs e-mail cím megadva.');
    return;
  }

  if (!clientLink) {
    ui.alert('A kijelölt rekordhoz nem található adatbekérő link.');
    return;
  }

  const fullName = [vezeteknev, keresztnev].filter(Boolean).join(' ');
  const greeting = fullName ? 'Kedves ' + fullName + '!' : 'Kedves Ügyfelünk!';
  const subject = 'Adatbekérés – Kocka Stúdió';
  const body = greeting + '\n\n' +
    'Kérjük, az alábbi linken töltse ki és ellenőrizze a tervezéshez szükséges adatokat:\n\n' +
    clientLink + '\n\n' +
    'Köszönettel:\n' +
    'Kocka Stúdió';

  const mailto = 'mailto:' + encodeURIComponent(email) +
    '?subject=' + encodeURIComponent(subject) +
    '&body=' + encodeURIComponent(body);

  const dialog = HtmlService.createHtmlOutput(
    '<!doctype html><html><head><base target="_blank"><style>' +
    'body{font:14px Arial,sans-serif;color:#333;padding:18px;margin:0}' +
    'h3{margin:0 0 14px;font-size:18px}' +
    'p{line-height:1.5;margin:8px 0}' +
    '.btn{display:inline-block;margin-top:14px;padding:10px 16px;background:#3e3e3e;color:#fff;text-decoration:none;border-radius:3px}' +
    '.link{margin-top:14px;font-size:12px;color:#666;word-break:break-all}' +
    '</style></head><body>' +
    '<h3>Adatbekérő elküldése</h3>' +
    '<p><strong>Címzett:</strong> ' + escapeHtml_(email) + '</p>' +
    '<p><strong>Ügyfél:</strong> ' + escapeHtml_(fullName || '—') + '</p>' +
    '<a class="btn" href="' + escapeHtml_(mailto) + '">Levél megnyitása</a>' +
    '<div class="link">' + escapeHtml_(clientLink) + '</div>' +
    '</body></html>'
  ).setWidth(480).setHeight(260);

  ui.showModalDialog(dialog, 'Adatbekérő elküldése');
}

function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


/*************************************************
 * UID
 *************************************************/

// MARK: UID létrehozása és ügyféllinkek
function generateUID() {

  return Utilities
    .getUuid()
    .replace(/-/g, '')
    .toUpperCase();

}


function generateUniqueUID(sheet) {

  let uid;

  do {

    uid = generateUID();

  } while (
    findUID(sheet, uid) !== -1
  );

  return uid;
}


/*************************************************
 * ÜGYFÉL LINK
 *************************************************/

function buildClientUrl(uid) {

  if (!WEB_APP_URL) {

    throw new Error(
      'A WEB_APP_URL nincs beállítva.'
    );

  }

  return (
    WEB_APP_URL +
    '?uid=' +
    encodeURIComponent(uid)
  );

}


/*************************************************
 * ÚJ ÜGYFÉL - SHEETBŐL
 *************************************************/

// MARK: Új ügyfél létrehozása Sheetből
function createNewRecord() {

  const ss =
    SpreadsheetApp.openById(SHEET_ID);

  const sheet =
    ss.getSheetByName(SHEET_NAME);

  if (!sheet) {

    throw new Error(
      'Az Adatok munkalap nem található.'
    );

  }

  const uid =
    generateUniqueUID(sheet);

  const editUrl =
    buildClientUrl(uid);


  const row =
    buildRow(
      {
        status: 'ELŐKÉSZÍTÉS',
        clientLink: editUrl,
        gdprAccepted: false
      },
      uid
    );


  sheet.appendRow(row);


  const rowNumber =
    sheet.getLastRow();

  sheet.activate();

  sheet
    .getRange(
      rowNumber,
      1,
      1,
      row.length
    )
    .activate();

}


/*************************************************
 * ÚJ ÜGYFÉL - WEB APPBÓL
 *************************************************/

// MARK: Új ügyfél létrehozása web appból
function createNewRecordForWeb() {

  const ss =
    SpreadsheetApp.openById(SHEET_ID);

  const sheet =
    ss.getSheetByName(SHEET_NAME);

  if (!sheet) {

    throw new Error(
      'Az Adatok munkalap nem található.'
    );

  }


  const uid =
    generateUniqueUID(sheet);

  const editUrl =
    buildClientUrl(uid);


  const row =
    buildRow(
      {
        status: 'ELŐKÉSZÍTÉS',
        clientLink: editUrl,
        gdprAccepted: false
      },
      uid
    );


  sheet.appendRow(row);


  return {

    success: true,

    mode: 'created',

    uid: uid,

    url: editUrl

  };

}


/*************************************************
 * ADATOK MENTÉSE
 *************************************************/

// MARK: Ügyféladatok mentése
function saveData(data) {

  const ss =
    SpreadsheetApp.openById(SHEET_ID);

  const sheet =
    ss.getSheetByName(SHEET_NAME);

  if (!sheet) {

    throw new Error(
      'Az Adatok munkalap nem található.'
    );

  }


  validateData(data);


  let uid =
    data.uid
      ? String(data.uid)
          .trim()
          .toUpperCase()
      : '';


  let existingRow = -1;


  /*
   * UID esetén kizárólag meglévő
   * rekord módosítható.
   */
  if (uid) {

    existingRow =
      findUID(
        sheet,
        uid
      );


    if (existingRow === -1) {

      throw new Error(
        'A megadott UID nem található. ' +
        'Új rekord létrehozása nem engedélyezett.'
      );

    }

  } else {

    uid =
      generateUniqueUID(sheet);

  }


  /*
   * Meglévő adatok megőrzése.
   */
  let oldStatus =
    '';

  let oldClientLink =
    '';

  let oldGdprAccepted =
    false;
  let oldProjectFolderUrl = '';


  if (existingRow !== -1) {

    const oldRow =
      sheet
        .getRange(
          existingRow,
          1,
          1,
          40
        )
        .getValues()[0];


    /*
     * C = státusz
     */
    oldStatus =
      oldRow[2] || '';


    /*
     * D = ügyfél link
     */
    oldClientLink =
      oldRow[3] || '';


    /*
     * E = projekt mappa link
     */
    const oldFolderCell = sheet.getRange(existingRow, 5);
    const oldFolderRich = oldFolderCell.getRichTextValue();
    oldProjectFolderUrl = (oldFolderRich && oldFolderRich.getLinkUrl()) ||
      extractDriveId(oldRow[4]) && String(oldRow[4]) || '';


    /*
     * G = GDPR
     */
    oldGdprAccepted =
      oldRow[6] === true;

  }


  /*
   * Státusz.
   */
  data.status =
    data.status ||
    oldStatus ||
    'ELŐKÉSZÍTÉS';


  /*
   * Ügyféllink.
   */
  data.clientLink =
    data.clientLink ||
    oldClientLink ||
    buildClientUrl(uid);


  /*
   * Projektmappa link.
   */
  data.projectFolderUrl =
    data.projectFolderUrl ||
    oldProjectFolderUrl ||
    '';


  /*
   * GDPR:
   *
   * Ha már egyszer elfogadta,
   * ne lehessen egy hiányos kliensadat
   * miatt véletlenül FALSE-ra állítani.
   *
   * Ha az új rekordnál nincs érték,
   * FALSE.
   */
  data.gdprAccepted =
    data.gdprAccepted === true ||
    oldGdprAccepted;


  /*
   * Ha az értesítési cím checkbox
   * nincs megadva, alapértelmezett:
   * igaz.
   */
  if (
    typeof data.ertesitesi_same !==
    'boolean'
  ) {

    data.ertesitesi_same = true;

  }


  /*
   * Ha az értesítési cím azonos a lakcímmel,
   * szerveroldalon is biztosítjuk az egyezést.
   *
   * Ez fontos, mert nem szabad csak a
   * JavaScript kliensoldali működésére hagyatkozni.
   */
  if (
    data.ertesitesi_same === true
  ) {

    data.ertesitesi_irsz =
      data.lakcim_irsz || '';

    data.ertesitesi_varos =
      data.lakcim_varos || '';

    data.ertesitesi_kozterulet =
      data.lakcim_kozterulet || '';

    data.ertesitesi_tipus =
      data.lakcim_tipus || '';

    data.ertesitesi_hazszam =
      data.lakcim_hazszam || '';

    data.ertesitesi_egyeb =
      data.lakcim_egyeb || '';

    data.ertesitesiCim =
      data.lakcim || '';

  }


  const row =
    buildRow(
      data,
      uid
    );


  /*
   * Új rekord.
   */
  if (existingRow === -1) {

    sheet.appendRow(row);
    // Új ügyfél: projektmappa csak akkor, ha már van teljes projektcím.
    // A későbbi Web App mentések is elindítják a szinkront.
    syncProjectAfterSave_(uid);

    return {

      success: true,

      mode: 'created',

      uid: uid,

      url: data.clientLink

    };

  }


  /*
   * Meglévő rekord.
   */
  sheet
    .getRange(
      existingRow,
      1,
      1,
      row.length
    )
    .setValues([row]);
  if (oldProjectFolderUrl && extractDriveId(oldProjectFolderUrl)) {
    const rich = SpreadsheetApp.newRichTextValue()
      .setText('Projekt mappa').setLinkUrl(oldProjectFolderUrl).build();
    sheet.getRange(existingRow, 5).setRichTextValue(rich);
  }
  syncProjectAfterSave_(uid);

  return {

    success: true,

    mode: 'updated',

    uid: uid,

    url: data.clientLink

  };

}


/*************************************************
 * VALIDÁLÁS
 *************************************************/

// MARK: Szerveroldali adatellenőrzés
function validateData(data) {

  if (!data.vezeteknev) {

    throw new Error(
      'A vezetéknév megadása kötelező.'
    );

  }


  if (!data.keresztnev) {

    throw new Error(
      'A keresztnév megadása kötelező.'
    );

  }


  if (!data.allampolgarsag) {

    throw new Error(
      'Az állampolgárság megadása kötelező.'
    );

  }


  if (!data.adoazonosito) {

    throw new Error(
      'Az adóazonosító megadása kötelező.'
    );

  }


  /*
   * Magyar adóazonosító:
   * pontosan 10 számjegy.
   */
  if (
    data.allampolgarsag === 'Magyar'
  ) {

    const taxId =
      String(data.adoazonosito)
        .replace(/\D/g, '');


    if (
      !/^\d{10}$/.test(taxId)
    ) {

      throw new Error(
        'Az adóazonosító jel 10 számjegyből áll.'
      );

    }

  }


  /*
   * Projekt típus.
   */
  if (!data.projektTipus) {

    throw new Error(
      'A projekt típusának megadása kötelező.'
    );

  }


  /*
   * Ha "egyéb", akkor a szabad szöveges
   * érték is szükséges.
   */
  if (
    (data.projektTipus === 'Egyéb' || data.projektTipus === 'egyéb') &&
    !data.projektTipusEgyeb
  ) {

    throw new Error(
      'Adja meg az egyéb projekt típusát.'
    );

  }

}


/*************************************************
 * SOR FELÉPÍTÉSE
 *
 * A–AN = 40 oszlop
 *************************************************/

// MARK: Sheet sorok és projektnevek
function buildRow(data, uid) {

  // A–AN = 40 oszlop az aktuális Sheet-sorrend szerint.
  return [
    uid,                              // A  UID
    new Date(),                       // B  Dátum
    data.status || 'ELŐKÉSZÍTÉS',     // C  Státusz
    data.clientLink || buildClientUrl(uid), // D Form link
    data.projectFolderUrl || '',      // E  Projekt mappa
    data.language || '',              // F  Nyelv
    data.gdprAccepted === true,       // G  adatvédelmi elfogadva
    data.vezeteknev || '',            // H  Vezetéknév
    data.keresztnev || '',            // I  Keresztnév
    data.szuletesiNev || '',          // J  Születési név
    data.allampolgarsag || '',        // K  Állampolgárság

    data.lakcim_irsz || '',           // L  Irányítószám
    data.lakcim_varos || '',          // M  Város
    data.lakcim_kozterulet || '',     // N  Közterület
    data.lakcim_tipus || '',          // O  Típus
    data.lakcim_hazszam || '',        // P  Házszám
    data.lakcim_egyeb || '',          // Q  Egyéb
    data.lakcim || '',                // R  Cím

    data.ertesitesi_irsz || '',       // S
    data.ertesitesi_varos || '',      // T
    data.ertesitesi_kozterulet || '', // U
    data.ertesitesi_tipus || '',      // V
    data.ertesitesi_hazszam || '',    // W
    data.ertesitesi_egyeb || '',      // X
    data.ertesitesiCim || '',         // Y

    data.adoazonosito || '',          // Z
    data.telefon || '',               // AA
    data.email || '',                 // AB
    data.anyjaNeve || '',             // AC
    data.szuletesiHely || '',         // AD
    data.szuletesiIdo || '',          // AE

    getProjectName(data),             // AF
    data.projekt_irsz || '',          // AG
    data.projekt_varos || '',         // AH
    data.projekt_kozterulet || '',    // AI
    data.projekt_tipus || '',         // AJ
    data.projekt_hazszam || '',       // AK
    data.projekt_egyeb || '',         // AL
    data.projektCim || '',            // AM
    data.hrsz || ''                   // AN
  ];
}

function getProjectName(data) {
  if (data.projektTipus === 'Egyéb' || data.projektTipus === 'egyéb') {
    return data.projektTipusEgyeb
      ? 'Egyéb: ' + String(data.projektTipusEgyeb).trim()
      : 'Egyéb';
  }
  return data.projektTipus || '';
}

function parseProjectName(value) {
  const text = String(value || '').trim();
  const match = text.match(/^Egyéb\s*:\s*(.*)$/i);
  if (match) {
    return { projektTipus: 'Egyéb', projektTipusEgyeb: match[1] || '' };
  }
  if (/^egyéb$/i.test(text)) {
    return { projektTipus: 'Egyéb', projektTipusEgyeb: '' };
  }
  return { projektTipus: text, projektTipusEgyeb: '' };
}


/*************************************************
 * UID KERESÉSE
 *************************************************/

// MARK: UID keresése és rekord betöltése
function findUID(sheet, uid) {

  const values =
    sheet
      .getDataRange()
      .getValues();


  for (
    let i = 1;
    i < values.length;
    i++
  ) {

    const rowUID =
      String(values[i][0])
        .trim()
        .toUpperCase();


    if (
      rowUID === uid
    ) {

      return i + 1;

    }

  }


  return -1;

}


/*************************************************
 * ADATOK BETÖLTÉSE
 *************************************************/

function getData(uid) {

  if (!uid) return null;

  uid = String(uid).trim().toUpperCase();

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    throw new Error('Az Adatok munkalap nem található.');
  }

  const rowNumber = findUID(sheet, uid);
  if (rowNumber === -1) return null;

  // A web app RPC válaszában nem szerepelhet Date objektum.
  const row = sheet.getRange(rowNumber, 1, 1, 40).getValues()[0]
    .map(function(value) { return value instanceof Date ? formatDate(value) : value; });
  const project = parseProjectName(row[31]);

  return {
    uid: row[0],
    status: row[2],
    clientLink: row[3],
    projectFolderUrl: row[4],
    language: row[5],
    gdprAccepted: row[6] === true,

    vezeteknev: row[7],
    keresztnev: row[8],
    szuletesiNev: row[9],
    allampolgarsag: row[10],

    lakcim_irsz: row[11],
    lakcim_varos: row[12],
    lakcim_kozterulet: row[13],
    lakcim_tipus: row[14],
    lakcim_hazszam: row[15],
    lakcim_egyeb: row[16],
    lakcim: row[17],

    ertesitesi_irsz: row[18],
    ertesitesi_varos: row[19],
    ertesitesi_kozterulet: row[20],
    ertesitesi_tipus: row[21],
    ertesitesi_hazszam: row[22],
    ertesitesi_egyeb: row[23],
    ertesitesiCim: row[24],

    adoazonosito: row[25],
    telefon: row[26],
    email: row[27],
    anyjaNeve: row[28],
    szuletesiHely: row[29],
    szuletesiIdo: formatDate(row[30]),

    projektTipus: project.projektTipus,
    projektTipusEgyeb: project.projektTipusEgyeb,
    projekt_irsz: row[32],
    projekt_varos: row[33],
    projekt_kozterulet: row[34],
    projekt_tipus: row[35],
    projekt_hazszam: row[36],
    projekt_egyeb: row[37],
    projektCim: row[38],
    hrsz: row[39],

    ertesitesi_same: (
      String(row[17] || '') === String(row[24] || '')
    )
  };
}



/*************************************************
 * PROJEKTMAPPA + DOKUMENTUMGENERÁLÁS
 *************************************************/

// MARK: Projektmappák és aktív sor
function getActiveProjectContext() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw new Error(
      'A funkció csak a Google Sheet menüjéből használható.'
    );
  }

  const sheet = ss.getActiveSheet();

  if (!sheet) {
    throw new Error('Nincs aktív munkalap.');
  }

  if (sheet.getName() !== SHEET_NAME) {
    throw new Error(
      'Válassz ki egy projektet az "' +
      SHEET_NAME +
      '" munkalapon.'
    );
  }

  const activeRange = sheet.getActiveRange();

  if (!activeRange) {
    throw new Error('Jelölj ki egy projekt sort.');
  }

  const rowNumber = activeRange.getRow();

  if (rowNumber < 2) {
    throw new Error(
      'Jelölj ki egy projektet a fejléc alatti sorok egyikében.'
    );
  }

  const uid = String(
    sheet.getRange(rowNumber, 1).getValue() || ''
  )
    .trim()
    .toUpperCase();

  if (!uid) {
    throw new Error(
      'A kijelölt sorhoz nincs UID.'
    );
  }

  const data = getData(uid);

  if (!data) {
    throw new Error(
      'A kijelölt sor UID-je nem található: ' +
      uid
    );
  }

  return {
    ss: ss,
    sheet: sheet,
    rowNumber: rowNumber,
    uid: uid,
    data: data
  };
}

function buildProjectFolderName(data) {
  return [
    data.projekt_varos,
    data.projekt_kozterulet,
    data.projekt_tipus,
    data.projekt_hazszam
  ]
    .filter(function(value) {
      return String(value || '').trim() !== '';
    })
    .map(function(value) {
      return String(value).trim();
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}


function extractDriveId(value) {
  const text = String(value || '').trim();

  if (!text) {
    return '';
  }

  const folderMatch = text.match(/\/folders\/([A-Za-z0-9_-]+)/);

  if (folderMatch) {
    return folderMatch[1];
  }

  if (/^[A-Za-z0-9_-]{10,}$/.test(text)) {
    return text;
  }

  return '';
}


function getExistingProjectFolder(context) {
  const cell = context.sheet.getRange(context.rowNumber, 5);
  const rich = cell.getRichTextValue();

  let url = '';

  if (rich) {
    url = rich.getLinkUrl() || '';
  }

  if (!url) {
    url = String(cell.getValue() || '');
  }

  const folderId = extractDriveId(url);

  if (!folderId) {
    return null;
  }

  try {
    return DriveApp.getFolderById(folderId);
  } catch (err) {
    return null;
  }
}


function findOrCreateSubfolder(parentFolder, name) {
  const folders = parentFolder.getFoldersByName(name);

  if (folders.hasNext()) {
    return folders.next();
  }

  return parentFolder.createFolder(name);
}


function ensureProjectSubfolders(projectFolder) {
  PROJECT_SUBFOLDERS.forEach(function(folderName) {
    findOrCreateSubfolder(projectFolder, folderName);
  });
}


function setProjectFolderLink(context, folder) {
  const richText = SpreadsheetApp
    .newRichTextValue()
    .setText('Projekt mappa')
    .setLinkUrl(folder.getUrl())
    .build();

  context.sheet
    .getRange(context.rowNumber, 5)
    .setRichTextValue(richText);
}


function getProjectsParentFolder() {
  const templateRoot = DriveApp.getFolderById(
    TEMPLATE_ROOT_FOLDER_ID
  );

  const parents = templateRoot.getParents();

  if (!parents.hasNext()) {
    throw new Error(
      'A sablonmappa szülőmappája nem érhető el.'
    );
  }

  return parents.next();
}

function getStartedProjectsFolder_() {
  const preparationFolder = getProjectsParentFolder();
  const parents = preparationFolder.getParents();
  if (!parents.hasNext()) {
    throw new Error('Az előkészítő mappa szülőmappája nem érhető el.');
  }
  return parents.next();
}

function getProjectFolderForMove_(context, expectedParent, action) {
  const folder = getExistingProjectFolder(context);
  if (!folder) {
    throw new Error('A kijelölt projekthez nem található elérhető projektmappa az E oszlopban.');
  }
  const parents = folder.getParents();
  if (!parents.hasNext() || parents.next().getId() !== expectedParent.getId()) {
    throw new Error('A projektmappa nincs a ' + action + ' várt helyén: ' + folder.getName());
  }
  return folder;
}

function assertProjectFolderDestinationAvailable_(folder, destination) {
  const sameName = destination.getFoldersByName(folder.getName());
  while (sameName.hasNext()) {
    if (sameName.next().getId() !== folder.getId()) {
      throw new Error('A célmappában már van ilyen nevű projektmappa: ' + folder.getName());
    }
  }
}

function moveProjectFolder_(folder, destination) {
  assertProjectFolderDestinationAvailable_(folder, destination);
  folder.moveTo(destination);
}


function ensureProjectFolder(context) {
  context = context || getActiveProjectContext();

  let folder = getExistingProjectFolder(context);

  if (folder) {
    ensureProjectSubfolders(folder);
    setProjectFolderLink(context, folder);
    return folder;
  }

  const folderName = buildProjectFolderName(context.data);

  if (!folderName) {
    throw new Error(
      'A projektmappa létrehozásához projekt város, közterület és házszám szükséges.'
    );
  }

  const parentFolder = getProjectsParentFolder();
  const sameName = parentFolder.getFoldersByName(folderName);

  if (sameName.hasNext()) {
    folder = sameName.next();
  } else {
    folder = parentFolder.createFolder(folderName);
  }

  ensureProjectSubfolders(folder);
  setProjectFolderLink(context, folder);

  return folder;
}


function ensureProjectFolderForActiveRow() {
  const context = getActiveProjectContext();
  const folder = ensureProjectFolder(context);
  const result = ensureAllProjectDocuments_(context, folder);

  SpreadsheetApp.getUi().alert(
    'Alapdokumentumok: ' + result.created + ' új, ' + result.existing + ' meglévő.\n\n' +
    'Projektmappa:\n' +
    folder.getName() +
    '\n\n' +
    folder.getUrl()
  );
}


function getTargetSubfolder(projectFolder, folderName) {
  return findOrCreateSubfolder(
    projectFolder,
    folderName
  );
}

// MARK: Tervjegyzék a projekt aktuális PDFA fájljaiból
function getProjectPlanEntries_(projectFolder, uid) {
  const folders = projectFolder.getFoldersByName('PDFA');
  if (!folders.hasNext()) return [];

  const files = folders.next().getFiles();
  const entries = [];
  const answers = uid ? getDashboardAnswers_(uid) : {};
  while (files.hasNext()) {
    const file = files.next();
    const name = String(file.getName() || '');
    if (!/\.pdf$/i.test(name)) continue;
    const title = name.replace(/\.pdf$/i, '').replace(/[\r\n\t]+/g, ' ').trim();
    if (!title) continue;
    entries.push({title: title, scale: getPlanScaleForTitle_(title) ||
      answers['scale:' + title] || ''});
  }

  entries.sort(function(a, b) {
    const aMatch = a.title.match(/^[A-Za-z]+-(\d+)/);
    const bMatch = b.title.match(/^[A-Za-z]+-(\d+)/);
    const aNumber = aMatch ? Number(aMatch[1]) : Infinity;
    const bNumber = bMatch ? Number(bMatch[1]) : Infinity;
    return aNumber - bNumber || a.title.localeCompare(b.title, 'hu');
  });
  return entries;
}

function isProjectPlanLine_(text) {
  const value = String(text || '').trim();
  return /^EK-\d+\b/i.test(value) ||
    value === 'Nincs PDF tervlap a PDFA mappában.' ||
    /\t(?:M=\d|méretarány ellenőrizendő)/i.test(value);
}

function refreshTechnicalPlanList_(documentId, projectFolder, uid) {
  const entries = getProjectPlanEntries_(projectFolder, uid);
  const lines = entries.length
    ? entries.map(function(entry) {
        return entry.title + '\t' + (entry.scale || 'méretarány ellenőrizendő');
      })
    : ['Nincs PDF tervlap a PDFA mappában.'];

  const doc = DocumentApp.openById(documentId);
  const body = doc.getBody();
  let start = -1;
  for (let i = 0; i < body.getNumChildren(); i++) {
    const child = body.getChild(i);
    if (child.getType() === DocumentApp.ElementType.PARAGRAPH &&
        child.getText().trim() === 'Építészeti tervrajzok') {
      start = i + 1;
      break;
    }
  }
  if (start < 0) {
    doc.saveAndClose();
    throw new Error('A műszaki leírásban nincs „Építészeti tervrajzok” szakasz.');
  }

  let end = start;
  const previous = [];
  while (end < body.getNumChildren()) {
    const child = body.getChild(end);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH ||
        !isProjectPlanLine_(child.getText())) break;
    previous.push(child.getText());
    end++;
  }
  if (previous.join('\n') === lines.join('\n')) {
    doc.saveAndClose();
    return entries.length;
  }

  const attributes = end > start ? body.getChild(start).getAttributes() : null;
  for (let i = end - 1; i >= start; i--) {
    body.removeChild(body.getChild(i));
  }
  lines.forEach(function(line, index) {
    const paragraph = body.insertParagraph(start + index, line);
    if (attributes) paragraph.setAttributes(attributes);
  });
  doc.saveAndClose();
  return entries.length;
}

// MARK: Címlapkép a legfrissebb rendercsomagból
function renderPackageOrder_(label) {
  return String(label || '').toLowerCase().split('').reduce(function(value, letter) {
    return value * 26 + letter.charCodeAt(0) - 96;
  }, 0);
}

function getLatestRenderCoverFile_(projectFolder) {
  const folders = projectFolder.getFoldersByName('Render');
  if (!folders.hasNext()) return null;

  const files = folders.next().getFiles();
  const images = [];
  while (files.hasNext()) {
    const file = files.next();
    if (!/^image\/(?:jpeg|png|gif)$/i.test(file.getMimeType())) continue;
    const match = String(file.getName() || '').match(/^([a-z]+)[_\s-]+(\d+)(?=\D|$)/i);
    if (!match) continue;
    images.push({
      file: file,
      packageOrder: renderPackageOrder_(match[1]),
      number: Number(match[2])
    });
  }
  if (!images.length) return null;

  const latestOrder = Math.max.apply(null, images.map(function(image) {
    return image.packageOrder;
  }));
  const covers = images.filter(function(image) {
    return image.packageOrder === latestOrder && image.number === 1;
  });
  if (!covers.length) {
    throw new Error('A legfrissebb Render képcsomagból hiányzik az 1. számú kép.');
  }
  covers.sort(function(a, b) {
    return b.file.getLastUpdated().getTime() - a.file.getLastUpdated().getTime() ||
      a.file.getName().localeCompare(b.file.getName(), 'hu');
  });
  return covers[0].file;
}

function refreshTechnicalCoverImage_(documentId, projectFolder) {
  const file = getLatestRenderCoverFile_(projectFolder);
  if (!file) return false;

  const doc = DocumentApp.openById(documentId);
  const paragraphs = doc.getBody().getParagraphs();
  let anchor = null;
  let oldImage = null;
  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i];
    const images = paragraph.getPositionedImages();
    images.forEach(function(image) {
      if (!oldImage || image.getWidth() * image.getHeight() >
          oldImage.getWidth() * oldImage.getHeight()) {
        anchor = paragraph;
        oldImage = image;
      }
    });
    if (paragraph.getText().trim()) break;
  }
  if (!anchor || !oldImage) {
    doc.saveAndClose();
    throw new Error('A műszaki leírás címlapján nincs lecserélhető elhelyezett kép.');
  }

  const newImage = anchor.addPositionedImage(file.getBlob());
  newImage.setWidth(oldImage.getWidth())
    .setHeight(oldImage.getHeight())
    .setLayout(oldImage.getLayout())
    .setLeftOffset(oldImage.getLeftOffset())
    .setTopOffset(oldImage.getTopOffset());
  anchor.removePositionedImage(oldImage.getId());
  doc.saveAndClose();
  return true;
}

// MARK: Helyiséglista a projekt PLN mappájának szövegfájljából
function findProjectDataSpreadsheet_(projectFolder) {
  const folders = [projectFolder];
  ['Írásos', 'írásos'].forEach(function(name) {
    const writtenFolders = projectFolder.getFoldersByName(name);
    while (writtenFolders.hasNext()) folders.push(writtenFolders.next());
  });
  const matches = [];
  folders.forEach(function(folder) {
    const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    while (files.hasNext()) {
      const file = files.next();
      if (/^Tervezési adatok(?:\s|\s*-)/i.test(file.getName())) matches.push(file);
    }
  });
  if (matches.length > 1)
    throw new Error('Több „Tervezési adatok” Sheet található a projektmappában.');
  if (!matches.length) return null;
  return SpreadsheetApp.openById(matches[0].getId());
}

function ensureProjectDataSpreadsheet_(projectFolder) {
  const existing = findProjectDataSpreadsheet_(projectFolder);
  if (existing) return existing;
  const written = getTargetSubfolder(projectFolder, 'írásos');
  const name = 'Tervezési adatok - ' + projectFolder.getName();
  const file = DriveApp.getFileById(PROJECT_DATA_TEMPLATE_ID).makeCopy(name, written);
  const spreadsheet = SpreadsheetApp.openById(file.getId());
  installProjectDataTrigger_(spreadsheet.getId());
  return spreadsheet;
}

function setProjectDashboardLink_(spreadsheet, uid) {
  const control = spreadsheet.getSheetByName('Generálás');
  if (!control) return;
  const target = DASHBOARD_WEB_APP_URL + '?view=dashboard&project=' + encodeURIComponent(uid);
  const current = control.getRange('B6').getRichTextValue();
  if (current && current.getLinkUrl() === target) return;
  control.getRange('A6').setValue('Projekt dashboard');
  control.getRange('B6').setRichTextValue(SpreadsheetApp.newRichTextValue()
    .setText('Dashboard megnyitása')
    .setLinkUrl(target)
    .build());
}

function getProjectContextForDataSheet_(spreadsheet) {
  const file = DriveApp.getFileById(spreadsheet.getId());
  const parents = file.getParents();
  if (!parents.hasNext()) throw new Error('A projekt adatlapja nem projektmappában van.');
  const written = parents.next();
  const projectFolder = /^írásos$/i.test(written.getName())
    ? written.getParents().next() : written;
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  const last = sheet.getLastRow();
  if (last < 2) throw new Error('A központi ügyféllap üres.');
  const links = sheet.getRange(2, 5, last - 1, 1).getRichTextValues();
  const values = sheet.getRange(2, 5, last - 1, 1).getDisplayValues();
  const uids = sheet.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (let i = 0; i < links.length; i++) {
    const url = links[i][0] && links[i][0].getLinkUrl() || values[i][0];
    if (extractDriveId(url) !== projectFolder.getId()) continue;
    const uid = String(uids[i][0] || '').trim().toUpperCase();
    const data = getData(uid);
    if (data) return {ss: sheet.getParent(), sheet: sheet, rowNumber: i + 2,
      uid: uid, data: data, projectFolder: projectFolder};
  }
  throw new Error('A projekt adatlapjához nem található ügyfélrekord a központi táblázatban.');
}

function getTechnicalSheetReplacements_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName('Munkalap1');
  if (!sheet) throw new Error('A projekt adatlapon nincs Munkalap1.');
  const values = sheet.getRange('A1:J20').getDisplayValues();
  const out = {};
  const addresses = [
    'B2', 'B3', 'B5', 'B6', 'B7', 'E2', 'H2', 'H3', 'H5',
    'H7', 'E6', 'E8', 'B9', 'E9', 'J2', 'J5'
  ];
  addresses.forEach(function(address) {
    const columnIndex = address.charCodeAt(0) - 65;
    const rowIndex = Number(address.slice(1)) - 1;
    out['TERVEZESI_ADATOK:Munkalap1!' + address] = values[rowIndex][columnIndex];
  });
  return out;
}

function getTechnicalProgramLines_(spreadsheet, replacements) {
  const sheet = spreadsheet.getSheetByName('Tervezési program');
  if (!sheet) throw new Error('A projekt adatlapon nincs Tervezési program munkalap.');
  const values = sheet.getRange(2, 1, 16, 2).getDisplayValues();
  return values.map(function(row, index) {
    const letter = String.fromCharCode(97 + index);
    if (String(row[0]).trim() !== letter ||
        !new RegExp('^' + letter + '\\)').test(String(row[1]).trim()))
      throw new Error('A tervezési program ' + letter + ') pontja hiányzik vagy hibás.');
    const text = String(row[1]).trim().replace(/\{\{([^}]+)\}\}/g, function(marker, key) {
      if (!(key in replacements) || String(replacements[key]).trim() === '')
        throw new Error('Hiányzó projektadat a tervezési programban: ' + key);
      return String(replacements[key]);
    });
    return text.split(/\r?\n/).filter(function(line) { return line.trim() !== ''; });
  });
}

function refreshTechnicalProgram_(documentId, spreadsheet, data) {
  const replacements = Object.assign({}, getDocumentReplacements(data),
    getTechnicalSheetReplacements_(spreadsheet));
  const points = getTechnicalProgramLines_(spreadsheet, replacements);
  const doc = DocumentApp.openById(documentId);
  const body = doc.getBody();
  let start = -1, end = -1;
  for (let i = 0; i < body.getNumChildren(); i++) {
    const text = getBodyElementText_(body.getChild(i)).trim();
    if (start < 0 && /^Tervezési program\s*\(266\/2013\./.test(text)) start = i;
    else if (start >= 0 && /^Zöldterület számítása$/.test(text)) { end = i; break; }
  }
  if (start < 0 || end < 0 || end <= start)
    throw new Error('A műszaki leírás tervezési programjának határai nem találhatók.');
  for (let i = end - 1; i > start; i--) body.removeChild(body.getChild(i));
  let insertAt = start + 1;
  points.forEach(function(lines) {
    lines.forEach(function(line) {
      const paragraph = body.insertParagraph(insertAt++, line);
      paragraph.editAsText().setFontFamily('Arial Narrow').setFontSize(10)
        .setForegroundColor('#1456BA');
    });
    body.insertParagraph(insertAt++, '');
  });
  doc.saveAndClose();
}

function prepareTechnicalProjectSheet_(projectFolder) {
  const spreadsheet = ensureProjectDataSpreadsheet_(projectFolder);
  const roomData = getProjectRoomData_(projectFolder);
  if (roomData) {
    const list = buildRoomList_(roomData);
    writeRoomTotalToProjectSheet_(roomData.summarySheet, list.totalCents);
    writeRoomListToProjectSheet_(spreadsheet, list.rows);
  }
  return spreadsheet;
}

function refreshTechnicalDescription_(documentId, projectFolder, data, spreadsheet) {
  spreadsheet = spreadsheet || prepareTechnicalProjectSheet_(projectFolder);
  refreshTechnicalProgram_(documentId, spreadsheet, data);
  refreshTechnicalPlanList_(documentId, projectFolder, data.uid);
  refreshTechnicalRoomList_(documentId, projectFolder);
  refreshTechnicalGrossCoverage_(documentId, projectFolder);
  refreshTechnicalCoverImage_(documentId, projectFolder);
}

function findProjectRoomFile_(projectFolder) {
  const folders = [];
  ['PLN', 'pln'].forEach(function(name) {
    const iterator = projectFolder.getFoldersByName(name);
    while (iterator.hasNext()) folders.push(iterator.next());
  });
  if (folders.length > 1) throw new Error('Több PLN mappa található a projektben.');
  if (!folders.length) return null;
  const files = folders[0].getFiles();
  const matches = [];
  while (files.hasNext()) {
    const file = files.next();
    if (/^(?:helyiségek|helyiséglista)\.txt$/i.test(file.getName())) matches.push(file);
  }
  const preferred = matches.filter(function(file) { return /^helyiségek\.txt$/i.test(file.getName()); });
  if (preferred.length > 1 || (!preferred.length && matches.length > 1))
    throw new Error('Több helyiséglista szövegfájl található a PLN mappában.');
  return preferred[0] || matches[0] || null;
}

function parseRoomAreaCents_(value) {
  const normalized = String(value || '').replace(/\s|m²|m2/gi, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

function formatRoomArea_(cents) {
  return (cents / 100).toFixed(2).replace('.', ',');
}

function parseProjectRoomText_(content, sourceName) {
  const values = String(content || '').replace(/^\uFEFF/, '').split(/\r?\n/).map(function(line) {
    return [line];
  });
  const rooms = [];
  let sourceTotal = null;
  let columns = null;
  values.forEach(function(row, index) {
    const cells = row[0] && row[0].indexOf('|') !== -1
      ? row[0].split('|').map(function(value) { return value.trim(); })
      : row.map(function(value) { return String(value).trim(); });
    if (cells[0] === '') cells.shift();
    if (!columns) {
      const floor = cells.findIndex(function(value) { return /helyiség szintjének neve|^szint$/i.test(value); });
      const name = cells.findIndex(function(value) { return /helyiség neve|^helyiség$/i.test(value); });
      const area = cells.findIndex(function(value) { return /mért terület|^terület/i.test(value); });
      if (floor >= 0 && name >= 0 && area >= 0) columns = {floor: floor, name: name, area: area};
      return;
    }
    // A régi, egyetlen cellába másolt lista az első mezőben darabszámot is tartalmaz.
    const offset = row[0] && row[0].indexOf('|') !== -1 && /^\d+$/.test(cells[0]) ? 1 : 0;
    const floor = String(cells[columns.floor + offset] || '').trim();
    const name = String(cells[columns.name + offset] || '').trim();
    const areaText = String(cells[columns.area + offset] || '').trim();
    if (floor && name && !/^-+$/.test(floor)) {
      const area = parseRoomAreaCents_(areaText);
      if (area === null) throw new Error('Érvénytelen helyiségterület a ' + sourceName + ' ' + (index + 1) + '. sorában.');
      rooms.push({floor: floor, name: name, area: area});
    } else if (!floor && !name && areaText) {
      sourceTotal = parseRoomAreaCents_(areaText);
    }
  });
  if (!columns) throw new Error('A ' + sourceName + ' helyiséglista oszlopai nem ismerhetők fel.');
  if (!rooms.length) throw new Error('A ' + sourceName + ' fájlban nincs feldolgozható helyiség.');
  return {rooms: rooms, sourceTotal: sourceTotal};
}

function getProjectRoomData_(projectFolder) {
  const file = findProjectRoomFile_(projectFolder);
  if (!file) return null;
  const sourceName = 'PLN/' + file.getName();
  const parsed = parseProjectRoomText_(file.getBlob().getDataAsString('UTF-8'), sourceName);
  const spreadsheet = findProjectDataSpreadsheet_(projectFolder);
  if (!spreadsheet) throw new Error('A projekt tervezési adatlapja nem található.');
  const summarySheet = spreadsheet.getSheetByName('Munkalap1');
  if (!summarySheet) throw new Error('A tervezési adatlap Munkalap1 lapja nem található.');
  return {spreadsheet: spreadsheet, summarySheet: summarySheet, rooms: parsed.rooms, sourceTotal: parsed.sourceTotal};
}

function buildRoomList_(roomData) {
  const groups = [];
  roomData.rooms.forEach(function(room) {
    let group = groups.filter(function(item) { return item.floor === room.floor; })[0];
    if (!group) {
      group = {floor: room.floor, rooms: [], total: 0};
      groups.push(group);
    }
    group.rooms.push(room);
    group.total += room.area;
  });
  const rows = [['Helyiség', 'Terület (m²)']];
  let total = 0;
  let externalArea = 0;
  groups.forEach(function(group) {
    rows.push([group.floor, '']);
    group.rooms.forEach(function(room) {
      rows.push([room.name, formatRoomArea_(room.area)]);
      if (/terasz/i.test(room.name)) externalArea += room.area;
    });
    rows.push([group.floor + ' összesen', formatRoomArea_(group.total)]);
    total += group.total;
  });
  rows.push(['Teljes összesen', formatRoomArea_(total)]);
  const fireArea = total - externalArea;
  if (externalArea) rows.push(['Terasz nélkül', formatRoomArea_(fireArea)]);
  const warning = roomData.sourceTotal !== null && roomData.sourceTotal !== total
    ? '[ELLENŐRIZENDŐ: a helyiségsorok összege ' + formatRoomArea_(total) +
      ' m², a forrásban megadott összesen ' + formatRoomArea_(roomData.sourceTotal) + ' m².]'
    : '';
  return {rows: rows, totalCents: total, fireAreaCents: fireArea, warning: warning};
}

function writeRoomTotalToProjectSheet_(summarySheet, totalCents) {
  const cell = summarySheet.getRange('H7');
  const total = totalCents / 100;
  const previous = Number(cell.getValue());
  if (cell.getValue() !== total) cell.setValue(total);
  cell.setNumberFormat('0.00');
  return Number.isFinite(previous) && previous > 0 ? Math.round(previous * 100) : null;
}

function writeRoomListToProjectSheet_(spreadsheet, rows) {
  const sheet = spreadsheet.getSheetByName('Munkalap2');
  if (!sheet) return false;
  const header = String(sheet.getRange('A1').getDisplayValue() || '').trim();
  // Csak üres vagy korábban ezzel a táblázattal feltöltött lapot írunk felül.
  if (header && header !== 'Helyiség') return false;
  const rowCount = Math.max(sheet.getLastRow(), rows.length);
  sheet.getRange(1, 1, rowCount, 2).clearContent();
  const range = sheet.getRange(1, 1, rows.length, 2);
  range.setValues(rows).setFontFamily('Arial Narrow').setFontSize(10)
    .setFontColor('#1456BA').setFontWeight('normal');
  rows.forEach(function(row, index) {
    if (index === 0 || !row[1] || / összesen$/.test(row[0]) || row[0] === 'Terasz nélkül')
      sheet.getRange(index + 1, 1, 1, 2).setFontWeight('bold');
  });
  sheet.setColumnWidth(1, 210);
  sheet.setColumnWidth(2, 80);
  return true;
}

function writeRoomTotalToDocument_(body, totalCents) {
  const value = formatRoomArea_(totalCents) + ' m²';
  for (let i = 0; i < body.getNumChildren(); i++) {
    const paragraph = body.getChild(i);
    if (paragraph.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
    const content = paragraph.getText();
    if (content.trimStart().indexOf('Lakószintek összes nettó alapterülete összesen:') !== 0) continue;
    const marker = '{{TERVEZESI_ADATOK:Munkalap1!H7}}';
    const match = content.indexOf(marker) >= 0
      ? (function() {
          const index = content.indexOf(marker);
          const unit = /^\s*m[²2]/.exec(content.slice(index + marker.length));
          return {index: index, text: marker + (unit ? unit[0] : '')};
        })()
      : (function() {
          const found = /\d+(?:[,.]\d+)?\s*m[²2]/.exec(content);
          return found ? {index: found.index, text: found[0]} : null;
        })();
    if (!match) throw new Error('A műszaki leírás H7 alapterület-mezője nem ismerhető fel.');
    if (match.text === value) return;
    const text = paragraph.editAsText();
    text.deleteText(match.index, match.index + match.text.length - 1);
    text.insertText(match.index, value);
    text.setForegroundColor(match.index, match.index + value.length - 1, '#1456BA');
    return;
  }
}

function writeRoomTotalToBuildingAreaTable_(body, totalCents) {
  const value = formatRoomArea_(totalCents);
  for (let i = 0; i < body.getNumChildren(); i++) {
    const table = body.getChild(i);
    if (table.getType() !== DocumentApp.ElementType.TABLE) continue;
    for (let rowIndex = 0; rowIndex < table.getNumRows(); rowIndex++) {
      const row = table.getRow(rowIndex);
      if (row.getNumCells() < 2 ||
          row.getCell(0).getText().trim() !== 'Az építmény összes szintterülete:') continue;
      const cell = row.getCell(row.getNumCells() - 1);
      const content = cell.getText();
      const marker = '{{TERVEZESI_ADATOK:Munkalap1!H7}}';
      const match = content.indexOf(marker) >= 0
        ? {index: content.indexOf(marker), text: marker}
        : (function() {
            const found = /^\s*(\d+(?:[,.]\d+)?)(?:\s*m[²2])?\s*$/i.exec(content);
            return found ? {index: content.indexOf(found[1]), text: found[1]} : null;
          })();
      if (!match) throw new Error('A műszaki leírás szintterület-mezője nem ismerhető fel.');
      if (match.text === value) return;
      const text = cell.getChild(0).asParagraph().editAsText();
      text.deleteText(match.index, match.index + match.text.length - 1);
      text.insertText(match.index, value);
      text.setForegroundColor(match.index, match.index + value.length - 1, '#1456BA');
      return;
    }
  }
}

// MARK: Számított építményérték a helyiséglista nettó területéből
// 245/2006. (XII. 5.) Korm. rendelet 3. § (3) és 1. melléklet 1. sor:
// lakóépület nettó alapterülete × 600 ezer Ft/m² (ellenőrizve: 2026-09-28).
const RESIDENTIAL_BUILDING_VALUE_THOUSAND_HUF_PER_M2 = 600;

function formatBuildingValue_(thousandHuf) {
  return String(thousandHuf).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function writeBuildingValueToDocument_(body, totalCents) {
  if (!Number.isInteger(totalCents) || totalCents <= 0)
    throw new Error('Az építményértékhez érvényes nettó helyiségterület szükséges.');
  const totalThousandHuf = totalCents * RESIDENTIAL_BUILDING_VALUE_THOUSAND_HUF_PER_M2 / 100;
  const values = [
    '600',
    formatRoomArea_(totalCents) + ' m²',
    formatBuildingValue_(totalThousandHuf) + ' E Ft',
    formatBuildingValue_(totalThousandHuf) + ' E Ft'
  ];
  for (let i = 0; i < body.getNumChildren(); i++) {
    const table = body.getChild(i);
    if (table.getType() !== DocumentApp.ElementType.TABLE || table.getNumRows() < 2) continue;
    const firstRow = table.getRow(0);
    const lastRow = table.getRow(table.getNumRows() - 1);
    if (firstRow.getNumCells() < 5 || lastRow.getNumCells() < 5 ||
        !/^Lakó, üdülő, kulturális/.test(firstRow.getCell(0).getText().trim()) ||
        lastRow.getCell(0).getText().trim() !== 'MINDÖSSZESEN') continue;
    const cells = [firstRow.getCell(2), firstRow.getCell(3), firstRow.getCell(4), lastRow.getCell(4)];
    cells.forEach(function(cell, index) {
      const oldValue = cell.getText();
      const value = values[index];
      if (oldValue === value) return;
      const text = cell.getChild(0).asParagraph().editAsText();
      if (oldValue) text.deleteText(0, oldValue.length - 1);
      text.insertText(0, value);
      text.setForegroundColor(0, value.length - 1, '#1456BA');
    });
    return true;
  }
  return false;
}

// MARK: Tűzszakasz nettó területe és szerkezetek a rétegrendekből
function replaceDocumentText_(element, oldValue, newValue) {
  if (!oldValue || oldValue === newValue) return;
  const content = element.getText();
  const start = content.indexOf(oldValue);
  if (start < 0) return;
  const text = element.editAsText();
  text.deleteText(start, start + oldValue.length - 1);
  text.insertText(start, newValue);
  text.setForegroundColor(start, start + newValue.length - 1, '#1456BA');
}

function getTechnicalLayerSections_(body) {
  const sections = {};
  let inLayers = false;
  let current = '';
  for (let i = 0; i < body.getNumChildren(); i++) {
    const child = body.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
    const line = child.getText().trim();
    if (/^Rétegrendek\s*:/i.test(line)) { inLayers = true; continue; }
    if (!inLayers) continue;
    const heading = /^([FPTK]\d+[a-z]?)\s+\S/i.exec(line);
    if (heading) {
      current = heading[1].toUpperCase();
      sections[current] = [];
    } else if (current && line) {
      sections[current].push(line.replace(/\s+/g, ' '));
    } else if (!current && line) {
      break;
    }
  }
  return sections;
}

function getLayerStructure_(sections, codes, pattern) {
  const matches = [];
  codes.forEach(function(code) {
    const line = (sections[code] || []).filter(function(item) { return pattern.test(item); })[0];
    if (line) matches.push({code: code, value: line});
  });
  return matches;
}

function getFloorLayerStructures_(sections) {
  const matches = getLayerStructure_(sections, ['P2', 'T1', 'T2', 'T3'],
    /(?:vasbeton|Porotherm|fa(?:\s+gerendás)?)\b.*födém/i);
  return matches.map(function(item) {
    const protectiveLayer = (sections[item.code] || []).filter(function(line) {
      return /(?:tűzgátló.*(?:gk|gipszkarton)|(?:gk|gipszkarton).*tűzgátló)/i.test(line);
    })[0];
    return protectiveLayer
      ? {code: item.code, value: item.value + '; ' + protectiveLayer}
      : item;
  });
}

function matchFireStructureRow_(content) {
  // A régi dokumentumokban tabulátor, szóköz, NBSP vagy felsorolásjel tagolhatja a sort.
  const match = /^\s*(?:[·•]\s*)?(teherhordó falak|födémek|fedélszerkezet)\s+min\.\s+D(?:\s+REI\s+\d+)?\s+(.+?)\s+(megfelel|ellenőrizendő)\s*$/i.exec(content);
  return match ? {key: match[1].toLowerCase(), material: match[2].trim(), status: match[3]} : null;
}

function writeFireProtectionFromLayers_(body, fireAreaCents, previousTotalCents, previousFireAreaCents) {
  const area = formatRoomArea_(fireAreaCents) + ' m²';
  const layers = getTechnicalLayerSections_(body);
  const walls = getLayerStructure_(layers, ['F1', 'F2', 'F2F', 'F3'],
    /(?:Porotherm|vázkerámia|kerámia falazó|téglafal|vasbeton fal)/i);
  const floors = getFloorLayerStructures_(layers);
  const roof = getLayerStructure_(layers, ['T4'], /(?:szaruzat|fa tetőszerkezet|fedélszék)/i);
  const unique = function(items) {
    return items.filter(function(item, index) {
      return items.findIndex(function(other) { return other.value === item.value; }) === index;
    }).map(function(item) {
      return item.value.replace(/\s+tartószerkezeti terv szerint.*$/i, '') + ' (' + item.code + ')';
    }).join('; ');
  };
  const structures = {
    'teherhordó falak': unique(walls),
    'födémek': unique(floors),
    'fedélszerkezet': unique(roof)
  };
  for (let i = 0; i < body.getNumChildren(); i++) {
    const child = body.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
    const content = child.getText();
    if (/^A mértékadó tűzszakasz nagysága:/.test(content)) {
      const oldArea = /(?:\{\{TERVEZESI_ADATOK:Munkalap1!H7\}\}|\d+(?:[,.]\d+)?)\s*m[²2]/.exec(content);
      // A H7 korábbi értékétől eltérő kézi javítást a következő futás is megőrzi.
      if (oldArea && (oldArea[0].indexOf('{{') === 0 || oldArea[0] === '251,55 m2' ||
          parseRoomAreaCents_(oldArea[0]) === previousTotalCents ||
          parseRoomAreaCents_(oldArea[0]) === previousFireAreaCents))
        replaceDocumentText_(child, oldArea[0], area);
      continue;
    }
    const row = matchFireStructureRow_(content);
    if (!row || !structures[row.key]) continue;
    replaceDocumentText_(child, row.material, structures[row.key]);
    // Az anyag és vastagság nem bizonyítja a tűzállósági határértéket.
    if (row.status.toLowerCase() === 'megfelel')
      replaceDocumentText_(child, row.status, 'ellenőrizendő');
  }
}

// MARK: Földszinti bruttó beépítés a projektadatlap H3/I3 celláiból
function writeGrossCoverageToDocument_(body, summarySheet) {
  const area = String(summarySheet.getRange('H2').getDisplayValue() || '').trim();
  const percent = String(summarySheet.getRange('J2').getDisplayValue() || '').trim();
  if (!/^\d+(?:[,.]\d+)?$/.test(area) || !/^\d+(?:[,.]\d+)?%$/.test(percent)) {
    throw new Error('A tervezési adatlap H2/J2 bruttó beépítési adatai hiányoznak vagy hibásak.');
  }
  const label = 'Bruttó beépítési százalék földszinten:';
  for (let i = 0; i < body.getNumChildren(); i++) {
    const child = body.getChild(i);
    if (child.getType() === DocumentApp.ElementType.PARAGRAPH) {
      const content = child.getText();
      if (content.trimStart().indexOf(label) === 0) {
        const start = content.indexOf(label) + label.length;
        const oldValue = content.slice(start);
        const tabs = /^\s*/.exec(oldValue)[0];
        const nextValue = tabs + percent + ' (' + area + ' m²)';
        if (oldValue !== nextValue) {
          const text = child.editAsText();
          if (oldValue) text.deleteText(start, content.length - 1);
          text.insertText(start, nextValue);
          text.setForegroundColor(start + tabs.length, start + nextValue.length - 1, '#1456BA');
        }
      }
    } else if (child.getType() === DocumentApp.ElementType.TABLE) {
      for (let rowIndex = 0; rowIndex < child.getNumRows(); rowIndex++) {
        const row = child.getRow(rowIndex);
        if (row.getNumCells() < 2 ||
            row.getCell(0).getText().trim() !== 'Beépítési százalék:') continue;
        const valueCell = row.getCell(row.getNumCells() - 1);
        const oldValue = valueCell.getText();
        if (oldValue.replace(/\s/g, '') === percent) continue;
        const text = valueCell.getChild(0).asParagraph().editAsText();
        if (oldValue) text.deleteText(0, oldValue.length - 1);
        text.insertText(0, percent);
        text.setForegroundColor(0, percent.length - 1, '#1456BA');
      }
    }
  }
}

function refreshTechnicalGrossCoverage_(documentId, projectFolder) {
  const spreadsheet = findProjectDataSpreadsheet_(projectFolder);
  if (!spreadsheet) return false;
  const summarySheet = spreadsheet.getSheetByName('Munkalap1');
  if (!summarySheet) throw new Error('A tervezési adatlap Munkalap1 lapja nem található.');
  const doc = DocumentApp.openById(documentId);
  writeGrossCoverageToDocument_(doc.getBody(), summarySheet);
  doc.saveAndClose();
  return true;
}

function styleRoomTable_(table, rows) {
  table.setColumnWidth(0, 210);
  table.setColumnWidth(1, 80);
  rows.forEach(function(row, rowIndex) {
    const emphasized = rowIndex === 0 || !row[1] || / összesen$/.test(row[0]) ||
      row[0] === 'Terasz nélkül';
    for (let col = 0; col < 2; col++) {
      const cell = table.getCell(rowIndex, col);
      cell.setPaddingTop(1.5).setPaddingBottom(1.5)
        .setPaddingLeft(3.5).setPaddingRight(3.5);
      cell.getChild(0).asParagraph().editAsText().setBold(emphasized);
    }
  });
}

function refreshTechnicalRoomList_(documentId, projectFolder) {
  const roomData = getProjectRoomData_(projectFolder);
  if (!roomData || !roomData.rooms.length) return 0;
  const result = buildRoomList_(roomData);
  writeRoomListToProjectSheet_(roomData.spreadsheet, result.rows);
  const previousTotalCents = writeRoomTotalToProjectSheet_(roomData.summarySheet, result.totalCents);
  const doc = DocumentApp.openById(documentId);
  const body = doc.getBody();
  let start = -1;
  for (let i = 0; i < body.getNumChildren(); i++) {
    const child = body.getChild(i);
    if ((child.getType() === DocumentApp.ElementType.PARAGRAPH ||
         child.getType() === DocumentApp.ElementType.LIST_ITEM) &&
        child.getText().trim() === 'Helyiségek') {
      start = i + 1;
      break;
    }
  }
  if (start < 0) {
    doc.saveAndClose();
    throw new Error('A műszaki leírásban nincs „Helyiségek” szakasz.');
  }
  let end = start;
  let seenTable = false;
  let hasPlaceholder = false;
  let existingRows = null;
  let existingTable = null;
  let existingWarning = '';
  while (end < body.getNumChildren()) {
    const child = body.getChild(end);
    const type = child.getType();
    if (type === DocumentApp.ElementType.TABLE) {
      const header = child.getNumRows() && child.getRow(0).getText();
      if (!/Helyiség/.test(header)) break;
      seenTable = true;
      existingTable = child;
      existingRows = [];
      for (let row = 0; row < child.getNumRows(); row++) {
        const tableRow = child.getRow(row);
        const values = [];
        for (let col = 0; col < tableRow.getNumCells(); col++)
          values.push(tableRow.getCell(col).getText());
        existingRows.push(values);
      }
    } else if (type === DocumentApp.ElementType.PARAGRAPH &&
               (/^Helyiséglista:/.test(child.getText()) ||
                (!seenTable && !child.getText().trim()) ||
                /^\[ELLENŐRIZENDŐ: (?:a Sheetben a 3 szoba|a helyiségsorok összege)/.test(child.getText()))) {
      // Korábbi helyiséglista-placeholder vagy annak ellenőrzési jelzése.
    } else {
      break;
    }
    if (type === DocumentApp.ElementType.PARAGRAPH) {
      if (/^Helyiséglista:/.test(child.getText())) hasPlaceholder = true;
      if (/^\[ELLENŐRIZENDŐ: (?:a Sheetben a 3 szoba|a helyiségsorok összege)/.test(child.getText()))
        existingWarning = child.getText();
    }
    end++;
  }
  const previousTerraceCents = (existingRows || []).reduce(function(sum, row) {
    return /terasz/i.test(row[0]) && !/^(?:Terasz nélkül|.* összesen)$/i.test(row[0])
      ? sum + (parseRoomAreaCents_(row[1]) || 0) : sum;
  }, 0);
  const previousFireAreaCents = previousTotalCents === null
    ? null : previousTotalCents - previousTerraceCents;
  if (!hasPlaceholder && JSON.stringify(existingRows) === JSON.stringify(result.rows) &&
      existingWarning === result.warning) {
    styleRoomTable_(existingTable, result.rows);
    writeRoomTotalToDocument_(body, result.totalCents);
    writeRoomTotalToBuildingAreaTable_(body, result.totalCents);
    writeBuildingValueToDocument_(body, result.totalCents);
    writeFireProtectionFromLayers_(body, result.fireAreaCents, previousTotalCents, previousFireAreaCents);
    doc.saveAndClose();
    return roomData.rooms.length;
  }
  for (let i = end - 1; i >= start; i--) body.removeChild(body.getChild(i));
  const table = body.insertTable(start, result.rows);
  styleRoomTable_(table, result.rows);
  if (result.warning) body.insertParagraph(start + 1, result.warning);
  writeRoomTotalToDocument_(body, result.totalCents);
  writeRoomTotalToBuildingAreaTable_(body, result.totalCents);
  writeBuildingValueToDocument_(body, result.totalCents);
  writeFireProtectionFromLayers_(body, result.fireAreaCents, previousTotalCents, previousFireAreaCents);
  doc.saveAndClose();
  return roomData.rooms.length;
}


function buildDocumentFileName(config, data) {
  const projectName = buildProjectFolderName(data);
  const base = [
    config.title,
    projectName
  ]
    .filter(Boolean)
    .join(' - ')
    .replace(/\s+/g, ' ')
    .trim();
  return appendProjectPostfix_(base, data.uid ? getProjectPostfix_(data.uid) : '');
}

function appendProjectPostfix_(name, postfix) {
  name = String(name || '').trim();
  postfix = String(postfix || '').trim();
  if (!postfix || name.endsWith(' - ' + postfix)) return name;
  const match = name.match(/^(.*?)(\.[^.]+)$/);
  return match ? match[1] + ' - ' + postfix + match[2] : name + ' - ' + postfix;
}


function replaceTextInContainer(container, replacements) {
  if (!container) {
    return;
  }

  Object.keys(replacements).forEach(function(key) {
    const escapedKey = key.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );

    container.replaceText(
      '\\{\\{' + escapedKey + '\\}\\}',
      String(
        replacements[key] == null
          ? ''
          : replacements[key]
      )
    );
  });
}


// MARK: Dokumentumsablonok és mezőhelyettesítés
function getDocumentReplacements(data) {
  const result = {
    'UID': data.uid || '',
    'Vezetéknév': data.vezeteknev || '',
    'Keresztnév': data.keresztnev || '',
    'Teljes név': [
      data.vezeteknev,
      data.keresztnev
    ].filter(Boolean).join(' '),
    'Születési név': data.szuletesiNev || '',
    'Állampolgárság': data.allampolgarsag || '',
    'lakcim_cim': data.lakcim || '',
    'ertesitesi_cim': data.ertesitesiCim || '',
    'Adóazonosító': String(
      data.adoazonosito || ''
    ).replace(/\D/g, ''),
    'Telefon': data.telefon || '',
    'Email cím': data.email || '',
    'Anyja neve': data.anyjaNeve || '',
    'Születési hely': data.szuletesiHely || '',
    'Születési idő': data.szuletesiIdo || '',
    'Neve':
      data.projektTipus === 'Egyéb'
        ? (data.projektTipusEgyeb || '')
        : (data.projektTipus || ''),
    'projekt Irányítószám': data.projekt_irsz || '',
    'projekt Város': data.projekt_varos || '',
    'projekt Közterület': data.projekt_kozterulet || '',
    'projekt Típus': data.projekt_tipus || '',
    'projekt Házszám': data.projekt_hazszam || '',
    'projekt Egyéb': data.projekt_egyeb || '',
    'projekt_cim': data.projektCim || '',
    'Hrsz': data.hrsz || '',
    'Projekt azonosító': buildProjectFolderName(data),
    'Mai dátum': Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyy. MM. dd.'
    )
  };
  const extras = getAdditionalMergeFields_(data.uid);
  Object.keys(extras).forEach(function(k) {
    if (!(k in result)) result[k] = extras[k];
  });
  return result;
}


function fillDocumentFromSheet(documentId, data) {
  const doc = DocumentApp.openById(documentId);
  const replacements = getDocumentReplacements(data);

  replaceTextInContainer(
    doc.getBody(),
    replacements
  );

  const header = doc.getHeader();

  if (header) {
    replaceTextInContainer(
      header,
      replacements
    );
  }

  const footer = doc.getFooter();

  if (footer) {
    replaceTextInContainer(
      footer,
      replacements
    );
  }

  doc.saveAndClose();
}


function findExistingGeneratedDocument(
  targetFolder,
  fileName
) {
  const files = targetFolder.getFilesByName(
    fileName
  );

  while (files.hasNext()) {
    const file = files.next();

    if (
      file.getMimeType() ===
      MimeType.GOOGLE_DOCS
    ) {
      return file;
    }
  }

  return null;
}


// MARK: Dokumentumok létrehozása
function generateDocumentForActiveRow(
  templateKey
) {
  const context =
    getActiveProjectContext();

  return generateDocumentForContext_(context, templateKey);
}

function generateDocumentForContext_(context, templateKey) {

  const config =
    DOCUMENT_TEMPLATES[templateKey];

  if (!config) {
    throw new Error(
      'Ismeretlen dokumentumtípus: ' +
      templateKey
    );
  }

  const projectFolder =
    context.projectFolder || ensureProjectFolder(context);

  const projectSpreadsheet = templateKey === 'muszakiLeiras'
    ? prepareTechnicalProjectSheet_(projectFolder) : null;
  if (projectSpreadsheet) installProjectDataTrigger_(projectSpreadsheet.getId());
  const technicalValues = projectSpreadsheet
    ? getTechnicalSheetReplacements_(projectSpreadsheet) : null;
  if (projectSpreadsheet)
    getTechnicalProgramLines_(projectSpreadsheet,
      Object.assign({}, getDocumentReplacements(context.data), technicalValues));

  const targetFolder =
    getTargetSubfolder(
      projectFolder,
      config.targetFolder
    );

  const fileName =
    buildDocumentFileName(
      config,
      context.data
    );

  const existing =
    findExistingGeneratedDocument(
      targetFolder,
      fileName
    );

  if (existing) {
    const record = getProjectDocumentRecords_(context.uid)
      .filter(function(r) { return r.type === templateKey; })[0];
    registerProjectDocument_(context.uid, templateKey, existing.getId());
    if (!record || record.status !== 'FINAL') {
      syncDocument_(existing.getId(), context.data, config.templateId, technicalValues);
      if (templateKey === 'muszakiLeiras') {
        refreshTechnicalDescription_(existing.getId(), projectFolder,
          context.data, projectSpreadsheet);
      }
    }
    return {
      created: false,
      file: existing,
      url: existing.getUrl()
    };
  }

  const templateFile =
    DriveApp.getFileById(
      config.templateId
    );

  const newFile =
    templateFile.makeCopy(
      fileName,
      targetFolder
    );

  registerAndFillDocument_(newFile.getId(), context.data, config.templateId, technicalValues);
  registerProjectDocument_(context.uid, templateKey, newFile.getId());
  if (templateKey === 'muszakiLeiras') {
    refreshTechnicalDescription_(newFile.getId(), projectFolder,
      context.data, projectSpreadsheet);
  }

  return {
    created: true,
    file: newFile,
    url: newFile.getUrl()
  };
}


function showGeneratedDocumentResult(
  result,
  title
) {
  SpreadsheetApp.getUi().alert(
    title +
    (
      result.created
        ? ' létrehozva.'
        : ' már létezett, ezért nem készült új példány.'
    ) +
    '\n\n' +
    result.url
  );
}


function createOfferForActiveRow() {
  showGeneratedDocumentResult(
    generateDocumentForActiveRow(
      'ajanlat'
    ),
    'Árajánlat'
  );
}


function createContractForActiveRow() {
  showGeneratedDocumentResult(
    generateDocumentForActiveRow(
      'szerzodes'
    ),
    'Tervezési szerződés'
  );
}


function createTechnicalDescriptionForActiveRow() {
  showGeneratedDocumentResult(
    generateDocumentForActiveRow(
      'muszakiLeiras'
    ),
    'Műszaki leírás'
  );
}


function createAuthorizationForActiveRow() {
  showGeneratedDocumentResult(
    generateDocumentForActiveRow(
      'meghatalmazas'
    ),
    'Meghatalmazás'
  );
}


function createSignatureSheetForActiveRow() {
  showGeneratedDocumentResult(
    generateDocumentForActiveRow(
      'alairolap'
    ),
    'Aláírólap'
  );
}


function createAllDocumentsForActiveRow() {
  const context = getActiveProjectContext();
  const folder = ensureProjectFolder(context);
  const result = ensureAllProjectDocuments_(context, folder);
  SpreadsheetApp.getUi().alert('Alapdokumentumok: ' + result.created +
    ' új, ' + result.existing + ' meglévő.\n' + folder.getUrl());
}

/*************************************************
 * ÉLŐ KÖRLEVÉL / DOKUMENTUM-INDEX
 * A named range megőrzi a mező helyét az első kitöltés után is.
 * Csak a DRAFT dokumentumok frissülnek.
 *************************************************/
// MARK: Dokumentumindex és körlevélmezők
function getMergeIndex_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(MERGE_INDEX_SHEET);
  if (!sh) {
    sh = ss.insertSheet(MERGE_INDEX_SHEET);
    sh.getRange(1,1,1,5).setValues([['UID','Típus','Dokumentum ID','Állapot','Utolsó szinkron']]);
    sh.hideSheet();
  }
  return sh;
}

function getProjectDocumentRecords_(uid) {
  const sh = getMergeIndex_();
  const n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2,1,n-1,5).getValues()
    .map(function(r,i) { return {row:i+2,uid:String(r[0]),type:String(r[1]),id:String(r[2]),status:String(r[3])}; })
    .filter(function(r) { return r.uid === String(uid); });
}

function registerProjectDocument_(uid,type,id) {
  const sh = getMergeIndex_();
  const old = getProjectDocumentRecords_(uid).filter(function(r){return r.type === type;})[0];
  if (old) {
    if (old.id !== id && old.status === 'FINAL')
      throw new Error('Véglegesített dokumentum nem cserélhető: ' + type);
    if (old.id !== id) sh.getRange(old.row,3).setValue(id);
  } else {
    sh.appendRow([uid,type,id,'DRAFT',new Date()]);
  }
}

function getAdditionalMergeFields_(uid) {
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  const row = findUID(sh,uid);
  if (row < 2) return {};
  const last = sh.getLastColumn();
  if (last <= 40) return {};
  const headers = sh.getRange(1,41,1,last-40).getDisplayValues()[0];
  const values = sh.getRange(row,41,1,last-40).getDisplayValues()[0];
  const out = {};
  headers.forEach(function(header,i) {
    header = String(header||'').trim();
    if (header && !(header in out)) out[header] = values[i] || '';
  });
  return out;
}

function escapeMergeRegex_(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
}

/*************************************************
 * FELTÉTELES GOOGLE DOCS BLOKKOK
 *
 * A sablonban a vezérlő sorok KÜLÖN bekezdésben legyenek:
 *   {{#IF Neve=Új építés}}
 *   ... feltételes, tetszőlegesen formázott tartalom ...
 *   {{/IF}}
 *
 * Támogatott feltételek:
 *   {{#IF Mező=érték}}      pontos egyezés
 *   {{#IF Mező!=érték}}     nem egyezik
 *
 * A mező lehet bármely getDocumentReplacements() kulcs,
 * így az AO utáni Sheet-fejlécek is használhatók.
 * A blokkok egymásba ágyazása jelenleg NEM támogatott.
 *
 * Működés:
 * - a feltételes blokk forrása mindig az eredeti Google Docs sablon;
 * - minden DRAFT szinkronnál újraépül a blokk a sablonból;
 * - ezért Új építés -> Bővítés -> Új építés váltásnál is visszaáll;
 * - a blokkban lévő {{mezők}} ezután a normál merge motorral töltődnek.
 *************************************************/
// MARK: Feltételes Google Docs blokkok
function parseConditionalMarker_(text) {
  const value = String(text || '').trim();
  if (value === '{{/IF}}') return {type:'end'};

  const m = value.match(/^\{\{#IF\s+(.+?)\s*(!=|=)\s*(.*?)\s*\}\}$/);
  if (!m) return null;

  return {
    type: 'start',
    field: String(m[1] || '').trim(),
    operator: m[2],
    expected: String(m[3] || '').trim()
  };
}

function conditionalMatches_(marker, values) {
  const actual = String(values[marker.field] == null ? '' : values[marker.field]).trim();
  const expected = String(marker.expected || '').trim();
  return marker.operator === '!=' ? actual !== expected : actual === expected;
}

function getBodyElementText_(element) {
  const type = element.getType();
  if (type === DocumentApp.ElementType.PARAGRAPH) return element.asParagraph().getText();
  if (type === DocumentApp.ElementType.LIST_ITEM) return element.asListItem().getText();
  return '';
}

function findConditionalBlocksInBody_(body) {
  const blocks = [];
  let open = null;

  for (let i = 0; i < body.getNumChildren(); i++) {
    const marker = parseConditionalMarker_(getBodyElementText_(body.getChild(i)));
    if (!marker) continue;

    if (marker.type === 'start') {
      if (open) throw new Error('Egymásba ágyazott {{#IF}} blokkok nem támogatottak.');
      open = {start:i, marker:marker};
    } else {
      if (!open) throw new Error('Találtam {{/IF}} jelet nyitó {{#IF ...}} nélkül.');
      blocks.push({start:open.start, end:i, marker:open.marker});
      open = null;
    }
  }

  if (open) throw new Error('Nincs lezárva ez a feltételes blokk: ' + open.marker.field);
  return blocks;
}

function copyBodyElementAt_(targetBody, index, sourceElement) {
  const type = sourceElement.getType();
  if (type === DocumentApp.ElementType.PARAGRAPH)
    return targetBody.insertParagraph(index, sourceElement.asParagraph().copy());
  if (type === DocumentApp.ElementType.LIST_ITEM)
    return targetBody.insertListItem(index, sourceElement.asListItem().copy());
  if (type === DocumentApp.ElementType.TABLE)
    return targetBody.insertTable(index, sourceElement.asTable().copy());
  if (type === DocumentApp.ElementType.PAGE_BREAK)
    return targetBody.insertPageBreak(index, sourceElement.asPageBreak().copy());
  if (type === DocumentApp.ElementType.HORIZONTAL_RULE)
    return targetBody.insertHorizontalRule(index);

  throw new Error('Nem támogatott elem a feltételes blokkban: ' + type);
}

function styleConditionalMarker_(element) {
  const type = element.getType();
  let text = null;
  let paragraph = null;

  if (type === DocumentApp.ElementType.PARAGRAPH) {
    paragraph = element.asParagraph();
    text = paragraph.editAsText();
  } else if (type === DocumentApp.ElementType.LIST_ITEM) {
    paragraph = element.asListItem();
    text = paragraph.editAsText();
  }

  if (text && text.getText()) {
    text.setForegroundColor('#ffffff');
    text.setFontSize(1);
  }
  if (paragraph) {
    paragraph.setSpacingBefore(0).setSpacingAfter(0).setLineSpacing(1);
  }
}

function processConditionalBlocks_(doc, templateId, values) {
  if (!templateId) return;

  const targetBody = doc.getBody();
  const templateDoc = DocumentApp.openById(templateId);
  const templateBody = templateDoc.getBody();
  const sourceBlocks = findConditionalBlocksInBody_(templateBody);
  if (!sourceBlocks.length) {
    templateDoc.saveAndClose();
    return;
  }

  // A célban lévő blokkokat hátulról dolgozzuk fel, így az indexek nem csúsznak el.
  const targetBlocks = findConditionalBlocksInBody_(targetBody);
  if (targetBlocks.length !== sourceBlocks.length) {
    templateDoc.saveAndClose();
    throw new Error('A feltételes blokkok száma eltér a sablon és a generált dokumentum között.');
  }

  for (let b = targetBlocks.length - 1; b >= 0; b--) {
    const target = targetBlocks[b];
    const source = sourceBlocks[b];

    // Biztonsági ellenőrzés: ugyanaz a feltétel legyen ugyanazon a pozíción.
    if (target.marker.field !== source.marker.field ||
        target.marker.operator !== source.marker.operator ||
        target.marker.expected !== source.marker.expected) {
      templateDoc.saveAndClose();
      throw new Error('A feltételes blokk jelölése eltér a sablontól: ' + target.marker.field);
    }

    // Minden korábbi blokk-tartalom törlése, a két vezérlő sort megtartjuk.
    for (let i = target.end - 1; i > target.start; i--) {
      targetBody.removeChild(targetBody.getChild(i));
    }

    if (conditionalMatches_(target.marker, values)) {
      let insertAt = target.start + 1;
      for (let i = source.start + 1; i < source.end; i++) {
        copyBodyElementAt_(targetBody, insertAt++, templateBody.getChild(i));
      }
    }

    styleConditionalMarker_(targetBody.getChild(target.start));
    // Az end marker az új tartalom miatt új indexre került.
    const refreshed = findConditionalBlocksInBody_(targetBody)[b];
    if (refreshed) styleConditionalMarker_(targetBody.getChild(refreshed.end));
  }

  templateDoc.saveAndClose();
}

function getTemplateIdForDocument_(uid, documentId) {
  const record = getProjectDocumentRecords_(uid).filter(function(r) {
    return r.id === documentId;
  })[0];
  return record && DOCUMENT_TEMPLATES[record.type]
    ? DOCUMENT_TEMPLATES[record.type].templateId
    : '';
}

function registerAndFillContainer_(doc,container,replacements) {
  if (!container) return;
  Object.keys(replacements).forEach(function(key) {
    const marker = '{{' + key + '}}';
    const pattern = escapeMergeRegex_(marker);
    let found;
    // A DocumentApp.findText ugyanazon Text elemen belül keres.
    while ((found = container.findText(pattern))) {
      const el = found.getElement();
      if (el.getType() !== DocumentApp.ElementType.TEXT) break;
      const t = el.asText(), a = found.getStartOffset(), b = found.getEndOffsetInclusive();
      const value = String(replacements[key] == null ? '' : replacements[key]) || '\u200B';
      t.deleteText(a,b);
      t.insertText(a,value);
      const range = doc.newRange().addElement(t,a,a+value.length-1).build();
      doc.addNamedRange(MERGE_PREFIX + key,range);
    }
  });
}

function registerAndFillDocument_(id,data,templateId,additionalValues) {
  const doc = DocumentApp.openById(id);
  const values = Object.assign({}, getDocumentReplacements(data), additionalValues || {});
  processConditionalBlocks_(doc, templateId, values);
  registerAndFillContainer_(doc,doc.getBody(),values);
  registerAndFillContainer_(doc,doc.getHeader(),values);
  registerAndFillContainer_(doc,doc.getFooter(),values);
  doc.saveAndClose();
}

function syncDocument_(id,data,templateId,additionalValues) {
  const doc = DocumentApp.openById(id);
  const values = Object.assign({}, getDocumentReplacements(data), additionalValues || {});
  templateId = templateId || getTemplateIdForDocument_(data.uid, id);
  processConditionalBlocks_(doc, templateId, values);
  // Előbb az újonnan, kézzel beszúrt {{Oszlopnév}} mezőket regisztráljuk.
  registerAndFillContainer_(doc,doc.getBody(),values);
  registerAndFillContainer_(doc,doc.getHeader(),values);
  registerAndFillContainer_(doc,doc.getFooter(),values);
  Object.keys(values).forEach(function(key) {
    const name = MERGE_PREFIX + key;
    // Visszafelé dolgozunk, hogy egyazon szövegelemen belül az offsetek ne csússzanak.
    const entries = doc.getNamedRanges(name).map(function(nr) {
      const els = nr.getRange().getRangeElements();
      return {nr:nr,els:els};
    });
    entries.sort(function(a,b) {
      return (b.els[0] ? b.els[0].getStartOffset() : 0) -
             (a.els[0] ? a.els[0].getStartOffset() : 0);
    });
    entries.forEach(function(item) {
      const el = item.els[0];
      if (!el || el.getElement().getType() !== DocumentApp.ElementType.TEXT) return;
      const text = el.getElement().asText();
      const a = el.getStartOffset(), b = el.getEndOffsetInclusive();
      if (a < 0 || b < a) return;
      const value = String(values[key] == null ? '' : values[key]) || '\u200B';
      // Régi named range eltávolítása, újra létrehozása az aktuális szövegen.
      item.nr.remove();
      text.deleteText(a,b);
      text.insertText(a,value);
      doc.addNamedRange(name,doc.newRange()
        .addElement(text,a,a+value.length-1).build());
    });
  });
  doc.saveAndClose();
}

function ensureAllProjectDocuments_(context,folder) {
  let created = 0, existing = 0;
  const projectSpreadsheet = prepareTechnicalProjectSheet_(folder);
  installProjectDataTrigger_(projectSpreadsheet.getId());
  const technicalValues = getTechnicalSheetReplacements_(projectSpreadsheet);
  getTechnicalProgramLines_(projectSpreadsheet,
    Object.assign({}, getDocumentReplacements(context.data), technicalValues));
  Object.keys(DOCUMENT_TEMPLATES).forEach(function(key) {
    const cfg = DOCUMENT_TEMPLATES[key];
    const target = getTargetSubfolder(folder,cfg.targetFolder);
    const name = buildDocumentFileName(cfg,context.data);
    const known = getProjectDocumentRecords_(context.uid).filter(function(r){return r.type === key;})[0];
    let file = null;
    if (known) {
      try { file = DriveApp.getFileById(known.id); } catch(e) {}
    }
    if (known && known.status === 'FINAL' && !file)
      throw new Error('A véglegesített dokumentum nem található: ' + cfg.title);
    if (!file) file = findExistingGeneratedDocument(target,name);
    if (file) {
      registerProjectDocument_(context.uid,key,file.getId());
      if (!known || known.status !== 'FINAL') {
        syncDocument_(file.getId(),context.data,cfg.templateId,
          key === 'muszakiLeiras' ? technicalValues : null);
        if (key === 'muszakiLeiras') {
          refreshTechnicalDescription_(file.getId(),folder,context.data,projectSpreadsheet);
        }
      }
      existing++;
    } else {
      file = DriveApp.getFileById(cfg.templateId).makeCopy(name,target);
      registerAndFillDocument_(file.getId(),context.data,cfg.templateId,
        key === 'muszakiLeiras' ? technicalValues : null);
      registerProjectDocument_(context.uid,key,file.getId());
      if (key === 'muszakiLeiras') {
        refreshTechnicalDescription_(file.getId(),folder,context.data,projectSpreadsheet);
      }
      created++;
    }
  });
  return {created:created,existing:existing};
}

// MARK: Dokumentumszinkron és Sheets trigger
function syncProjectByUid_(uid) {
  const data = getData(uid);
  if (!data) return;
  const records = getProjectDocumentRecords_(uid);
  const index = getMergeIndex_();
  let projectFolder = null;
  records.forEach(function(rec) {
    if (rec.status !== 'DRAFT') return;
    if (rec.type === 'muszakiLeiras') {
      if (!projectFolder) {
        const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
        const rowNumber = findUID(sheet, uid);
        projectFolder = rowNumber > 1
          ? getExistingProjectFolder({sheet: sheet, rowNumber: rowNumber})
          : null;
      }
      if (!projectFolder) throw new Error('A műszaki leírás tervjegyzékéhez nincs projektmappa.');
      const projectSpreadsheet = prepareTechnicalProjectSheet_(projectFolder);
      const technicalValues = getTechnicalSheetReplacements_(projectSpreadsheet);
      getTechnicalProgramLines_(projectSpreadsheet,
        Object.assign({}, getDocumentReplacements(data), technicalValues));
      syncDocument_(rec.id,data,DOCUMENT_TEMPLATES[rec.type].templateId,technicalValues);
      refreshTechnicalDescription_(rec.id,projectFolder,data,projectSpreadsheet);
    } else {
      syncDocument_(rec.id,data,DOCUMENT_TEMPLATES[rec.type]
        ? DOCUMENT_TEMPLATES[rec.type].templateId : null);
    }
    index.getRange(rec.row,5).setValue(new Date());
  });
}

function syncProjectAfterSave_(uid) {
  // A Web App nem vált ki onEdit eseményt, ezért mentés után explicit szinkron kell.
  // Az ügyfél mentését nem akadályozza, ha a Drive pillanatnyilag nem érhető el.
  try {
    const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    const row = findUID(sh,uid);
    if (row < 2) return;
    const cell = sh.getRange(row,5);
    const rich = cell.getRichTextValue();
    const url = rich && rich.getLinkUrl() || String(cell.getValue()||'');
    if (!extractDriveId(url)) return; // új projektmappa csak menüből
    syncProjectByUid_(uid);
  } catch (err) { console.error('Dokumentumszinkron: ' + err); }
}

function projectSheetEditTrigger(e) {
  if (!e || !e.range) return;

  const sh = e.range.getSheet();
  if (sh.getName() !== SHEET_NAME) return;

  const first = Math.max(2, e.range.getRow());
  const last = e.range.getLastRow();
  if (last < 2) return;

  const uidValues = sh.getRange(first, 1, last - first + 1, 1).getDisplayValues();
  const uids = {};
  uidValues.forEach(function(r) {
    const uid = String(r[0] || '').trim().toUpperCase();
    if (uid) uids[uid] = true;
  });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('A dokumentumszinkron már fut.');
  }

  try {
    Object.keys(uids).forEach(function(uid) {
      syncProjectByUid_(uid);
    });
  } finally {
    lock.releaseLock();
  }
}

// MARK: Műszaki leírás indítása a projekthez tartozó adatlapból
function installProjectDataTrigger_(spreadsheetId) {
  const exists = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === 'projectDataGenerationTrigger' &&
      trigger.getTriggerSourceId() === spreadsheetId;
  });
  if (!exists) ScriptApp.newTrigger('projectDataGenerationTrigger')
    .forSpreadsheet(spreadsheetId).onEdit().create();
}

function installExistingProjectDataSheetTrigger() {
  const spreadsheetId = '1TcAQLjIWDjAEhS2fSLMy05ovwOAEIrk7bICtxWr9l5g';
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  getProjectContextForDataSheet_(spreadsheet);
  installProjectDataTrigger_(spreadsheetId);
  return 'A projektadatlap generálási jelölőnégyzete aktiválva.';
}

function installProjectDataGenerationForActiveRow() {
  const context = getActiveProjectContext();
  const spreadsheet = ensureProjectDataSpreadsheet_(ensureProjectFolder(context));
  setProjectDashboardLink_(spreadsheet, context.uid);
  installProjectDataTrigger_(spreadsheet.getId());
  openUrlDialog_(spreadsheet.getUrl(), 'Projektadatlap');
}

function projectDataGenerationTrigger(e) {
  if (!e || !e.range || e.range.getSheet().getName() !== 'Generálás' ||
      e.range.getA1Notation() !== 'B2' || e.range.getValue() !== true) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('A dokumentumgenerálás már fut.');
  const control = e.range.getSheet();
  try {
    const context = getProjectContextForDataSheet_(e.source);
    const result = generateDocumentForContext_(context, 'muszakiLeiras');
    control.getRange('B3').setRichTextValue(SpreadsheetApp.newRichTextValue()
      .setText(result.created ? 'Új műszaki leírás megnyitása' : 'Műszaki leírás megnyitása')
      .setLinkUrl(result.url).build());
    control.getRange('B4').setValue('A műszaki leírás elkészült.');
  } catch (err) {
    control.getRange('B4').setValue('Hiba: ' + (err.message || String(err)));
    throw err;
  } finally {
    control.getRange('B2').setValue(false);
    lock.releaseLock();
  }
}

function installProjectSync() {
  // Drive/Docs elérés miatt installálható onEdit trigger szükséges.
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'projectSheetEditTrigger') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('projectSheetEditTrigger')
    .forSpreadsheet(SHEET_ID)
    .onEdit()
    .create();

  let testMessage = '';
  try {
    const ctx = getActiveProjectContext();
    syncProjectByUid_(ctx.uid);
    testMessage = '\n\nAz aktív projekt DRAFT dokumentumait próbaként szinkronizáltam.';
  } catch (err) {
    testMessage = '\n\nA trigger elkészült. Próbaszinkron: ' + err.message;
  }

  SpreadsheetApp.getUi().alert(
    'Az automatikus Sheet → Docs szinkron bekapcsolva.' + testMessage
  );
}

function syncSelectedProject() {
  const ctx = getActiveProjectContext();
  syncProjectByUid_(ctx.uid);
  SpreadsheetApp.getUi().alert('A DRAFT dokumentumok szinkronizálva.');
}

// MARK: Projekt indítása és lezárása
function getFinalizableProjectRecords_(uid) {
  return getProjectDocumentRecords_(uid).filter(function(r) {
    const cfg = DOCUMENT_TEMPLATES[r.type];
    return cfg && cfg.targetFolder === '_Belső';
  });
}

function startSelectedProject() {
  const ui = SpreadsheetApp.getUi();
  try {
    const ctx = getActiveProjectContext();
    const preparationFolder = getProjectsParentFolder();
    const projectFolder = getProjectFolderForMove_(ctx, preparationFolder, 'indításhoz');
    const destination = getStartedProjectsFolder_();
    const records = getFinalizableProjectRecords_(ctx.uid);
    if (!records.length) {
      ui.alert('Ehhez a projekthez nincs véglegesíthető dokumentum a _Belső mappában.');
      return;
    }
    assertProjectFolderDestinationAvailable_(projectFolder, destination);

    const response = ui.alert(
      'Projekt indítása',
      'Véglegesítsem a _Belső dokumentumokat, majd áthelyezzem a teljes projektmappát egy szinttel feljebb?\n\n' +
      projectFolder.getName() + '\nCél: ' + destination.getName(),
      ui.ButtonSet.YES_NO
    );
    if (response !== ui.Button.YES) return;

    getProjectFolderForMove_(ctx, preparationFolder, 'indításhoz');
    assertProjectFolderDestinationAvailable_(projectFolder, destination);
    const currentRecords = getFinalizableProjectRecords_(ctx.uid);
    if (!currentRecords.length) {
      throw new Error('Időközben eltűntek a véglegesíthető _Belső dokumentumok.');
    }
    const result = finalizeProjectDocuments_(ctx, projectFolder, currentRecords);
    moveProjectFolder_(projectFolder, destination);
    markDashboardStarted_(ctx.uid);
    ui.alert(
      'A projekt elindult, a teljes projektmappa áthelyezve.\n\n' +
      result.finalized + ' _Belső dokumentum véglegesítve.\n' +
      'PDF létrehozva: ' + result.pdfCreated + '\n' +
      'PDF frissítve: ' + result.pdfUpdated + '\n\n' + projectFolder.getUrl()
    );
  } catch (err) {
    ui.alert('A projekt indítása nem sikerült: ' + (err.message || String(err)));
  }
}

function closeSelectedProject() {
  const ui = SpreadsheetApp.getUi();
  try {
    const ctx = getActiveProjectContext();
    const startedFolder = getStartedProjectsFolder_();
    const projectFolder = getProjectFolderForMove_(ctx, startedFolder, 'lezáráshoz');

    const response = ui.alert(
      'Projekt lezárása',
      'Áthelyezzem a teljes projektmappát a _Lezárt mappába?\n\n' +
      projectFolder.getName() + '\nCél: ' + startedFolder.getName() + '/_Lezárt',
      ui.ButtonSet.YES_NO
    );
    if (response !== ui.Button.YES) return;

    getProjectFolderForMove_(ctx, startedFolder, 'lezáráshoz');
    const archiveFolder = findOrCreateSubfolder(startedFolder, '_Lezárt');
    moveProjectFolder_(projectFolder, archiveFolder);
    ui.alert('A projekt lezárva, a teljes projektmappa áthelyezve.\n\n' + projectFolder.getUrl());
  } catch (err) {
    ui.alert('A projekt lezárása nem sikerült: ' + (err.message || String(err)));
  }
}

function finalizeProjectDocuments_(ctx, projectFolder, records) {
  const sh = getMergeIndex_();

  // Véglegesítés előtt az utolsó Sheet-adatokkal szinkronizálunk.
  records.forEach(function(r) {
    if (r.status !== 'FINAL') {
      syncDocument_(r.id, ctx.data, DOCUMENT_TEMPLATES[r.type] ? DOCUMENT_TEMPLATES[r.type].templateId : null);
    }
  });

  const internalFolder = getTargetSubfolder(projectFolder, '_Belső');

  let finalized = 0;
  let pdfCreated = 0;
  let pdfUpdated = 0;

  records.forEach(function(r) {
    const sourceFile = DriveApp.getFileById(r.id);
    // Ha a dokumentumnév ponttal végződik (pl. házszám: "12."),
    // a PDF kiterjesztés előtt eltávolítjuk, így nem lesz "12..pdf".
    const pdfBaseName = sourceFile.getName().replace(/\.+\s*$/, '');
    const pdfName = pdfBaseName + '.pdf';
    const pdfBlob = sourceFile.getAs(MimeType.PDF).setName(pdfName);

    // Ha már volt ilyen PDF, a régit kukázzuk, majd létrehozzuk az aktuálisat.
    const existingPdfs = internalFolder.getFilesByName(pdfName);
    let existed = false;
    while (existingPdfs.hasNext()) {
      existed = true;
      existingPdfs.next().setTrashed(true);
    }

    internalFolder.createFile(pdfBlob);

    if (existed) {
      pdfUpdated++;
    } else {
      pdfCreated++;
    }

    sh.getRange(r.row, 4).setValue('FINAL');
    sh.getRange(r.row, 5).setValue(new Date());
    finalized++;
  });

  return {finalized: finalized, pdfCreated: pdfCreated, pdfUpdated: pdfUpdated};
}

function finalizeWrittenDocuments_(ctx, projectFolder) {
  const records = getProjectDocumentRecords_(ctx.uid).filter(function(record) {
    const config = DOCUMENT_TEMPLATES[record.type];
    return config && config.targetFolder === 'írásos';
  });
  const written = getTargetSubfolder(projectFolder, 'írásos');
  const index = getMergeIndex_();
  records.forEach(function(record) {
    if (record.status === 'FINAL') return;
    if (record.type === 'muszakiLeiras') {
      const projectSheet = prepareTechnicalProjectSheet_(projectFolder);
      const values = getTechnicalSheetReplacements_(projectSheet);
      syncDocument_(record.id, ctx.data, DOCUMENT_TEMPLATES[record.type].templateId, values);
      refreshTechnicalDescription_(record.id, projectFolder, ctx.data, projectSheet);
    } else {
      syncDocument_(record.id, ctx.data, DOCUMENT_TEMPLATES[record.type].templateId);
    }
    const file = DriveApp.getFileById(record.id);
    const pdfName = file.getName().replace(/\.+\s*$/, '') + '.pdf';
    const existing = written.getFilesByName(pdfName);
    while (existing.hasNext()) existing.next().setTrashed(true);
    written.createFile(file.getAs(MimeType.PDF).setName(pdfName));
    index.getRange(record.row, 4).setValue('FINAL');
    index.getRange(record.row, 5).setValue(new Date());
  });
}

// A már megnyitott régi Sheet menük hívását is megerősítéssel kezeljük.
function finalizeSelectedProject() {
  startSelectedProject();
}

// MARK: Külön projekt-dashboard – jogosultság és projektfolyamat
// A dashboard csak a MYSELF jogosultságú, külön verziózott web appon érhető el.
// Az élő, anonim ügyfélűrlap korábbi telepítési verziója ezt a kódot nem tartalmazza.
const DASHBOARD_WEB_APP_URL =
  'https://script.google.com/macros/s/AKfycbye38YrXeU6GMe9h2ncu79s0FlB8xpNLFfWBU-kTH-LigT7fiylMpHTYdNfWUuYcgxpUQ/exec';

function assertDashboardAccess_() {
  const activeEmail = Session.getActiveUser().getEmail();
  const deployingEmail = Session.getEffectiveUser().getEmail();
  if (!activeEmail || !deployingEmail || activeEmail.toLowerCase() !== deployingEmail.toLowerCase())
    throw new Error('A projekt-dashboardot csak a telepítő Google-fiókja használhatja.');
}

function openProjectDashboard() {
  if (!DASHBOARD_WEB_APP_URL) throw new Error('A dashboard telepítési URL-je még nincs beállítva.');
  let uid = '';
  try { uid = getActiveProjectContext().uid; } catch (err) {}
  const url = DASHBOARD_WEB_APP_URL + '?view=dashboard' +
    (uid ? '&project=' + encodeURIComponent(uid) : '');
  openUrlDialog_(url, 'Projekt dashboard');
}

function getProjectContextByUid_(uid) {
  uid = String(uid || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,64}$/.test(uid)) throw new Error('Érvénytelen projektazonosító.');
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const rowNumber = findUID(sheet, uid);
  const data = rowNumber > 1 ? getData(uid) : null;
  if (!data) throw new Error('A projekt nem található.');
  return {ss: ss, sheet: sheet, rowNumber: rowNumber, uid: uid, data: data};
}

function dashboardListProjects() {
  assertDashboardAccess_();
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const postfixes = {};
  getDashboardRows_(DASHBOARD_RESTARTS_SHEET).forEach(function(row) {
    postfixes[String(row[0])] = String(row[2] || '');
  });
  const folderLinks = sheet.getRange(2, 5, last - 1, 1).getRichTextValues();
  return sheet.getRange(2, 1, last - 1, 40).getDisplayValues()
    .map(function(row, index) {
      if (!String(row[0] || '').trim()) return null;
      const uid = String(row[0]).trim().toUpperCase();
      const address = String(row[38] || '').trim();
      const name = address || buildProjectFolderName({
        projekt_varos: row[33], projekt_kozterulet: row[34],
        projekt_tipus: row[35], projekt_hazszam: row[36]
      }) || 'Új projekt';
      const status = String(row[2] || '').trim();
      let archived = false;
      let stage = 'none';
      const rich = folderLinks[index] && folderLinks[index][0];
      const folderId = extractDriveId(rich && rich.getLinkUrl() || row[4]);
      if (folderId) {
        try {
          const parents = DriveApp.getFolderById(folderId).getParents();
          if (parents.hasNext()) {
            const parentName = parents.next().getName();
            archived = ['_Elkészült', '_Lezárt'].indexOf(parentName) !== -1;
            stage = archived ? 'closed' : parentName === '_Ajánlatok' ? 'preparation' : 'started';
          }
        } catch (error) {}
      }
      if (isClosedProjectStatus_(status)) stage = 'closed';
      return {uid: uid, name: appendProjectPostfix_(name, postfixes[uid]),
        clientName: [row[7], row[8]].filter(Boolean).join(' '),
        status: status, stage: stage, closed: isClosedProjectStatus_(status) || archived,
        order: index + 2};
    })
    .filter(Boolean)
    .sort(function(a, b) { return b.order - a.order; });
}

function isClosedProjectStatus_(status) {
  return /^(?:KÉSZ|KESZ|LEZÁRT|LEZART)$/i.test(String(status || '').trim());
}

const DASHBOARD_NOTES_SHEET = '_ProjektJegyzetek';
const DASHBOARD_RESTARTS_SHEET = '_ProjektÚjraindítás';
const DASHBOARD_CHECKS_SHEET = '_ProjektEllenőrzés';
const DASHBOARD_EXPECTED_SHEET = '_ProjektElvártFájlok';
const DASHBOARD_MEMO_SHEET = '_ProjektMemo';
const DASHBOARD_TIMELINE_SHEET = '_ProjektIdővonal';

function getDashboardSheet_(name, headers, create) {
  const book = SpreadsheetApp.openById(SHEET_ID);
  let sheet = book.getSheetByName(name);
  if (!sheet && create) {
    sheet = book.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.hideSheet();
  }
  return sheet;
}

function getDashboardRows_(name) {
  const sheet = getDashboardSheet_(name, [], false);
  return sheet && sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    : [];
}

function getProjectPostfix_(uid) {
  const row = getDashboardRows_(DASHBOARD_RESTARTS_SHEET).filter(function(item) {
    return String(item[0]) === String(uid);
  })[0];
  return row ? String(row[2] || '') : '';
}

function getDashboardNotes_(uid) {
  return getDashboardRows_(DASHBOARD_NOTES_SHEET)
    .filter(function(row) { return String(row[0]) === String(uid); })
    .map(function(row) { return {at: formatDate(row[1]), text: String(row[2] || '')}; });
}

function getDashboardMemo_(uid) {
  const current = getDashboardRows_(DASHBOARD_MEMO_SHEET).filter(function(row) {
    return String(row[0]) === String(uid);
  })[0];
  if (current) return String(current[1] || '');
  return getDashboardNotes_(uid).map(function(note) {
    return (note.at ? '[' + note.at + ']\n' : '') + note.text;
  }).join('\n\n');
}

function dashboardSaveMemo(uid, memo) {
  assertDashboardAccess_();
  const ctx = getProjectContextByUid_(uid);
  memo = String(memo || '');
  if (memo.length > 50000) throw new Error('A jegyzet legfeljebb 50 000 karakter lehet.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('A jegyzet mentése folyamatban van.');
  try {
    const sheet = getDashboardSheet_(DASHBOARD_MEMO_SHEET, ['UID', 'Jegyzet', 'Módosítva'], true);
    const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues() : [];
    const index = rows.findIndex(function(row) { return String(row[0]) === ctx.uid; });
    if (index < 0) sheet.appendRow([ctx.uid, memo, new Date()]);
    else sheet.getRange(index + 2, 2, 1, 2).setValues([[memo, new Date()]]);
  } finally { lock.releaseLock(); }
  return memo;
}

function getDashboardStartDate_(uid) {
  const row = getDashboardRows_(DASHBOARD_TIMELINE_SHEET).filter(function(item) {
    return String(item[0]) === String(uid);
  })[0];
  return row && row[1] ? new Date(row[1]).toISOString() : '';
}

function markDashboardStarted_(uid) {
  if (getDashboardStartDate_(uid)) return;
  getDashboardSheet_(DASHBOARD_TIMELINE_SHEET, ['UID', 'Indítás időpontja'], true)
    .appendRow([uid, new Date()]);
}

function dashboardSetStartDate(uid, dateText) {
  assertDashboardAccess_();
  const ctx = getProjectContextByUid_(uid);
  const state = getDashboardProject(ctx.uid);
  if (state.stage !== 'started' && state.stage !== 'closed')
    throw new Error('Indítási dátum csak elindított projektnél adható meg.');
  dateText = String(dateText || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) throw new Error('Érvénytelen indítási dátum.');
  const date = new Date(dateText + 'T12:00:00Z');
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateText ||
      dateText > Utilities.formatDate(new Date(), 'Europe/Budapest', 'yyyy-MM-dd'))
    throw new Error('Az indítási dátum nem lehet hibás vagy jövőbeli.');
  const sheet = getDashboardSheet_(DASHBOARD_TIMELINE_SHEET, ['UID', 'Indítás időpontja'], true);
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues() : [];
  const index = rows.findIndex(function(row) { return String(row[0]) === ctx.uid; });
  if (index < 0) sheet.appendRow([ctx.uid, date]);
  else sheet.getRange(index + 2, 2).setValue(date);
  return getDashboardProject(ctx.uid);
}

const DASHBOARD_OFFER_FIELDS = [
  'totalFee', 'optionalFee', 'installment1', 'installment2', 'installment3', 'installment4',
  'pricePrefix', 'pricePostfix', 'amountWords', 'currency', 'currencyLong',
  'deadline5', 'deadline6', 'deadline7', 'deadline8',
  'structuralEngineer', 'mechanicalEngineer', 'electricalEngineer', 'projectDescription',
  'structuralFee', 'structuralOptionalFee', 'mechanicalFee', 'electricalFee', 'fireFee'
];

function getDashboardOffer_(ctx) {
  const values = ctx.sheet.getRange(ctx.rowNumber, 41, 1, DASHBOARD_OFFER_FIELDS.length).getDisplayValues()[0];
  const offer = {};
  DASHBOARD_OFFER_FIELDS.forEach(function(key, index) { offer[key] = String(values[index] || ''); });
  const end = ctx.sheet.getLastRow();
  const people = end > 1 ? ctx.sheet.getRange(2, 56, end - 1, 3).getDisplayValues() : [];
  offer.peopleOptions = [0, 1, 2].map(function(column) {
    return Array.from(new Set(people.map(function(row) { return String(row[column] || '').trim(); })
      .filter(Boolean))).sort(function(a, b) { return a.localeCompare(b, 'hu'); });
  });
  return offer;
}

function dashboardSaveOffer(uid, input) {
  assertDashboardAccess_();
  const ctx = getProjectContextByUid_(uid);
  if (!input || typeof input !== 'object') throw new Error('Az ajánlati adatok hiányoznak.');
  const data = DASHBOARD_OFFER_FIELDS.map(function(key) {
    const value = String(input[key] == null ? '' : input[key]).trim();
    if (value.length > (key === 'projectDescription' ? 10000 : 1000))
      throw new Error('Túl hosszú ajánlati adat: ' + key);
    return value;
  });
  ['deadline5', 'deadline6', 'deadline7', 'deadline8'].forEach(function(key) {
    const value = String(input[key] || '').trim();
    if (value && (!/^\d+$/.test(value) || Number(value) > 3650))
      throw new Error('A szakaszhatáridő egész napokban adható meg.');
  });
  if (!String(input.currency || '').trim() || !String(input.currencyLong || '').trim())
    throw new Error('A deviza rövid és hosszú nevét is add meg.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Másik projektművelet folyamatban van.');
  try {
    ctx.sheet.getRange(ctx.rowNumber, 41, 1, data.length).setValues([data]);
    syncProjectByUid_(ctx.uid);
  } finally { lock.releaseLock(); }
  return getDashboardProject(ctx.uid);
}

function getExpectedProjectFiles_(uid) {
  const row = getDashboardRows_(DASHBOARD_EXPECTED_SHEET).filter(function(item) {
    return String(item[0]) === String(uid);
  })[0];
  return row ? String(row[1] || '') : '';
}

function dashboardSaveExpectedFiles(uid, paths) {
  assertDashboardAccess_();
  const ctx = getProjectContextByUid_(uid);
  const lines = String(paths || '').split(/\r?\n/).map(function(line) { return line.trim(); })
    .filter(Boolean);
  if (lines.length > 200 || lines.join('\n').length > 12000)
    throw new Error('Legfeljebb 200 elvárt fájl adható meg.');
  lines.forEach(function(line) {
    if (line.indexOf('..') !== -1 || line.charAt(0) === '/' || /[\x00-\x1f]/.test(line))
      throw new Error('Érvénytelen relatív fájlútvonal: ' + line);
  });
  const sheet = getDashboardSheet_(DASHBOARD_EXPECTED_SHEET,
    ['UID', 'Relatív fájlútvonalak', 'Módosítva'], true);
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues() : [];
  const index = rows.findIndex(function(row) { return String(row[0]) === ctx.uid; });
  if (index < 0) sheet.appendRow([ctx.uid, lines.join('\n'), new Date()]);
  else sheet.getRange(index + 2, 2, 1, 2).setValues([[lines.join('\n'), new Date()]]);
  return getDashboardProject(ctx.uid);
}

function projectRelativeFileExists_(root, path) {
  const parts = String(path).split('/').filter(Boolean);
  if (!parts.length) return false;
  let folder = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const children = folder.getFoldersByName(parts[i]);
    if (!children.hasNext()) return false;
    folder = children.next();
  }
  return folder.getFilesByName(parts[parts.length - 1]).hasNext();
}

function dashboardAddNote(uid, note) {
  assertDashboardAccess_();
  const ctx = getProjectContextByUid_(uid);
  note = String(note || '').trim();
  if (!note || note.length > 10000) throw new Error('A jegyzet 1–10000 karakter lehet.');
  const sheet = getDashboardSheet_(DASHBOARD_NOTES_SHEET, ['UID', 'Időpont', 'Jegyzet'], true);
  sheet.appendRow([ctx.uid, new Date(), note]);
  return getDashboardNotes_(ctx.uid);
}

function getDefaultRestartPostfix_() {
  return 'MOD_' + Utilities.formatDate(new Date(), 'Europe/Budapest', 'yyMM');
}

function validateRestartPostfix_(postfix) {
  postfix = String(postfix || '').trim() || getDefaultRestartPostfix_();
  if (postfix.length > 60 || /[\\/<>:"|?*\x00-\x1f]/.test(postfix))
    throw new Error('Az utótag legfeljebb 60 karakter lehet, fájlnévben tiltott karakter nélkül.');
  return postfix;
}

function copyProjectTree_(source, destination, postfix, fileIds) {
  const files = source.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();
    // A helyiséglista gépi beolvasása pontos fájlnévre épül.
    const copyName = fileName.toLowerCase() === 'helyiségek.txt'
      ? fileName : appendProjectPostfix_(fileName, postfix);
    const copy = file.makeCopy(copyName, destination);
    fileIds[file.getId()] = copy.getId();
  }
  const folders = source.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    const name = folder.getName();
    const childName = PROJECT_SUBFOLDERS.indexOf(name) !== -1
      ? name : appendProjectPostfix_(name, postfix);
    copyProjectTree_(folder, destination.createFolder(childName), postfix, fileIds);
  }
}

function restartExpectedPath_(path, postfix) {
  const parts = String(path).split('/');
  return parts.map(function(part, index) {
    if (index < parts.length - 1 && PROJECT_SUBFOLDERS.indexOf(part) !== -1) return part;
    if (index === parts.length - 1 && part.toLowerCase() === 'helyiségek.txt') return part;
    return appendProjectPostfix_(part, postfix);
  }).join('/');
}

function dashboardRestartProject(uid, requestedPostfix, confirmation) {
  assertDashboardAccess_();
  const ctx = getProjectContextByUid_(uid);
  if (confirmation !== 'restart:' + ctx.uid)
    throw new Error('Az újraindítás megerősítése hiányzik.');
  const postfix = validateRestartPostfix_(requestedPostfix);
  const source = getExistingProjectFolder(ctx);
  if (!source) throw new Error('A lezárt projektmappa nem található.');
  const sourceParents = source.getParents();
  const archiveName = sourceParents.hasNext() ? sourceParents.next().getName() : '';
  if (archiveName !== '_Elkészült' && archiveName !== '_Lezárt')
    throw new Error('A forrásprojekt nincs lezárt projektmappában.');
  const targetRoot = getProjectsParentFolder();
  const targetName = appendProjectPostfix_(buildProjectFolderName(ctx.data) || source.getName(), postfix);
  if (targetRoot.getFoldersByName(targetName).hasNext())
    throw new Error('Már van ilyen nevű projekt az ajánlatok között: ' + targetName);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Egy másik projektművelet még fut.');
  let newFolder = null;
  let rowAdded = false;
  try {
    const newUid = generateUniqueUID(ctx.sheet);
    newFolder = targetRoot.createFolder(targetName);
    const copiedIds = {};
    copyProjectTree_(source, newFolder, postfix, copiedIds);
    const copiedData = Object.assign({}, ctx.data, {
      uid: newUid, status: 'ELŐKÉSZÍTÉS', projectFolderUrl: '',
      clientLink: buildClientUrl(newUid)
    });
    ctx.sheet.appendRow(buildRow(copiedData, newUid));
    rowAdded = true;
    const newRow = ctx.sheet.getLastRow();
    setProjectFolderLink({sheet: ctx.sheet, rowNumber: newRow}, newFolder);
    getDashboardSheet_(DASHBOARD_RESTARTS_SHEET,
      ['UID', 'Forrás UID', 'Utótag', 'Időpont'], true)
      .appendRow([newUid, ctx.uid, postfix, new Date()]);
    const oldExpected = getExpectedProjectFiles_(ctx.uid);
    if (oldExpected) {
      const updatedExpected = oldExpected.split(/\r?\n/)
        .map(function(path) { return restartExpectedPath_(path, postfix); }).join('\n');
      getDashboardSheet_(DASHBOARD_EXPECTED_SHEET,
        ['UID', 'Relatív fájlútvonalak', 'Módosítva'], true)
        .appendRow([newUid, updatedExpected, new Date()]);
    }
    getProjectDocumentRecords_(ctx.uid).forEach(function(record) {
      const config = DOCUMENT_TEMPLATES[record.type];
      if (!config || !copiedIds[record.id]) return;
      const sourceFile = DriveApp.getFileById(record.id);
      const newName = buildDocumentFileName(config, copiedData);
      DriveApp.getFileById(copiedIds[record.id]).setName(newName);
      const originalFolder = source.getFoldersByName(config.targetFolder);
      if (originalFolder.hasNext()) {
        const pdf = originalFolder.next().getFilesByName(sourceFile.getName() + '.pdf');
        if (pdf.hasNext()) {
          const copiedPdfId = copiedIds[pdf.next().getId()];
          if (copiedPdfId) DriveApp.getFileById(copiedPdfId).setName(newName + '.pdf');
        }
      }
      registerProjectDocument_(newUid, record.type, copiedIds[record.id]);
    });
    return {uid: newUid, folderUrl: newFolder.getUrl(), postfix: postfix};
  } catch (error) {
    if (newFolder && !rowAdded) newFolder.setTrashed(true);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function getDashboardAnswers_(uid) {
  const answers = {};
  getDashboardRows_(DASHBOARD_CHECKS_SHEET).forEach(function(row) {
    if (String(row[0]) === String(uid)) answers[String(row[1])] = String(row[2] || '');
  });
  return answers;
}

function dashboardAnswerCheck(uid, code, answer) {
  assertDashboardAccess_();
  const ctx = getProjectContextByUid_(uid);
  code = String(code || '');
  answer = String(answer || '').trim();
  const current = getDashboardProject(ctx.uid);
  const issue = current.issues.filter(function(item) { return item.code === code; })[0];
  if (!issue || !issue.answerable) throw new Error('Ez az ellenőrzési pont nem válaszolható meg itt.');
  if (!answer || answer.length > 3000) throw new Error('A válasz 1–3000 karakter lehet.');
  if (code.indexOf('scale:') === 0 && !/^M=1:\d+(?:,\s*1:\d+)*$/.test(answer))
    throw new Error('A méretarány formátuma például M=1:50 vagy M=1:500, 1:200.');
  getDashboardSheet_(DASHBOARD_CHECKS_SHEET,
    ['UID', 'Ellenőrzés', 'Válasz', 'Időpont'], true)
    .appendRow([ctx.uid, code, answer, new Date()]);
  return getDashboardProject(ctx.uid);
}

function dashboardSendEmail(uid, kind, confirmation) {
  assertDashboardAccess_();
  const ctx = getProjectContextByUid_(uid);
  kind = String(kind || '');
  if (['offer', 'contract', 'intake', 'package'].indexOf(kind) === -1)
    throw new Error('Ismeretlen e-mail típus.');
  if (confirmation !== 'email:' + kind + ':' + ctx.uid)
    throw new Error('Az e-mail küldés megerősítése hiányzik.');
  const recipient = String(ctx.data.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
    throw new Error('Az ügyfél e-mail-címe hiányzik vagy érvénytelen.');
  const projectName = buildProjectFolderName(ctx.data) || ctx.data.projektCim || ctx.uid;
  const mail = {to: recipient, subject: '', body: '', attachments: []};
  if (kind === 'intake') {
    mail.subject = 'Adatbekérő – ' + projectName;
    mail.body = 'Kedves Ügyfelünk!\n\nKérjük, töltse ki vagy ellenőrizze a projekt adatlapját az alábbi linken:\n' +
      buildClientUrl(ctx.uid) + '\n\nÜdvözlettel:\nKocka Stúdió';
  } else if (kind === 'package') {
    const folder = getExistingProjectFolder(ctx);
    if (!folder) throw new Error('A projektmappa nem található.');
    const blobs = [];
    const included = {};
    ['PDFA', 'írásos'].forEach(function(folderName) {
      const candidates = folder.getFoldersByName(folderName);
      if (!candidates.hasNext()) return;
      const files = candidates.next().getFiles();
      while (files.hasNext()) {
        const file = files.next();
        if (/\.pdf$/i.test(file.getName()) && !included[file.getName()]) {
          included[file.getName()] = true;
          blobs.push(file.getBlob());
        }
      }
    });
    getProjectDocumentRecords_(ctx.uid).forEach(function(record) {
      const config = DOCUMENT_TEMPLATES[record.type];
      if (!config || config.targetFolder !== 'írásos') return;
      const file = DriveApp.getFileById(record.id);
      const pdfName = file.getName() + '.pdf';
      if (!included[pdfName]) {
        included[pdfName] = true;
        blobs.push(file.getAs(MimeType.PDF).setName(pdfName));
      }
    });
    if (!blobs.length) throw new Error('Nincs küldhető PDF a PDFA vagy írásos mappában.');
    const totalBytes = blobs.reduce(function(total, blob) { return total + blob.getBytes().length; }, 0);
    if (totalBytes > 18 * 1024 * 1024)
      throw new Error('A tervcsomag meghaladja a 18 MB-ot; bontsd részekre a küldést.');
    mail.attachments = [Utilities.zip(blobs, projectName + ' - tervcsomag.zip')];
    mail.subject = 'Tervcsomag – ' + projectName;
    mail.body = 'Kedves Ügyfelünk!\n\nMellékelten küldjük a projekt tervcsomagját.\n\nÜdvözlettel:\nKocka Stúdió';
  } else {
    const type = kind === 'offer' ? 'ajanlat' : 'szerzodes';
    const record = getProjectDocumentRecords_(ctx.uid).filter(function(item) {
      return item.type === type;
    })[0];
    if (!record) throw new Error('A küldendő dokumentum még nem készült el.');
    const file = DriveApp.getFileById(record.id);
    if (record.status !== 'FINAL')
      syncDocument_(record.id, ctx.data, DOCUMENT_TEMPLATES[type].templateId);
    mail.attachments = [file.getAs(MimeType.PDF).setName(file.getName() + '.pdf')];
    mail.subject = (kind === 'offer' ? 'Ajánlat' : 'Szerződés') + ' – ' + projectName;
    mail.body = 'Kedves Ügyfelünk!\n\nMellékelten küldjük a projekt ' +
      (kind === 'offer' ? 'ajánlatát.' : 'szerződését.') +
      '\n\nÜdvözlettel:\nKocka Stúdió';
  }
  MailApp.sendEmail(mail);
  return 'Az e-mail elküldve erre a címre: ' + recipient;
}

function getDashboardAudioFolder_(projectFolder, create) {
  const internal = projectFolder.getFoldersByName('_Belső');
  if (!internal.hasNext() && !create) return null;
  const parent = internal.hasNext() ? internal.next() : findOrCreateSubfolder(projectFolder, '_Belső');
  const audio = parent.getFoldersByName('Hangjegyzetek');
  return audio.hasNext() ? audio.next() : create ? parent.createFolder('Hangjegyzetek') : null;
}

function getDashboardAudio_(folder) {
  if (!folder) return [];
  const audioFolder = getDashboardAudioFolder_(folder, false);
  if (!audioFolder) return [];
  const files = audioFolder.getFiles();
  const audio = [];
  while (files.hasNext()) {
    const file = files.next();
    audio.push({id: file.getId(), name: file.getName(), url: file.getUrl()});
  }
  return audio;
}

function dashboardUploadAudio(uid, name, mimeType, base64) {
  assertDashboardAccess_();
  const ctx = getProjectContextByUid_(uid);
  name = String(name || '').replace(/[\\/<>:"|?*\x00-\x1f]/g, '_').slice(0, 120);
  mimeType = String(mimeType || '');
  if (!mimeType) {
    const extension = (name.match(/\.([^.]+)$/) || [,''])[1].toLowerCase();
    mimeType = {mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
      webm: 'audio/webm', ogg: 'audio/ogg'}[extension] || '';
  }
  base64 = String(base64 || '');
  if (!/^audio\//.test(mimeType) || !name || base64.length > 12 * 1024 * 1024)
    throw new Error('Legfeljebb 8 MB-os hangfájl tölthető fel.');
  const bytes = Utilities.base64Decode(base64);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('A hangfájl túl nagy.');
  const folder = getDashboardAudioFolder_(ensureProjectFolder(ctx), true);
  const file = folder.createFile(Utilities.newBlob(bytes, mimeType,
    appendProjectPostfix_(name, getProjectPostfix_(ctx.uid))));
  return {id: file.getId(), url: file.getUrl(), project: getDashboardProject(ctx.uid)};
}

function dashboardSummarizeAudio(uid, fileId) {
  assertDashboardAccess_();
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('A Gemini API-kulcs még nincs beállítva a Script Properties között.');
  const ctx = getProjectContextByUid_(uid);
  const folder = getExistingProjectFolder(ctx);
  const audioFolder = folder && getDashboardAudioFolder_(folder, false);
  if (!audioFolder) throw new Error('A projektben nincs hangjegyzet.');
  const files = audioFolder.getFiles();
  let audioFile = null;
  while (files.hasNext()) {
    const candidate = files.next();
    if (candidate.getId() === String(fileId)) { audioFile = candidate; break; }
  }
  if (!audioFile) throw new Error('A hangfájl nem ehhez a projekthez tartozik.');
  const blob = audioFile.getBlob();
  if (blob.getBytes().length > 8 * 1024 * 1024) throw new Error('A hangfájl túl nagy az AI-kivonathoz.');
  const model = PropertiesService.getScriptProperties().getProperty('GEMINI_AUDIO_MODEL') || 'gemini-2.5-flash';
  const payload = {contents: [{parts: [
    {text: 'Készíts magyar nyelvű, tömör projektjegyzetet a hangfelvételből. ' +
      'Csak az elhangzott tényeket és döntéseket írd le. A bizonytalan részeket jelöld kérdésként. ' +
      'Ne találj ki adatokat. Szerkezet: tények, döntések, nyitott kérdések.'},
    {inline_data: {mime_type: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes())}}
  ]}]};
  const response = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
    {method: 'post', contentType: 'application/json',
      headers: {'x-goog-api-key': key}, payload: JSON.stringify(payload), muteHttpExceptions: true});
  if (response.getResponseCode() !== 200)
    throw new Error('Az AI-kivonat nem készült el (HTTP ' + response.getResponseCode() + ').');
  const result = JSON.parse(response.getContentText());
  const parts = result.candidates && result.candidates[0] && result.candidates[0].content &&
    result.candidates[0].content.parts || [];
  const summary = parts.map(function(part) { return part.text || ''; }).join('\n').trim();
  if (!summary) throw new Error('Az AI nem adott szöveges kivonatot.');
  if (summary.length > 9000) throw new Error('Az AI-kivonat túl hosszú a jegyzetmezőhöz.');
  return {summary: '[AI-kivonat – ' + audioFile.getName() + ']\n' + summary};
}

function dashboardConfigureAi(apiKey) {
  assertDashboardAccess_();
  apiKey = String(apiKey || '').trim();
  if (!/^[A-Za-z0-9._-]{20,300}$/.test(apiKey))
    throw new Error('Érvénytelen Gemini API-kulcs.');
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', apiKey);
  return true;
}

function getDashboardIssues_(ctx, folder, dataSheet, documents, planEntries, programReady, dataSheetError) {
  const issues = [];
  const expectedFiles = getExpectedProjectFiles_(ctx.uid).split(/\r?\n/).filter(Boolean);
  function add(code, text, blocking, answerable) {
    issues.push({code: code, text: text, blocking: !!blocking,
      answerable: !!answerable});
  }
  if (!folder) add('folder', 'A projektmappa hiányzik.', true, false);
  if (dataSheetError) add('data_sheet_conflict', dataSheetError, true, false);
  if (folder && !dataSheet) add('data_sheet', 'A tervezési adatlap hiányzik.', true, false);
  if (dataSheet && !programReady)
    add('program', 'A tervezési program a–p pontjai nem teljesek.', true, false);
  if (folder) {
    const parents = folder.getParents();
    const parentName = parents.hasNext() ? parents.next().getName() : '';
    const archived = parentName === '_Elkészült' || parentName === '_Lezárt';
    if (isClosedProjectStatus_(ctx.data.status) !== archived)
      add('status_folder', 'A projekt státusza és a mappa helye ellentmond egymásnak.', false, true);
    const pln = folder.getFoldersByName('PLN');
    let rooms = false;
    if (pln.hasNext()) {
      const files = pln.next().getFiles();
      while (files.hasNext()) if (files.next().getName().toLowerCase() === 'helyiségek.txt') rooms = true;
    }
    if (!rooms) add('rooms', 'A PLN/helyiségek.txt fájl hiányzik.', true, false);
    if (!planEntries.length) add('plans', 'Nincs PDF tervlap a PDFA mappában.', true, false);
    planEntries.filter(function(entry) { return !entry.scale; }).forEach(function(entry) {
      add('scale:' + entry.title, 'A tervlap méretaránya nem ismert: ' + entry.title +
        '. Mi a helyes méretarány?', false, true);
    });
    const expectedName = appendProjectPostfix_(buildProjectFolderName(ctx.data), getProjectPostfix_(ctx.uid));
    if (expectedName && folder.getName() !== expectedName)
      add('folder_name', 'A projektmappa neve eltér az adatlap alapján várttól. Mi az eltérés oka?', false, true);
    expectedFiles.forEach(function(path) {
      if (!projectRelativeFileExists_(folder, path))
        add('expected:' + path, 'Hiányzó elvárt fájl: ' + path, true, false);
    });
  }
  if (!expectedFiles.length)
    add('expected_list', 'Nincs projektspecifikus elvárt fájllista; a teljes fájlkészlet nem ellenőrizhető.', false, false);
  ['ajanlat', 'szerzodes'].forEach(function(type) {
    if (!documents.some(function(doc) { return doc.type === type && doc.url; }))
      add('document:' + type, 'Hiányzik a(z) ' + DOCUMENT_TEMPLATES[type].title + ' dokumentum.',
        type === 'szerzodes', false);
  });
  if (!documents.some(function(doc) { return doc.type === 'muszakiLeiras' && doc.url; }))
    add('document:muszakiLeiras', 'A műszaki leírás még nem készült el.', false, false);
  const answers = getDashboardAnswers_(ctx.uid);
  return issues.map(function(issue) {
    issue.answer = answers[issue.code] || '';
    issue.resolved = !!issue.answer;
    return issue;
  });
}

function getDashboardProject(uid) {
  assertDashboardAccess_();
  const ctx = getProjectContextByUid_(uid);
  const folder = getExistingProjectFolder(ctx);
  let stage = 'none';
  let folderUrl = '';
  let folderName = '';
  let dataSheetUrl = '';
  let projectSheet = null;
  let dataSheetError = '';
  let programReady = false;
  let planEntries = [];
  if (folder) {
    folderUrl = folder.getUrl();
    folderName = folder.getName();
    const parents = folder.getParents();
    const parent = parents.hasNext() ? parents.next() : null;
    if (parent) {
      if (parent.getName() === '_Lezárt' || parent.getName() === '_Elkészült') stage = 'closed';
      else if (parent.getId() === getStartedProjectsFolder_().getId()) stage = 'started';
      else if (parent.getId() === getProjectsParentFolder().getId()) stage = 'preparation';
      else stage = 'other';
    }
    try { projectSheet = findProjectDataSpreadsheet_(folder); }
    catch (error) { dataSheetError = error.message || String(error); }
    if (projectSheet) {
      dataSheetUrl = projectSheet.getUrl();
      setProjectDashboardLink_(projectSheet, ctx.uid);
      const program = projectSheet.getSheetByName('Tervezési program');
      if (program) {
        const values = program.getRange(2, 2, 16, 1).getDisplayValues();
        programReady = values.every(function(row, i) {
          return String(row[0] || '').trim().indexOf(String.fromCharCode(97 + i) + ')') === 0;
        });
      }
    }
    planEntries = getProjectPlanEntries_(folder, ctx.uid);
  }
  const records = getProjectDocumentRecords_(ctx.uid);
  const documents = Object.keys(DOCUMENT_TEMPLATES).map(function(type) {
    const config = DOCUMENT_TEMPLATES[type];
    const record = records.filter(function(item) { return item.type === type; })[0];
    let url = '';
    if (record) {
      try { url = DriveApp.getFileById(record.id).getUrl(); } catch (err) {}
    }
    return {type: type, title: config.title, status: record ? record.status : '', url: url};
  });
  const issues = getDashboardIssues_(ctx, folder, projectSheet, documents,
    planEntries, programReady, dataSheetError);
  return {
    uid: ctx.uid,
    name: folderName || buildProjectFolderName(ctx.data) || ctx.data.projektCim || ctx.uid,
    address: ctx.data.projektCim || '',
    clientName: [ctx.data.vezeteknev, ctx.data.keresztnev].filter(Boolean).join(' '),
    status: ctx.data.status || '',
    stage: stage,
    folderName: folderName,
    folderUrl: folderUrl,
    dataSheetUrl: dataSheetUrl,
    programReady: programReady,
    planCount: planEntries.length,
    documents: documents,
    issues: issues,
    memo: getDashboardMemo_(ctx.uid),
    offer: getDashboardOffer_(ctx),
    startedAt: getDashboardStartDate_(ctx.uid),
    expectedFiles: getExpectedProjectFiles_(ctx.uid),
    audio: getDashboardAudio_(folder),
    aiConfigured: !!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'),
    email: ctx.data.email || '',
    phone: ctx.data.telefon || '',
    defaultPostfix: getDefaultRestartPostfix_(),
    clientFormUrl: buildClientUrl(ctx.uid)
  };
}

// MARK: Dashboard oldalsáv – projektmappa böngészése
function dashboardListFolder(uid, folderId) {
  assertDashboardAccess_();
  const ctx = getProjectContextByUid_(uid);
  const root = getExistingProjectFolder(ctx);
  if (!root) return {name: '', folders: [], files: [], missing: true};
  folderId = String(folderId || '').trim();
  if (folderId && !/^[A-Za-z0-9_-]{10,128}$/.test(folderId))
    throw new Error('Érvénytelen mappaazonosító.');
  const folder = folderId ? DriveApp.getFolderById(folderId) : root;
  let current = folder;
  let inside = false;
  for (let depth = 0; current && depth < 30; depth++) {
    if (current.getId() === root.getId()) { inside = true; break; }
    const parents = current.getParents();
    current = parents.hasNext() ? parents.next() : null;
  }
  if (!inside) throw new Error('A mappa nem a kiválasztott projekthez tartozik.');
  const folders = [], files = [];
  const folderIterator = folder.getFolders();
  while (folderIterator.hasNext() && folders.length < 300) {
    const child = folderIterator.next();
    folders.push({id: child.getId(), name: child.getName()});
  }
  const fileIterator = folder.getFiles();
  while (fileIterator.hasNext() && files.length + folders.length < 300) {
    const file = fileIterator.next();
    files.push({name: file.getName(), url: file.getUrl(), mimeType: file.getMimeType()});
  }
  folders.sort(function(a, b) { return a.name.localeCompare(b.name, 'hu'); });
  files.sort(function(a, b) { return a.name.localeCompare(b.name, 'hu'); });
  return {id: folder.getId(), name: folder.getName(), folders: folders, files: files,
    truncated: folderIterator.hasNext() || fileIterator.hasNext()};
}

// MARK: Dashboard oldalsáv – elküldött levelek HTTPS–IMAP közvetítőn át
function dashboardMailRequest_(path, recipient, messageId) {
  const properties = PropertiesService.getScriptProperties();
  const baseUrl = String(properties.getProperty('IMAP_BRIDGE_URL') || '').replace(/\/+$/, '');
  const token = String(properties.getProperty('IMAP_BRIDGE_TOKEN') || '');
  if (!baseUrl || !token) return {configured: false, messages: []};
  if (!/^https:\/\//i.test(baseUrl)) throw new Error('Az IMAP-közvetítőhöz HTTPS URL szükséges.');
  const response = UrlFetchApp.fetch(baseUrl + path, {
    method: 'post', contentType: 'application/json',
    headers: {Authorization: 'Bearer ' + token},
    payload: JSON.stringify({recipient: recipient, id: messageId || ''}),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200)
    throw new Error('Az elküldött levelek nem érhetők el (HTTP ' + response.getResponseCode() + ').');
  const result = JSON.parse(response.getContentText());
  return Object.assign({configured: true}, result);
}

function dashboardListSentMail(uid) {
  assertDashboardAccess_();
  const ctx = getProjectContextByUid_(uid);
  const recipient = String(ctx.data.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
    return {configured: true, missingRecipient: true, messages: []};
  return dashboardMailRequest_('/messages', recipient, '');
}

function dashboardGetSentMail(uid, messageId) {
  assertDashboardAccess_();
  const ctx = getProjectContextByUid_(uid);
  const recipient = String(ctx.data.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
    throw new Error('A projekthez nincs érvényes címzett.');
  if (!/^\d{1,20}:\d{1,20}$/.test(String(messageId || '')))
    throw new Error('Érvénytelen levélazonosító.');
  const result = dashboardMailRequest_('/message', recipient, String(messageId));
  if (!result.configured) throw new Error('Az IMAP-közvetítő nincs beállítva.');
  return result;
}

function dashboardPerform(uid, action, confirmation) {
  assertDashboardAccess_();
  const ctx = getProjectContextByUid_(uid);
  action = String(action || '');
  if (['start', 'close'].indexOf(action) !== -1 &&
      confirmation !== action + ':' + ctx.uid)
    throw new Error('A művelet megerősítése hiányzik.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Egy másik projektművelet még fut.');
  let message = '';
  let openedUrl = '';
  try {
    if (action === 'folder') {
      const folder = ensureProjectFolder(ctx);
      message = 'A projektmappa készen áll.';
      openedUrl = folder.getUrl();
    } else if (action === 'dataSheet') {
      const sheet = ensureProjectDataSpreadsheet_(ensureProjectFolder(ctx));
      setProjectDashboardLink_(sheet, ctx.uid);
      installProjectDataTrigger_(sheet.getId());
      message = 'A tervezési adatlap készen áll.';
      openedUrl = sheet.getUrl();
    } else if (action.indexOf('document:') === 0) {
      const type = action.slice('document:'.length);
      if (!Object.prototype.hasOwnProperty.call(DOCUMENT_TEMPLATES, type))
        throw new Error('Ismeretlen dokumentumtípus.');
      if (type === 'muszakiLeiras') {
        const state = getDashboardProject(ctx.uid);
        if (state.stage !== 'started') throw new Error('A műszaki leírás a projekt indítása után készíthető.');
        const blockers = state.issues.filter(function(issue) { return issue.blocking && !issue.resolved; });
        if (blockers.length) throw new Error('Előbb javítsd a hiányzó adatokat és fájlokat: ' +
          blockers.map(function(issue) { return issue.text; }).join(' '));
      }
      const result = generateDocumentForContext_(ctx, type);
      message = result.created ? 'A dokumentum létrejött.' : 'A dokumentum frissítve.';
      openedUrl = result.url;
    } else if (action === 'sync') {
      syncProjectByUid_(ctx.uid);
      message = 'A DRAFT dokumentumok szinkronizálva.';
    } else if (action === 'start') {
      const preparation = getProjectsParentFolder();
      const folder = getProjectFolderForMove_(ctx, preparation, 'indításhoz');
      const destination = getStartedProjectsFolder_();
      const records = getFinalizableProjectRecords_(ctx.uid);
      if (!records.length) throw new Error('Nincs véglegesíthető dokumentum a _Belső mappában.');
      assertProjectFolderDestinationAvailable_(folder, destination);
      const result = finalizeProjectDocuments_(ctx, folder, records);
      setProjectDashboardLink_(ensureProjectDataSpreadsheet_(folder), ctx.uid);
      ['meghatalmazas', 'alairolap'].forEach(function(type) {
        generateDocumentForContext_(Object.assign({}, ctx, {projectFolder: folder}), type);
      });
      moveProjectFolder_(folder, destination);
      ctx.sheet.getRange(ctx.rowNumber, 3).setValue('AKTÍV');
      markDashboardStarted_(ctx.uid);
      message = 'A projekt elindult; ' + result.finalized + ' dokumentum véglegesítve.';
      openedUrl = folder.getUrl();
    } else if (action === 'close') {
      const started = getStartedProjectsFolder_();
      const folder = getProjectFolderForMove_(ctx, started, 'lezáráshoz');
      const state = getDashboardProject(ctx.uid);
      const missing = state.issues.filter(function(issue) { return issue.blocking && !issue.resolved; });
      if (missing.length) throw new Error('A lezárás előtt javítandó: ' +
        missing.map(function(issue) { return issue.text; }).join(' '));
      if (!state.documents.some(function(doc) { return doc.type === 'muszakiLeiras' && doc.url; }))
        throw new Error('A lezáráshoz műszaki leírás szükséges.');
      finalizeWrittenDocuments_(ctx, folder);
      const archive = findOrCreateSubfolder(started, '_Elkészült');
      moveProjectFolder_(folder, archive);
      ctx.sheet.getRange(ctx.rowNumber, 3).setValue('KÉSZ');
      message = 'A projekt elkészült, a dokumentumok véglegesítve.';
      openedUrl = folder.getUrl();
    } else {
      throw new Error('Ismeretlen projektművelet.');
    }
  } finally {
    lock.releaseLock();
  }
  return {message: message, url: openedUrl, project: getDashboardProject(ctx.uid)};
}

/*************************************************
 * DÁTUM FORMÁZÁSA
 *************************************************/

// MARK: Dátum és HTML segédfüggvények
function formatDate(value) {

  if (!value) {
    return '';
  }


  if (
    value instanceof Date
  ) {

    return Utilities.formatDate(
      value,
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );

  }


  return String(value);

}


/*************************************************
 * HTML ESCAPE
 *************************************************/

function escapeHtml(value) {

  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

}
