'use strict';

// MARK: A meglévő Adatok munkalap A–AN oszlopainak változatlan megfeleltetése
const FIELDS = [
  'uid', 'createdAt', 'status', 'clientLink', 'projectFolderUrl', 'language', 'gdprAccepted',
  'vezeteknev', 'keresztnev', 'szuletesiNev', 'allampolgarsag',
  'lakcim_irsz', 'lakcim_varos', 'lakcim_kozterulet', 'lakcim_tipus', 'lakcim_hazszam', 'lakcim_egyeb', 'lakcim',
  'ertesitesi_irsz', 'ertesitesi_varos', 'ertesitesi_kozterulet', 'ertesitesi_tipus', 'ertesitesi_hazszam', 'ertesitesi_egyeb', 'ertesitesiCim',
  'adoazonosito', 'telefon', 'email', 'anyjaNeve', 'szuletesiHely', 'szuletesiIdo',
  'projektTipusStored', 'projekt_irsz', 'projekt_varos', 'projekt_kozterulet', 'projekt_tipus', 'projekt_hazszam', 'projekt_egyeb', 'projektCim', 'hrsz'
];

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
  const closed = /^(KÉSZ|KESZ|LEZÁRT|LEZART)$/i.test(status);
  return {
    uid: String(data.uid).trim().toUpperCase(),
    name: String(data.projektCim || data.projekt_varos || 'Új projekt').trim(),
    clientName: [data.vezeteknev, data.keresztnev].filter(Boolean).join(' '),
    status, stage: closed ? 'closed' : data.projectFolderUrl ? 'preparation' : 'none',
    closed, order: rowNumber
  };
}

function extractDriveId(value) {
  const text = String(value || '');
  const match = text.match(/(?:\/folders\/|[?&]id=)([A-Za-z0-9_-]{10,128})/);
  return match ? match[1] : /^[A-Za-z0-9_-]{10,128}$/.test(text) ? text : '';
}

module.exports = {FIELDS, rowToData, projectFromRow, extractDriveId};
