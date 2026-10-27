'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'..','dashboard_v2.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
function section(start,end){return script.slice(script.indexOf(start),script.indexOf(end,script.indexOf(start)+start.length));}

test('A 2. lépés hiányzó mappája és ajánlata létrehozható és megnyitható',() => {
  const controls=[];
  const context=vm.createContext({project:{folderUrl:''},
    button:(_root,label,action) => {controls.push({label,action});return {disabled:false};},
    link:(_root,label,url) => {controls.push({label,url});},
    callAction:action => {context.called=action;},
    doc:() => ({url:''})});
  vm.runInContext(section('    function folderLink(','    async function loadFolderTree('),context);
  context.folderLink({});context.docActions({},'ajanlat','Ajánlat létrehozása');
  assert.deepEqual(controls.map(item => item.label),[
    'Projektmappa létrehozása és megnyitása','Ajánlat létrehozása és megnyitása']);
  controls[0].action();assert.equal(context.called,'folder');
  controls[1].action();assert.equal(context.called,'document:ajanlat');
});

test('A létrehozott dokumentum új böngészőfüle a kattintáskor nyílik',async () => {
  const events=[];
  const tab={document:{},location:{replace:url => events.push('navigate:'+url)},close:() => events.push('close')};
  const context=vm.createContext({project:{uid:'ABC123'},busy:false,
    window:{open:() => {events.push('open');return tab;}},
    busyState:() => {},notice:() => {},render:() => {},loadFolderTree:() => {},
    rpc:async () => {events.push('rpc');return {project:{uid:'ABC123'},
      message:'Kész',url:'https://docs.google.com/document/d/test/edit'};},
    loadProjects:async () => {}});
  vm.runInContext(section('    async function callAction(','    async function prepareEmail('),context);
  await context.callAction('document:ajanlat');
  assert.deepEqual(events,['open','rpc','navigate:https://docs.google.com/document/d/test/edit']);
});

test('Projektfájl-böngésző a mappákat a védett RPC-n keresztül olvassa',async () => {
  let request;
  const root={id:'root',name:'Projekt',folders:[],files:[]};
  const child={id:'child',name:'PDFA',folders:[],files:[{name:'terv.pdf',url:'https://drive.google.com/file/d/test/view'}]};
  const context=vm.createContext({project:{uid:'ABC123'},folderTree:new Map([['',root]]),
    folderOpen:new Set(),folderLoading:new Set(),folderTreeError:'',renderFolderTree:()=>{},
    rpc:async (...args) => {request=args;return child;}});
  vm.runInContext(section('    async function loadFolderTree(','    function renderFolderTree('),context);
  await context.loadFolderTree('child');
  assert.deepEqual(Array.from(request),['dashboardListFolder','ABC123','child']);
  assert.equal(context.folderTree.get('child').name,'PDFA');
  assert.equal(context.folderOpen.has('child'),true);
});
