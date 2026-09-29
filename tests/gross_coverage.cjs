const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function editable(initial) {
  let value = initial;
  const text = {
    deleteText(start, end) { value = value.slice(0, start) + value.slice(end + 1); },
    insertText(start, insertion) { value = value.slice(0, start) + insertion + value.slice(start); },
    setForegroundColor() {}
  };
  return {getText: () => value, editAsText: () => text};
}

const gross = editable('Bruttó beépítési százalék földszinten:\t\t\t21,9% (220,99 m2)');
gross.getType = () => 'PARAGRAPH';
const tableValue = editable('21,9 %');
const table = {
  getType: () => 'TABLE',
  getNumRows: () => 1,
  getRow: () => ({
    getNumCells: () => 3,
    getCell: index => index === 0
      ? {getText: () => 'Beépítési százalék:'}
      : index === 2
        ? {getText: tableValue.getText, getChild: () => ({asParagraph: () => tableValue})}
        : {getText: () => '25 %'}
  })
};
const body = {getNumChildren: () => 2, getChild: index => [gross, table][index]};
let area = '252,3';
let percent = '22,53%';
const requested = [];
const sheet = {getRange: key => {
  requested.push(key);
  assert.ok(key === 'H2' || key === 'J2', key);
  return {getDisplayValue: () => key === 'H2' ? area : percent};
}};
const context = vm.createContext({DocumentApp: {ElementType: {PARAGRAPH: 'PARAGRAPH', TABLE: 'TABLE'}}});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Kód.js'), 'utf8'), context);

context.writeGrossCoverageToDocument_(body, sheet);
assert.equal(gross.getText(), 'Bruttó beépítési százalék földszinten:\t\t\t22,53% (252,3 m²)');
assert.equal(tableValue.getText(), '22,53%');
assert.deepEqual(requested, ['H2', 'J2']);
context.writeGrossCoverageToDocument_(body, sheet);
assert.equal(gross.getText(), 'Bruttó beépítési százalék földszinten:\t\t\t22,53% (252,3 m²)');
assert.equal(tableValue.getText(), '22,53%');

percent = '';
assert.throws(() => context.writeGrossCoverageToDocument_(body, sheet), /H2\/J2/);
console.log('Bruttó beépítési adat H2/J2 szinkron: OK');
