'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname,'..','technical.html'),'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

class Node {
  constructor(tag){
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = []; this.dataset = {}; this.style = {}; this.attributes = {};
    this.className = ''; this.value = ''; this.hidden = false; this.textContent = '';
  }
  append(...items){
    for (const item of items) {
      if (item && typeof item === 'object') item.parentNode = this;
      this.children.push(item);
    }
  }
  replaceChildren(...items){this.children = []; this.append(...items)}
  addEventListener(type,handler){
    if (type === 'submit') this.submitHandler = handler;
    if (type === 'click') this.clickHandler = handler;
  }
  setAttribute(name,value){this.attributes[name] = value}
  closest(){return this}
  querySelector(selector){return this.querySelectorAll(selector)[0] || null}
  querySelectorAll(selector){
    const found = [];
    const match = node => {
      if (selector === '[data-key]') return node.dataset?.key !== undefined;
      if (selector === '[data-block-id]') return node.dataset?.blockId !== undefined;
      if (selector === 'textarea') return node.tagName === 'TEXTAREA';
      if (selector === 'label') return node.tagName === 'LABEL';
      if (selector === 'input[type=checkbox]')
        return node.tagName === 'INPUT' && node.type === 'checkbox';
      return false;
    };
    const walk = node => {
      for (const child of node.children || []) {
        if (!child || typeof child !== 'object') continue;
        if (match(child)) found.push(child);
        walk(child);
      }
    };
    walk(this); return found;
  }
  get scrollHeight(){return 80}
  getBoundingClientRect(){return {left:0,top:0,width:0,height:0}}
  scrollIntoView(){}
}

function createContext(payload, calls) {
  const ids = new Map();
  for (const id of ['status','form','draft','draftPreview','autoDraft','projectUid',
    'dashboardLink','sheetLink','chat','chatSend','chatMessage','chatLog','groups',
    'draftRows','applyDraft']) ids.set(id,new Node(id === 'form' ? 'form' : 'div'));
  const document = {
    getElementById:id => ids.get(id) || new Node('div'),
    createElement:tag => new Node(tag),
    createTextNode:text => ({textContent:String(text)}),
    querySelectorAll:() => []
  };
  const context = vm.createContext({
    document, location:{search:'?uid=ABC123',pathname:'/technical',replace(){}},
    window:{open:() => null},
    fetch:async (_url,options) => {
      const body = JSON.parse(options.body); calls.push(body);
      const result = body.name === 'dashboardSaveTechnicalFields'
        ? {fields:[],blocks:[],synced:true,syncMessage:'A műszaki leírás mentve.'}
        : payload;
      return {status:200,ok:true,json:async () => ({result})};
    },
    requestAnimationFrame:fn => fn(), setTimeout, clearTimeout, console,
    URLSearchParams, confirm:() => true
  });
  vm.runInContext(script,context);
  return {context,ids};
}

test('A /technical oldal a dokumentum sorrendjében, szerkeszthető blokkokkal jelenik meg',async () => {
  const calls = [];
  const payload = {
    sheetUrl:'https://docs.google.com/spreadsheets/d/x/edit',aiConfigured:false,
    outline:[
      {type:'heading',id:'b0',text:'Adatok',ordinal:0},
      {type:'text',id:'b1',text:'Fix szöveg',ordinal:1},
      {type:'fields',keys:['TERV_TARGYA'],context:'Tárgy: {{TERV_TARGYA}}',ordinal:2},
      {type:'auto',text:'{{Teljes név}}',preview:'Lovas Krisztián',ordinal:3},
      {type:'table',note:'Táblázat'}
    ],
    blocks:[
      {id:'b0',text:'Adatok',value:'',manual:false},
      {id:'b1',text:'Fix szöveg',value:'Kézi szöveg',manual:true}
    ],
    fields:[{key:'TERV_TARGYA',help:'A terv tárgya',value:'',manual:false,default:'alap'}],
    missingFields:[]
  };
  const {ids} = createContext(payload,calls);
  await new Promise(resolve => setTimeout(resolve,20));
  const groups = ids.get('groups');
  const all = [];
  const walk = node => {
    for (const child of node.children || []) {
      if (child && typeof child === 'object') { all.push(child); walk(child); }
    }
  };
  walk(groups);
  const block = all.find(node => node.dataset?.blockId === 'b1');
  assert.ok(block,'Hiányzik a szerkeszthető fix szövegblokk.');
  assert.equal(block.value,'Kézi szöveg');
  const field = all.find(node => node.dataset?.key === 'TERV_TARGYA');
  assert.ok(field,'Hiányzik a dokumentumhelyhez rendelt mező.');
  const textOf = node => String(node.textContent || '') +
    (node.children || []).map(child => typeof child === 'string' ? child : textOf(child)).join('');
  assert.ok(all.some(node => node.className === 'doc-auto' &&
    textOf(node).includes('Lovas Krisztián')),
    'Az automatikus szöveg előnézete hiányzik.');
  assert.ok(all.some(node => node.className === 'doc-table-note'));

  const form = ids.get('form');
  field.value = 'Új tervtárgy';
  block.value = 'Módosított fix szöveg';
  await form.submitHandler({preventDefault(){}});
  const save = calls.find(call => call.name === 'dashboardSaveTechnicalFields');
  assert.ok(save,'A mentés nem indult el.');
  assert.equal(save.args[2].b1.value,'Módosított fix szöveg');
  assert.equal(save.args[2].b0.value,'');
});
