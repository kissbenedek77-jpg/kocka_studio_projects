'use strict';

const MODELS={
  local:{label:'Helyi grafika (demó)',provider:'browser'},
  'flux-1-schnell':{label:'FLUX.1 schnell · új háttér',provider:'cloudflare',id:'@cf/black-forest-labs/flux-1-schnell'},
  'flux-2-klein-4b':{label:'FLUX.2 klein 4B · képreferenciával',provider:'cloudflare',id:'@cf/black-forest-labs/flux-2-klein-4b'},
  'gemini-image':{label:'Gemini 3.1 Flash Lite Image · képreferenciával',provider:'gemini',id:'gemini-3.1-flash-lite-image'}
};
const IMAGE_RE=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const fail=(status,message)=>Object.assign(new Error(message),{status});

function modelStatus(env=process.env){
  const ready=Boolean(env.CLOUDFLARE_ACCOUNT_ID&&env.CLOUDFLARE_AI_TOKEN);
  return Object.entries(MODELS).map(([id,model])=>({id,label:model.label,
    available:model.provider==='browser'||(model.provider==='gemini'?Boolean(env.GEMINI_API_KEY):ready),
    reason:model.provider==='browser'?'A böngészőben, API-kulcs nélkül működik.':model.provider==='gemini'?
      (env.GEMINI_API_KEY?'Beállítva. Valódi képgenerálás; a Gemini fizetős kvótájába számít.':'Hiányzó GEMINI_API_KEY a Railway Variables között. A képgeneráló modellhez fizetős Gemini API-hozzáférés szükséges.'):
      ready?
      'Beállítva. A tényleges elérhetőség az első generáláskor ellenőrizhető.':
      'Hiányzó Cloudflare beállítás. A Railway Variables között állítsd be a CLOUDFLARE_ACCOUNT_ID és CLOUDFLARE_AI_TOKEN változót, majd telepítsd újra a szolgáltatást.'}));
}

function validateImageInput(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||!MODELS[value.model]||value.model==='local')
    throw fail(400,'Válassz támogatott AI-képmodellt.');
  if(typeof value.prompt!=='string'||!value.prompt.trim()||value.prompt.length>1800)
    throw fail(400,'Adj meg legfeljebb 1800 karakteres képleírást.');
  if(!['square','portrait','story','landscape'].includes(value.format))throw fail(400,'Érvénytelen képarány.');
  const references=[];
  if(value.references!==undefined){
    if(!Array.isArray(value.references)||value.references.length>2)throw fail(400,'Legfeljebb két képreferencia adható meg.');
    for(const source of value.references){
      if(typeof source!=='string')throw fail(400,'Érvénytelen képreferencia.');
      const match=IMAGE_RE.exec(source);
      if(!match)throw fail(400,'Csak PNG, JPG vagy WebP képreferencia használható.');
      const bytes=Buffer.from(match[2],'base64');
      if(!bytes.length||bytes.length>700000||bytes.toString('base64')!==match[2])
        throw fail(400,'A képreferencia túl nagy vagy sérült.');
      references.push({mime:match[1],bytes});
    }
  }
  return {model:value.model,prompt:value.prompt.trim(),format:value.format,references};
}

function providerError(status,payload){
  const detail=String(payload?.errors?.[0]?.message||payload?.error?.message||payload?.error||'').slice(0,200);
  if(status===401||status===403)return fail(502,'A Cloudflare elutasította a hozzáférést (HTTP '+status+'). Ellenőrizd a CLOUDFLARE_AI_TOKEN érvényességét, Workers AI jogosultságát és a CLOUDFLARE_ACCOUNT_ID értékét. Ha a modell fizetős csomagot kér, válassz másikat vagy engedélyezd a megfelelő csomagot.'+(detail?' Részlet: '+detail:''));
  if(status===429)return fail(429,'A Cloudflare napi ingyenes kerete vagy sebességkorlátja elfogyott. Próbáld később, vagy ellenőrizd a Workers AI használatát a Cloudflare felületén.');
  if(status===400&&/Additional or unevaluated properties|not allowed/i.test(detail))
    return fail(502,'A Cloudflare modell elutasított egy nem támogatott API-paramétert. Az alkalmazás kérésformátumát kell javítani és újratelepíteni; a képleírás módosítása nem segít.'+(detail?' Részlet: '+detail:''));
  if(status===400)return fail(502,'A Cloudflare nem fogadta el a modell kérését. Ellenőrizd a képleírást és a feltöltött referenciaképet.'+(detail?' Részlet: '+detail:''));
  if(status>=500)return fail(502,'A Cloudflare képgenerálás átmenetileg nem elérhető (HTTP '+status+'). Próbáld később vagy válaszd a helyi grafikát.');
  return fail(502,'A Cloudflare képgenerálás nem sikerült (HTTP '+status+').'+(detail?' Részlet: '+detail:''));
}

