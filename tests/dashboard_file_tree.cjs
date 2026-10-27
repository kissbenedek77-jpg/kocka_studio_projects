'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'..','dashboard_v2.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1]||'';
const source=script.slice(script.indexOf('    function pdfAuditErrorText('),
  script.indexOf('    function queueMemo('));

function node(tag,className='',value=''){
  return {tag,className,textContent:value,children:[],attributes:{},
    append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},
    setAttribute(name,value){this.attributes[name]=value},
    remove(){this.removed=true},
    addEventListener(name,handler){this[name]=handler}};
}
const descendants=item=>[item,...item.children.flatMap(descendants)];

test('A PDF ellenőrzés a fájlpanel fejlécében, a frissítés mellett van; jelmagyarázat nincs',()=>{
  assert.match(html,/<h2 id="fileTreeTitle">Projektfájlok<\/h2><div class="tree-head-actions"><button id="auditFileTree"[^>]*>Ellenőrzés<\/button><button id="refreshFileTree"/);
  assert.match(html,/\$\('auditFileTree'\)\.addEventListener\('click',auditTreePdfs\)/);
  assert.doesNotMatch(source,/tree-legend|tree-audit-button/);
});

test('A mappanév nyit, a fájlok és a mappa valódi ellenőrzési jelzést kapnak',()=>{
  const root=node('div');
  const folderTree=new Map([
    ['',{id:'project',name:'Projekt',folders:[{id:'pdfa',name:'PDFA'}],files:[]}],
    ['pdfa',{id:'pdfa',name:'PDFA',folders:[],files:[
      {id:'good',name:'Aláírólap.pdf',mimeType:'application/pdf',url:'https://example.test/good'},
      {id:'bad',name:'Hibás.pdf',mimeType:'application/pdf',url:'https://example.test/bad'}]}]
  ]);
  const context=vm.createContext({$:id=>id==='fileTree'?root:null,element:node,
    document:{body:{dataset:{runtime:'apps-script'}}},folderTree,
    folderOpen:new Set(['project']),folderTreeError:'',project:{documents:[],issues:[]},
    pdfAudit:{files:[
      {path:'PDFA/Aláírólap.pdf',pdfa:true,profile:'PDF/A-2B',signed:true,signatureVerified:true,signatureSheet:true,error:''},
      {path:'PDFA/Hibás.pdf',pdfa:false,signed:false,signatureSheet:false,error:''}]}});
  vm.runInContext(source,context);
  context.renderFolderTree();
  const folderName=descendants(root).find(item=>item.className==='tree-folder-name'&&
    item.children.some(child=>child.textContent==='PDFA'));
  assert.ok(folderName);
  assert.equal(folderName.attributes['aria-expanded'],'false');
  const folderRow=descendants(root).find(item=>item.children.includes(folderName));
  assert.ok(descendants(folderRow).some(item=>item.className?.includes('tree-status error fa-action fa-triangle-exclamation')));
  folderName.click();
  const fileRows=descendants(root).filter(item=>item.className==='tree-node file');
  assert.equal(fileRows.length,2);
  assert.ok(descendants(fileRows[0]).some(item=>item.title==='PDF/A ellenőrzött (PDF/A-2B)'));
  assert.ok(descendants(fileRows[0]).some(item=>item.title==='Tanúsítványos aláírás ellenőrzött'));
  assert.ok(descendants(fileRows[1]).some(item=>item.className?.includes('tree-status error fa-action fa-triangle-exclamation')));
  const fileLink=descendants(fileRows[0]).find(item=>item.tag==='a');
  assert.equal(fileLink.href,'https://example.test/good');
  assert.equal(fileLink.attributes['aria-label'],'Aláírólap.pdf – PDF');
  const fileIcon=descendants(fileLink).find(item=>item.className?.includes('tree-kind tree-file-kind fa-action fa-file-pdf'));
  assert.equal(fileIcon.attributes['data-file-kind'],'pdf');
  assert.equal(fileIcon.attributes['aria-hidden'],'true');
});

test('A fájltípus ikonja MIME-típus és szükség esetén kiterjesztés alapján készül',()=>{
  const context=vm.createContext({});vm.runInContext(source,context);
  const cases=[
    [{name:'Leírás',mimeType:'application/vnd.google-apps.document'},'document'],
    [{name:'Adatok',mimeType:'application/vnd.google-apps.spreadsheet'},'spreadsheet'],
    [{name:'Bemutató.pptx',mimeType:'application/octet-stream'},'presentation'],
    [{name:'Terv.DWG',mimeType:'application/octet-stream'},'cad'],
    [{name:'Fotó.jpg',mimeType:'image/jpeg'},'image'],
    [{name:'Hang.mp3',mimeType:'audio/mpeg'},'audio'],
    [{name:'Film.mp4',mimeType:'video/mp4'},'video'],
    [{name:'Csomag.zip',mimeType:'application/zip'},'archive'],
    [{name:'Jegyzet.txt',mimeType:'text/plain'},'text'],
    [{name:'Ismeretlen.bin',mimeType:'application/octet-stream'},'other']
  ];
  for(const [file,expected] of cases)assert.equal(context.fileTypeInfo(file).kind,expected,file.name);
});

