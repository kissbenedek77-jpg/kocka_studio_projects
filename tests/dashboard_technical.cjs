'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'dashboard_v2.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
function section(start,end){return script.slice(script.indexOf(start),script.indexOf(end,script.indexOf(start)+start.length));}

function node(tag='div',className='',text=''){
  return {tag,className,textContent:text,children:[],attributes:{},value:'',
    append(...items){this.children.push(...items)},setAttribute(name,value){this.attributes[name]=value}};
}
const descendants=item=>[item,...(item.children||[]).flatMap(descendants)];

function harness(project){
  const buttons=[],textareas=[],sections=[],paragraphs=[],notices=[],rpcCalls=[];
  const actions=node();
  const panel=node();
  const context=vm.createContext({
    step:5,actions,panel,project,technicalDraft:null,
    document:{body:{dataset:{runtime:'node'}}},
    element(tag,className,text){const item=node(tag,className,text);
      if(tag==='textarea')textareas.push(item);return item;},
    section(parent,title){const item=node('div','detail',title);item.title=title;
      sections.push(item);parent.append(item);return item;},
    paragraph(parent,text){paragraphs.push(text);parent.append({tag:'p',textContent:text});},
    button(parent,label,handler){const item={label,handler,parent,disabled:false};
      buttons.push(item);parent.append(item);return item;},
    link(){},
    doc:() => ({url:''}),
    callAction(action){context.calledAction=action;},
    sendEmail(){},
    confirm(title,messageText,callback){context.confirmed=title;callback();},
    busyState(){},render(){},showStep(index){context.shown=index;},
    renderIssues(){},renderPdfAudit(){},refreshProject(){},folderLink(){},auditTreePdfs(){},
    notice(text,kind){notices.push({text,kind});},
    rpc:async (...args) => {rpcCalls.push(args);
      if(args[0]==='dashboardExpectedPdfaFiles')
        return {folder:'PDFA',files:['PDFA/A terv.pdf','PDFA/Statika/S-01.pdf'],
          missing:false,truncated:false};
      if(args[0]==='dashboardSaveTechnicalFields')return {fields:[]};
      if(args[0]==='dashboardGetTechnicalFields')return {
        autoChapters:[{key:'HELYSZIN:meglevo_allapot',title:'Meglévő állapot'}],
        fields:[{key:'HELYSZIN:meglevo_allapot',value:'Üres telek.'}]};
      if(args[0]==='dashboardPerform')return {message:'A dokumentum frissítve.',
        url:'https://docs.google.com/document/d/doc/edit',project};
      return {...project,expectedFiles:args[2]};}
  });
  return {context,buttons,textareas,sections,paragraphs,notices,rpcCalls,actions,panel};
}

function runStep5(run){
  const source=section('    const TECHNICAL_GROUP_TITLES=','    function renderAudio(parent){')+
    '\n'+section('      if(step===5){','      if(step===6){');
  vm.runInContext(source,run.context);
}

test('Blokkoló ellenőrzés mellett is elkészülhet a tervezet, de figyelmeztet',() => {
  const run=harness({uid:'ABC123',stage:'started',
    folderUrl:'https://drive.google.com/drive/folders/root',documents:[],issues:[
      {text:'Hiányzó elvárt fájl: PDFA/EK-01 Helyszínrajz.pdf',blocking:true,resolved:false}]});
  runStep5(run);
  const create=run.buttons.find(item=>item.label==='Műszaki leírás létrehozása AI-val');
  assert.ok(create,'Hiányzik az AI-s műszaki leírás gomb.');
  assert.equal(create.disabled,false,'A blokkoló ellenőrzés nem akadályozhatja a tervezetet.');
  assert.equal(run.sections.some(item=>
    item.title==='Miért nem hozható létre a műszaki leírás?'),false);
  const warn=run.sections.find(item=>item.title==='Nyitott ellenőrzési pontok');
  assert.ok(warn,'A nyitott ellenőrzési pontok figyelmeztetése hiányzik.');
  assert.ok(run.paragraphs.some(text=>text.includes('PDFA/EK-01 Helyszínrajz.pdf')));
  const jump=run.buttons.find(item=>item.label==='Ellenőrzések megnyitása (4. lépés)');
  assert.ok(jump);
  jump.handler();
  assert.equal(run.context.shown,4);
});

