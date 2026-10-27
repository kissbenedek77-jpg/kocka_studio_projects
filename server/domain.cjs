'use strict';

// MARK: Az Adatok munkalap A–AN oszlopainak változatlan megfeleltetése
const FIELDS = [
  'uid', 'createdAt', 'status', 'clientLink', 'projectFolderUrl', 'language', 'gdprAccepted',
  'vezeteknev', 'keresztnev', 'szuletesiNev', 'allampolgarsag',
  'lakcim_irsz', 'lakcim_varos', 'lakcim_kozterulet', 'lakcim_tipus', 'lakcim_hazszam', 'lakcim_egyeb', 'lakcim',
  'ertesitesi_irsz', 'ertesitesi_varos', 'ertesitesi_kozterulet', 'ertesitesi_tipus', 'ertesitesi_hazszam', 'ertesitesi_egyeb', 'ertesitesiCim',
  'adoazonosito', 'telefon', 'email', 'anyjaNeve', 'szuletesiHely', 'szuletesiIdo',
  'projektTipusStored', 'projekt_irsz', 'projekt_varos', 'projekt_kozterulet', 'projekt_tipus', 'projekt_hazszam', 'projekt_egyeb', 'projektCim', 'hrsz'
];
const COLUMN_COUNT = FIELDS.length;

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

const PROJECT_SUBFOLDERS = ['írásos', '_Belső', 'PDFA', 'DWG', 'Adat társtervezőktől', 'PLN', 'Render'];

const TEMPLATE_ROOT_FOLDER_ID = '1yw8ts2OTQTK0y2dn8TnovvR5HbWSqHWd';
const PROJECT_DATA_TEMPLATE_ID = '1NZPw7bJAQFfQbTNl3yzObRly1bjyt2hRfQ0QHhCN4Dg';

// MARK: Tervfajták fájlnév alapján felismert méretarányai
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

// 245/2006. (XII. 5.) Korm. rendelet 3. § (3) és 1. melléklet 1. sor
const RESIDENTIAL_BUILDING_VALUE_THOUSAND_HUF_PER_M2 = 600;

const MERGE_INDEX_SHEET = '_DokumentumIndex';
const MERGE_PREFIX = 'KOCKA_MERGE_';

function rowToData(row) {
  const data = Object.fromEntries(FIELDS.map((key, index) => [key, row[index] ?? '']));
  const kind = String(data.projektTipusStored).match(/^Egyéb\s*:\s*(.*)$/i);
  data.projektTipus = kind ? 'Egyéb' : data.projektTipusStored;
  data.projektTipusEgyeb = kind ? kind[1] : '';
  data.gdprAccepted = data.gdprAccepted === true || data.gdprAccepted === 'TRUE';
  data.ertesitesi_same = String(data.lakcim) === String(data.ertesitesiCim);
  delete data.projektTipusStored;
  return data;
}

function projectFromRow(row, rowNumber) {
  const data = rowToData(row);
  const status = String(data.status).trim();
  const closed = isClosedStatus(status);
  return {
    uid: String(data.uid).trim().toUpperCase(),
    name: String(data.projektCim || data.projekt_varos || 'Új projekt').trim(),
    clientName: [data.vezeteknev, data.keresztnev].filter(Boolean).join(' '),
    status, stage: closed ? 'closed' : data.projectFolderUrl ? 'preparation' : 'none',
    closed, order: rowNumber
  };
}

function isClosedStatus(status) {
  return /^(?:KÉSZ|KESZ|LEZÁRT|LEZART)$/i.test(String(status || '').trim());
}

function extractDriveId(value) {
  const text = String(value || '');
  const match = text.match(/(?:\/folders\/|[?&]id=)([A-Za-z0-9_-]{10,128})/);
  return match ? match[1] : /^[A-Za-z0-9_-]{10,128}$/.test(text) ? text : '';
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
  if (match) return {projektTipus: 'Egyéb', projektTipusEgyeb: match[1] || ''};
  if (/^egyéb$/i.test(text)) return {projektTipus: 'Egyéb', projektTipusEgyeb: ''};
  return {projektTipus: text, projektTipusEgyeb: ''};
}

