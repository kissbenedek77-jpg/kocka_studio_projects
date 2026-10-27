'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateCreativeInput,generateCreativePlan}=require('../server/marketing_ai.cjs');

const png='data:image/png;base64,'+Buffer.from('mock-image').toString('base64');
const input=()=>({name:'Lakóház',brief:'Egyedi családi ház tervezés',audience:'építkezők',
  headline:'Otthontervezés',body:'Személyes építészeti tervezés.',cta:'Ajánlatkérés',
  format:'square',font:'Georgia',bodyFont:'Arial',background:'#3e3e3e',accent:'#77c59e',images:{logo:png,background:png}});

test('AI-kreatív: szerepes képek és arculati beállítások validálása',()=>{
  assert.deepEqual(validateCreativeInput(input()).images.map(image=>image.role),['logo','background']);
  assert.equal(validateCreativeInput({...input(),font:'Source Sans Pro',bodyFont:'Source Sans Pro'}).font,
    'Source Sans Pro');
  assert.throws(()=>validateCreativeInput({...input(),images:{}}),/legalább egy képet/);
  assert.throws(()=>validateCreativeInput({...input(),font:'Not a font'}),/arculati/);
  assert.throws(()=>validateCreativeInput({...input(),images:{logo:'https://external.invalid/logo.png'}}),/PNG, JPG/);
});

test('AI-kreatív: képszerepek a Gemini-kérésben, csak ellenőrzött terv kerül vissza',async()=>{
  let request;
  const fetchImpl=async(url,options)=>{request={url,options};return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({
    headline:'A te otthonod',subtitle:'Egyedi építészeti tervezés',body:'Beszéljük át a terveket.',
    cta:'Kérj ajánlatot',background:'#333333',accent:'#77c59e',style:'minimal',layout:'bottom'
  })}]}}]})}};
  const result=await generateCreativePlan(input(),{apiKey:'test-key',fetchImpl});
  assert.equal(result.plan.layout,'bottom');
  assert.equal(result.plan.headline,'A te otthonod');
  assert.match(request.url,/gemini-3\.5-flash-lite:generateContent$/);
  const body=JSON.parse(request.options.body);
  assert.deepEqual(body.contents[0].parts.filter(part=>part.inlineData).map(part=>part.inlineData.mimeType),
    ['image/png','image/png']);
  assert.match(body.contents[0].parts[0].text,/Georgia címsorbetű/);
  assert.ok(!request.options.body.includes('test-key'));
  assert.equal(request.options.headers['x-goog-api-key'],'test-key');
});

test('AI-kreatív: a Gemini 404 értelmezhető modellhibát ad a szolgáltatói részlettel',async()=>{
  await assert.rejects(generateCreativePlan(input(),{apiKey:'test-key',model:'gemini-2.5-flash',
    fetchImpl:async()=>({ok:false,status:404,json:async()=>({error:{message:'Model is not found'}})})}),
  error=>error.status===502&&/GEMINI_MARKETING_MODEL/.test(error.message)&&/Model is not found/.test(error.message));
});
