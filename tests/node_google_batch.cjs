'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {google} = require('googleapis');
const {googleClient} = require('../server/google.cjs');

test('Projektfrissítéskor a kiegészítő Sheet-lapok egy batchGet hívással olvasódnak', async () => {
  const originalSheets = google.sheets;
  const originalDrive = google.drive;
  const calls = {rows:0, links:0, metadata:0, batch:0};
  google.sheets = () => ({spreadsheets:{
    get:async options => {
      if (options.includeGridData) {calls.links++; return {data:{sheets:[]}};}
      calls.metadata++;
      return {data:{sheets:[{properties:{title:'_DokumentumIndex'}},
        {properties:{title:'_ProjektJegyzetek'}}]}};
    },
    values:{
      get:async options => {
        if (!options.range.includes('Adatok')) throw new Error('Váratlan különálló Sheet-olvasás.');
        calls.rows++;
        return {data:{values:[['ABC123','','ELŐKÉSZÍTÉS']]}};
      },
      batchGet:async options => {
        calls.batch++;
        assert.equal(options.ranges.length, 2);
        return {data:{valueRanges:[{values:[]},{values:[['ABC123','2026-09-29','Korábbi jegyzet']]}]}};
      }
    }
  }});
  google.drive = () => ({files:{get:async () => {throw new Error('Nincs projektmappa.');}}});
  try {
    const client = googleClient({clientId:'test',clientSecret:'test',baseUrl:'http://localhost',
      sheetId:'batch-test-book',sheetName:'Adatok',legacyFormUrl:'https://example.com/form'});
    const first = await client.dashboardProject('ABC123');
    const second = await client.dashboardProject('ABC123');
    assert.match(first.memo, /Korábbi jegyzet/);
    assert.equal(second.uid, 'ABC123');
    assert.deepEqual(calls, {rows:1, links:1, metadata:2, batch:2});
  } finally {
    google.sheets = originalSheets;
    google.drive = originalDrive;
  }
});
