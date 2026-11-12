'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {railwayDeployer,DEFAULT_ENDPOINT} = require('../server/railway.cjs');

const serviceId = 'svc-1';
const environmentId = 'env-1';

// A hívásokat rögzítő ál-fetch: a választ a megadott függvény adja.
function fakeFetch(answer) {
  const calls = [];
  const impl = async (url,options) => {
    const body = JSON.parse(options.body);
    calls.push({url,options,body});
    return answer(body,calls.length);
  };
  impl.calls = calls;
  return impl;
}

const okResponse = data => ({ok:true,status:200,json:async()=>({data})});

test('Beállítás nélkül a deploy állapota hiányzó változókat jelez', () => {
  const deployer = railwayDeployer({});
  const state = deployer.status();
  assert.equal(state.configured,false);
  assert.deepEqual(state.missing,['RAILWAY_TOKEN','RAILWAY_SERVICE_ID','RAILWAY_ENVIRONMENT_ID']);
});

test('Projekt tokennél a Project-Access-Token fejlécet használja', async () => {
  const fetchImpl = fakeFetch(() => okResponse({serviceInstanceRedeploy:true}));
  const deployer = railwayDeployer({token:'projekt-token',serviceId,environmentId,fetchImpl});
  assert.equal(deployer.status().configured,true);
  const result = await deployer.deploy();
  assert.equal(result.ok,true);
  assert.equal(result.via,'serviceInstanceRedeploy');
  assert.equal(fetchImpl.calls.length,1);
  const call = fetchImpl.calls[0];
  assert.equal(call.url,DEFAULT_ENDPOINT);
  assert.equal(call.options.headers['Project-Access-Token'],'projekt-token');
  assert.equal(call.options.headers.Authorization,undefined);
  assert.match(call.body.query,/serviceInstanceRedeploy/);
  assert.deepEqual(call.body.variables,{serviceId,environmentId});
});

test('Fiók tokennél Authorization: Bearer fejlécet használ', async () => {
  const fetchImpl = fakeFetch(() => okResponse({serviceInstanceRedeploy:true}));
  const deployer = railwayDeployer({token:'fiok-token',tokenType:'account',serviceId,environmentId,fetchImpl});
  await deployer.deploy();
  const headers = fetchImpl.calls[0].options.headers;
  assert.equal(headers.Authorization,'Bearer fiok-token');
  assert.equal(headers['Project-Access-Token'],undefined);
});

test('Beállítás nélkül a deploy érthető hibát ad, hívás nélkül', async () => {
  const fetchImpl = fakeFetch(() => okResponse({}));
  const deployer = railwayDeployer({serviceId,environmentId,fetchImpl});
  await assert.rejects(deployer.deploy(),error => {
    assert.equal(error.status,503);
    assert.match(error.message,/RAILWAY_TOKEN/);
    return true;
  });
  assert.equal(fetchImpl.calls.length,0);
});

test('GraphQL hiba esetén a hibaüzenet nem tartalmaz tokent', async () => {
  const fetchImpl = fakeFetch(() => ({ok:true,status:200,json:async()=>({
    errors:[{message:'Not authorized'}]})}));
  const deployer = railwayDeployer({token:'titkos-token',serviceId,environmentId,fetchImpl});
  await assert.rejects(deployer.deploy(),error => {
    assert.match(error.message,/Not authorized/);
    assert.doesNotMatch(error.message,/titkos-token/);
    return true;
  });
});

test('HTTP hiba esetén a státuszkód és az üzenet is megjelenik', async () => {
  const fetchImpl = fakeFetch(() => ({ok:false,status:401,json:async()=>({
    errors:[{message:'Unauthorized'}]})}));
  const deployer = railwayDeployer({token:'x',serviceId,environmentId,fetchImpl});
  await assert.rejects(deployer.deploy(),/HTTP 401[\s\S]*Unauthorized/);
});

test('Sikertelen redeploy után projekt-azonosítóval a tartalék mutationt hívja', async () => {
  const fetchImpl = fakeFetch((body,count) => count === 1
    ? {ok:true,status:200,json:async()=>({errors:[{message:'Redeploy nem támogatott'}]})}
    : okResponse({environmentTriggersDeploy:true}));
  const deployer = railwayDeployer({token:'t',serviceId,environmentId,projectId:'proj-1',fetchImpl});
  const result = await deployer.deploy();
  assert.equal(result.via,'environmentTriggersDeploy');
  assert.equal(fetchImpl.calls.length,2);
  assert.match(fetchImpl.calls[1].body.query,/environmentTriggersDeploy/);
  assert.deepEqual(fetchImpl.calls[1].body.variables,{
    input:{projectId:'proj-1',environmentId,serviceId}});
});

test('Időtúllépéskor 504-es, érthető hiba jön', async () => {
  const fetchImpl = (url,options) => new Promise((resolve,reject) => {
    options.signal.addEventListener('abort',() => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });
  const deployer = railwayDeployer({token:'t',serviceId,environmentId,fetchImpl,timeout:10});
  await assert.rejects(deployer.deploy(),error => {
    assert.equal(error.status,504);
    assert.match(error.message,/nem válaszolt időben/);
    return true;
  });
});

test('Hálózati hiba esetén a deploy nem omlik össze', async () => {
  const fetchImpl = async () => { throw new Error('ECONNRESET'); };
  const deployer = railwayDeployer({token:'t',serviceId,environmentId,fetchImpl});
  await assert.rejects(deployer.deploy(),/nem érhető el: ECONNRESET/);
});