function validateData(data) {
  if (!data.vezeteknev) throw new Error('A vezetéknév megadása kötelező.');
  if (!data.keresztnev) throw new Error('A keresztnév megadása kötelező.');
  if (!data.allampolgarsag) throw new Error('Az állampolgárság megadása kötelező.');
  if (!data.adoazonosito) throw new Error('Az adóazonosító megadása kötelező.');
  if (data.allampolgarsag === 'Magyar') {
    const taxId = String(data.adoazonosito).replace(/\D/g, '');
    if (!/^\d{10}$/.test(taxId)) throw new Error('Az adóazonosító jel 10 számjegyből áll.');
  }
  if (!data.projektTipus) throw new Error('A projekt típusának megadása kötelező.');
  if ((data.projektTipus === 'Egyéb' || data.projektTipus === 'egyéb') && !data.projektTipusEgyeb) {
    throw new Error('Adja meg az egyéb projekt típusát.');
  }
}

function applyNotificationAddress(data) {
  if (typeof data.ertesitesi_same !== 'boolean') data.ertesitesi_same = true;
  if (data.ertesitesi_same !== true) return data;
  data.ertesitesi_irsz = data.lakcim_irsz || '';
  data.ertesitesi_varos = data.lakcim_varos || '';
  data.ertesitesi_kozterulet = data.lakcim_kozterulet || '';
  data.ertesitesi_tipus = data.lakcim_tipus || '';
  data.ertesitesi_hazszam = data.lakcim_hazszam || '';
  data.ertesitesi_egyeb = data.lakcim_egyeb || '';
  data.ertesitesiCim = data.lakcim || '';
  return data;
}

function buildRow(data, uid, now = new Date()) {
  return [
    uid,                                  // A  UID
    now,                                  // B  Dátum
    data.status || 'ELŐKÉSZÍTÉS',         // C  Státusz
    data.clientLink || '',                // D  Form link
    data.projectFolderUrl || '',          // E  Projekt mappa
    data.language || '',                  // F  Nyelv
    data.gdprAccepted === true,           // G  adatvédelmi elfogadva
    data.vezeteknev || '',                // H  Vezetéknév
    data.keresztnev || '',                // I  Keresztnév
    data.szuletesiNev || '',              // J  Születési név
    data.allampolgarsag || '',            // K  Állampolgárság
    data.lakcim_irsz || '',               // L
    data.lakcim_varos || '',              // M
    data.lakcim_kozterulet || '',         // N
    data.lakcim_tipus || '',              // O
    data.lakcim_hazszam || '',            // P
    data.lakcim_egyeb || '',              // Q
    data.lakcim || '',                    // R
    data.ertesitesi_irsz || '',           // S
    data.ertesitesi_varos || '',          // T
    data.ertesitesi_kozterulet || '',     // U
    data.ertesitesi_tipus || '',          // V
    data.ertesitesi_hazszam || '',        // W
    data.ertesitesi_egyeb || '',          // X
    data.ertesitesiCim || '',             // Y
    data.adoazonosito || '',              // Z
    data.telefon || '',                   // AA
    data.email || '',                     // AB
    data.anyjaNeve || '',                 // AC
    data.szuletesiHely || '',             // AD
    data.szuletesiIdo || '',              // AE
    getProjectName(data),                 // AF
    data.projekt_irsz || '',              // AG
    data.projekt_varos || '',             // AH
    data.projekt_kozterulet || '',        // AI
    data.projekt_tipus || '',             // AJ
    data.projekt_hazszam || '',           // AK
    data.projekt_egyeb || '',             // AL
    data.projektCim || '',                // AM
    data.hrsz || ''                       // AN
  ];
}

