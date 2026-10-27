'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {google} = require('googleapis');
const {googleClient} = require('../server/google.cjs');

test('Node jegyzetmentés a meglévő UID-hez és Apps Script munkalaphoz igazodik', async () => {
  const originalSheets = google.sheets;
  const originalDrive = google.drive;
  const calls = [];
  let memoExists = false;
  let memoRows = [];
  google.sheets = () => ({spreadsheets:{
    get:async options => {
      if (options.includeGridData) return {data:{sheets:[]}};
      return {data:{sheets:memoExists ? [{properties:{title:'_ProjektMemo'}}] : []}};
    },
    batchUpdate:async options => {calls.push(['create', options.requestBody]); memoExists = true; return {data:{}};},
    values:{
      get:async options => ({data:{values:options.range.includes('Adatok')
        ? [['ABC123']] : options.range.includes('A2:A') ? memoRows : []}}),
      update:async options => {calls.push(['update', options.range, options.requestBody.values]); return {data:{}};},
      append:async options => {calls.push(['append', options.range, options.requestBody.values]); memoRows.push([options.requestBody.values[0][0]]); return {data:{}};}
    }
  }});
  google.drive = () => ({});
  try {
    const client = googleClient({clientId:'test',clientSecret:'test',baseUrl:'http://localhost',sheetId:'book',sheetName:'Adatok'});
    assert.equal(await client.saveMemo('abc123', 'Első jegyzet'), 'Első jegyzet');
    assert.equal(calls[0][0], 'create');
    assert.equal(calls[0][1].requests[0].addSheet.properties.hidden, true);
    assert.equal(calls.find(call => call[0] === 'append')[2][0][0], 'ABC123');
    assert.equal(await client.saveMemo('ABC123', 'Frissített jegyzet'), 'Frissített jegyzet');
    assert.equal(calls.at(-1)[1], "'_ProjektMemo'!B2:C2");
    assert.equal(calls.at(-1)[2][0][0], 'Frissített jegyzet');
    await assert.rejects(client.saveMemo('NINCS', 'x'), /nem található/);
    await assert.rejects(client.saveMemo('ABC123', 'x'.repeat(50001)), /50 000/);
  } finally {
    google.sheets = originalSheets;
    google.drive = originalDrive;
  }
});