test('A gomb megerősítés után a szerveroldali AI-generálást indítja',() => {
  const run=harness({uid:'ABC123',stage:'started',
    folderUrl:'https://drive.google.com/drive/folders/root',documents:[],issues:[]});
  runStep5(run);
  const create=run.buttons.find(item=>item.label==='Műszaki leírás létrehozása AI-val');
  create.handler();
  assert.equal(run.context.confirmed,'Műszaki leírás készítése');
  assert.equal(run.context.calledAction,'technical:generate');
});

test('Elindított, tiszta projektnél aktív a gomb és nincs oklista',() => {
  const run=harness({uid:'ABC123',stage:'started',
    folderUrl:'https://drive.google.com/drive/folders/root',documents:[],issues:[]});
  runStep5(run);
  const create=run.buttons.find(item=>item.label==='Műszaki leírás létrehozása AI-val');
  assert.equal(create.disabled,false);
  assert.equal(run.sections.some(item=>
    item.title==='Miért nem hozható létre a műszaki leírás?'),false);
});

test('Indítás előtt is elkészíthető, ha a projektmappa megvan',() => {
  const run=harness({uid:'ABC123',stage:'preparation',
    folderUrl:'https://drive.google.com/drive/folders/root',documents:[],issues:[]});
  runStep5(run);
  const create=run.buttons.find(item=>item.label==='Műszaki leírás létrehozása AI-val');
  assert.equal(create.disabled,false);
  assert.equal(run.sections.some(item=>
    item.title==='Miért nem hozható létre a műszaki leírás?'),false);
});

test('Lezárt projektnél és projektmappa nélkül a gomb okot ír ki',() => {
  const closed=harness({uid:'ABC123',stage:'closed',
    folderUrl:'https://drive.google.com/drive/folders/root',documents:[],issues:[]});
  runStep5(closed);
  assert.equal(closed.buttons.find(item=>
    item.label==='Műszaki leírás létrehozása AI-val').disabled,true);
  assert.ok(closed.paragraphs.some(text=>text.includes('le van zárva')));
  const noFolder=harness({uid:'ABC123',stage:'preparation',folderUrl:'',documents:[],issues:[]});
  runStep5(noFolder);
  assert.equal(noFolder.buttons.find(item=>
    item.label==='Műszaki leírás létrehozása AI-val').disabled,true);
  assert.ok(noFolder.paragraphs.some(text=>text.includes('projektmappa még nem jött létre')));
  const noAi=harness({uid:'ABC123',stage:'started',aiConfigured:false,
    folderUrl:'https://drive.google.com/drive/folders/root',documents:[],issues:[]});
  runStep5(noAi);
  assert.equal(noAi.buttons.find(item=>
    item.label==='Műszaki leírás létrehozása AI-val').disabled,true);
  assert.ok(noAi.paragraphs.some(text=>text.includes('GEMINI_API_KEY nincs beállítva')));
});

