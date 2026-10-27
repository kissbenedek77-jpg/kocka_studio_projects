'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {google} = require('googleapis');
const {googleClient} = require('../server/google.cjs');
const {projectPhases,phaseChange} = require('../server/phases.cjs');

test('A _ProjektSzakasz sorokból a négy szakasz állapota épül', () => {
  const phases = projectPhases([
    ['ABC123',2,'2026-02-01',''],
    ['abc123',1,'','2026-01-31'],
    ['XYZ',3,'x','y']
  ],'ABC123');
  assert.equal(phases.length,4);
  assert.equal(phases[0].kesz,'2026-01-31');
  assert.equal(phases[1].kezdes,'2026-02-01');
  assert.equal(phases[2].kezdes,'');
});

test('A 2. szakasz minden köre megmarad a dashboard állapotában', () => {
  const phases=projectPhases([
    ['ABC123',2,'2026-01-01','2026-01-05'],
    ['ABC123',2,'2026-01-06',''],
    ['ABC123',2,'2026-01-10','2026-01-12']
  ],'ABC123');
  assert.equal(phases[1].kezdes,'2026-01-10');
  assert.equal(phases[1].rounds.length,3);
  assert.equal(phases[1].rounds[0].restartedAt,'2026-01-06');
  assert.equal(phases[1].rounds[1].restartedAt,'2026-01-10');
  assert.equal(phases[1].rounds[2].kesz,'2026-01-12');
});

test('A szakaszműveletek érvényességi szabályai', () => {
  const empty = projectPhases([],'ABC123');
  assert.deepEqual(phaseChange('done',1,{started:true,exists:true,phases:empty},'T1'),
    {kezdes:'',kesz:'T1'});
  assert.throws(() => phaseChange('done',2,{started:true,exists:true,phases:empty},'T'),
    /még nem indult el/);
  assert.throws(() => phaseChange('done',1,{started:false,exists:true,phases:empty},'T'),
    /még nem indult el/);
  assert.throws(() => phaseChange('start',1,{started:true,exists:true,phases:empty},'T'),
    /1\. szakasz/);
  assert.throws(() => phaseChange('start',2,{started:true,exists:true,phases:empty},'T'),
    /Előbb zárd le az előző szakaszt/);
  assert.throws(() => phaseChange('start',4,{started:true,exists:false,phases:empty},'T'),
    /nincs megadva/);
  assert.throws(() => phaseChange('restart',3,{started:true,exists:true,phases:empty},'T'),
    /csak a 2\. szakasz/);
  assert.throws(() => phaseChange('move',1,{started:true,exists:true,phases:empty},'T'),
    /Ismeretlen szakaszművelet/);
  const done1 = projectPhases([['ABC123',1,'','k']],'ABC123');
  assert.deepEqual(phaseChange('start',2,{started:true,exists:true,phases:done1},'T2'),
    {kezdes:'T2',kesz:''});
  const running2 = projectPhases([['ABC123',1,'','k'],['ABC123',2,'x','']],'ABC123');
  assert.throws(() => phaseChange('start',2,{started:true,exists:true,phases:running2},'T'),
    /már elindult/);
  assert.throws(() => phaseChange('done',1,{started:true,exists:true,phases:done1},'T'),
    /már elkészült/);
  assert.deepEqual(phaseChange('restart',2,{started:true,exists:true,phases:running2},'T3'),
    {kezdes:'T3',kesz:''});
  assert.throws(() => phaseChange('restart',2,{started:true,exists:true,phases:projectPhases([
    ['ABC123',2,'x','k'],['ABC123',3,'y','']],'ABC123')},'T4'),/3\. szakasz indítása után/);
});

