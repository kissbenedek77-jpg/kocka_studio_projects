'use strict';

const {generateContent:generateGeminiContent}=require('./gemini_model.cjs');

const CHANNELS=new Set(['facebook','instagram','google','tiktok']);
const FORMATS=new Set(['video','carousel','static']);
const bad=message=>Object.assign(new Error(message),{status:400});
const clean=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';

function validateStrategyInput(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw bad('Érvénytelen kampánybrief.');
  const input={};
  for(const [field,max] of [['name',100],['goal',100],['brief',1200],['audience',160],
    ['city',100],['services',1800],['evidence',1200]]){
    if(typeof value[field]!=='string'||value[field].length>max)throw bad('A kampánybrief egyik mezője túl hosszú vagy hibás.');
    input[field]=value[field].trim();
  }
  if(!input.name||!input.goal||!input.audience||!input.brief&&!input.services)
    throw bad('Add meg a kampány nevét, célját, közönségét és rövid leírását.');
  const budget=Number(value.budget||0);
  if(!Number.isFinite(budget)||budget<0||budget>100000000)throw bad('Érvénytelen keretösszeg.');
  input.budget=budget;
  input.channels=Array.isArray(value.channels)?value.channels.filter(channel=>CHANNELS.has(channel)):[];
  if(!input.channels.length||input.channels.length>4)throw bad('Válassz legalább egy hirdetési csatornát.');
  return input;
}

function parseStrategy(payload){
  const raw=payload?.candidates?.[0]?.content?.parts?.map(part=>part.text||'').join('').trim();
  if(!raw)throw Object.assign(new Error('Az AI nem adott kampánytervet.'),{status:502});
  let value;try{value=JSON.parse(raw)}catch{throw Object.assign(new Error('Az AI terve nem értelmezhető.'),{status:502})}
  const required=(parent,key,max=900)=>{const result=clean(parent?.[key],max);
    if(!result)throw Object.assign(new Error('Az AI hiányos kampánytervet adott: '+key+'.'),{status:502});return result};
  const items=(value,min,max,label)=>{if(!Array.isArray(value)||value.length<min||value.length>max)
    throw Object.assign(new Error('Az AI hiányos kampánytervet adott: '+label+'.'),{status:502});return value};
  const landing=value?.landing||{},positioning=value?.positioning||{};
  const result={positioning:{mainMessage:required(positioning,'mainMessage',250),
    valueProposition:required(positioning,'valueProposition',700),tone:required(positioning,'tone',250)},
    landing:{heroTitle:required(landing,'heroTitle',180),heroSubtitle:required(landing,'heroSubtitle',280),
      cta:required(landing,'cta',50),intro:required(landing,'intro',700),
      services:items(landing.services,1,6,'szolgáltatások').map(item=>clean(item,250)).filter(Boolean),
      references:required(landing,'references',500),formIntro:required(landing,'formIntro',350)},
    ads:items(value.ads,3,3,'hirdetések').map(ad=>({
      format:FORMATS.has(ad?.format)?ad.format:'static',
      channel:CHANNELS.has(ad?.channel)?ad.channel:'facebook',
      visual:required(ad,'visual',550),headline:required(ad,'headline',140),
      body:required(ad,'body',900),cta:required(ad,'cta',40),
      steps:Array.isArray(ad.steps)?ad.steps.slice(0,6).map(step=>clean(step,350)).filter(Boolean):[]
    })),
    schedule:items(value.schedule,4,4,'négyhetes terv').map((week,index)=>({
      week:index+1,title:required(week,'title',100),
      tasks:items(week?.tasks,1,6,'heti feladatok').map(task=>clean(task,350)).filter(Boolean)
    })),
    assumptions:Array.isArray(value.assumptions)?value.assumptions.slice(0,8).map(item=>clean(item,300)).filter(Boolean):[]};
  if(result.landing.services.length===0||result.schedule.some(week=>!week.tasks.length))
    throw Object.assign(new Error('Az AI terve nem tartalmaz használható feladatokat.'),{status:502});
  if(!['video','carousel','static'].every(format=>result.ads.some(ad=>ad.format===format)))
    throw Object.assign(new Error('Az AI nem adott videó, lapozható és statikus hirdetést is.'),{status:502});
  return result;
}

