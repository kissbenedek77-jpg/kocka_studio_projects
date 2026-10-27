'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {renderEmailHtml}=require('../server/email_templates.cjs');

const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard_v2.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);

function dashboardContext(extra) {
  const context = vm.createContext({window:{}, ...extra});
  const rpcSource = script.slice(script.indexOf('    function rpc('), script.indexOf('    function notice('));
  vm.runInContext(rpcSource, context);
  return context;
}

test('Node dashboard RPC a védett API-t hívja és visszaadja az eredményt', async () => {
  let request;
  const context = dashboardContext({fetch:async (url, options) => {
    request = {url, options};
    return {ok:true, json:async () => ({result:[{uid:'ABC123'}]})};
  }});
  const result = await context.rpc('dashboardListProjects');
  assert.equal(result[0].uid, 'ABC123');
  assert.equal(request.url, '/api/rpc');
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(request.options.headers['X-Kocka-RPC'], '1');
  assert.deepEqual(JSON.parse(request.options.body), {name:'dashboardListProjects', args:[]});
});

test('Node dashboard RPC megjeleníthető hibát ad vissza', async () => {
  const context = dashboardContext({fetch:async () => ({ok:false, json:async () => ({error:'Jelentkezz be újra.'})})});
  await assert.rejects(context.rpc('getDashboardProject', 'ABC123'), /Jelentkezz be újra/);
});

test('A tulajdonosi adatmódosítás a középső panelben nyílik meg', () => {
  const start=script.indexOf('    function clientEditAction(');
  const end=script.indexOf("    $('closeClientEditor')",start);
  assert.ok(start>0&&end>start);
  const host={hidden:true,scrollIntoView(){this.scrolled=true}};
  const frame={attributes:{},getAttribute(name){return this.attributes[name]||null},
    set src(value){this.attributes.src=value},removeAttribute(name){delete this.attributes[name]}};
  let action,renders=0;
  const context=vm.createContext({project:{uid:'ABC123'},clientFormOpen:false,
    document:{body:{dataset:{runtime:'node'}}},$:id=>id==='clientEditorHost'?host:frame,
    button:(_parent,_label,handler)=>{action={handler,setAttribute(){}};return action},
    link:()=>{throw new Error('Nem nyílhat külön ügyfélűrlap.')},
    render:()=>{renders++}});
  vm.runInContext(script.slice(start,end),context);
  context.clientEditAction({},'Adatok módosítása');
  action.handler();
  assert.equal(host.hidden,false);
  assert.equal(frame.getAttribute('src'),'/form?uid=ABC123&embed=1');
  assert.equal(renders,1);
  assert.equal(host.scrolled,true);
});

test('Apps Script dashboard továbbra is google.script.run-t használ', async () => {
  let called;
  const run = {
    withSuccessHandler(handler) {this.success = handler; return this;},
    withFailureHandler() {return this;},
    getDashboardProject(...args) {called = args; this.success({uid:args[0]});}
  };
  const google = {script:{run}};
  const context = dashboardContext({window:{google}, google, fetch:() => {throw new Error('Nem hívható');}});
  const result = await context.rpc('getDashboardProject', 'ABC123');
  assert.equal(result.uid, 'ABC123');
  assert.deepEqual(called, ['ABC123']);
});

test('Levélgomb csak előkészített mailto piszkozatot nyit meg', async () => {
  const source = script.slice(script.indexOf('    async function prepareEmail('),
    script.indexOf('    function ',script.indexOf('    async function prepareEmail(')));
  assert.ok(source.includes('async function prepareEmail'));
  let request, noticeText;
  const window = {location:{href:''}};
  const context = vm.createContext({window,project:{uid:'ABC123',email:'client@example.com'},
    busyState:() => {},notice:text => {noticeText=text;},
    rpc:async (...args) => {request=args;return {to:'client@example.com',
      subject:'Ajánlat – próba',text:'Kedves Ügyfelünk!\nPróba'};}});
  vm.runInContext(source,context);
  await context.prepareEmail('offer');
  assert.deepEqual(Array.from(request),['dashboardPrepareEmail','ABC123','offer']);
  assert.match(window.location.href,/^mailto:client%40example\.com\?/);
  assert.equal(new URL(window.location.href).searchParams.get('subject'),'Ajánlat – próba');
  assert.equal(new URL(window.location.href).searchParams.get('body'),'Kedves Ügyfelünk!\nPróba');
  assert.match(noticeText,/levelezőben/);
});

