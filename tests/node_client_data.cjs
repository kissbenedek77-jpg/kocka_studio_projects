'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {buildClientRow} = require('../server/client_data.cjs');

test('Ügyféladat-frissítés megtartja az UID-t, státuszt, mappát és az eredeti dátumot', () => {
  const old = Array(40).fill('');
  old[0] = 'ABC123'; old[1] = '2020-01-01'; old[2] = 'AKTÍV';
  old[4] = 'Projekt mappa'; old[6] = 'TRUE';
  const input = {vezeteknev:'Kiss',keresztnev:'Anna',allampolgarsag:'Magyar',
    adoazonosito:'1234567890',projektTipus:'Egyéb',projektTipusEgyeb:'Felújítás',
    lakcim:'Budapest, Fő utca 1.',ertesitesi_same:true,gdprAccepted:false};
  const row = buildClientRow(input, 'ABC123', old, 'https://example.test');
  assert.equal(row.length, 40);
  assert.deepEqual(row.slice(0,5), ['ABC123','2020-01-01','AKTÍV',
    'https://example.test/form?uid=ABC123','Projekt mappa']);
  assert.equal(row[6], true);
  assert.equal(row[24], 'Budapest, Fő utca 1.');
  assert.equal(row[31], 'Egyéb: Felújítás');
  assert.throws(() => buildClientRow({...input,adoazonosito:'123'}, 'ABC123', old,
    'https://example.test'), /10 számjegyből/);
  assert.throws(() => buildClientRow({...input,gdprAccepted:false}, 'NEW123', [],
    'https://example.test'), /adatvédelmi/);
});