test('A szakaszművelet a _ProjektSzakasz lapot írja és a sorrendet betartja', async () => {
  const original = google.sheets;
  const row = Array(65).fill(''); row[0] = 'ABC123'; row[4] = ''; row[7] = 'Kiss'; row[8] = 'Anna';
  row[51] = '30'; row[52] = '20'; row[53] = '10';
  const timelineRows = [['ABC123','2026-01-10T00:00:00.000Z']];
  const phaseRows = [];
  const appends = [], updates = [];
  google.sheets = () => ({spreadsheets:{
    get:async options => options.includeGridData ? {data:{sheets:[]}} :
      {data:{sheets:[{properties:{title:'_ProjektSzakasz'}}]}},
    values:{
      get:async options => ({data:{values:options.range.includes('A2:BM') ? [row] :
        options.range.includes('_ProjektIdővonal') ? timelineRows :
        options.range.includes('_ProjektSzakasz') ? phaseRows : []}}),
      append:async options => {appends.push(options);
        phaseRows.push(options.requestBody.values[0].slice()); return {data:{}};},
      update:async options => {const match = String(options.range).match(/!C(\d+):D\d+/);
        if (match) {const at = Number(match[1]) - 2; if (phaseRows[at]) {
          phaseRows[at][2] = options.requestBody.values[0][0];
          phaseRows[at][3] = options.requestBody.values[0][1];}}
        updates.push(options); return {data:{}};},
      batchGet:async options => ({data:{valueRanges:options.ranges.map(range =>
        range.includes('_ProjektSzakasz') ? {values:phaseRows} : {values:[]})}})
    }
  }});
  try {
    const client = googleClient({clientId:'test',clientSecret:'test',baseUrl:'https://node.example',
      sheetId:'phase-main',sheetName:'Adatok'});
    await assert.rejects(client.setPhase('ABC123','start','2'), /Előbb zárd le az előző szakaszt/);
    await assert.rejects(client.setPhase('ABC123','start','1'), /1\. szakasz/);
    await assert.rejects(client.setPhase('ABC123','start','4'), /nincs megadva/);
    const done = await client.setPhase('ABC123','done','1');
    assert.match(done.message, /1\. szakasz/);
    assert.deepEqual(appends.at(-1).requestBody.values[0].slice(0,2), ['ABC123',1]);
    assert.equal(appends.at(-1).requestBody.values[0][3].length > 0, true);
    await client.setPhase('ABC123','start','2');
    assert.deepEqual(appends.at(-1).requestBody.values[0].slice(0,2), ['ABC123',2]);
    assert.equal(appends.at(-1).requestBody.values[0][2].length > 0, true);
    assert.equal(appends.at(-1).requestBody.values[0][3], '');
    await client.setPhase('ABC123','restart','2');
    assert.deepEqual(appends.at(-1).requestBody.values[0].slice(0,2),['ABC123',2]);
    assert.equal(phaseRows[1][2].length > 0,true);
    assert.equal(phaseRows[2][3],'');
    await client.setPhase('ABC123','done','2');
    assert.equal(updates.at(-1).range,"'_ProjektSzakasz'!C4:D4");
    assert.equal(phaseRows[1][3],'');
    assert.equal(phaseRows[2][3].length > 0,true);
  } finally {
    google.sheets = original;
  }
});

const dashboardHtml = fs.readFileSync(path.join(__dirname,'..','dashboard_v2.html'),'utf8');
const dashboardScript = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
const phaseSource = dashboardScript.slice(dashboardScript.indexOf('    const PHASE_COLORS='),
  dashboardScript.indexOf('    function renderLegacyStartDate'));

function timelineNodes(project,daysSince=()=>12){
  const nodes = {};
  const $ = id => nodes[id] || (nodes[id] = {textContent:'',className:'',style:{},children:[],
    append(...items){this.children.push(...items)},replaceChildren(){this.children=[]}});
  const element = (tag,className,text) => ({tag,className,textContent:text===undefined?'':String(text),
    style:{},children:[],append(...items){this.children.push(...items)},
    prepend(...items){this.children.unshift(...items)},replaceChildren(){this.children=[]}});
  const context = vm.createContext({$,element,project,step:0,labels:['0','1','2','3','4','5','6'],
    projectColor:() => '●',calendarDaysSince:daysSince,renderLegacyStartDate:() => {},
    button:(parent,text,handler,kind) => {const node = element('button',kind||'',text);
      node.click = handler;node.setAttribute=(name,value)=>{node[name]=value};parent.append(node);return node;},
    callAction:() => {}});
  vm.runInContext(phaseSource,context);
  context.renderTimeline();
  return nodes;
}