function imageResult(model,image){
  if(typeof image!=='string'||!image.length||image.length>9000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(image))
    throw fail(502,'A képgeneráló szolgáltatás nem adott használható képet. Válassz másik modellt vagy próbáld újra.');
  const bytes=Buffer.from(image,'base64');
  const mime=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':
    bytes[0]===0xff&&bytes[1]===0xd8?'image/jpeg':
    bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;
  if(!mime)throw fail(502,'A képgeneráló szolgáltatás nem támogatott képformátumot adott.');
  return {model,image:'data:'+mime+';base64,'+image};
}

async function generateGeminiImage(data,{apiKey,fetchImpl}){
  if(!apiKey)throw fail(503,'A Gemini képgeneráláshoz GEMINI_API_KEY szükséges a Railway Variables között.');
  const ratios={square:'1:1',portrait:'4:5',story:'9:16',landscape:'16:9'};
  const parts=[{text:data.prompt+' Készíts önálló hirdetési háttérképet, olvasható feliratok, logó és vízjel nélkül. A képen maradjon hely a később ráhelyezett szövegnek.'}];
  data.references.forEach(ref=>parts.push({inlineData:{mimeType:ref.mime,data:ref.bytes.toString('base64')}}));
  let response;
  try{response=await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models/'+MODELS[data.model].id+':generateContent',{
    method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
    body:JSON.stringify({contents:[{parts}],generationConfig:{responseModalities:['IMAGE'],
      imageConfig:{aspectRatio:ratios[data.format]}}}),signal:AbortSignal.timeout(90000)});
  }catch(error){throw fail(error.name==='TimeoutError'||error.name==='AbortError'?504:502,
    error.name==='TimeoutError'||error.name==='AbortError'?'A Gemini képgenerálás időtúllépés miatt megszakadt.':'A Gemini képgenerálás nem érhető el. Ellenőrizd a Railway hálózati kapcsolatát.');}
  let payload;try{payload=await response.json()}catch{throw fail(502,'A Gemini nem értelmezhető választ adott.')}
  if(!response.ok){const detail=String(payload?.error?.message||'').slice(0,250);
    const action=response.status===404?'Ellenőrizd, hogy a gemini-3.1-flash-lite-image modell elérhető-e az API-kulcs projektjében.':
      response.status===402?'Ellenőrizd a Gemini API számlázását és egyenlegét.':
      response.status===429?'A Gemini kvótája betelt; próbáld később.':
      response.status===401||response.status===403?'Ellenőrizd a GEMINI_API_KEY értékét és jogosultságát.':'Ellenőrizd a modell kérését.';
    throw fail(response.status===429?429:502,'A Gemini képgenerálás nem sikerült (HTTP '+response.status+'). '+action+(detail?' Részlet: '+detail:''));}
  const image=payload?.candidates?.[0]?.content?.parts?.find(part=>part.inlineData?.data)?.inlineData?.data;
  if(!image)throw fail(502,'A Gemini válaszában nem volt képfájl. Próbáld újra vagy válassz másik modellt.');
  return imageResult(data.model,image);
}

async function generateMarketingImage(input,{accountId,token,apiKey,fetchImpl=fetch}={}){
  const data=validateImageInput(input);
  if(MODELS[data.model].provider==='gemini')return generateGeminiImage(data,{apiKey,fetchImpl});
  if(!accountId||!token)throw fail(503,'A Cloudflare képgenerálás nincs beállítva. A Railway Variables között add meg a CLOUDFLARE_ACCOUNT_ID és CLOUDFLARE_AI_TOKEN változót.');
  const formats={square:[1024,1024],portrait:[768,1024],story:[576,1024],landscape:[1024,576]};
  const [width,height]=formats[data.format];
  const url=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${MODELS[data.model].id}`;
  let body,headers={'Authorization':'Bearer '+token};
  if(data.model==='flux-2-klein-4b'){
    body=new FormData();body.set('prompt',data.prompt);body.set('width',String(width));body.set('height',String(height));
    data.references.forEach((ref,index)=>body.set('input_image_'+index,new Blob([ref.bytes],{type:ref.mime}),'reference-'+index+'.png'));
  }else{
    headers['Content-Type']='application/json';body=JSON.stringify({prompt:data.prompt,steps:4});
  }
  let response;
  try{response=await fetchImpl(url,{method:'POST',headers,body,signal:AbortSignal.timeout(90000)});}
  catch(error){throw fail(error.name==='TimeoutError'||error.name==='AbortError'?504:502,
    error.name==='TimeoutError'||error.name==='AbortError'?'A képgenerálás időtúllépés miatt megszakadt. Próbáld újra vagy válassz gyorsabb modellt.':'A Cloudflare nem érhető el. Ellenőrizd a Railway hálózati kapcsolatát, majd próbáld újra.');}
  let payload;try{payload=await response.json();}catch{throw fail(502,'A Cloudflare nem értelmezhető választ adott. Próbáld újra később.');}
  if(!response.ok||payload.success===false)throw providerError(response.status,payload);
  return imageResult(data.model,payload?.result?.image);
}

module.exports={MODELS,modelStatus,validateImageInput,generateMarketingImage};
