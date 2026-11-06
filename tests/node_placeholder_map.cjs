'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {placeholderTarget,MUNKALAP_INPUT_CELLS,ADDRESS_PARTS,composeAddress} =
  require('../server/placeholder_map.cjs');

test('A tervezési adatlap beviteli cellái szerkeszthetők, a képletek nem', () => {
  for (const cell of ['B2','B3','E2','J7','F9']) {
    assert.deepEqual(placeholderTarget(`TERVEZESI_ADATOK:Munkalap1!${cell}`),
      {type:'munkalap',cell});
  }
  for (const cell of ['L2','M2','L5','M5','L7','M7','J5']) {
    assert.equal(placeholderTarget(`TERVEZESI_ADATOK:Munkalap1!${cell}`),null,
      `A(z) ${cell} képlet, ezért nem írható felül.`);
    assert.equal(MUNKALAP_INPUT_CELLS.has(cell),false);
  }
});

test('Az ügyféladatok és a műszaki mezők a forráshelyükre mutatnak', () => {
  assert.deepEqual(placeholderTarget('Hrsz'),
    {type:'client',field:'hrsz',column:39});
  assert.deepEqual(placeholderTarget('telepules'),
    {type:'client',field:'projekt_varos',column:33});
  assert.deepEqual(placeholderTarget('TERV_TARGYA'),
    {type:'field',key:'TERV_TARGYA'});
  assert.equal(placeholderTarget('TERVJEGYZEK'),null);
  assert.equal(placeholderTarget('szintek'),null);
  assert.deepEqual(ADDRESS_PARTS,{projekt_varos:'projektCim'});
});

test('A város módosításakor a teljes projektcím újraépül', () => {
  const address = composeAddress({projekt_irsz:'7200',projekt_varos:'Dombóvár',
    projekt_kozterulet:'Dáró',projekt_tipus:'utca',projekt_hazszam:'7',
    projekt_egyeb:''});
  assert.equal(address,'7200 Dombóvár, Dáró utca 7');
  assert.equal(composeAddress({projekt_irsz:'7200',projekt_varos:'Dombóvár',
    projekt_kozterulet:'Dáró',projekt_tipus:'utca',projekt_hazszam:'7',
    projekt_egyeb:'hrsz.: 6272'}),'7200 Dombóvár, Dáró utca 7 hrsz.: 6272');
});