function phaseState(szakasz,kezdes,kesz){return {szakasz,kezdes:kezdes||'',kesz:kesz||''};}

test('A folyamatjelző a futó szakaszt a hosszáig tölti, gombbal zárható', () => {
  const nodes = timelineNodes({stage:'started',startedAt:'2026-01-01T00:00:00.000Z',
    offer:{deadline5:'20',deadline6:'10',deadline7:'5',deadline8:'4'},
    phases:[phaseState(1),phaseState(2),phaseState(3),phaseState(4)]});
  const track = nodes.timelineTrack;
  assert.equal(track.children.length,4);
  assert.deepEqual(track.children.map(item => item.style.flexGrow),['20','10','5','4']);
  assert.equal(track.children[0].children[0].style.width,'60%');
  assert.equal(track.children[0].children[0].style.background,'#4085a6');
  assert.equal(track.children[1].children[0].style.width,'0%');
  assert.equal(track.children[0].children[1].textContent,'12 / 20 nap');
  assert.deepEqual(nodes.timelineActions.children.map(item => item.textContent),['✓','▶']);
  assert.equal(nodes.timelineActions.children[0].disabled,false);
  assert.equal(nodes.timelineActions.children[1].disabled,true);
  assert.equal(nodes.timelineStatus.textContent,'1. szakasz · 12. nap / 20 nap');
});

test('A kész szakasz zöld, és a következő indítható', () => {
  const nodes = timelineNodes({stage:'started',startedAt:'2026-01-01T00:00:00.000Z',
    offer:{deadline5:'20',deadline6:'10'},
    phases:[phaseState(1,'','2026-01-15T00:00:00.000Z'),phaseState(2),phaseState(3),phaseState(4)]});
  assert.equal(nodes.timelineTrack.children[0].children[0].style.background,'#5d986d');
  assert.equal(nodes.timelineTrack.children[0].children[0].style.width,'100%');
  assert.deepEqual(nodes.timelineActions.children.map(item => item.textContent),['✓','▶']);
  assert.equal(nodes.timelineActions.children[0].disabled,true);
  assert.equal(nodes.timelineActions.children[1].disabled,false);
  assert.equal(nodes.timelineStatus.textContent,'A 2. szakasz indításra vár');
});

test('A 2. szakasz narancs, határidő előtt piros, és van újraindító gomb', () => {
  const orange = timelineNodes({stage:'started',startedAt:'2026-01-01T00:00:00.000Z',
    offer:{deadline5:'20',deadline6:'17',deadline7:'5'},
    phases:[phaseState(1,'','k'),phaseState(2,'2026-01-15T00:00:00.000Z'),phaseState(3)]});
  assert.equal(orange.timelineTrack.children[1].children[0].style.background,'#d09646');
  assert.equal(orange.timelineTrack.children[1].children[0].style.width,'71%');
  assert.deepEqual(orange.timelineActions.children.map(item => item.textContent),['✓','▶','0']);
  assert.equal(orange.timelineStatus.textContent,'2. szakasz · 12. nap / 17 nap');
  const red = timelineNodes({stage:'started',startedAt:'2026-01-01T00:00:00.000Z',
    offer:{deadline5:'20',deadline6:'15'},
    phases:[phaseState(1,'','k'),phaseState(2,'2026-01-20T00:00:00.000Z'),phaseState(3)]});
  assert.equal(red.timelineTrack.children[1].children[0].style.background,'#b34b42');
});

