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
  insertBefore(node,reference){
    if (!node || typeof node !== 'object') return;
    node.parentNode = this;
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index < 0) this.children.push(node);
    else this.children.splice(index,0,node);
  }
  remove(){
    if (!this.parentNode) return;
    const list = this.parentNode.children;
    const index = list.indexOf(this);
    if (index >= 0) list.splice(index,1);
    this.parentNode = null;
  }
  get nextSibling(){
    if (!this.parentNode) return null;
    const list = this.parentNode.children;
    return list[list.indexOf(this)+1] || null;
  }
  addEventListener(type,handler){
    if (type === 'submit') this.submitHandler = handler;
    if (type === 'click') this.clickHandler = handler;
    if (type === 'keydown') this.keydownHandler = handler;
    if (type === 'input') this.inputHandler = handler;
    if (type === 'focusin') this.focusinHandler = handler;
  }
  removeEventListener(){}
  replaceWith(other){
    if (!this.parentNode) return;
    const list = this.parentNode.children;
    const index = list.indexOf(this);
    if (index >= 0) list[index] = other;
    other.parentNode = this.parentNode;
    this.parentNode = null;
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
      if (selector.startsWith('.'))
        return (' ' + String(node.className || '') + ' ').includes(' ' + selector.slice(1) + ' ');
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
  getBoundingClientRect(){
    return this.rect || {left:0,top:0,right:600,width:600,height:40,bottom:40};
  }
  scrollIntoView(){}
  focus(){}
  select(){}
}

