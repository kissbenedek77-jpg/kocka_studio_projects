'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createQuotaGuard} = require('../server/quota.cjs');
const {createRequestCache} = require('../server/cache.cjs');

test('A Google-hívás a helyi keret elérésekor nem indul el', async () => {
  let time = 0, calls = 0;
  const quota = createQuotaGuard({sheetsRead:{windowMs:60000,limit:2}}, () => time);
  await quota.run('sheetsRead',1,() => {calls++;});
  await quota.run('sheetsRead',1,() => {calls++;});
  await assert.rejects(quota.run('sheetsRead',1,() => {calls++;}), error => error.status === 429);
  assert.equal(calls, 2);
  time = 60000;
  await quota.run('sheetsRead',1,() => {calls++;});
  assert.equal(calls, 3);
});

test('A Drive perces és napi kerete együtt, részleges foglalás nélkül érvényesül', async () => {
  const quota = createQuotaGuard({
    driveMinute:{windowMs:60000,limit:200},
    driveDay:{windowMs:86400000,limit:150}
  }, () => 0);
  await quota.run('drive',100,() => {});
  await assert.rejects(quota.run('drive',100,() => {}), error => error.status === 429);
  await quota.run('drive',50,() => {});
});

test('Azonos olvasások egy kéréssé állnak össze és a lejárat után frissülnek', async () => {
  let time = 0, calls = 0;
  const cache = createRequestCache(() => time);
  const load = async () => {calls++; return {value:calls};};
  const [first, second] = await Promise.all([cache.get('row',1000,load),cache.get('row',1000,load)]);
  assert.equal(first, second);
  assert.equal(calls, 1);
  time = 1000;
  assert.equal((await cache.get('row',1000,load)).value, 2);
  cache.clear('row');
  assert.equal((await cache.get('row',1000,load)).value, 3);
});