test('A futó sáv a határidőnél megáll, a négy alapszín eltérő', () => {
  const nodes = timelineNodes({stage:'started',startedAt:'2026-01-01T00:00:00.000Z',
    offer:{deadline5:'8',deadline6:'8',deadline7:'8',deadline8:'8'},
    phases:[phaseState(1),phaseState(2),phaseState(3),phaseState(4)]});
  assert.equal(nodes.timelineTrack.children[0].children[0].style.width,'100%');
  assert.equal(nodes.timelineTrack.children[0].children[1].textContent,'8 / 8 nap');
  const backgrounds=nodes.timelineTrack.children.map(item=>item.style.background);
  assert.equal(new Set(backgrounds).size,4);
});

test('Az első szakasz a szerződés dátumától számol, az indítás dátuma külön látszik', () => {
  const nodes=timelineNodes({stage:'started',startedAt:'2026-01-20T12:00:00.000Z',
    contractDate:'2026-01-10T12:00:00.000Z',offer:{deadline5:'20',deadline6:'10'},
    phases:[phaseState(1,'2026-01-20T12:00:00.000Z'),phaseState(2)]},date=>date.getUTCDate()===10?12:2);
  assert.equal(nodes.timelineTrack.children[0].children[0].style.width,'60%');
  assert.equal(nodes.timelineTrack.children[0].children[1].textContent,'12 / 20 nap');
  assert.match(nodes.timelineTitle.textContent,/Szerződés dátuma:.*Projekt indítása:/);
});

test('A kész 2. szakasz újraindítható a 3. indítása előtt', () => {
  const nodes = timelineNodes({stage:'started',startedAt:'2026-01-01T00:00:00.000Z',
    offer:{deadline5:'8',deadline6:'8',deadline7:'8'},
    phases:[phaseState(1,'','k'),phaseState(2,'x','k'),phaseState(3)]});
  assert.deepEqual(nodes.timelineActions.children.map(item=>item.textContent),['✓','▶','0']);
  assert.equal(nodes.timelineActions.children[1].disabled,false);
});

test('A 2. szakasz minden köre külön sávot és balra igazított hossz címkét kap', () => {
  const phases=projectPhases([
    ['ABC123',1,'','2026-01-01'],
    ['ABC123',2,'2026-01-02','2026-01-04'],
    ['ABC123',2,'2026-01-05',''],
    ['ABC123',2,'2026-01-08','']
  ],'ABC123');
  const nodes=timelineNodes({stage:'started',startedAt:'2026-01-01T00:00:00.000Z',
    offer:{deadline5:'8',deadline6:'8',deadline7:'8'},phases},()=>2);
  assert.equal(nodes.timelineTrack.children.length,5);
  assert.deepEqual(nodes.timelineLengths.children.map(item=>item.textContent),
    ['1. · 8 nap','2/1 · 8 nap','2/2 · 8 nap','2/3 · 8 nap','3. · 8 nap']);
  assert.deepEqual(nodes.timelineLengths.children.map(item=>item.style.flexGrow),
    nodes.timelineTrack.children.map(item=>item.style.flexGrow));
  assert.equal(nodes.timelineTrack.children[1].children[0].style.background,'#5d986d');
  assert.equal(nodes.timelineTrack.children[2].children[0].style.background,'#a88952');
  assert.equal(nodes.timelineTrack.children[2].children[0].style.width,'38%');
  assert.equal(nodes.timelineTrack.children[3].children[0].style.width,'25%');
  assert.equal(nodes.timelineStrip.style.minWidth,'390px');
});

test('A 4. szakasz csak akkor jelenik meg, ha az ajánlatban megvan', () => {
  const three = timelineNodes({stage:'started',startedAt:'2026-01-01T00:00:00.000Z',
    offer:{deadline5:'5',deadline6:'5',deadline7:'5'},phases:[phaseState(1)]});
  assert.equal(three.timelineTrack.children.length,3);
  const four = timelineNodes({stage:'started',startedAt:'2026-01-01T00:00:00.000Z',
    offer:{deadline5:'5',deadline6:'5',deadline7:'5',deadline8:'5'},phases:[phaseState(1)]});
  assert.equal(four.timelineTrack.children.length,4);
});


