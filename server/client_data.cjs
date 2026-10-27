'use strict';
const {FIELDS} = require('./domain.cjs');

function clientFormUrl(baseUrl, uid) {
  return `${baseUrl}/form?uid=${encodeURIComponent(uid)}`;
}

function normalizeClientInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Az ügyféladatok hiányoznak.');
  const data = {};
  for (const key of FIELDS.slice(5)) {
    if (key === 'gdprAccepted' || key === 'projektTipusStored') continue;
    const value = input[key];
    data[key] = value == null ? '' : String(value).trim();
    if (data[key].length > 10000) throw new Error('Túl hosszú adat: ' + key);
  }
  data.projektTipus = String(input.projektTipus || '').trim();
  data.projektTipusEgyeb = String(input.projektTipusEgyeb || '').trim();
  data.ertesitesi_same = input.ertesitesi_same !== false;
  data.gdprAccepted = input.gdprAccepted === true;
  for (const [key, label] of [
    ['vezeteknev','vezetéknév'], ['keresztnev','keresztnév'],
    ['allampolgarsag','állampolgárság'], ['adoazonosito','adóazonosító'],
    ['projektTipus','projekttípus']
  ]) if (!data[key]) throw new Error('Kötelező adat: ' + label + '.');
  if (data.allampolgarsag === 'Magyar' && !/^\d{10}$/.test(data.adoazonosito.replace(/\D/g, '')))
    throw new Error('Az adóazonosító jel 10 számjegyből áll.');
  if (/^egyéb$/i.test(data.projektTipus) && !data.projektTipusEgyeb)
    throw new Error('Adja meg az egyéb projekt típusát.');
  if (data.ertesitesi_same) {
    for (const key of ['irsz','varos','kozterulet','tipus','hazszam','egyeb'])
      data[`ertesitesi_${key}`] = data[`lakcim_${key}`];
    data.ertesitesiCim = data.lakcim;
  }
  data.projektTipusStored = /^egyéb$/i.test(data.projektTipus)
    ? `Egyéb: ${data.projektTipusEgyeb}` : data.projektTipus;
  return data;
}

function buildClientRow(input, uid, previous, baseUrl) {
  const data = normalizeClientInput(input);
  const old = previous || [];
  const accepted = data.gdprAccepted || old[6] === true || old[6] === 'TRUE';
  if (!accepted) throw new Error('Az adatvédelmi tájékoztató elfogadása szükséges.');
  const row = FIELDS.map(key => data[key] ?? '');
  row[0] = uid;
  row[1] = old[1] || new Date().toISOString();
  row[2] = old[2] || 'ELŐKÉSZÍTÉS';
  row[3] = clientFormUrl(baseUrl, uid);
  row[4] = old[4] || '';
  row[6] = accepted;
  return row;
}

module.exports = {clientFormUrl, normalizeClientInput, buildClientRow};
