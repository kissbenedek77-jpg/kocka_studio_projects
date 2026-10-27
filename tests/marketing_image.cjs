'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {modelStatus,validateImageInput,generateMarketingImage}=require('../server/marketing_image.cjs');

const jpeg=Buffer.from([0xff,0xd8,0xff,0xd9]).toString('base64');

test('képkészítő modellek beállítási állapota és bemenet',()=>{
  const absent=modelStatus({});assert.equal(absent[0].available,true);
  assert.equal(absent[1].available,false);assert.match(absent[1].reason,/CLOUDFLARE_AI_TOKEN/);
  assert.equal(modelStatus({CLOUDFLARE_ACCOUNT_ID:'account',CLOUDFLARE_AI_TOKEN:'token'})[2].available,true);
  assert.equal(modelStatus({})[3].available,false);
  assert.equal(modelStatus({GEMINI_API_KEY:'key'})[3].available,true);
  assert.throws(()=>validateImageInput({model:'other',prompt:'ház',format:'square'}),/támogatott/);
  assert.throws(()=>validateImageInput({model:'flux-1-schnell',prompt:'',format:'square'}),/képleírást/);
});

test('Gemini képgenerálás képet ad vissza a kiválasztott aránnyal és referenciával',async()=>{
  let request;
  const result=await generateMarketingImage({model:'gemini-image',prompt:'modern ház',format:'story',
    references:['data:image/jpeg;base64,'+jpeg]},
  {apiKey:'test-key',fetchImpl:async(url,options)=>{request={url,options};return {ok:true,status:200,
    json:async()=>({candidates:[{content:{parts:[{inlineData:{mimeType:'image/jpeg',data:jpeg}}]}}]})}}});
  assert.match(request.url,/gemini-3\.1-flash-lite-image:generateContent$/);
  assert.equal(request.options.headers['x-goog-api-key'],'test-key');
  const body=JSON.parse(request.options.body);
  assert.deepEqual(body.generationConfig.responseModalities,['IMAGE']);
  assert.equal(body.generationConfig.imageConfig.aspectRatio,'9:16');
  assert.equal(body.contents[0].parts[1].inlineData.mimeType,'image/jpeg');
  assert.equal(result.image,'data:image/jpeg;base64,'+jpeg);
});

test('FLUX.1 JSON kérés, FLUX.2 multipart referenciával',async()=>{
  const seen=[];const fetchImpl=async(url,options)=>{seen.push({url,options});return {ok:true,status:200,
    json:async()=>({success:true,result:{image:jpeg}})}};
  const config={accountId:'account',token:'secret',fetchImpl};
  const first=await generateMarketingImage({model:'flux-1-schnell',prompt:'modern ház',format:'square'},config);
  assert.match(first.image,/^data:image\/jpeg;base64,/);
  assert.match(seen[0].url,/flux-1-schnell$/);
  assert.deepEqual(JSON.parse(seen[0].options.body),{prompt:'modern ház',steps:4});
  assert.equal(seen[0].options.headers.Authorization,'Bearer secret');
  assert.ok(!JSON.stringify(seen[0].options.body).includes('secret'));
  await generateMarketingImage({model:'flux-2-klein-4b',prompt:'modern ház',format:'portrait',
    references:['data:image/jpeg;base64,'+jpeg]},config);
  assert.match(seen[1].url,/flux-2-klein-4b$/);
  assert.equal(seen[1].options.body.get('width'),'768');
  assert.equal(seen[1].options.body.get('input_image_0').type,'image/jpeg');
});

test('szolgáltatói hibák teendővel jelennek meg',async()=>{
  const base={model:'flux-1-schnell',prompt:'modern ház',format:'square'};
  await assert.rejects(generateMarketingImage(base,{accountId:'account',token:'token',
    fetchImpl:async()=>({ok:false,status:429,json:async()=>({success:false})})}),
  /napi ingyenes kerete/);
  await assert.rejects(generateMarketingImage(base,{accountId:'account',token:'token',
    fetchImpl:async()=>({ok:false,status:403,json:async()=>({success:false})})}),
  /Workers AI jogosultságát/);
  await assert.rejects(generateMarketingImage(base,{accountId:'account',token:'token',
    fetchImpl:async()=>({ok:false,status:400,json:async()=>({success:false,
      errors:[{message:"Additional or unevaluated properties '/width, /height' at '/' not allowed"}]})})}),
  /alkalmazás kérésformátumát kell javítani/);
});
