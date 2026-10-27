'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {validateStrategyInput,parseStrategy,generateStrategy}=require('../server/marketing_strategy.cjs');

const input=()=>({name:'Építészeti kampány',goal:'Ajánlatkérések',brief:'Családi ház tervezés',
  audience:'építkezést tervezők',city:'Somogy',services:'Új ház és bővítés tervezése',
  evidence:'Nincs még jóváhagyott referencia.',budget:50000,channels:['instagram','facebook']});
const plan=()=>({positioning:{mainMessage:'Személyes építészeti segítség',
  valueProposition:'Megvalósítható tervek.',tone:'Közvetlen és szakmai.'},
  landing:{heroTitle:'Beszéljük át a terveidet',heroSubtitle:'Építészeti tervezés',cta:'Kérj ajánlatot',
    intro:'Bemutatkozó szöveg.',services:['Új ház tervezése','Bővítés'],
    references:'Referenciák beszerzése szükséges.',formIntro:'Írd le röviden a projektet.'},
  ads:[{format:'video',channel:'instagram',visual:'Beszélős videó',headline:'Otthontervezés',
    body:'Beszéljük át.',cta:'Kérj ajánlatot',steps:['Nyitó jelenet','Probléma','Megoldás']},
    {format:'carousel',channel:'facebook',visual:'Kártyák',headline:'Bővítés',body:'Mutasd meg a házat.',
      cta:'Kérj ajánlatot',steps:['Első kártya','Második kártya','Harmadik kártya','Negyedik kártya']},
    {format:'static',channel:'instagram',visual:'Tervrajz',headline:'Új ház',body:'Személyes tervezés.',
      cta:'Kérj ajánlatot',steps:[]}],
  schedule:[1,2,3,4].map(week=>({title:'Előkészítés '+week,tasks:['Szöveg és képek ellenőrzése']})),
  assumptions:['Jóváhagyott referenciák ellenőrzése']});

test('kampánystratégia: egy briefből öt részes terv és hirdetésszövegek készülnek',async()=>{
  let request;
  const fetchImpl=async(url,options)=>{request={url,options};return {ok:true,
    json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(plan())}]}}]})}};
  const result=await generateStrategy(input(),{apiKey:'test-key',fetchImpl});
  assert.match(result.markdown,/## 1\. Pozicionálás/);
  assert.match(result.markdown,/## 2\. Landingoldal/);
  assert.match(result.markdown,/Meta Pixel azonosító és hozzájáruláskezelés/);
  assert.match(result.markdown,/## 4\. Hirdetési kreatívok/);
  assert.match(result.markdown,/### 4\. hét/);
  assert.match(result.markdown,/AI-tervezet/);
  assert.equal(result.ads.length,3);
  assert.equal(result.plan.landing.services.length,2);
  assert.match(request.url,/gemini-3\.5-flash-lite:generateContent$/);
  const body=JSON.parse(request.options.body);
  assert.equal(body.generationConfig.responseMimeType,'application/json');
  assert.match(body.contents[0].parts[0].text,/Ne találj ki nevet, referenciát/);
  assert.ok(!request.options.body.includes('test-key'));
});

test('kampánystratégia: hiányos brief és hibás AI-válasz elutasítása',()=>{
  assert.throws(()=>validateStrategyInput({...input(),channels:[]}),/csatornát/);
  assert.throws(()=>validateStrategyInput({...input(),services:'',brief:''}),/rövid leírását/);
  const wrong=plan();wrong.ads[0].format='static';
  assert.throws(()=>parseStrategy({candidates:[{content:{parts:[{text:JSON.stringify(wrong)}]}}]}),/videó/);
});