function strategyMarkdown(plan,input){
  const lines=[`# ${input.name} – marketing cselekvési terv`,'',
    '> AI-tervezet. A referenciákat, ígéreteket, költségkeretet és mérési beállításokat közzététel előtt ellenőrizni kell.','',
    `**Cél:** ${input.goal}`,'',`**Célközönség:** ${input.audience}`,'',
    ...(input.city?[`**Terület:** ${input.city}`,'']:[]),
    ...(input.budget?[`**Tervezett havi keret:** ${new Intl.NumberFormat('hu-HU').format(input.budget)} Ft (jóváhagyásig nem indul költés)`,'']:[]),
    '## 1. Pozicionálás és üzenet','',`**Fő üzenet:** ${plan.positioning.mainMessage}`,'',
    `**Értékajánlat:** ${plan.positioning.valueProposition}`,'',`**Hangnem:** ${plan.positioning.tone}`,'',
    '## 2. Landingoldal','',`**Főcím:** ${plan.landing.heroTitle}`,'',
    `**Alcím:** ${plan.landing.heroSubtitle}`,'',`**CTA:** ${plan.landing.cta}`,'',
    '### Bemutatkozás','',plan.landing.intro,'','### Szolgáltatások','',
    ...plan.landing.services.map(item=>`- ${item}`),'','### Referenciák és bizalom','',
    plan.landing.references,'',
    '- [ ] Csak publikálható, engedéllyel rendelkező referenciafotók és valódi ügyfélvélemények kerüljenek az oldalra.','',
    '### Ajánlatkérő űrlap','',plan.landing.formIntro,'',
    'Javasolt mezők: projekt típusa, település/helyszín, tervezett kezdés, név, e-mail, telefon.','',
    '## 3. Mérés – beállítandó és ellenőrizendő','',
    '- [ ] Meta Pixel azonosító és hozzájáruláskezelés beállítása a landingoldalon.',
    '- [ ] Lead esemény küldése csak sikeres ajánlatkérés után; teszt a szolgáltató diagnosztikai felületén.',
    '- [ ] GA4 mérési azonosító és konverziós esemény beállítása; teszt valós űrlapbeküldéssel.',
    '- [ ] UTM-paraméterek és forrásadatok ellenőrzése a kampánylinkeknél.','',
    '## 4. Hirdetési kreatívok és A/B próba',''];
  const formats={video:'Videó / Reels',carousel:'Lapozható carousel',static:'Statikus kép'};
  for(const [index,ad] of plan.ads.entries())lines.push(`### ${index+1}. ${formats[ad.format]} (${ad.channel})`,'',
    `**Vizuál:** ${ad.visual}`,'',`**Főcím:** ${ad.headline}`,'',`**Posztszöveg:** ${ad.body}`,'',
    `**CTA:** ${ad.cta}`,'',...(ad.steps.length?['**Jelenetek / lapok:**','',...ad.steps.map((step,i)=>`${i+1}. ${step}`),'']:[]));
  lines.push('## 5. Négyhetes cselekvési terv','');
  for(const week of plan.schedule)lines.push(`### ${week.week}. hét – ${week.title}`,'',...week.tasks.map(task=>`- [ ] ${task}`),'');
  lines.push('### Próbaindítás és kiértékelés','',
    '- [ ] Hirdetési fiókban kézi jóváhagyás után próbaindítás a jóváhagyott kerettel.',
    '- [ ] 10–14 nap után tényleges leadminőség és ajánlatkérési költség értékelése; csak ezután módosíts keretet vagy kreatívot.','',
    '## Jóváhagyás előtt ellenőrizendő','',
    ...(plan.assumptions.length?plan.assumptions.map(item=>`- [ ] ${item}`):['- [ ] A feltételezéseket és a felhasznált referenciákat ellenőrizni kell.']),'');
  return lines.join('\n');
}

