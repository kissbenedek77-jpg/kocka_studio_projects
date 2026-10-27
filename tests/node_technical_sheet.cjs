'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {technicalSheetValues,technicalProgramLines} = require('../server/technical_sheet.cjs');

test('Műszaki adatlap a sablon valódi celláit olvassa, hiányzó programot és hibás képletet elutasít', () => {
  const rows = Array.from({length:20},() => Array(10).fill(''));
  rows[1][1] = 'Lke-8'; rows[1][4] = '1000'; rows[1][7] = '200';
  rows[1][9] = '0,2'; rows[4][7] = '700'; rows[4][9] = '0,7';
  const fields = technicalSheetValues(rows);
  assert.equal(fields['TERVEZESI_ADATOK:Munkalap1!B2'],'Lke-8');
  assert.equal(fields['TERVEZESI_ADATOK:Munkalap1!J5'],'0,7');
  const program = Array.from({length:16},(_,index) => {
    const letter = String.fromCharCode(97+index);
    return [letter,`${letter}) ${letter === 'a' ? '{{TERVEZESI_ADATOK:Munkalap1!B2}}' : 'Kitöltött pont.'}`];
  });
  assert.equal(technicalProgramLines(program,fields)[0][0],'a) Lke-8');
  program[1][1] = '';
  assert.throws(() => technicalProgramLines(program,fields),/b\) pontja hiányzik/);
  rows[4][9] = '#ERROR!';
  assert.throws(() => technicalSheetValues(rows),/Munkalap1!J5/);
});