test('Node levélgomb szerkeszthető előnézet után küld',async () => {
  const start=script.indexOf('    let emailKind=');
  const source=script.slice(start,script.indexOf('    function folderLink(',start));
  const elements={};
  const $=id => elements[id] ||= {value:'',innerHTML:'',hidden:true,files:[],children:[],
    classList:{remove(){}},setAttribute(){},replaceChildren(){this.children=[];},
    append(item){this.children.push(item);},focus(){},
    setRangeText(value,start,end){this.value=this.value.slice(0,start)+value+this.value.slice(end)}};
  let request,shown;
  class FakeFileReader {readAsDataURL(file){this.result='data:'+file.type+';base64,'+
    Buffer.from('plusz').toString('base64');this.onload();}}
  const context=vm.createContext({$,document:{body:{dataset:{runtime:'node'}}},
    project:{uid:'ABC123',email:'client@example.com'},busy:false,
    FileReader:FakeFileReader,clearTimeout,setTimeout,
    busyState:value => {context.busy=value;},
    refreshSentMailbox:()=>{},refreshEmailOpens:()=>{},
    doc:() => ({url:'https://docs.google.com/document/d/test/edit'}),
    element:(_tag,_className,text) => ({textContent:text,children:[],
      append(item){this.children.push(item);},
      addEventListener(event,handler){this[event]=handler;},
      setAttribute(name,value){this[name]=value;}}),
    button:(parent,text,handler) => {const node={textContent:text,click:handler,
      setAttribute(name,value){this[name]=value;}};parent.append(node);return node;},
    rpc:async (...args) => {request=args;
      if(args[0]==='dashboardEmailPreview')return {to:'client@example.com',subject:'Ajánlat',
        htmlSource:'<p>Eredeti szöveg</p>',
        html:renderEmailHtml('<p>Eredeti szöveg</p>','https://example.test/download/preview-token'),
        downloadUrl:'https://example.test/download/preview-token',
        inserts:{signature:'<div>Aláírás</div>',button:'<a>Gomb</a>',link:'<a>Link</a>'},
        downloads:[{filename:'ajanlat.pdf'}],attachments:[]};
      if(args[0]==='dashboardRenderEmailHtml')return {htmlSource:args[2],
        html:renderEmailHtml(args[2],args[3])};
      return {sent:true,saved:true,to:'client@example.com'};},
    notice:(text,kind) => {shown={text,kind}}});
  vm.runInContext(source,context);
  await context.sendEmail('offer','Ajánlat küldése');
  assert.deepEqual(Array.from(request),['dashboardEmailPreview','ABC123','offer']);
  assert.equal($('emailBackdrop').hidden,false);
  assert.equal($('emailAutoFiles').children[0].textContent,'ajanlat.pdf');
  assert.equal($('emailPreviewFrame').srcdoc,
    renderEmailHtml('<p>Eredeti szöveg</p>','https://example.test/download/preview-token'));
  $('emailSubject').value='Szerkesztett ajánlat';
  $('emailEditor').innerHTML='<h2>Új szöveg</h2>';
  await context.renderEmailPreview();
  assert.equal($('emailPreviewFrame').srcdoc,
    renderEmailHtml('<h2>Új szöveg</h2>','https://example.test/download/preview-token'));
  await context.toggleEmailSource();
  assert.equal($('emailHtmlSource').value,'<h2>Új szöveg</h2>');
  $('emailHtmlSource').value='<p>Gomb nélkül</p>';
  $('emailHtmlSource').selectionStart=$('emailHtmlSource').value.length;
  $('emailHtmlSource').selectionEnd=$('emailHtmlSource').value.length;
  context.insertEmailHtml('<p><a href="{{DOWNLOAD_URL}}">Dokumentumok letöltése</a></p>');
  assert.match($('emailHtmlSource').value,/\{\{DOWNLOAD_URL\}\}/);
  await context.toggleEmailSource();
  assert.match($('emailEditor').innerHTML,/\{\{DOWNLOAD_URL\}\}/);
  $('emailEditor').innerHTML='<h2>Új szöveg</h2>';
  context.addEmailFiles([{name:'plusz.txt',type:'text/plain',size:5,lastModified:1}]);
  context.addEmailFiles([{name:'masik.txt',type:'text/plain',size:4,lastModified:2}]);
  assert.equal($('emailSelectedFiles').children.length,2);
  $('emailSelectedFiles').children[1].children[1].click();
  assert.equal($('emailSelectedFiles').children.length,1);
  assert.equal(shown.text,'');
  await context.sendPreviewEmail();
  assert.equal(request[0],'dashboardSendEmail');
  assert.equal(request[1],'ABC123');
  assert.equal(request[2],'offer');
  assert.equal(request[3].subject,'Szerkesztett ajánlat');
  assert.equal(request[3].to,'client@example.com');
  assert.equal(request[3].htmlSource,'<h2>Új szöveg</h2>');
  assert.equal(request[3].extraAttachments[0].filename,'plusz.txt');
  assert.equal(request[3].extraAttachments.length,1);
  assert.equal(request[3].extraAttachments[0].base64,Buffer.from('plusz').toString('base64'));
  assert.equal(request[4],'email:offer:ABC123');
  assert.equal($('emailBackdrop').hidden,true);
  assert.match(shown.text,/Elküldött mappába mentve/);
});

