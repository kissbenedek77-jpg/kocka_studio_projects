'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {completeness,parseSubmission,submissionFor} = require('../server/client_submission.cjs');

const full = {vezeteknev:'Kiss',keresztnev:'Anna',allampolgarsag:'Magyar',
  adoazonosito:'1234567890',telefon:'+36-20/123-4567',email:'anna@example.com',
  anyjaNeve:'Teszt Mária',szuletesiHely:'Budapest',szuletesiIdo:'1990-01-01',
  projektTipus:'Új építés',lakcim_irsz:'1234',lakcim_varos:'Budapest',
  lakcim_kozterulet:'Fő',lakcim_tipus:'utca',lakcim_hazszam:'1',
  ertesitesi_same:true,projekt_varos:'Magyaratád',hrsz:'531'};

test('A teljes magyar lakcím és a település + helyrajzi szám teljes kitöltés', () => {
  assert.deepEqual(completeness(full),{status:'complete',missing:[]});
});
test('Az eltérő értesítési cím hiányát külön jelzi', () => {
  const result=completeness({...full,ertesitesi_same:false});
  assert.equal(result.status,'incomplete');
  assert.deepEqual(result.missing,['Értesítési cím (teljes cím)']);
});
test('Külföldi cím szabad szöveggel is teljes lehet', () => {
  const data={...full,allampolgarsag:'Német',lakcim:'Berlin, Beispielstrasse 2',
    lakcim_irsz:'',lakcim_varos:'',lakcim_kozterulet:'',lakcim_tipus:'',lakcim_hazszam:'',
    projekt_varos:'',hrsz:'',projektCim:'Wien, Beispielgasse 3'};
  assert.equal(completeness(data).status,'complete');
});
test('Beküldés és olvasottság külön állapot; régi rekordnál nincs hamis beküldési idő', () => {
  const row=['ABC123','2026-10-07T08:00:00.000Z','incomplete','["Telefon"]','',
    'customer','2026-10-07T08:00:00.000Z'];
  assert.equal(parseSubmission(row).unread,true);
  assert.equal(parseSubmission([...row.slice(0,4),'2026-10-07T09:00:00.000Z',...row.slice(5)]).unread,false);
  assert.equal(submissionFor(full,null).status,'legacy');
  assert.equal(submissionFor({uid:'ABC123'},null).status,'not_submitted');
});
