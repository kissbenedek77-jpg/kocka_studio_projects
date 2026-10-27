'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'..','dashboard_v2.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
function section(start,end){return script.slice(script.indexOf(start),script.indexOf(end,script.indexOf(start)+start.length));}

function node(tag='div',className='',text=''){
  return {tag,className,textContent:text,children:[],attributes:{},value:'',
    append(...items){this.children.push(...items)},setAttribute(name,value){this.attributes[name]=value}};
}

function harness(project){
  const buttons=[],textareas=[],sections=[],paragraphs=[],notices=[],rpcCalls=[];
  const actions=node();
  const panel=node();
  const context=vm.createContext({
    step:5,actions,panel,project,
    document:{body:{dataset:{runtime:'node'}}},
    element:node,
    section(parent,title){const item=node('div','detail',title);item.title=title;
      sections.push(item);parent.append(item);return item;},
    paragraph(parent,text){paragraphs.push(text);parent.append({tag:'p',textContent:text});},
    button(parent,label,handler){const item={label,handler,parent,disabled:false};
      buttons.push(item);parent.append(item);return item;},
    link(){},
    doc:() => ({url:''}),
    callAction(){},
    sendEmail(){},
    busyState(){},render(){},showStep(index){context.shown=index;},
    renderIssues(){},renderPdfAudit(){},refreshProject(){},folderLink(){},auditTreePdfs(){},
    notice(text,kind){notices.push({text,kind});},
    rpc:async (...args) => {rpcCalls.push(args);
      if(args[0]==='dashboardExpectedPdfaFiles')
        return {folder:'PDFA',files:['PDFA/A terv.pdf','PDFA/Statika/S-01.pdf'],
          missing:false,truncated:false};
      return {...project,expectedFiles:args[2]};}
  });
  return {context,buttons,textareas,sections,paragraphs,notices,rpcCalls,actions,panel};
}

test('A műszaki leírás gomb blokkoló ellenőrzésnél okot mutat',() => {
  const run=harness({uid:'ABC123',stage:'started',documents:[],issues:[
    {text:'Hiányzó elvárt fájl: PDFA/EK-01 Helyszínrajz.pdf',blocking:true,resolved:false}]});
  vm.runInContext(section('      if(step===5){','      if(step===6){'),run.context);
  const create=run.buttons.find(item=>item.label==='Műszaki leírás létrehozása');
  assert.ok(create);
  assert.equal(create.disabled,true);
  const why=run.sections.find(item=>item.title==='Miért nem hozható létre a műszaki leírás?');
  assert.ok(why,'A blokkoló okot magyarázó szakasz hiányzik.');
  assert.ok(run.paragraphs.some(text=>text.includes('PDFA/EK-01 Helyszínrajz.pdf')));
  const jump=run.buttons.find(item=>item.label==='Ellenőrzések megnyitása (4. lépés)');
  assert.ok(jump);
  jump.handler();
  assert.equal(run.context.shown,4);
});

test('A műszaki leírás gomb elindított, tiszta projektnél aktív',() => {
  const run=harness({uid:'ABC123',stage:'started',documents:[],issues:[]});
  vm.runInContext(section('      if(step===5){','      if(step===6){'),run.context);
  const create=run.buttons.find(item=>item.label==='Műszaki leírás létrehozása');
  assert.equal(create.disabled,false);
  assert.equal(run.sections.some(item=>
    item.title==='Miért nem hozható létre a műszaki leírás?'),false);
});

test('Elindítás előtt a műszaki leírás gomb ezt az okot írja ki',() => {
  const run=harness({uid:'ABC123',stage:'preparation',documents:[],issues:[]});
  vm.runInContext(section('      if(step===5){','      if(step===6){'),run.context);
  const create=run.buttons.find(item=>item.label==='Műszaki leírás létrehozása');
  assert.equal(create.disabled,true);
  assert.ok(run.paragraphs.some(text=>text.includes('még nincs elindítva')));
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
