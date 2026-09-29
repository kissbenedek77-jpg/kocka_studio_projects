const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const programRows = Array.from({length: 16}, (_, i) => {
  const letter = String.fromCharCode(97 + i);
  return [letter, `${letter}) ${letter === 'a' ? 'Helyszín: {{projekt_cim}}; telek: {{TERVEZESI_ADATOK:Munkalap1!E2}} m².' : 'Követelmény.'}`];
});
const programSheet = {getRange: () => ({getDisplayValues: () => programRows})};
const summarySheet = {getRange: () => ({getDisplayValues: () => Array.from({length: 20}, (_, r) =>
  Array.from({length: 10}, (_, c) => r === 1 && c === 4 ? '1120' : ''))})};
const spreadsheet = {getSheetByName: name => name === 'Tervezési program' ? programSheet : summarySheet};
function paragraph(value) {
  let text = value;
  return {getType: () => 'PARAGRAPH', getText: () => text, asParagraph() { return this; },
    editAsText: () => ({setFontFamily() { return this; }, setFontSize() { return this; },
      setForegroundColor() { return this; }})};
}
const children = [paragraph('Előző fejezet'), paragraph('Tervezési program (266/2013. rendelet szerint)'),
  paragraph('Elavult program'), paragraph('Zöldterület számítása'), paragraph('Következő szakasz')];
const body = {getNumChildren: () => children.length, getChild: i => children[i],
  removeChild: child => children.splice(children.indexOf(child), 1),
  insertParagraph(index, value) { const child = paragraph(value); children.splice(index, 0, child); return child; }};
const context = vm.createContext({DocumentApp: {openById: () => ({getBody: () => body, saveAndClose() {}}),
  ElementType: {PARAGRAPH: 'PARAGRAPH'}}});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Kód.js'), 'utf8'), context);
context.getDocumentReplacements = () => ({projekt_cim: 'Magyaratád 531'});
const replacements = {...context.getDocumentReplacements(), ...context.getTechnicalSheetReplacements_(spreadsheet)};
assert.equal(context.getTechnicalProgramLines_(spreadsheet, replacements).length, 16);
context.refreshTechnicalProgram_('doc', spreadsheet, {});
assert.equal(children[0].getText(), 'Előző fejezet');
assert.equal(children.at(-2).getText(), 'Zöldterület számítása');
assert.equal(children.at(-1).getText(), 'Következő szakasz');
assert.match(children[2].getText(), /Magyaratád 531; telek: 1120 m²/);
assert.equal(children.filter(x => /^[a-p]\)/.test(x.getText())).length, 16);
assert(!children.some(x => x.getText() === 'Elavult program'));
programRows[6][1] = '';
assert.throws(() => context.getTechnicalProgramLines_(spreadsheet, replacements), /g\) pontja hiányzik/);
console.log('Projektadatlapból épülő tervezési program: OK');