test('A Kapott anyagok képei belépéshez kötött előnézetként jelennek meg',()=>{
  const root=node('div');
  const context=vm.createContext({$:()=>root,element:node,
    document:{body:{dataset:{runtime:'node'}}},
    folderTree:new Map([
      ['',{id:'project-root-0001',name:'Projekt',folders:[{id:'received-folder-0001',
        name:'Kapott anyagok'}],files:[]}],
      ['received-folder-0001',{id:'received-folder-0001',name:'Kapott anyagok',folders:[],
        files:[{id:'received-image-0001',name:'Helyszín-01.jpg',mimeType:'image/jpeg',
          url:'https://drive.google.com/file/d/received-image-0001/view'}]}]
    ]),folderOpen:new Set(['project-root-0001','received-folder-0001']),
    folderTreeError:'',project:{uid:'ABC123',documents:[],issues:[]},pdfAudit:null});
  vm.runInContext(source,context);context.renderFolderTree();
  const image=descendants(root).find(item=>item.tag==='img'&&item.className==='tree-photo-thumb');
  assert.ok(image);
  assert.equal(image.src,'/api/project-image?uid=ABC123&file=received-image-0001');
  assert.equal(image.loading,'lazy');
  const link=descendants(root).find(item=>item.tag==='a'&&item.children.includes(image));
  assert.equal(link.href,'https://drive.google.com/file/d/received-image-0001/view');
});

test('Vizsgálat nélkül a PDF és a be nem töltött mappa kék teendő',()=>{
  const root=node('div');
  const context=vm.createContext({$:()=>root,element:node,
    document:{body:{dataset:{runtime:'apps-script'}}},
    folderTree:new Map([['',{id:'project',name:'Projekt',folders:[{id:'child',name:'PDFA'}],
      files:[{id:'file',name:'terv.pdf',mimeType:'application/pdf',url:'https://example.test/file'}]}]]),
    folderOpen:new Set(['project']),folderTreeError:'',project:{documents:[],issues:[]},pdfAudit:null});
  vm.runInContext(source,context);context.renderFolderTree();
  const rows=descendants(root).filter(item=>item.className.startsWith('tree-node'));
  assert.ok(rows.some(item=>item.className==='tree-node file'&&
    descendants(item).some(child=>child.className?.includes('tree-status todo fa-action fa-triangle-exclamation'))));
  assert.ok(rows.some(item=>item.className==='tree-node folder'&&
    descendants(item).some(child=>child.className?.includes('tree-status todo fa-action fa-triangle-exclamation'))));
});

test('Az egyszerű fájl nem kap fölösleges állapotikont, a csonkolt lista teendő',()=>{
  const root=node('div');
  const context=vm.createContext({$:()=>root,element:node,
    document:{body:{dataset:{runtime:'apps-script'}}},
    folderTree:new Map([['',{id:'project',name:'Projekt',truncated:true,folders:[],
      files:[{id:'plain',name:'Jegyzet.txt',mimeType:'text/plain',url:'https://example.test/plain'}]}]]),
    folderOpen:new Set(['project']),folderTreeError:'',project:{documents:[],issues:[]},pdfAudit:null});
  vm.runInContext(source,context);context.renderFolderTree();
  const rows=descendants(root).filter(item=>item.className.startsWith('tree-node'));
  const folder=rows.find(item=>item.className==='tree-node folder active');
  const file=rows.find(item=>item.className==='tree-node file');
  assert.ok(descendants(folder).some(item=>item.className?.includes('tree-status todo fa-action fa-triangle-exclamation')));
  assert.ok(!descendants(file).some(item=>item.className.startsWith('tree-status')));
  assert.ok(descendants(root).some(item=>item.textContent.includes('A mappalista nem teljes')));
});

