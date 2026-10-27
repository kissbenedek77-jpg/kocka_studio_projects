'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {mergeRequests, documentValues} = require('../server/doc_merge.cjs');

test('Docs sablonmezők névvel jelölt tartományként frissülnek', () => {
  const values = documentValues({uid:'ABC123',vezeteknev:'Kiss',keresztnev:'Anna',
    projektTipus:'Új építés'});
  const document = {body:{content:[{paragraph:{elements:[{startIndex:1,
    textRun:{content:'Ügyfél: {{Teljes név}}\n'}}]}}]},
    namedRanges:{KOCKA_MERGE_UID:{name:'KOCKA_MERGE_UID',namedRanges:[]}}};
  const requests = mergeRequests(document,values);
  assert.deepEqual(requests[0],{createNamedRange:{name:'KOCKA_MERGE_Teljes név',
    range:{startIndex:9,endIndex:23}}});
  assert.deepEqual(requests[1],{replaceNamedRangeContent:{
    namedRangeName:'KOCKA_MERGE_Teljes név',text:'Kiss Anna'}});
  assert.deepEqual(requests[2],{replaceNamedRangeContent:{
    namedRangeName:'KOCKA_MERGE_UID',text:'ABC123'}});
  assert.throws(() => mergeRequests({body:{content:[{paragraph:{elements:[{startIndex:1,
    textRun:{content:'{{#IF Neve=Új építés}}'}}]}}]}},values), /feltételes/);
});