async function generateStrategy(value,{apiKey,model='gemini-3.5-flash-lite',fetchImpl=fetch}={}){
  const input=validateStrategyInput(value);
  if(!apiKey)throw Object.assign(new Error('A GEMINI_API_KEY nincs beállítva a Railway Variables között.'),{status:503});
  if(!/^[A-Za-z0-9._-]{3,80}$/.test(model))throw bad('Érvénytelen Gemini modellnév.');
  const prompt=`Készíts magyar nyelvű, megvalósítható marketing cselekvési tervet egy építész stúdiónak.\n
  A cél az ajánlatkérések minőségének javítása. Adj márkaüzenetet, landingoldal szövegezést és szerkezetet,
  három különböző hirdetési koncepciót (video, carousel, static), valamint konkrét négyhetes feladatlistát.
  A videóhoz jeleneteket, a carouselhez 4–6 kártyaszöveget adj a steps mezőben.
  Csak a briefben szereplő tényekből dolgozz. Ne találj ki nevet, referenciát, ügyfélvéleményt, árat,
  megtakarítási ígéretet, elérhető szolgáltatást vagy már beállított mérőeszközt.
  Ha hiányzik referencia vagy portré, az ellenőrizendő feladatként jelenjen meg. A Pixel és GA4 telepítése
  csak javasolt teendő; ne állítsd, hogy működik. A költségkeret javaslat, nem automatikus hirdetésindítás.
  Közvetlen, partnerszerű, szakmai hangnemet használj, kerüld a túlzó reklámállításokat.
  Kampány: ${input.name}\nCél: ${input.goal}\nRövid leírás: ${input.brief}\nCélközönség: ${input.audience}\nHelyszín: ${input.city||'nincs megadva'}\nSzolgáltatások és egyedi szempontok: ${input.services||'nincs külön megadva'}\nIgazolt referenciák/állítások: ${input.evidence||'nincs megadva'}\nCsatornák: ${input.channels.join(', ')}\nTervezett havi keret: ${input.budget||'nincs megadva'} Ft.
  Az ads elemekben a channel csak a megadott csatornák egyike legyen. A schedule pontosan négy hét legyen.
  A válasz kizárólag a megadott JSON-séma mezőit tartalmazza.`;
  const schema={type:'OBJECT',properties:{
    positioning:{type:'OBJECT',properties:{mainMessage:{type:'STRING'},valueProposition:{type:'STRING'},tone:{type:'STRING'}},required:['mainMessage','valueProposition','tone']},
    landing:{type:'OBJECT',properties:{heroTitle:{type:'STRING'},heroSubtitle:{type:'STRING'},cta:{type:'STRING'},intro:{type:'STRING'},services:{type:'ARRAY',items:{type:'STRING'}},references:{type:'STRING'},formIntro:{type:'STRING'}},required:['heroTitle','heroSubtitle','cta','intro','services','references','formIntro']},
    ads:{type:'ARRAY',items:{type:'OBJECT',properties:{format:{type:'STRING'},channel:{type:'STRING'},visual:{type:'STRING'},headline:{type:'STRING'},body:{type:'STRING'},cta:{type:'STRING'},steps:{type:'ARRAY',items:{type:'STRING'}}},required:['format','channel','visual','headline','body','cta','steps']}},
    schedule:{type:'ARRAY',items:{type:'OBJECT',properties:{title:{type:'STRING'},tasks:{type:'ARRAY',items:{type:'STRING'}}},required:['title','tasks']}},
    assumptions:{type:'ARRAY',items:{type:'STRING'}}
  },required:['positioning','landing','ads','schedule','assumptions']};
  let answer;
  try{answer=await generateGeminiContent({apiKey,model,setting:'GEMINI_MARKETING_MODEL',
    fetchImpl,timeoutMs:90000,
    payload:{contents:[{parts:[{text:prompt}]}],generationConfig:{
      maxOutputTokens:8192,responseMimeType:'application/json',responseSchema:schema}}});
  }catch(error){
    if(error.name==='TimeoutError'||error.name==='AbortError')
      throw Object.assign(new Error('Az AI-kérés időtúllépés miatt megszakadt.'),{status:504});
    if(!error.status)throw Object.assign(new Error('Az AI-szolgáltatás nem érhető el.'),{status:502});
    throw Object.assign(new Error('A kampányterv nem készült el: '+error.message),{status:error.status});
  }
  const plan=parseStrategy(answer.data);
  for(const ad of plan.ads)if(!input.channels.includes(ad.channel))ad.channel=input.channels[0];
  return {markdown:strategyMarkdown(plan,input),ads:plan.ads,plan,model};
}

module.exports={validateStrategyInput,parseStrategy,strategyMarkdown,generateStrategy};