test('A levelezés megnyitásait és letöltéseit ikonok számlálják, az időpont popupban látszik',()=>{
  const start=script.indexOf('    let emailOpens=');
  const source=script.slice(start,script.indexOf('    async function refreshSentMailbox(',start));
  const element=(_tag,className,value)=>({className,textContent:value||'',children:[],dataset:{},
    append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},
    setAttribute(){},addEventListener(name,callback){this[name]=callback},focus(){},remove(){}});
  const root=element('div');
  const body=element('body');body.dataset.runtime='node';
  const context=vm.createContext({$,document:{body},
    project:{uid:'ABC123',email:'client@example.com'},element});
  function $(id){return id==='sentMailList'?root:null}
  vm.runInContext(source,context);
  vm.runInContext(`sentMailbox={messages:[{id:'sent:1:2',direction:'sent',messageId:'<15ac641d-f45e-48a2-ae2b-4848325cc7a7@kockastudio.hu>',date:'2026-10-04T10:00:00Z',subject:'Ajánlat'}]};
    emailOpens={configured:true,sent:[{id:'15ac641d-f45e-48a2-ae2b-4848325cc7a7',to:'client@example.com',subject:'Ajánlat',at:'2026-10-04T10:00:00Z',resendId:'email-1'}],
    messages:[{emailId:'15ac641d-f45e-48a2-ae2b-4848325cc7a7',times:[{at:'2026-10-04T10:05:00Z',source:'pixel'}]},
      {emailId:'email-1',times:[{at:'2026-10-04T10:06:00Z',source:'resend'}]}],
    downloads:[{trackingId:'15ac641d-f45e-48a2-ae2b-4848325cc7a7',at:'2026-10-04T10:10:00Z',filename:'ajanlat.pdf'}]};
    renderSentMail()`,context);
  const flatten=node=>[node.textContent,...node.children.flatMap(flatten)].join(' ');
  const shown=flatten(root);
  const all=node=>[node,...node.children.flatMap(all)];
  assert.equal(all(root).find(node=>node.className?.includes('fa-eye'))?.textContent,'1');
  assert.equal(all(root).find(node=>node.className?.includes('fa-download'))?.textContent,'1');
  assert.equal(all(root).find(node=>node.className?.includes('fa-paperclip'))?.textContent,'0');
  assert.doesNotMatch(shown,/12:05:00/);
  all(root).find(node=>node.className?.includes('fa-eye')).click();
  assert.match(flatten(body),/Megnyitás:.*12:05:00/);
  assert.doesNotMatch(flatten(body),/12:06:00/);
  all(root).find(node=>node.className?.includes('fa-download')).click();
  assert.match(flatten(body),/Letöltés:.*12:10:00/);
  assert.match(flatten(body),/ajanlat\.pdf/);
});

