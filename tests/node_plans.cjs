'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {planScale, scaleFromText, resolvePlanScale, planScaleWarning} =
  require('../server/plans.cjs');

test('A léptéket a tervlap „M = 1:XXX” feliratából olvassa ki', () => {
  assert.equal(scaleFromText('EK-01 Helyszínrajz M = 1:200'),'M=1:200');
  assert.equal(scaleFromText('M=1:50'),'M=1:50');
  assert.equal(scaleFromText('m = 1 : 500'),'M=1:500');
  assert.equal(scaleFromText('M  =  1:12.5'),'M=1:12.5');
  // Az XXX változó: nem csak az ismert fájlnév-kulcsszavakhoz tartozó érték.
  assert.equal(scaleFromText('M = 1:333'),'M=1:333');
  // Több felirat esetén a leggyakoribb a jellemző, holtversenynél az első.
  assert.equal(scaleFromText('M = 1:100 … M = 1:200 … M = 1:100'),'M=1:100');
  assert.equal(scaleFromText('M = 1:100 … M = 1:200'),'M=1:100');
});

test('Egy feliratban több lépték is szerepelhet, a címszóblokk szerint', () => {
  assert.equal(scaleFromText('M = 1:500, 1:200'),'M=1:500, 1:200');
  assert.equal(scaleFromText('M = 1:1,160, 1:50'),'M=1:1,160, 1:50');
  assert.equal(scaleFromText('M=1:20;1:50'),'M=1:20, 1:50');
  assert.equal(scaleFromText('M = 1:500'),'M=1:500');
});

test('Csak az „M = 1:XXX” felirat számít, a csupasz 1:XXX nem', () => {
  assert.equal(scaleFromText('1:200'),'');
  assert.equal(scaleFromText('Lépték: 1:50'),'');
  assert.equal(scaleFromText(''),'');
  assert.equal(scaleFromText(null),'');
});

test('A fájlnév csak tartalék, a tervlapi felirat élvez elsőbbséget', () => {
  const fromPdf = resolvePlanScale('EK-03 Földszinti alaprajz','M = 1:333');
  assert.deepEqual(fromPdf,{scale:'M=1:333',source:'pdf',assumed:false});
  const fromName = resolvePlanScale('EK-03 Földszinti alaprajz','');
  assert.deepEqual(fromName,{scale:'M=1:50',source:'name',assumed:true});
  const unknown = resolvePlanScale('scan_0012','');
  assert.deepEqual(unknown,{scale:'',source:'',assumed:false});
});

test('Bizonytalanság esetén a figyelmeztetés nevezi meg a tervlapot és a becsült léptéket', () => {
  const assumed = planScaleWarning('EK-03 Földszinti alaprajz',
    resolvePlanScale('EK-03 Földszinti alaprajz',''),'a PDF szövege nem olvasható');
  assert.match(assumed,/EK-03 Földszinti alaprajz/);
  assert.match(assumed,/M = 1:XXX/);
  assert.match(assumed,/M=1:50/);
  assert.match(assumed,/feltételezett/);
  assert.match(assumed,/a PDF szövege nem olvasható/);
  const missing = planScaleWarning('scan_0012',resolvePlanScale('scan_0012',''));
  assert.match(missing,/scan_0012/);
  assert.match(missing,/lépték nélkül/);
  const certain = planScaleWarning('EK-01 Helyszínrajz',
    resolvePlanScale('EK-01 Helyszínrajz','M = 1:200'));
  assert.equal(certain,'');
  assert.equal(planScale('EK-01 Helyszínrajz'),'M=1:200');
});