test('A kész fejezetek szerkeszthetők, menthetők és a DRAFT frissül',async () => {
  const run=harness({uid:'ABC123',stage:'started',
    folderUrl:'https://drive.google.com/drive/folders/root',documents:[],issues:[]});
  run.context.technicalDraft=[
    {key:'HELYSZIN:meglevo_allapot',title:'Meglévő állapot',value:'Üres telek.'},
    {key:'SZERKEZET:alapozas',title:'Alapozás',
      value:'[KIEGÉSZÍTENDŐ: alapozás rétegrendje]'}];
  runStep5(run);
  assert.equal(run.notices.length,0);
  const root=run.sections.find(item=>item.title==='AI fejezetszövegek szerkesztése');
  assert.ok(root,'Hiányzik a fejezetszerkesztő.');
  const groups=descendants(root).filter(item=>item.tag==='h4').map(item=>item.textContent);
  assert.deepEqual(groups,['Helyszín és tervelőzmények','Szerkezetek és anyagok']);
  assert.equal(run.textareas.length,2);
  assert.ok(descendants(root).some(item=>item.textContent?.includes('Hiányzó adatot jelöl')));
  run.textareas[0].value='Üres telek, a telek határoló kerítéssel.';
  const save=run.buttons.find(item=>item.label==='Fejezetek mentése és dokumentum frissítése');
  assert.ok(save);
  await save.handler();
  assert.equal(JSON.stringify(Array.from(run.rpcCalls[0])),JSON.stringify(['dashboardSaveTechnicalFields','ABC123',
    {'HELYSZIN:meglevo_allapot':'Üres telek, a telek határoló kerítéssel.',
      'SZERKEZET:alapozas':'[KIEGÉSZÍTENDŐ: alapozás rétegrendje]'}]));
  assert.deepEqual(Array.from(run.rpcCalls[1]),['dashboardPerform','ABC123','document:muszakiLeiras']);
  assert.equal(run.notices.at(-1)?.kind,'success');
});

test('Korábbi fejezetszövegek betölthetők szerkesztésre',async () => {
  const run=harness({uid:'ABC123',stage:'started',
    folderUrl:'https://drive.google.com/drive/folders/root',documents:[],issues:[]});
  runStep5(run);
  const load=run.buttons.find(item=>item.label==='Mentett fejezetszövegek szerkesztése');
  assert.ok(load,'Hiányzik a mentett szövegek betöltése.');
  await load.handler();
  assert.equal(run.context.technicalDraft.length,1);
  assert.equal(run.context.technicalDraft[0].key,'HELYSZIN:meglevo_allapot');
  assert.equal(run.context.technicalDraft[0].value,'Üres telek.');
  assert.equal(run.notices.at(-1)?.kind,'success');
});

test('A PDFA mappa fájljai egy gombnyomásra bekerülnek az elvárt listába',async () => {
  const project={uid:'ABC123',stage:'started',folderUrl:'https://drive.google.com/drive/folders/root',
    issues:[],documents:[],dataSheetUrl:'',expectedFiles:'PLN/helyiségek.txt\nPDFA/régi.pdf'};
  const run=harness(project);
  const textareas=[];
  run.context.step=4;
  run.context.element=(tag,className,text) => {
    const item=node(tag,className,text);
    if(tag==='textarea'){item.value=project.expectedFiles;textareas.push(item);}
    return item;
  };
  vm.runInContext(section('      if(step===4){','      if(step===5){'),run.context);
  const importPdfa=run.buttons.find(item=>item.label==='PDFA fájlok beemelése');
  assert.ok(importPdfa);
  assert.equal(importPdfa.disabled,false);
  await importPdfa.handler();
  assert.deepEqual(Array.from(run.rpcCalls.at(-1)),['dashboardSaveExpectedFiles','ABC123',
    'PLN/helyiségek.txt\nPDFA/A terv.pdf\nPDFA/Statika/S-01.pdf']);
  assert.equal(run.notices.at(-1)?.kind,'success');
  assert.match(run.notices.at(-1)?.text||'',/2 fájlja/);
});

test('A műszaki űrlapon egygombos AI-kitöltés és hiányjelölés van',() => {
  const page=fs.readFileSync(path.join(root,'technical.html'),'utf8');
  assert.match(page,/id="autoDraft"/);
  assert.match(page,/dashboardGenerateTechnical/);
  assert.match(page,/\[KIEGÉSZÍTENDŐ:/);
});
