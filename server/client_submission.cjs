'use strict';

const SHEET = '_UgyfelBekuldesek';
const HEADERS = ['UID','Ügyfél beküldte','Állapot','Hiányzó mezők JSON','Megnézve','Utolsó módosító','Módosítva'];
const filled = value => Boolean(String(value ?? '').trim());

function completeness(data) {
  const missing = [];
  const requireField = (key, label) => {if (!filled(data[key])) missing.push(label);};
  for (const [key,label] of [
    ['vezeteknev','Vezetéknév'],['keresztnev','Keresztnév'],
    ['allampolgarsag','Állampolgárság'],['adoazonosito','Adóazonosító'],
    ['telefon','Telefonszám'],['email','E-mail-cím'],
    ['anyjaNeve','Anyja neve'],['szuletesiHely','Születési hely'],
    ['szuletesiIdo','Születési idő'],['projektTipus','Projekt típusa']
  ]) requireField(key,label);
  if (data.projektTipus === 'Egyéb') requireField('projektTipusEgyeb','Egyéb projekttípus');

  function address(prefix, label, allowParcel = false) {
    const structured = ['irsz','varos','kozterulet','tipus','hazszam']
      .every(part => filled(data[`${prefix}_${part}`]));
    const foreign = data.allampolgarsag !== 'Magyar' && filled(data[`${prefix === 'lakcim' ? 'lakcim' : prefix === 'ertesitesi' ? 'ertesitesiCim' : 'projektCim'}`]);
    const parcel = allowParcel && filled(data.projekt_varos) && filled(data.hrsz);
    if (!structured && !foreign && !parcel) missing.push(label + (allowParcel ? ' (teljes cím vagy település és helyrajzi szám)' : ' (teljes cím)'));
  }
  address('lakcim','Lakóhely');
  if (!data.ertesitesi_same) address('ertesitesi','Értesítési cím');
  address('projekt','Tervezési helyszín',true);
  return {status:missing.length ? 'incomplete':'complete',missing};
}

function parseSubmission(row) {
  if (!row) return null;
  let missing = [];
  try {const parsed=JSON.parse(String(row[3] || '[]'));if (Array.isArray(parsed)) missing=parsed.filter(x=>typeof x==='string').slice(0,30);} catch (_) {}
  return {uid:String(row[0] || '').trim().toUpperCase(),submittedAt:String(row[1] || ''),
    status:row[2] === 'complete' ? 'complete':'incomplete',missing,
    seenAt:String(row[4] || ''),actor:String(row[5] || ''),updatedAt:String(row[6] || ''),
    unread:Boolean(row[1]) && (!row[4] || String(row[4]) < String(row[1]))};
}

function submissionFor(data, stored) {
  if (stored) return stored;
  if (filled(data.vezeteknev) || filled(data.keresztnev))
    return {status:'legacy',submittedAt:'',seenAt:'',missing:completeness(data).missing,unread:false};
  return {status:'not_submitted',submittedAt:'',seenAt:'',missing:[],unread:false};
}

module.exports = {SHEET,HEADERS,completeness,parseSubmission,submissionFor};
