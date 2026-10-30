'use strict';

const {generateContent:generateGeminiContent}=require('./gemini_model.cjs');

const ROLES=['logo','background','element'];
const FONTS=['Source Sans Pro','Arial','Georgia','Verdana','Trebuchet MS','Tahoma',
  'Times New Roman','Courier New','Segoe UI'];
const IMAGE_RE=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

function badRequest(message){return Object.assign(new Error(message),{status:400});}

function validateCreativeInput(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw badRequest('Érvénytelen kreatívkérés.');
  const text={};
  for(const [field,max] of [['name',100],['brief',1200],['audience',160],['headline',140],['body',900],['cta',40]]){
    if(typeof value[field]!=='string'||value[field].length>max)throw badRequest('Érvénytelen kreatívszöveg.');
    text[field]=value[field].trim();
  }
  if(!text.brief&&!text.body)throw badRequest('Írd le, mit mutasson be a kreatív.');
  if(!['square','portrait','story','landscape'].includes(value.format))throw badRequest('Érvénytelen képarány.');
  if(!FONTS.includes(value.font)||!FONTS.includes(value.bodyFont)||
    !/^#[0-9a-fA-F]{6}$/.test(value.background)||!/^#[0-9a-fA-F]{6}$/.test(value.accent))
    throw badRequest('Érvénytelen arculati beállítás.');
  if(!value.images||typeof value.images!=='object'||Array.isArray(value.images))throw badRequest('Hiányoznak a képek.');
  const images=[];let totalBytes=0;
  for(const role of ROLES){const data=value.images[role];if(!data)continue;
    if(typeof data!=='string')throw badRequest('Érvénytelen kép.');
    const match=IMAGE_RE.exec(data);if(!match)throw badRequest('Csak PNG, JPG vagy WebP kép használható.');
    const bytes=Buffer.from(match[2],'base64');
    if(!bytes.length||bytes.length>1500000||bytes.toString('base64')!==match[2])throw badRequest('Az egyik kép túl nagy vagy sérült.');
    totalBytes+=bytes.length;images.push({role,mimeType:match[1],data:match[2]});
  }
  if(!images.length)throw badRequest('Adj meg legalább egy képet logóként, háttérként vagy elemként.');
  if(totalBytes>3500000)throw badRequest('A képek együttes mérete túl nagy.');
  return {...text,format:value.format,font:value.font,bodyFont:value.bodyFont,
    background:value.background,accent:value.accent,images};
}

function parseCreativePlan(payload){
  const raw=payload?.candidates?.[0]?.content?.parts?.map(part=>part.text||'').join('').trim();
  if(!raw)throw new Error('Az AI nem adott kreatívtervet.');
  let value;try{value=JSON.parse(raw)}catch{throw new Error('Az AI válasza nem értelmezhető.');}
  const output={};
  for(const [field,max] of [['headline',140],['subtitle',180],['body',900],['cta',32]]){
    if(typeof value[field]!=='string'||!value[field].trim())throw new Error('Az AI hiányos kreatívtervet adott.');
    output[field]=value[field].trim().slice(0,max);
  }
  for(const field of ['background','accent']){
    if(typeof value[field]!=='string'||!/^#[0-9a-fA-F]{6}$/.test(value[field]))throw new Error('Az AI hibás színkódot adott.');
    output[field]=value[field];
  }
  output.style=['architecture','geometry','minimal'].includes(value.style)?value.style:'minimal';
  output.layout=['editorial','centered','bottom'].includes(value.layout)?value.layout:'editorial';
  return output;
}

async function generateCreativePlan(input,{apiKey,model='gemini-3.5-flash-lite',fetchImpl=fetch}={}){
  const data=validateCreativeInput(input);
  if(!apiKey)throw Object.assign(new Error('A GEMINI_API_KEY nincs beállítva.'),{status:503});
  if(!/^[A-Za-z0-9._-]{3,80}$/.test(model))throw new Error('Érvénytelen Gemini modellnév.');
  const roles={logo:'logó: csak arculati referencia; a felületen az eredeti kép kerül a tervre',
    background:'háttérkép: ehhez illő színeket és szövegelhelyezést válassz',
    element:'különálló grafikai elem: ehhez illő kompozíciót válassz'};
  const prompt=`Magyar építész stúdió hirdetéséhez készíts rövid, szakmai és ízléses kreatívtervet JSON formában.
  A megadott képek szerepét tartsd tiszteletben. A logót ne rajzold újra, a böngésző az eredeti képet fogja beilleszteni.
  Ne találj ki referenciát, árat, engedélyt, helyszínt vagy nem igazolt állítást.
  Kampány: ${data.name}\nCélközönség: ${data.audience}\nBrief: ${data.brief}\nKiinduló címsor: ${data.headline}\nKiinduló posztszöveg: ${data.body}\nGomb: ${data.cta}\nFormátum: ${data.format}.
  Jelenlegi arculat: ${data.font} címsorbetű, ${data.bodyFont} kísérőszöveg-betű, ${data.background} háttér, ${data.accent} kiemelés. Ezeket tekintsd alapnak; csak akkor javasolj más színeket, ha a feltöltött képek olvashatósága miatt indokolt.
  Válaszmezők: headline (képen), subtitle (képen), body (posztszöveg), cta, background és accent (#RRGGBB), style (architecture/geometry/minimal), layout (editorial/centered/bottom).
  A címsor legyen legfeljebb 70 karakter, a kísérőszöveg legfeljebb 100, a posztszöveg legfeljebb 450, a gomb legfeljebb 28.`;
  const parts=[{text:prompt}];
  for(const image of data.images)parts.push({text:'Kép szerepe: '+roles[image.role]},{inlineData:{mimeType:image.mimeType,data:image.data}});
  let answer;
  try{answer=await generateGeminiContent({apiKey,model,setting:'GEMINI_MARKETING_MODEL',
    fetchImpl,timeoutMs:60000,
    payload:{contents:[{parts}],generationConfig:{maxOutputTokens:2048,
      responseMimeType:'application/json',responseSchema:{type:'OBJECT',properties:{
        headline:{type:'STRING'},subtitle:{type:'STRING'},body:{type:'STRING'},cta:{type:'STRING'},
        background:{type:'STRING'},accent:{type:'STRING'},style:{type:'STRING'},layout:{type:'STRING'}
      },required:['headline','subtitle','body','cta','background','accent','style','layout']}}}});
  }catch(error){
    if(error.name==='TimeoutError'||error.name==='AbortError')
      throw Object.assign(new Error('Az AI-kérés időtúllépés miatt megszakadt.'),{status:504});
    if(!error.status)
      throw Object.assign(new Error('Az AI-szolgáltatás nem érhető el.'),{status:502});
    throw Object.assign(new Error('Az AI-kreatív nem készült el: '+error.message),
      {status:error.status});
  }
  const plan=parseCreativePlan(answer.data);
  return {plan,model:answer.model};
}

module.exports={validateCreativeInput,parseCreativePlan,generateCreativePlan};
