'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const auto=require('../public/marketing-auto.js');

test('a landing és a szerkeszthető kreatív nem enged HTML beszúrást',()=>{
  const plan={landing:{heroTitle:'<img src=x onerror=alert(1)>',heroSubtitle:'Építészet',cta:'Ajánlat',
    intro:'<script>alert(1)</script>',services:['Tervezés & tanácsadás'],formIntro:'Írj nekünk'}};
  const html=auto.landingHtml(plan,{},'https://projects.kockastudio.hu/ajanlatkeres');
  assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/<script>|<img src=x/);
  assert.match(html,/href="https:\/\/projects.kockastudio.hu\/ajanlatkeres"/);
  const svg=auto.creativeSvg({title:'<script>alert(1)</script>',cta:'Ajánlat',width:1080,height:1080});
  assert.match(svg,/&lt;script&gt;/);assert.doesNotMatch(svg,/<script>/);
});

test('a kampánycsomag minden tervformátumot sorban előállít és hibás képnél folytatja',async()=>{
  const oldImage=global.Image,oldDocument=global.document,oldBtoa=global.btoa;
  global.Image=class {set src(value){this.value=value;queueMicrotask(()=>this.onload())}};
  global.document={createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){}}),toDataURL:()=>
    'data:image/png;base64,'+Buffer.from('89504e470d0a1a0a','hex').toString('base64')})};
  global.btoa=value=>Buffer.from(value,'binary').toString('base64');
  try{const files=[];
    const result=await auto.build({plan:{landing:{heroTitle:'Otthon',heroSubtitle:'Alcím',cta:'Kérj ajánlatot',
      intro:'Bemutatkozás',services:['Tervezés'],formIntro:'Űrlap'},ads:[
      {format:'static',headline:'Ház',body:'Szöveg',cta:'Kérj ajánlatot',visual:'Vázlat'},
      {format:'carousel',headline:'Bővítés',body:'Szöveg',cta:'Ajánlat',visual:'Ház',steps:['Első','Második','Harmadik','Negyedik']},
      {format:'video',headline:'Terv',body:'Szöveg',cta:'Ajánlat',visual:'Rajz',steps:['Nyitó','Záró']} ]},
      brand:{},generateImage:async()=>{throw Error('Modell nem elérhető')},
      save:async(name,mime,data)=>{files.push({name,mime,data})},progress:()=>{},url:'https://example.com/ajanlatkeres'});
    assert.equal(files.filter(file=>file.name.endsWith('.png')).length,7);
    assert.equal(files.filter(file=>file.name.endsWith('.svg')).length,7);
    assert.ok(files.some(file=>file.name==='landing-vazlat.html'));
    assert.equal(result.outcomes.length,15);
    assert.ok(result.errors.some(error=>error.includes('Modell nem elérhető')));
  }finally{global.Image=oldImage;global.document=oldDocument;global.btoa=oldBtoa}
});