function buildProjectFolderName(data) {
  return [
    data.projekt_varos,
    data.projekt_kozterulet,
    data.projekt_tipus,
    data.projekt_hazszam
  ]
    .filter(value => String(value || '').trim() !== '')
    .map(value => String(value).trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function appendProjectPostfix(name, postfix) {
  name = String(name || '').trim();
  postfix = String(postfix || '').trim();
  if (!postfix || name.endsWith(' - ' + postfix)) return name;
  const match = name.match(/^(.*?)(\.[^.]+)$/);
  return match ? match[1] + ' - ' + postfix + match[2] : name + ' - ' + postfix;
}

function normalizePlanName(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function getPlanScaleForTitle(title) {
  const name = normalizePlanName(title);
  const keyword = PLAN_SCALE_MATCH_ORDER.filter(key => name.indexOf(normalizePlanName(key)) !== -1)[0];
  return keyword ? PLAN_TYPE_SCALES[keyword] : '';
}

function sortPlanEntries(entries) {
  return entries.slice().sort((a, b) => {
    const aMatch = a.title.match(/^[A-Za-z]+-(\d+)/);
    const bMatch = b.title.match(/^[A-Za-z]+-(\d+)/);
    const aNumber = aMatch ? Number(aMatch[1]) : Infinity;
    const bNumber = bMatch ? Number(bMatch[1]) : Infinity;
    return aNumber - bNumber || a.title.localeCompare(b.title, 'hu');
  });
}

function isProjectPlanLine(text) {
  const value = String(text || '').trim();
  return /^EK-\d+\b/i.test(value) ||
    value === 'Nincs PDF tervlap a PDFA mappában.' ||
    /\t(?:M=\d|méretarány ellenőrizendő)/i.test(value);
}

function parseRoomAreaCents(value) {
  const normalized = String(value || '').replace(/\s|m²|m2/gi, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

function formatRoomArea(cents) {
  return (cents / 100).toFixed(2).replace('.', ',');
}

function parseProjectRoomText(content, sourceName) {
  const values = String(content || '').replace(/^\uFEFF/, '').split(/\r?\n/).map(line => [line]);
  const rooms = [];
  let sourceTotal = null;
  let columns = null;
  values.forEach((row, index) => {
    const cells = row[0] && row[0].indexOf('|') !== -1
      ? row[0].split('|').map(value => value.trim())
      : row.map(value => String(value).trim());
    if (cells[0] === '') cells.shift();
    if (!columns) {
      const floor = cells.findIndex(value => /helyiség szintjének neve|^szint$/i.test(value));
      const name = cells.findIndex(value => /helyiség neve|^helyiség$/i.test(value));
      const area = cells.findIndex(value => /mért terület|^terület/i.test(value));
      if (floor >= 0 && name >= 0 && area >= 0) columns = {floor, name, area};
      return;
    }
    // A régi, egyetlen cellába másolt lista az első mezőben darabszámot is tartalmaz.
    const offset = row[0] && row[0].indexOf('|') !== -1 && /^\d+$/.test(cells[0]) ? 1 : 0;
    const floor = String(cells[columns.floor + offset] || '').trim();
    const name = String(cells[columns.name + offset] || '').trim();
    const areaText = String(cells[columns.area + offset] || '').trim();
    if (floor && name && !/^-+$/.test(floor)) {
      const area = parseRoomAreaCents(areaText);
      if (area === null) throw new Error('Érvénytelen helyiségterület a ' + sourceName + ' ' + (index + 1) + '. sorában.');
      rooms.push({floor, name, area});
    } else if (!floor && !name && areaText) {
      sourceTotal = parseRoomAreaCents(areaText);
    }
  });
  if (!columns) throw new Error('A ' + sourceName + ' helyiséglista oszlopai nem ismerhetők fel.');
  if (!rooms.length) throw new Error('A ' + sourceName + ' fájlban nincs feldolgozható helyiség.');
  return {rooms, sourceTotal};
}

function buildRoomList(roomData) {
  const groups = [];
  roomData.rooms.forEach(room => {
    let group = groups.filter(item => item.floor === room.floor)[0];
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
  groups.forEach(group => {
    rows.push([group.floor, '']);
    group.rooms.forEach(room => {
      rows.push([room.name, formatRoomArea(room.area)]);
      if (/terasz/i.test(room.name)) externalArea += room.area;
    });
    rows.push([group.floor + ' összesen', formatRoomArea(group.total)]);
    total += group.total;
  });
  rows.push(['Teljes összesen', formatRoomArea(total)]);
  const fireArea = total - externalArea;
  if (externalArea) rows.push(['Terasz nélkül', formatRoomArea(fireArea)]);
  const warning = roomData.sourceTotal !== null && roomData.sourceTotal !== total
    ? '[ELLENŐRIZENDŐ: a helyiségsorok összege ' + formatRoomArea(total) +
      ' m², a forrásban megadott összesen ' + formatRoomArea(roomData.sourceTotal) + ' m².]'
    : '';
  return {rows, totalCents: total, fireAreaCents: fireArea, warning};
}

function formatBuildingValue(thousandHuf) {
  return String(thousandHuf).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function buildingValueCells(totalCents) {
  if (!Number.isInteger(totalCents) || totalCents <= 0)
    throw new Error('Az építményértékhez érvényes nettó helyiségterület szükséges.');
  const totalThousandHuf = totalCents * RESIDENTIAL_BUILDING_VALUE_THOUSAND_HUF_PER_M2 / 100;
  return [
    '600',
    formatRoomArea(totalCents) + ' m²',
    formatBuildingValue(totalThousandHuf) + ' E Ft',
    formatBuildingValue(totalThousandHuf) + ' E Ft'
  ];
}

function renderPackageOrder(label) {
  return String(label || '').toLowerCase().split('').reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 96, 0);
}

function selectCoverImage(images) {
  const valid = (images || []).filter(image => {
    if (!/^image\/(?:jpeg|png|gif)$/i.test(image.mimeType)) return false;
    return /^([a-z]+)[_\s-]+(\d+)(?=\D|$)/i.test(String(image.name || ''));
  });
  if (!valid.length) return null;
  const decorated = valid.map(image => {
    const match = String(image.name).match(/^([a-z]+)[_\s-]+(\d+)(?=\D|$)/i);
    return Object.assign({}, image, {packageOrder: renderPackageOrder(match[1]), number: Number(match[2])});
  });
  const latestOrder = Math.max(...decorated.map(image => image.packageOrder));
  const covers = decorated.filter(image => image.packageOrder === latestOrder && image.number === 1);
  if (!covers.length) throw new Error('A legfrissebb Render képcsomagból hiányzik az 1. számú kép.');
  covers.sort((a, b) => (b.updatedMs || 0) - (a.updatedMs || 0) || a.name.localeCompare(b.name, 'hu'));
  return covers[0];
}

function restartExpectedPath(path, postfix) {
  const parts = String(path).split('/');
  return parts.map((part, index) => {
    if (index < parts.length - 1 && PROJECT_SUBFOLDERS.indexOf(part) !== -1) return part;
    if (index === parts.length - 1 && part.toLowerCase() === 'helyiségek.txt') return part;
    return appendProjectPostfix(part, postfix);
  }).join('/');
}

function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(value);
  }
  return String(value);
}

function todayInBudapest(now = new Date()) {
  return formatDate(now);
}

function formatHungarianDate(now = new Date()) {
  const [year, month, day] = formatDate(now).split('-');
  return year + '. ' + month + '. ' + day + '.';
}

function getDefaultRestartPostfix(now = new Date()) {
  const [year, month] = formatDate(now).split('-');
  return 'MOD_' + year.slice(2) + month;
}

function validateRestartPostfix(postfix, now = new Date()) {
  postfix = String(postfix || '').trim() || getDefaultRestartPostfix(now);
  if (postfix.length > 60 || /[\\/<>:"|?*\x00-\x1f]/.test(postfix))
    throw new Error('Az utótag legfeljebb 60 karakter lehet, fájlnévben tiltott karakter nélkül.');
  return postfix;
}

function buildDocumentFileName(config, data, postfix = '') {
  const base = [config.title, buildProjectFolderName(data)]
    .filter(Boolean).join(' - ').replace(/\s+/g, ' ').trim();
  return appendProjectPostfix(base, postfix);
}

function getDocumentReplacements(data, extras = {}, now = new Date()) {
  const result = {
    'UID': data.uid || '',
    'Vezetéknév': data.vezeteknev || '',
    'Keresztnév': data.keresztnev || '',
    'Teljes név': [data.vezeteknev, data.keresztnev].filter(Boolean).join(' '),
    'Születési név': data.szuletesiNev || '',
    'Állampolgárság': data.allampolgarsag || '',
    'lakcim_cim': data.lakcim || '',
    'ertesitesi_cim': data.ertesitesiCim || '',
    'Adóazonosító': String(data.adoazonosito || '').replace(/\D/g, ''),
    'Telefon': data.telefon || '',
    'Email cím': data.email || '',
    'Anyja neve': data.anyjaNeve || '',
    'Születési hely': data.szuletesiHely || '',
    'Születési idő': data.szuletesiIdo || '',
    'Neve': data.projektTipus === 'Egyéb' ? (data.projektTipusEgyeb || '') : (data.projektTipus || ''),
    'projekt Irányítószám': data.projekt_irsz || '',
    'projekt Város': data.projekt_varos || '',
    'projekt Közterület': data.projekt_kozterulet || '',
    'projekt Típus': data.projekt_tipus || '',
    'projekt Házszám': data.projekt_hazszam || '',
    'projekt Egyéb': data.projekt_egyeb || '',
    'projekt_cim': data.projektCim || '',
    'Hrsz': data.hrsz || '',
    'Projekt azonosító': buildProjectFolderName(data),
    'Mai dátum': formatHungarianDate(now)
  };
  Object.keys(extras || {}).forEach(key => {
    if (!(key in result)) result[key] = extras[key];
  });
  return result;
}

function parseConditionalMarker(text) {
  const value = String(text || '').trim();
  if (value === '{{/IF}}') return {type: 'end'};
  const match = value.match(/^\{\{#IF\s+(.+?)\s*(!=|=)\s*(.*?)\s*\}\}$/);
  if (!match) return null;
  return {type: 'start', field: String(match[1] || '').trim(), operator: match[2], expected: String(match[3] || '').trim()};
}

function conditionalMatches(marker, values) {
  const actual = String(values[marker.field] == null ? '' : values[marker.field]).trim();
  const expected = String(marker.expected || '').trim();
  return marker.operator === '!=' ? actual !== expected : actual === expected;
}

function validateTechnicalProgramRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 16)
    throw new Error('A tervezési program a–p pontjai nem teljesek.');
  return rows.map((row, index) => {
    const letter = String.fromCharCode(97 + index);
    if (String(row[0]).trim() !== letter || !new RegExp('^' + letter + '\\)').test(String(row[1]).trim()))
      throw new Error('A tervezési program ' + letter + ') pontja hiányzik vagy hibás.');
    return letter;
  });
}

function expandTechnicalProgramRow(row, replacements, letter) {
  const text = String(row[1]).trim().replace(/\{\{([^}]+)\}\}/g, (marker, key) => {
    if (!(key in replacements) || String(replacements[key]).trim() === '')
      throw new Error('Hiányzó projektadat a tervezési programban: ' + key);
    return String(replacements[key]);
  });
  return text.split(/\r?\n/).filter(line => line.trim() !== '');
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = {
  FIELDS, COLUMN_COUNT, DOCUMENT_TEMPLATES, PROJECT_SUBFOLDERS,
  TEMPLATE_ROOT_FOLDER_ID, PROJECT_DATA_TEMPLATE_ID,
  PLAN_TYPE_SCALES, PLAN_SCALE_MATCH_ORDER, RESIDENTIAL_BUILDING_VALUE_THOUSAND_HUF_PER_M2,
  MERGE_INDEX_SHEET, MERGE_PREFIX,
  rowToData, projectFromRow, isClosedStatus, extractDriveId,
  getProjectName, parseProjectName, validateData, applyNotificationAddress, buildRow,
  buildProjectFolderName, appendProjectPostfix, normalizePlanName, getPlanScaleForTitle,
  sortPlanEntries, isProjectPlanLine, parseRoomAreaCents, formatRoomArea,
  parseProjectRoomText, buildRoomList, formatBuildingValue, buildingValueCells,
  renderPackageOrder, selectCoverImage, restartExpectedPath,
  formatDate, todayInBudapest, formatHungarianDate, getDefaultRestartPostfix,
  validateRestartPostfix, buildDocumentFileName, getDocumentReplacements,
  parseConditionalMarker, conditionalMatches, validateTechnicalProgramRows,
  expandTechnicalProgramRow, escapeHtml
};