test('Az állapotikon érintésre is megmutatja a magyarázatát',()=>{
  const root=node('div'),body=node('body');body.dataset={runtime:'apps-script'};
  const context=vm.createContext({$:()=>root,element:node,document:{body},
    folderTree:new Map([['',{id:'project',name:'Projekt',folders:[],
      files:[{id:'file',name:'terv.pdf',mimeType:'application/pdf',url:'https://example.test/file'}]}]]),
    folderOpen:new Set(['project']),folderTreeError:'',project:{documents:[],issues:[]},pdfAudit:null});
  vm.runInContext(source,context);context.renderFolderTree();
  const icon=descendants(root).find(item=>item.tag==='button'&&
    item.attributes['aria-label']==='PDF/A és aláírás még nincs ellenőrizve');
  assert.ok(icon);assert.equal(icon.type,'button');
  icon.click();
  const hint=body.children.find(item=>item.className==='tree-hint');
  assert.ok(hint);assert.equal(hint.attributes.role,'status');
  assert.ok(descendants(hint).some(item=>item.textContent==='PDF/A és aláírás még nincs ellenőrizve'));
  const close=descendants(hint).find(item=>item.attributes['aria-label']==='Magyarázat bezárása');
  close.click();assert.equal(hint.removed,true);
});

test('A PDF eredmény azonosító alapján jelenik meg, hiányzó eredmény külön hibajelzés',()=>{
  const root=node('div');
  const context=vm.createContext({$:()=>root,element:node,
    document:{body:{dataset:{runtime:'apps-script'}}},
    folderTree:new Map([['',{id:'project',name:'Projekt',folders:[],files:[
      {id:'checked',name:'Első.pdf',mimeType:'application/pdf',url:'https://example.test/checked'},
      {id:'missing',name:'Második.pdf',mimeType:'application/pdf',url:'https://example.test/missing'}]}]]),
    folderOpen:new Set(['project']),folderTreeError:'',project:{documents:[],issues:[]},
    pdfAudit:{files:[{id:'checked',path:'Régi név/Első.pdf',pdfa:true,profile:'PDF/A-2B',
      signed:false,signatureSheet:false,converted:true,error:''}]}});
  vm.runInContext(source,context);context.renderFolderTree();
  const rows=descendants(root).filter(item=>item.className==='tree-node file');
  assert.ok(descendants(rows[0]).some(item=>item.title?.includes('PDF/A-2b-vá alakítva')));
  assert.ok(descendants(rows[1]).some(item=>item.title?.includes('nincs ellenőrzési eredmény')));
  assert.ok(!descendants(rows[1]).some(item=>item.title?.includes('még nincs ellenőrizve')));
});

test('Az auditált, de még meg nem nyitott almappa nem marad ellenőrizetlen',()=>{
  const root=node('div');
  const context=vm.createContext({$:()=>root,element:node,
    document:{body:{dataset:{runtime:'apps-script'}}},
    folderTree:new Map([['',{id:'project',name:'Projekt',folders:[{id:'other',name:'Egyéb'}],files:[]}]]),
    folderOpen:new Set(['project']),folderTreeError:'',project:{documents:[],issues:[]},
    pdfAudit:{files:[{id:'checked',path:'Egyéb/Terv.pdf',pdfa:true,profile:'PDF/A-2B',
      signed:false,signatureSheet:false,error:''}]}});
  vm.runInContext(source,context);context.renderFolderTree();
  const folder=descendants(root).find(item=>item.className==='tree-node folder'&&
    descendants(item).some(child=>child.textContent==='Egyéb'));
  assert.ok(folder);
  assert.ok(descendants(folder).some(item=>item.className?.includes('tree-status ok fa-action fa-circle-check')));
  assert.ok(!descendants(folder).some(item=>item.className?.includes('tree-status todo fa-action fa-triangle-exclamation')));
});

test('A PDF-hiba ikonja megadja az okot, a részletet és a teendőt',()=>{
  const root=node('div');
  const context=vm.createContext({$:()=>root,element:node,
    document:{body:{dataset:{runtime:'apps-script'}}},
    folderTree:new Map([['',{id:'project',name:'Projekt',folders:[],files:[
      {id:'broken',name:'Sérült.pdf',mimeType:'application/pdf',url:'https://example.test/broken'}]}]]),
    folderOpen:new Set(['project']),folderTreeError:'',project:{documents:[],issues:[]},
    pdfAudit:{files:[{id:'broken',path:'Sérült.pdf',pdfa:false,error:'A veraPDF nem tudta feldolgozni.',
      meaning:'A vizsgálat megszakadt.',diagnostic:'Failed to parse PDF',
      action:'Exportáld újra PDF-ként.'}]}});
  vm.runInContext(source,context);context.renderFolderTree();
  const row=descendants(root).find(item=>item.className==='tree-node file');
  const hint=descendants(row).find(item=>item.className?.includes('tree-status error fa-action fa-triangle-exclamation')).title;
  assert.match(hint,/megfelelőség nem állapítható meg/);
  assert.match(hint,/A vizsgálat megszakadt/);
  assert.match(hint,/Failed to parse PDF/);
  assert.match(hint,/Exportáld újra PDF-ként/);
});