test('A bejövő levél beszélgetésként, a mellékletek külön popupban jelennek meg',async()=>{
  const start=script.indexOf('    let emailOpens=');
  const source=script.slice(start,script.indexOf('    async function refreshSentMailbox(',start));
  const element=(_tag,className,value)=>({className,textContent:value||'',children:[],dataset:{},
    append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},
    setAttribute(){},addEventListener(name,callback){this[name]=callback},focus(){},remove(){}});
  const root=element('div'),body=element('body');body.dataset.runtime='node';
  const calls=[];
  const context=vm.createContext({$:id=>id==='sentMailList'?root:null,document:{body},
    project:{uid:'ABC123',email:'client@example.com'},element,
    rpc:async(...args)=>{calls.push(args);return {attachments:[{index:0,filename:'valasz.pdf',size:2048}]}}});
  vm.runInContext(source,context);
  vm.runInContext(`sentMailbox={messages:[{id:'incoming:200:4',direction:'incoming',from:'client@example.com',
    date:'2026-10-04T11:00:00Z',subject:'Válasz',attachmentCount:1}]};emailOpens={sent:[],messages:[],downloads:[]};renderSentMail()`,context);
  const all=node=>[node,...node.children.flatMap(all)];
  assert.match(all(root).map(node=>node.textContent).join(' '),/client@example.com → Ön/);
  const attach=all(root).find(node=>node.className?.includes('fa-paperclip'));
  await attach.click();
  assert.deepEqual(calls[0],['dashboardGetConversationMail','ABC123','incoming:200:4']);
  assert.match(all(body).map(node=>node.textContent).join(' '),/valasz\.pdf/);
});

test('A levél előnézete két sorra korlátozott, lenyitva a teljes szöveg látszik',async()=>{
  assert.match(html,/\.mail-preview\{[^}]*-webkit-line-clamp:2/);
  assert.match(html,/\.mail-body\{max-height:none;overflow:visible\}/);
  const start=script.indexOf('    let emailOpens=');
  const source=script.slice(start,script.indexOf('    async function refreshSentMailbox(',start));
  const element=(_tag,className='',value='')=>({className,textContent:value,children:[],dataset:{},hidden:false,
    append(...items){for(const item of items){item.parent=this;this.children.push(item)}},
    replaceChildren(){this.children=[]},setAttribute(){},addEventListener(name,callback){this[name]=callback},
    querySelector(selector){const name=selector.slice(1);return this.children.find(item=>item.className?.split(' ').includes(name))||
      this.children.map(item=>item.querySelector?.(selector)).find(Boolean)||null},
    after(item){const siblings=this.parent.children,index=siblings.indexOf(this);item.parent=this.parent;siblings.splice(index+1,0,item)},
    remove(){const siblings=this.parent?.children;if(siblings)siblings.splice(siblings.indexOf(this),1)}
  });
  const root=element('div'),body=element('body');body.dataset.runtime='node';
  let calls=0;const full='Első sor. Második sor. Harmadik sor, amely lenyitva is látszik.';
  const context=vm.createContext({$:id=>id==='sentMailList'?root:null,document:{body},
    project:{uid:'ABC123',email:'client@example.com'},element,
    rpc:async()=>{calls++;return {text:full,attachments:[]}}});
  vm.runInContext(source,context);
  vm.runInContext(`sentMailbox={messages:[{id:'incoming:200:4',direction:'incoming',from:'client@example.com',
    date:'2026-10-04T11:00:00Z',subject:'Válasz'}]};emailOpens={sent:[],messages:[],downloads:[]};renderSentMail()`,context);
  await new Promise(resolve=>setImmediate(resolve));
  const all=node=>[node,...node.children.flatMap(all)];
  const preview=all(root).find(node=>node.className==='mail-preview');
  const opener=all(root).find(node=>node.className?.includes('mail-expand'));
  assert.equal(preview.textContent,full);assert.equal(calls,1);
  await opener.click();
  assert.equal(preview.hidden,true);
  assert.equal(all(root).find(node=>node.className==='mail-body')?.textContent,full);
  assert.equal(calls,1);
  await opener.click();assert.equal(preview.hidden,false);
  assert.equal(all(root).some(node=>node.className==='mail-body'),false);
});
