'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {google} = require('googleapis');
const {googleClient} = require('../server/google.cjs');

test('Ajánlati adatok a meglévő AO–BL oszlopokba kerülnek', async () => {
  const originalSheets = google.sheets;
  const originalDrive = google.drive;
  const row = Array(65).fill(''); row[0] = 'ABC123';
  let write;
  google.sheets = () => ({spreadsheets:{
    get:async options => options.includeGridData ? {data:{sheets:[]}} : {data:{sheets:[]}},
    values:{
      get:async () => ({data:{values:[row]}}),
      update:async options => {write = options; options.requestBody.values[0].forEach((value,index) => {
        row[40+index] = value;
      }); return {data:{}};}
    }
  }});
  google.drive = () => ({});
  try {
    const client = googleClient({clientId:'test',clientSecret:'test',baseUrl:'http://localhost',
      sheetId:'offer-test',sheetName:'Adatok'});
    await assert.rejects(client.saveOffer('ABC123',{currency:'Ft',currencyLong:'forint',
      deadline5:'-1'}), /egész napokban/);
    const state = await client.saveOffer('ABC123',{totalFee:'1000000',currency:'Ft',
      currencyLong:'forint',deadline5:'30',structuralEngineer:'Kiss Anna'});
    assert.equal(write.range, "'Adatok'!AO2:BL2");
    assert.equal(write.requestBody.values[0].length, 24);
    assert.equal(state.offer.totalFee, '1000000');
    assert.deepEqual(state.offer.peopleOptions[0], ['Kiss Anna']);
  } finally {
    google.sheets = originalSheets;
    google.drive = originalDrive;
  }
});
