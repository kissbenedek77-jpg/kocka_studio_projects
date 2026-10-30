'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {DEFAULT_TEXT_MODEL,modelName,assertModelName,failureText,generateContent} =
  require('../server/gemini_model.cjs');

const response = (status, body) => ({
  ok:status >= 200 && status < 300,
  status,
  json:async()=>body
});
const payload = {contents:[{parts:[{text:'próba'}]}]};
const request = (impl) => {
  const calls = [];
  const fetchImpl = async (url,options) => {
    calls.push({url,body:JSON.parse(options.body)});
    return impl(url,calls.length);
  };
  return {calls,fetchImpl};
};

test('A beállított modell 404-je automatikusan az alapmodellre esik vissza',async()=>{
  const {calls,fetchImpl} = request(async url => url.includes('/gemini-2.5-flash:')
    ? response(404,{error:{message:'models/gemini-2.5-flash is not found for API version v1beta'}})
    : response(200,{candidates:[{content:{parts:[{text:'ok'}]}}]}));
  const result = await generateContent({apiKey:'test-key',model:'gemini-2.5-flash',
    payload,fetchImpl});
  assert.equal(result.model,DEFAULT_TEXT_MODEL);
  assert.equal(result.data.candidates[0].content.parts[0].text,'ok');
  assert.equal(calls.length,2);
  assert.match(calls[1].url,new RegExp('/'+DEFAULT_TEXT_MODEL+':generateContent$'));
  assert.match(calls[1].url,/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\//);
});

test('Ha mindkét modell 404-et ad, a hiba megnevezi a modellt, a teendőt és a Google üzenetét',async()=>{
  const {calls,fetchImpl} = request(async (url) => response(404,{error:{
    message:'models/'+url.split('/models/')[1].split(':')[0]+' is not found for API version v1beta'}}));
  await assert.rejects(generateContent({apiKey:'test-key',model:'gemini-2.5-flash',payload,
    fetchImpl,setting:'GEMINI_TECHNICAL_MODEL'}), error => {
    assert.match(error.message,/gemini-2\.5-flash/);
    assert.match(error.message,/HTTP 404/);
    assert.match(error.message,/GEMINI_TECHNICAL_MODEL/);
    assert.match(error.message,new RegExp(DEFAULT_TEXT_MODEL.replace(/\./g,'\\.')));
    assert.match(error.message,/Google: models\//);
    assert.equal(error.status,502);
    return true;
  });
  assert.equal(calls.length,2,'Az alapmodellt is ki kell próbálni.');
});

test('Kvóta- és túlterhelés-hibát nem ismétel, és a felületi üzenet megtartja a HTTP kódot',async()=>{
  const {calls,fetchImpl} = request(async () => response(429,{error:{message:'quota'}}));
  await assert.rejects(generateContent({apiKey:'test-key',model:DEFAULT_TEXT_MODEL,payload,fetchImpl}),
    error => error.status === 429 && /HTTP 429/.test(error.message));
  assert.equal(calls.length,1);
  const unavailable = request(async () => response(503,{error:{message:'overloaded'}}));
  await assert.rejects(generateContent({apiKey:'test-key',model:'custom-model',payload,
    fetchImpl:unavailable.fetchImpl}), error => /HTTP 503/.test(error.message));
  assert.equal(unavailable.calls.length,1,'Az 503-at nem szabad megismételni.');
});

test('Az időtúllépés típusa megmarad, hogy a hívó külön figyelmeztethessen',async()=>{
  const fetchImpl = async () => {
    throw Object.assign(new Error('timeout'),{name:'TimeoutError'});
  };
  await assert.rejects(generateContent({apiKey:'test-key',model:DEFAULT_TEXT_MODEL,payload,
    fetchImpl}), error => error.name === 'TimeoutError');
});

test('Üres beállításnál az alapmodell, érvénytelen névnél hálózati hívás nélküli hiba',async()=>{
  assert.equal(modelName(''),DEFAULT_TEXT_MODEL);
  assert.equal(modelName('  '),DEFAULT_TEXT_MODEL);
  assert.equal(modelName('gemini-3.8-flash'),'gemini-3.8-flash');
  assert.throws(()=>assertModelName('gemini 2.5 flash'),/Érvénytelen Gemini modellnév/);
  const {calls,fetchImpl} = request(async () => response(200,{candidates:[]}));
  await assert.rejects(generateContent({apiKey:'test-key',model:'xx',payload,fetchImpl}),
    /Érvénytelen Gemini modellnév/);
  assert.equal(calls.length,0);
});

test('A hibaüzenet a beállítás nevét használja, nem keveri a hang- és szövegmodellt',()=>{
  assert.match(failureText({model:'x',status:404,detail:''},'GEMINI_AUDIO_MODEL'),
    /GEMINI_AUDIO_MODEL/);
  assert.doesNotMatch(failureText({model:'x',status:404,detail:''},'GEMINI_AUDIO_MODEL'),
    /GEMINI_TECHNICAL_MODEL/);
});
