'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {restartPostfix,appendPostfix,copiedName,expectedPath} = require('../server/restart.cjs');

test('Újraindítás fájlnevei és elvárt útvonalai követik az Apps Script szabályait', () => {
  assert.equal(restartPostfix('',new Date('2026-09-30T12:00:00Z')),'MOD_2609');
  assert.equal(appendPostfix('EK-01 Helyszínrajz.pdf','MOD_2609'),
    'EK-01 Helyszínrajz - MOD_2609.pdf');
  assert.equal(copiedName({name:'PDFA',mimeType:'application/vnd.google-apps.folder'},'X'),'PDFA');
  assert.equal(copiedName({name:'helyiségek.txt',mimeType:'text/plain'},'X'),'helyiségek.txt');
  assert.equal(expectedPath('PDFA/EK-01 Helyszínrajz.pdf','X'),
    'PDFA/EK-01 Helyszínrajz - X.pdf');
  assert.throws(()=>restartPostfix('../bad'),/utótag/);
});
