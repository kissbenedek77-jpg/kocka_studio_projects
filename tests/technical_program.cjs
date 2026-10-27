'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../server/domain.cjs');
const projectSheet = require('../server/project-sheet.cjs');

function programRows(overrides = {}) {
  return Array.from({length: 16}, (_, index) => {
    const letter = String.fromCharCode(97 + index);
    const text = letter === 'a'
      ? 'a) Helyszín: {{projekt_cim}}; telek: {{TERVEZESI_ADATOK:Munkalap1!E2}} m².'
      : letter + ') Követelmény.';
    return [letter, overrides[letter] === undefined ? text : overrides[letter]];
  });
}

function fakeGoogle(rows) {
  return {
    async valuesIn(spreadsheetId, range) {
      if (range.indexOf('Tervezési program') !== -1) return rows;
      return Array.from({length: 20}, (_, row) =>
        Array.from({length: 10}, (_, column) => row === 1 && column === 4 ? '1120' : ''));
    }
  };
}

test('A tervezési program a–p pontjai és a sablonhelyőrzők ellenőrzöttek', async () => {
  const google = fakeGoogle(programRows());
  const replacements = Object.assign({projekt_cim: 'Magyaratád 531'},
    await projectSheet.getTechnicalSheetReplacements(google, 'sheet'));
  const lines = await projectSheet.getTechnicalProgramLines(google, 'sheet', replacements);
  assert.equal(lines.length, 16);
  assert.match(lines[0].join('\n'), /Helyszín: Magyaratád 531; telek: 1120 m²/);
  assert.deepEqual(lines[0].map(line => line.slice(0, 2)), ['a)']);
});

test('Hiányzó pont vagy kitöltetlen helyőrző hibát ad', async () => {
  await assert.rejects(
    () => projectSheet.getTechnicalProgramLines(fakeGoogle(programRows({g: ''})), 'sheet',
      {projekt_cim: 'Magyaratád 531', 'TERVEZESI_ADATOK:Munkalap1!E2': '1120'}),
    /g\) pontja hiányzik/);
  await assert.rejects(
    () => projectSheet.getTechnicalProgramLines(fakeGoogle(programRows()), 'sheet', {projekt_cim: ''}),
    /Hiányzó projektadat/);
});

test('A program sorai a dokumentum pontjai alá kerülnek', () => {
  const rows = programRows();
  assert.deepEqual(domain.validateTechnicalProgramRows(rows).length, 16);
  const expanded = domain.expandTechnicalProgramRow(rows[0], {
    projekt_cim: 'Magyaratád 531', 'TERVEZESI_ADATOK:Munkalap1!E2': '1120'
  }, 'a');
  assert.equal(expanded.length, 1);
  assert.match(expanded[0], /^a\) Helyszín: Magyaratád 531; telek: 1120 m²\.$/);
});