function createContext(payload, calls) {
  const ids = new Map();
  for (const id of ['status','form','draft','draftPreview','autoDraft','projectUid',
    'dashboardLink','sheetLink','chat','chatSend','chatMessage','chatLog','groups',
    'chatTarget','chatToggle','chatBody','draftRows','applyDraft'])
    ids.set(id,new Node(id === 'form' ? 'form' : 'div'));
  // A valódi oldalon a mezők a formon belül vannak; a teszthez is így kötjük be.
  ids.get('form').append(ids.get('groups'));
  const document = {
    getElementById:id => ids.get(id) || new Node('div'),
    createElement:tag => new Node(tag),
    createTextNode:text => ({textContent:String(text)}),
    querySelectorAll:() => [],
    documentElement:{style:{values:{},setProperty(name,value){this.values[name] = value}}}
  };
  const window = {
    open:() => null, innerHeight:900,
    addEventListener(type,handler){ if (type === 'scroll') this.scrollHandler = handler; }
  };
  const context = vm.createContext({
    document, location:{search:'?uid=ABC123',pathname:'/technical',replace(){}},
    window,
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
  return {context,ids,window};
}

test('A chat a lap alján rögzítve jelenik meg, a látható mezőt pedig finom szín jelöli',() => {
  assert.match(html,/#chat\{position:fixed/,'A chat a képernyő alján rögzített legyen.');
  assert.match(html,/\.doc-field textarea\.active-input/,'Az aktív beviteli mezőnek saját kiemelése legyen.');
  assert.match(html,/--chat-height/,'A chat magasságát a tartalom és a mentősáv kövesse.');
  assert.match(html,/#chatToggle/,'A chat összecsukható legyen.');
});

test('A chat a képernyőn látható első mezőre vonatkozik',async () => {
  const calls = [];
  const payload = {
    sheetUrl:'https://docs.google.com/spreadsheets/d/x/edit',aiConfigured:true,
    outline:[
      {type:'heading',level:'chapter',number:1,text:'Adatok',readonly:true},
      {type:'fields',keys:['TERV_TARGYA'],context:'',readonly:false},
      {type:'heading',level:'chapter',number:2,text:'Tervezési program',readonly:true},
      {type:'field',key:'TERVEZESI_PROGRAM:c',range:true,readonly:false}
    ],
    blocks:[],
    fields:[
      {key:'TERV_TARGYA',help:'A terv tárgya',value:'Lakóépület felújítása.',manual:false},
      {key:'TERVEZESI_PROGRAM:c',help:'Tervezési program c) pontjának végleges szövege',
        value:'Az ingatlan Dombóvár belterületén helyezkedik el.',manual:false}
    ],
    chatKeys:['TERV_TARGYA','TERVEZESI_PROGRAM:c'],
    valueRows:[],placeholderValues:{},editablePlaceholders:[],missingFields:[]
  };
  const {ids,window} = createContext(payload,calls);
  await new Promise(resolve => setTimeout(resolve,20));
  const groups = ids.get('groups');
  const all = [];
  const walk = node => {
    for (const child of node.children || []) {
      if (child && typeof child === 'object') { all.push(child); walk(child); }
    }
  };
  walk(groups);
  const inputFor = key => all.find(node => node.dataset?.key === key);
  const first = inputFor('TERV_TARGYA');
  const second = inputFor('TERVEZESI_PROGRAM:c');
  assert.ok(first && second,'Hiányoznak a szerkeszthető mezők.');
  assert.match(first.className,/active-input/,'Az első látható beviteli mező aktív jelölést kap.');
  assert.doesNotMatch(second.className,/active-input/);

  // Görgetés után a második mező kerül a képernyő tetejére: az lesz aktív.
  first.rect = {top:-320,height:60,bottom:-260,width:600};
  second.rect = {top:120,height:60,bottom:180,width:600};
  window.scrollHandler();
  assert.doesNotMatch(first.className,/active-input/,'A kigörgetett mező már nem aktív.');
  assert.match(second.className,/active-input/,'A látható első mező lesz aktív.');
  assert.match(ids.get('chatTarget').textContent,/Tervezési program c\)/,
    'A chat a kijelölt beviteli mezőt nevezi meg.');

  // A felső térköz (24 px) fölött kilógó mező még nem aktív, a következő igen.
  first.rect = {top:-20,height:40,bottom:20,width:600};
  second.rect = {top:40,height:60,bottom:100,width:600};
  window.scrollHandler();
  assert.match(second.className,/active-input/,
    'A felső térköz alatt látszó mező aktiválódik.');

  // Kattintás után a mező „rögzül”: addig marad az AI célpontja, amíg teljesen
  // ki nem kerül a viewportból.
  ids.get('form').focusinHandler({target:second});
  first.rect = {top:200,height:40,bottom:240,width:600};
  second.rect = {top:400,height:60,bottom:460,width:600};
  window.scrollHandler();
  assert.match(second.className,/active-input/,
    'A kiválasztott mező görgetéskor is megtartja az AI-fókuszt, amíg látszik.');
  second.rect = {top:950,height:60,bottom:1010,width:600};
  first.rect = {top:100,height:40,bottom:140,width:600};
  window.scrollHandler();
  assert.match(first.className,/active-input/,
    'A teljesen kigörgetett mező után a látható első mező lesz aktív.');
  ids.get('form').focusinHandler({target:second});

  // A mező még nincs mentve: a felület a sablon alapértékét mutatja helyőrzőként,
  // a chatnek ezt a látható szöveget kell átadnia.
  second.value='';
  second.placeholder='A környéken kialakult építészeti arculat nincs.';
  ids.get('chatMessage').value = 'Fogalmazd rövidebbre.';
  ids.get('chatSend').clickHandler();
  await new Promise(resolve => setTimeout(resolve,20));
  const chat = calls.find(call => call.name === 'dashboardTechnicalChat');
  assert.ok(chat,'A chat kérés nem indult el.');
  assert.equal(chat.args[1].focusKey,'TERVEZESI_PROGRAM:c');
  assert.equal(chat.args[1].focusValue,'A környéken kialakult építészeti arculat nincs.');
  assert.equal(chat.args[1].focusLabel,'Tervezési program c) pontjának végleges szövege');
});

test('Az AI-javaslat a mezőnél jelenik meg, beillesztés után visszaállítható',async () => {
  const calls = [];
  const payload = {
    sheetUrl:'https://docs.google.com/spreadsheets/d/x/edit',aiConfigured:true,
    outline:[
      {type:'heading',level:'chapter',number:1,text:'Adatok',readonly:true},
      {type:'fields',keys:['TERV_TARGYA'],context:'',readonly:false}
    ],
    blocks:[],
    fields:[{key:'TERV_TARGYA',help:'A terv tárgya',value:'Régi szöveg.',manual:true}],
    chatKeys:['TERV_TARGYA'],
    sections:{'TERV_TARGYA':'Új, rövidített szöveg.'},
    valueRows:[],placeholderValues:{},editablePlaceholders:[],missingFields:[]
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
  const input = all.find(node => node.dataset?.key === 'TERV_TARGYA');
  assert.ok(input,'Hiányzik a szerkeszthető mező.');
  const wrapper = input.parentNode;
  const label = wrapper.children.find(node => node.tagName === 'LABEL');
  const sendChat = async () => {
    ids.get('chatMessage').value = 'Rövidítsd.';
    ids.get('chatSend').clickHandler();
    await new Promise(resolve => setTimeout(resolve,20));
    const suggestion = input.nextSibling;
    assert.ok(suggestion && suggestion.className === 'ai-suggestion',
      'A javaslatnak a mezőnél, helyben kell megjelennie, nem külön szakaszban.');
    return suggestion;
  };
  const first = await sendChat();
  const actions = first.children.find(node => node.className === 'ai-suggestion-actions');
  const apply = actions.children.find(node => node.textContent === 'Beillesztés');
  assert.ok(apply,'Hiányzik a beillesztés gomb.');
  apply.clickHandler();
  assert.equal(input.value,'Új, rövidített szöveg.');
  const badge = label.children.find(node => node.className === 'ai-badge');
  assert.ok(badge,'Az AI-módosítás jelzésnek a Kézi jelzés mellett, a címkénél kell lennie.');
  assert.equal(badge.textContent,'AI-módosítás');
  const manualReset = wrapper.children.find(node => node.className === 'reset-field');
  assert.ok(manualReset,'A kézi mező saját visszaállítás gombja a mező alatt van.');
  assert.equal(manualReset.hidden,true,
    'AI-módosításnál a mező alatti visszaállítás gomb nem látszhat, csak a felső.');
  const restore = label.children.find(node => node.textContent === 'Visszaállítás');
  assert.ok(restore,'Hiányzik a visszaállítás gomb.');
  restore.clickHandler();
  assert.equal(input.value,'Régi szöveg.','A visszaállítás az AI előtti szöveget adja vissza.');
  assert.equal(manualReset.hidden,false,
    'Visszaállítás után a mező saját visszaállítás gombja újra látható.');

  // Meglévő szöveg megtartása: a jelölőnégyzettel a javaslat hozzáfűződik.
  const second = await sendChat();
  const keep = second.children.find(node => node.className === 'ai-keep');
  assert.ok(keep,'Hiányzik a meglévő szöveg megtartását választó jelölőnégyzet.');
  keep.children[0].checked = true;
  const apply2 = second.children.find(node => node.className === 'ai-suggestion-actions')
    .children.find(node => node.textContent === 'Beillesztés');
  apply2.clickHandler();
  assert.equal(input.value,'Régi szöveg.\n\nÚj, rövidített szöveg.',
    'Bekapcsolt jelölőnégyzettel a meglévő szöveg megmarad, a javaslat hozzáfűződik.');
  assert.equal(label.children.filter(node => node.className === 'ai-badge').length,1,
    'Többszöri módosításnál is csak egy AI-módosítás jelzés maradhat.');
  assert.equal(label.children.filter(node => node.textContent === 'Visszaállítás').length,1,
    'Többszöri módosításnál is csak egy visszaállítás gomb maradhat.');
  label.children.find(node => node.textContent === 'Visszaállítás').clickHandler();
  assert.equal(input.value,'Régi szöveg.','A visszaállítás minden AI-módosítást visszavon.');
});

test('A szerkezetleírás alpontjai külön beviteli mezőként célpontok',async () => {
  const calls = [];
  const payload = {
    sheetUrl:'https://docs.google.com/spreadsheets/d/x/edit',aiConfigured:true,
    outline:[
      {type:'heading',level:'chapter',number:1,text:'Szerkezetek leírása',readonly:true},
      {type:'field',key:'SZERKEZETEK LEÍRÁSA',range:true,readonly:false}
    ],
    blocks:[],
    fields:[{key:'SZERKEZETEK LEÍRÁSA',help:'Szerkezetek leírása',
      value:'Alapozás\nAz épület alatt sávalap készül, a talaj teherbírása megfelelő.\n\nTeherhordó szerkezetek\nAz épület tartószerkezete teherhordó téglafalakból áll.',
      manual:false,default:''}],
    chatKeys:['SZERKEZETEK LEÍRÁSA'],
    valueRows:[],placeholderValues:{},editablePlaceholders:[],missingFields:[]
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
  const areas = all.filter(node => node.tagName === 'TEXTAREA');
  assert.equal(areas.length,2,'A szerkezetleírás két alpontja két külön mező.');
  assert.equal(areas[0].dataset.chatTarget,'SZERKEZETEK LEÍRÁSA#1');
  assert.equal(areas[1].dataset.chatTarget,'SZERKEZETEK LEÍRÁSA#2');
  assert.match(areas[0].className,/active-input/,
    'A szerkezetleírás első alpontja az aktív beviteli mező.');
});

test('A /technical oldal a dokumentum sorrendjében, szerkeszthető blokkokkal jelenik meg',async () => {
  const calls = [];
  const payload = {
    sheetUrl:'https://docs.google.com/spreadsheets/d/x/edit',aiConfigured:false,
    outline:[
      {type:'heading',level:'chapter',number:1,text:'Adatok',ordinal:0,readonly:true},
      {type:'text',id:'b1',text:'Fix szöveg',ordinal:1,readonly:false},
      {type:'fields',keys:['TERV_TARGYA'],context:'Tárgy: {{TERV_TARGYA}}',ordinal:2,readonly:false},
      {type:'auto',text:'Település: {{telepules}}',preview:'Település: Dombóvár',ordinal:3},
      {type:'auto',text:'Szintek: {{szintek}}',preview:'Szintek: {{szintek}}',ordinal:3},
      {type:'table',note:'Táblázat'},
      {type:'heading',level:'chapter',number:4,text:'Építményérték számítása',ordinal:4,readonly:true},
      {type:'valueTable',chapter:4},
      {type:'field',key:'SZERKEZETEK LEÍRÁSA',range:true,chapter:7,readonly:false,context:'Alapozás'}
    ],
    blocks:[
      {id:'b1',text:'Fix szöveg',value:'Kézi szöveg',manual:true}
    ],
    fields:[
      {key:'TERV_TARGYA',help:'A terv tárgya',value:'',manual:false,default:'alap'},
      {key:'EPITMENYERTEK:terulet_1_m2',help:'1. sor területe',value:'100',manual:false},
      {key:'EPITMENYERTEK:terulet_5_m2',help:'5. sor területe',value:'',manual:false},
      {key:'SZERKEZETEK LEÍRÁSA',help:'Szerkezetek leírása',
        value:'Alapozás\nAz épület alatt sávalap készül.\n\nTeherhordó szerkezetek\nAz épület tartószerkezete teherhordó falakból áll.',
        manual:false,default:''}
    ],
    valueRows:[
      {number:1,key:'EPITMENYERTEK:terulet_1_m2',label:'Lakóépület',unit:'nettó alapterület / m²',price:'600'},
      {number:5,key:'EPITMENYERTEK:terulet_5_m2',label:'Pince',unit:'nettó alapterület / m²',price:'400'}
    ],
    placeholderValues:{'telepules':'Dombóvár'},
    editablePlaceholders:['telepules'],
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
  assert.equal(block.dataset.chatTarget,'BLOCK:b1',
    'A sablon fix bekezdése önálló chat-célpont.');
  const field = all.find(node => node.dataset?.key === 'TERV_TARGYA');
  assert.ok(field,'Hiányzik a dokumentumhelyhez rendelt mező.');
  const textOf = node => String(node.textContent || '') +
    (node.children || []).map(child => typeof child === 'string' ? child : textOf(child)).join('');
  assert.ok(all.some(node => node.className === 'doc-auto' &&
    textOf(node).includes('Dombóvár')),
    'Az automatikus szöveg előnézete hiányzik.');
  const marker = all.find(node => node.dataset?.key === 'telepules');
  assert.ok(marker,'Hiányzik a helyben szerkeszthető helyőrző.');
  assert.equal(marker.tagName,'BUTTON');
  assert.equal(marker.dataset.editable,'1');
  assert.equal(marker.textContent,'Dombóvár');
  const computed = all.find(node => node.dataset?.key === 'szintek');
  assert.ok(computed,'A számított helyőrző nem jelenik meg.');
  assert.equal(computed.dataset.editable,'0');
  assert.equal(computed.disabled,true);
  const collect = root => {
    const found = [];
    const walk = node => {
      for (const child of node.children || []) {
        if (!child || typeof child !== 'object') continue;
        found.push(child); walk(child);
      }
    };
    walk(root); return found;
  };
  const parent = marker.parentNode;
  marker.clickHandler();
  const editorNodes = collect(parent);
  const editor = editorNodes.find(node => node.className === 'placeholder-editor');
  assert.ok(editor,'A helyőrző kattintásra nem nyílik szerkesztő.');
  const editorInput = editorNodes.find(node => node.tagName === 'INPUT');
  editorInput.value = 'Kalocsa';
  const saveButton = editorNodes.find(node => node.tagName === 'BUTTON' &&
    node.textContent === 'Mentés');
  saveButton.clickHandler();
  await new Promise(resolve => setTimeout(resolve,20));
  const inlineSave = calls.find(call => call.name === 'dashboardSaveProjectValue');
  assert.ok(inlineSave,'A helyőrző mentése nem indult el.');
  assert.equal(inlineSave.args[1],'telepules');
  assert.equal(inlineSave.args[2],'Kalocsa');
  assert.equal(marker.textContent,'Kalocsa');
  assert.ok(all.some(node => node.className === 'doc-table-note'));
  assert.ok(all.some(node => node.className === 'doc-section'),'Hiányzik az accordion-szekció.');
  assert.ok(all.filter(node => node.className === 'doc-section').every(node => !node.open),
    'A szekciók alapból zárva legyenek.');
  const area1 = all.find(node => node.dataset?.key === 'EPITMENYERTEK:terulet_1_m2');
  assert.ok(area1,'Hiányzik az építményérték 1. sorának területmezője.');
  assert.equal(area1.value,'100');
  assert.ok(all.some(node => node.className === 'doc-structure-subheading' &&
    node.textContent === 'Alapozás'),'Hiányzik a szerkezetleírás alpontcíme.');

  const form = ids.get('form');
  field.value = 'Új tervtárgy';
  block.value = 'Módosított fix szöveg';
  await form.submitHandler({preventDefault(){}});
  const save = calls.find(call => call.name === 'dashboardSaveTechnicalFields');
  assert.ok(save,'A mentés nem indult el.');
  assert.equal(save.args[2].b1.value,'Módosított fix szöveg');
  assert.equal(save.args[1]['EPITMENYERTEK:terulet_1_m2'],'100');
});
