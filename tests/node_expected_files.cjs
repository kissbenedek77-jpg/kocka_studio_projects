'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {google} = require('googleapis');
const {googleClient} = require('../server/google.cjs');

test('A Node elvárt fájllistát a meglévő projekt UID-jéhez menti', async () => {
  const originalSheets = google.sheets;
  const originalDrive = google.drive;
  const calls = [];
  let exists = false;
  let saved = '';
  const row = ['ABC123'];
  google.sheets = () => ({spreadsheets:{
    get: async options => options.includeGridData ? {data:{sheets:[]}} :
      {data:{sheets:exists ? [{properties:{title:'_ProjektElvártFájlok'}}] : []}},
    batchUpdate: async options => {calls.push(['create', options.requestBody]); exists = true; return {data:{}};},
    values:{
      get: async options => ({data:{values:options.range.includes('Adatok') ? [row] :
        options.range.endsWith('A2:A') && saved ? [['ABC123']] : []}}),
      batchGet: async () => ({data:{valueRanges:[{values:[['ABC123', saved, 'now']]}]}}),
      update: async options => {calls.push(['update', options.range, options.requestBody.values]);
        if (options.range.includes('!B2:C2')) saved = options.requestBody.values[0][0]; return {data:{}};},
      append: async options => {calls.push(['append', options.range, options.requestBody.values]);
        saved = options.requestBody.values[0][1]; return {data:{}};}
    }
  }});
  google.drive = () => ({});
  try {
    const client = googleClient({clientId:'test',clientSecret:'test',baseUrl:'http://localhost',
      sheetId:'expected-files-test',sheetName:'Adatok'});
    const first = await client.saveExpectedFiles('abc123', 'PDFA/alaprajz.pdf\n\nPDFA/metszet.pdf');
    assert.equal(first.expectedFiles, 'PDFA/alaprajz.pdf\nPDFA/metszet.pdf');
    assert.equal(calls.find(call => call[0] === 'create')[1].requests[0].addSheet.properties.hidden, true);
    assert.deepEqual(calls.find(call => call[0] === 'append')[2][0].slice(0, 2),
      ['ABC123','PDFA/alaprajz.pdf\nPDFA/metszet.pdf']);
    const second = await client.saveExpectedFiles('ABC123', 'PDFA/helyszinrajz.pdf');
    assert.equal(second.expectedFiles, 'PDFA/helyszinrajz.pdf');
    assert.equal(calls.at(-1)[1], "'_ProjektElvártFájlok'!B2:C2");
    await assert.rejects(client.saveExpectedFiles('ABC123', '../titok'), /Érvénytelen/);
    await assert.rejects(client.saveExpectedFiles('NINCS', 'PDFA/fajl.pdf'), /nem található/);
  } finally {
    google.sheets = originalSheets;
    google.drive = originalDrive;
  }
});
