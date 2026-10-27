'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {google} = require('googleapis');
const {googleClient} = require('../server/google.cjs');

test('Node ügyfélmentés nem írja felül a projektmappa rich text celláját', async () => {
  const originalSheets = google.sheets;
  const originalDrive = google.drive;
  const old = Array(40).fill(''); old[0] = 'ABC123'; old[2] = 'AKTÍV';
  old[4] = 'Projekt mappa'; old[6] = 'TRUE';
  let write;
  let submissionSheet = false;
  let submissionRow;
  google.sheets = () => ({spreadsheets:{
    get: async options => options.includeGridData ? {data:{sheets:[{data:[{startRow:1,
      rowData:[{values:[{hyperlink:'https://drive.google.com/drive/folders/folder-id-123'}]}]}]}]}} :
      {data:{sheets:submissionSheet ? [{properties:{title:'_UgyfelBekuldesek'}}] : []}},
    batchUpdate:async () => {submissionSheet = true; return {data:{}};},
    values:{
      get:async options => ({data:{values:options.range.includes('_UgyfelBekuldesek') ?
        (submissionRow ? [submissionRow] : []) : [old]}}),
      batchUpdate:async options => {write = options.requestBody; return {data:{}};},
      update:async options => {
        if (options.range.includes('!A2:G2')) submissionRow=options.requestBody.values[0];
        if (options.range.includes('!E2')) submissionRow[4]=options.requestBody.values[0][0];
        return {data:{}};
      },
      append:async options => {submissionRow=options.requestBody.values[0];return {data:{}};}
    }
  }});
  google.drive = () => ({});
  try {
    const client = googleClient({clientId:'test',clientSecret:'test',baseUrl:'https://node.example',
      sheetId:'client-sheet-test',sheetName:'Adatok'});
    const result = await client.saveClientData({uid:'ABC123',vezeteknev:'Kiss',keresztnev:'Anna',
      allampolgarsag:'Magyar',adoazonosito:'1234567890',projektTipus:'Új építés',
      gdprAccepted:true});
    assert.equal(result.uid, 'ABC123');
    assert.deepEqual(write.data.map(item => item.range), ["'Adatok'!A2:D2", "'Adatok'!F2:AN2"]);
    assert.equal(write.data[0].values[0][2], 'AKTÍV');
    assert.equal(write.data[1].values[0][1], true);
    assert.equal(write.data[1].values[0][2], 'Kiss');
    assert.equal(submissionRow[0], 'ABC123');
    assert.equal(submissionRow[2], 'incomplete');
    assert.equal(result.submission.unread, false);
    const partial={uid:'ABC123',vezeteknev:'Kiss',keresztnev:'Anna',
      allampolgarsag:'Magyar',adoazonosito:'1234567890',projektTipus:'Új építés',gdprAccepted:true};
    const first=await client.saveClientData(partial,'customer');
    assert.equal(first.submission.notifyOwner,true);
    assert.equal(first.submission.unread,true);
    const full={...partial,telefon:'+36-20/123-4567',email:'anna@example.com',
      anyjaNeve:'Kiss Mária',szuletesiHely:'Budapest',szuletesiIdo:'1990-01-01',
      lakcim_irsz:'1234',lakcim_varos:'Budapest',lakcim_kozterulet:'Fő',
      lakcim_tipus:'utca',lakcim_hazszam:'1',projekt_varos:'Magyaratád',hrsz:'531'};
    const completed=await client.saveClientData(full,'customer');
    assert.equal(completed.submission.status,'complete');
    assert.equal(completed.submission.notifyOwner,true);
    assert.equal((await client.saveClientData(full,'customer')).submission.notifyOwner,false);
    assert.equal((await client.markClientSubmissionRead('ABC123')).unread,false);
  } finally {
    google.sheets = originalSheets;
    google.drive = originalDrive;
  }
});
