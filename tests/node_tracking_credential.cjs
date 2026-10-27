'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTrackingCredential,readTrackingCredential}=require('../server/tracking_credential.cjs');

test('A tulajdonosi OAuth-adat titkosítva tárolható, más fiókkal vagy titokkal nem használható',()=>{
  const secret='x'.repeat(48),email='owner@example.com',token='test-refresh-token';
  const encrypted=createTrackingCredential(secret,email,token);
  assert.doesNotMatch(encrypted,/test-refresh-token|owner@example.com/);
  assert.equal(readTrackingCredential(secret,encrypted,email),token);
  assert.throws(()=>readTrackingCredential('other-secret',encrypted,email),/érvénytelen/);
  assert.throws(()=>readTrackingCredential(secret,encrypted,'other@example.com'),/érvénytelen/);
  const altered=encrypted.slice(0,40)+(encrypted[40]==='A'?'B':'A')+encrypted.slice(41);
  assert.throws(()=>readTrackingCredential(secret,altered,email),/érvénytelen/);
});
