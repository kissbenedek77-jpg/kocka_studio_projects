'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {technicalSheetValues,technicalProgramLines} = require('../server/technical_sheet.cjs');

test('Műszaki adatlap a sablon valódi celláit olvassa, a hiányzó programot alapértékkel tölti ki', () => {
  const rows = Array.from({length:20},() => Array(13).fill(''));
  rows[1][1] = 'Lke-8'; rows[1][4] = '1000'; rows[1][9] = '200';
  rows[1][12] = '0,2'; rows[4][9] = '700'; rows[4][12] = '0,7';
  const fields = technicalSheetValues(rows);
  assert.equal(fields['TERVEZESI_ADATOK:Munkalap1!B2'],'Lke-8');
  assert.equal(fields['TERVEZESI_ADATOK:Munkalap1!J5'],'700');
  assert.equal(fields['TERVEZESI_ADATOK:Munkalap1!M5'],'0,7');
  assert.equal(fields['TERVEZESI_ADATOK:Munkalap1!H5'],undefined,'A H5 címkecella, nem adat.');
  const program = Array.from({length:16},(_,index) => {
    const letter = String.fromCharCode(97+index);
    return [letter,`${letter}) ${letter === 'a' ? '{{TERVEZESI_ADATOK:Munkalap1!B2}}' : 'Kitöltött pont.'}`];
  });
  assert.equal(technicalProgramLines(program,fields)[0][0],'a) Lke-8');
  program[1][1] = '';
  const fallback = technicalProgramLines(program,fields);
  assert.match(fallback[1][0],/^A telekről részletes tervezési felmérési térkép készült\.$/);
  rows[4][12] = '#ERROR!';
  assert.throws(() => technicalSheetValues(rows),/Munkalap1!M5/);
});

test('A százalékos követelmény cellája nem duplázza a százalékjelet', () => {
  const rows = Array.from({length:20},() => Array(13).fill(''));
  rows[2][1] = '30%'; rows[4][1] = '40 %';
  const values = technicalSheetValues(rows);
  assert.equal(values['TERVEZESI_ADATOK:Munkalap1!B3'],'30');
  assert.equal(values['TERVEZESI_ADATOK:Munkalap1!B5'],'40');
  assert.equal(values['TERVEZESI_ADATOK:Munkalap1!M2'],'',
    'A képletes arányoszlop értékét nem alakítjuk át.');
});
