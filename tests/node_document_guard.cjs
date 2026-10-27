'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {google} = require('googleapis');
const {googleClient} = require('../server/google.cjs');

test('Feltételes Docs sablonból nem készül hiányos másolat', async () => {
  const originalSheets = google.sheets;
  const originalDrive = google.drive;
  const originalDocs = google.docs;
  const row = Array(65).fill(''); row[0] = 'ABC123';
  let copied = false;
  google.sheets = () => ({spreadsheets:{
    get:async options => options.includeGridData ? {data:{sheets:[]}} : {data:{sheets:[]}},
    values:{get:async options => ({data:{values:options.range.includes('AO1') ? [[]] : [row]}})}
  }});
  google.drive = () => ({files:{copy:async () => {copied = true; return {data:{id:'copy'}};}}});
  google.docs = () => ({documents:{get:async () => ({data:{body:{content:[{paragraph:{
    elements:[{startIndex:1,textRun:{content:'{{#IF Neve=Új építés}}\n'}}]}}]}}})}});
  try {
    const client = googleClient({clientId:'test',clientSecret:'test',baseUrl:'http://localhost',
      sheetId:'document-guard-test',sheetName:'Adatok'});
    await assert.rejects(client.ensureDocument('ABC123','ajanlat'), /feltételes/);
    assert.equal(copied,false);
  } finally {
    google.sheets = originalSheets;
    google.drive = originalDrive;
    google.docs = originalDocs;
  }
});
