'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {technicalLineRequests} = require('../server/technical_lines.cjs');

function paragraph(start, text) {
  return {startIndex:start,endIndex:start + text.length + 1,
    paragraph:{elements:[{startIndex:start,textRun:{content:text + '\n'}}]}};
}

const document = {body:{content:[
  paragraph(100,'Szintterületi mutató: \u200B m²/m²'),
  paragraph(200,'Max. pinceszinti beépíthetőség: [KIEGÉSZÍTENDŐ: az igazolt '+
    'pinceszinti beépíthetőség az övezeti előírásból.]'),
  paragraph(300,'Építés jellege:\t\t\túj lakóépület építése')
]}};

test('Előírás nélkül a szintterületi mutató „nincs előírás”, a pinceszinti sor kimarad', () => {
  const requests = technicalLineRequests(document,{});
  assert.equal(requests[0].deleteContentRange.range.startIndex,200,
    'A dokumentum végéről visszafelé kell törölni.');
  const floorInsert = requests.find(request => request.insertText?.text === ' nincs előírás');
  assert.ok(floorInsert,'A helyére „nincs előírás” kerül.');
  const floorDelete = requests.find(request =>
    request.deleteContentRange?.range.startIndex === floorInsert.insertText.location.index);
  assert.ok(floorDelete,'A meglévő „ m²/m²” utótagot törölni kell.');
  assert.equal(floorInsert.insertText.text,' nincs előírás');
});

test('Meglévő előírásnál és igazolt pinceszinti adatnál a sorok érintetlenek', () => {
  const requests = technicalLineRequests(document,{
    'TERVEZESI_ADATOK:Munkalap1!B7':'1,5',
    'OVEZET:max_pinceszinti_beepites':'1 szint'
  });
  assert.deepEqual(requests,[]);
});
