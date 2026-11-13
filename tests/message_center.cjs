'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createMessageStore, createBrowserApi, normalizeLevel} = require('../public/message-center.js');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// Kis DOM-utĂˇnzat az ĂĽzenetkĂ¶zpont felĂĽletĂ©nek fĂĽsttesztjĂ©hez. Csak azt tudja,
// amit a message-center.js hasznĂˇl; a valĂłdi bĂ¶ngĂ©szĹ‘t nem helyettesĂ­ti.
class FakeElement {
  constructor(tag) {
    this.tagName = String(tag || 'div').toLowerCase();
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.className = '';
    this.hidden = false;
    this.textContent = '';
    this.innerHTML = '';
    this.title = '';
    this.type = '';
    this.style = {};
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name); else classes.delete(name);
        return on;
      }
    };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  append(...nodes) { for (const node of nodes) this.children.push(node); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes.slice(); }
  insertBefore(node, reference) {
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index < 0) this.children.push(node);
    else this.children.splice(index, 0, node);
    return node;
  }
  get firstChild() { return this.children[0] || null; }
  addEventListener(type, handler) {
    if (!this.handlers) this.handlers = {};
    this.handlers[String(type)] = handler;
  }
  focus() {}
  querySelector() { return null; }
}

function fakeDocument(page) {
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  if (page) body.dataset.ksPage = page;
  const main = new FakeElement('main');
  body.append(main);
  const documentElement = {style: {values: {}, setProperty(name, value) { this.values[name] = value; }}};
  return {
    readyState: 'complete',
    head,
    body,
    documentElement,
    createElement: tag => new FakeElement(tag),
    createDocumentFragment: () => new FakeElement('#fragment'),
    addEventListener() {},
    querySelector(selector) { return selector === 'main.shell' || selector === 'main' ? main : null; }
  };
}

function collect(element, predicate, found = []) {
  if (!element || typeof element !== 'object') return found;
  if (predicate(element)) found.push(element);
  for (const child of element.children || []) collect(child, predicate, found);
  return found;
}

test('Az ĂĽzenetkĂ¶zpont szintnevei egysĂ©gesek', () => {
  assert.equal(normalizeLevel(''), 'info');
  assert.equal(normalizeLevel('success'), 'success');
  assert.equal(normalizeLevel('warning'), 'warning');
  assert.equal(normalizeLevel('error'), 'error');
  assert.equal(normalizeLevel('note'), 'note');
  assert.equal(normalizeLevel(true), 'error');
  assert.equal(normalizeLevel(false), 'info');
  assert.equal(normalizeLevel('ismeretlen'), 'info');
});

test('A kulcsolt ĂĽzenet helyben frissĂĽl, nem gyĹ±lik', () => {
  const store = createMessageStore();
  store.notice('MentĂ©sâ€¦', '', {key: 'status'});
  store.notice('MentĂ©sâ€¦', '', {key: 'status'});
  let items = store.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].count, 2);
  store.notice('A mĹ±szaki leĂ­rĂˇs mentve.', 'success', {key: 'status'});
  items = store.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'A mĹ±szaki leĂ­rĂˇs mentve.');
  assert.equal(items[0].level, 'success');
  assert.equal(items[0].count, 1);
  // Ăśres szĂ¶veg a kulcsolt ĂĽzenet tĂ¶rlĂ©se.
  store.notice('', '', {key: 'status'});
  assert.equal(store.list().length, 0);
});

test('Az Ăşj futtatĂˇs eltĂĽnteti a rĂ©gi ĂĽzeneteket, a rĂ¶gzĂ­tett marad', () => {
  const store = createMessageStore();
  store.notice('RĂ©gi hiba', 'error');
  store.notice('RĂ©gi figyelmeztetĂ©s', 'warning');
  store.notice('Google-hozzĂˇfĂ©rĂ©s lejĂˇrt', 'error', {key: 'google', sticky: true});
  store.beginRun();
  const items = store.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].key, 'google');
  assert.equal(items[0].sticky, true);
});

test('A sorok egyenkĂ©nt tĂ¶rĂ¶lhetĹ‘k Ă©s a lista kiĂĽrĂ­thetĹ‘', () => {
  const store = createMessageStore();
  const first = store.notice('ElsĹ‘', 'info');
  store.notice('MĂˇsodik', 'warning');
  assert.equal(store.list().length, 2);
  assert.equal(store.remove(first.id), true);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].text, 'MĂˇsodik');
  store.clear();
  assert.equal(store.list().length, 0);
  assert.equal(store.remove('nincs-ilyen'), false);
});

test('A lista legfeljebb a beĂˇllĂ­tott szĂˇmĂş ĂĽzenetet tartja meg', () => {
  const store = createMessageStore({max: 3});
  for (let index = 0; index < 5; index += 1) store.notice('Ăśzenet ' + index, 'info');
  const items = store.list();
  assert.equal(items.length, 3);
  assert.equal(items[0].text, 'Ăśzenet 2');
  assert.equal(items[2].text, 'Ăśzenet 4');
});

test('Az azonos szĂ¶vegĹ±, egymĂˇst kĂ¶vetĹ‘ ĂĽzenet nem duplikĂˇlĂłdik', () => {
  const store = createMessageStore();
  store.notice('Ugyanaz', 'info');
  store.notice('Ugyanaz', 'info');
  const items = store.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].count, 2);
});

test('A felĂĽlet kirajzolja az ĂĽzeneteket, Ă©s a tĂ¶rlĂ©s frissĂ­ti a szĂˇmlĂˇlĂłt', () => {
  const doc = fakeDocument();
  const api = createBrowserApi({document: doc, sessionStorage: null});
  const bar = collect(doc.body, node => node.className === 'ks-msgbar')[0];
  assert.ok(bar, 'az alsĂł sĂˇv elkĂ©szĂĽl');
  assert.equal(bar.hidden, true, 'ĂĽzenet nĂ©lkĂĽl rejtett');

  api.notice('Valami hiba tĂ¶rtĂ©nt.', 'error');
  assert.equal(bar.hidden, false);
  const row = collect(bar, node => node.className.indexOf('ks-msg-item') === 0)[0];
  assert.ok(row, 'az ĂĽzenet sora megjelenik');
  assert.match(row.className, /error/);

  const removeButton = collect(row, node => node.className === 'ks-msg-remove')[0];
  assert.ok(removeButton, 'a sor tĂ¶rlĹ‘gombot kap');
  removeButton.handlers.click();
  assert.equal(api.list().length, 0);
  assert.equal(bar.hidden, true);
});

test('Az alsĂł sĂˇv kinyithatĂł Ă©s Ă¶sszecsukhatĂł', () => {
  const doc = fakeDocument();
  const api = createBrowserApi({document: doc, sessionStorage: null});
  const bar = collect(doc.body, node => node.className === 'ks-msgbar')[0];
  api.notice('Egy ĂĽzenet.','info');
  const head = collect(bar, node => node.className === 'ks-msgbar-head')[0];
  head.handlers.click();
  assert.equal(bar.dataset.state, 'open');
  head.handlers.click();
  assert.equal(bar.dataset.state, 'collapsed');
  api.open();
  assert.equal(bar.dataset.state, 'open');
  api.close();
  assert.equal(bar.dataset.state, 'collapsed');
});

test('Ăšj hiba esetĂ©n a sĂˇv lĂˇthatĂłvĂˇ vĂˇlik, piros szĂˇmlĂˇlĂłval', () => {
  const doc = fakeDocument();
  const api = createBrowserApi({document: doc, sessionStorage: null});
  const bar = collect(doc.body, node => node.className === 'ks-msgbar')[0];
  api.notice('Csak figyelmeztetĂ©s.', 'warning');
  assert.equal(bar.hidden, false, 'a figyelmeztetĂ©s is megjelenĂ­ti a sĂˇvot');
  const count = collect(bar, node => String(node.className || '').startsWith('ks-msgbar-count'))[0];
  assert.match(count.className, /warning/);
  api.notice('Hiba tĂ¶rtĂ©nt.', 'error');
  assert.match(count.className, /error/);
});

test('A dashboardon alsĂł sĂˇv jelenik meg a jobb szĂ©li fĂĽl helyett', () => {
  const doc = fakeDocument('dashboard');
  const api = createBrowserApi({document: doc, sessionStorage: null});
  const bar = collect(doc.body, node => node.className === 'ks-msgbar')[0];
  const launcher = collect(doc.body, node => node.className === 'ks-msg-launcher');
  assert.ok(bar, 'az alsĂł ĂĽzenetsĂˇv elkĂ©szĂĽl');
  assert.equal(launcher.length, 0, 'a jobb szĂ©li fĂĽl megszĹ±nik a dashboardon');
  assert.equal(bar.hidden, true, 'ĂĽzenet nĂ©lkĂĽl a sĂˇv rejtett');
  assert.equal(doc.documentElement.style.values['--ks-msgbar-height'], '0px',
    'ĂĽzenet nĂ©lkĂĽl nincs alsĂł eltolĂˇs');

  api.notice('Hiba tĂ¶rtĂ©nt.', 'error');
  assert.equal(bar.hidden, false, 'aktĂ­v Ăˇllapotban a sĂˇv lĂˇtszik');
  assert.equal(bar.dataset.state, 'collapsed', 'alapbĂłl Ă¶sszecsukott');
  assert.equal(doc.documentElement.style.values['--ks-msgbar-height'], '46px',
    'a lĂˇthatĂł sĂˇv fĂ¶lĂ© kerĂĽl az alsĂł navigĂˇciĂł');

  const head = collect(bar, node => node.className === 'ks-msgbar-head')[0];
  head.handlers.click();
  assert.equal(bar.dataset.state, 'open', 'kattintĂˇsra kinyĂ­lik');
  assert.equal(doc.documentElement.style.values['--ks-msgbar-height'], '46px',
    'kinyitva is a helyĂ©n marad, csak felfelĂ© lĂłg');

  head.handlers.click();
  assert.equal(bar.dataset.state, 'collapsed', 'Ăşjabb kattintĂˇsra Ă¶sszecsukĂłdik');

  api.clear();
  assert.equal(bar.hidden, true, 'kiĂĽrĂ­tĂ©s utĂˇn a sĂˇv eltĹ±nik');
  assert.equal(doc.documentElement.style.values['--ks-msgbar-height'], '0px');
});

test('A dashboard alsĂł sĂˇvja a szervernaplĂłt is mutatja', () => {
  const doc = fakeDocument('dashboard');
  const api = createBrowserApi({document: doc, sessionStorage: null});
  const bar = collect(doc.body, node => node.className === 'ks-msgbar')[0];
  assert.equal(bar.hidden, true);

  api.appendLog([
    {id:1,time:Date.now(),level:'error',text:'KĂ©rĂ©s hiba: teszt'},
    {id:2,time:Date.now(),level:'info',text:'Kocka dashboard listening on 3000'}
  ]);
  assert.equal(bar.hidden, false, 'naplĂłbejegyzĂ©s is megjelenĂ­ti a sĂˇvot');

  const logTab = collect(bar, node =>
    node.className === 'ks-msgbar-tab' && node.dataset && node.dataset.tab === 'log')[0];
  assert.ok(logTab, 'van NaplĂł fĂĽl');
  logTab.handlers.click();
  assert.equal(bar.dataset.tab, 'log');
  assert.ok(collect(bar, node => String(node.textContent || '').includes('listening')).length,
    'a naplĂł szĂ¶vege lĂˇtszik');
  const logRows = collect(bar, node => String(node.className || '').includes('ks-msg-item-log'));
  assert.equal(logRows.length, 2, 'minden naplĂłbejegyzĂ©s egy sor');

  // Ugyanazokat az id-ket nem tesszĂĽk be mĂ©g egyszer.
  api.appendLog([
    {id:1,time:Date.now(),level:'error',text:'KĂ©rĂ©s hiba: teszt'},
    {id:2,time:Date.now(),level:'info',text:'Kocka dashboard listening on 3000'}
  ]);
  assert.equal(
    collect(bar, node => String(node.className || '').includes('ks-msg-item-log')).length, 2,
    'a naplĂł nem duplikĂˇlĂłdik');

  api.clear();
  assert.equal(bar.hidden, true, 'a naplĂł is tĂ¶rĂ¶lhetĹ‘');
});

test('A sáv ugyanahhoz az oszlophoz igazodik, mint az AI-chat, és a viewport alján van', () => {
  const doc = fakeDocument('dashboard');
  const main = new FakeElement('main');
  main.getBoundingClientRect = () => ({left: 242, top: 0, width: 700, height: 100, right: 942, bottom: 100});
  doc.querySelector = selector => selector === 'main' ? main : null;
  const api = createBrowserApi({document: doc, sessionStorage: null});
  const bar = collect(doc.body, node => node.className === 'ks-msgbar')[0];
  api.notice('Valami történt.', 'info');
  assert.equal(bar.style.left, '242px', 'a bal szél a main oszlop bal széléhez igazodik');
  assert.equal(bar.style.width, '700px', 'a szélesség a main oszlopéval egyezik');
  assert.equal(bar.style.transform, 'none', 'nincs középre igazítás');
  assert.equal(doc.documentElement.style.values['--ks-msgbar-height'], '46px',
    'a sáv magassága a chat alsó offsetjeként megjelenik');

  // Ha nincs mérhető oszlop, a CSS középre igazító tartaléka érvényes.
  main.getBoundingClientRect = () => ({left: 0, top: 0, width: 0, height: 0});
  api.notice('Újabb üzenet.', 'info');
  assert.equal(bar.style.left, '');
  assert.equal(bar.style.width, '');
  assert.equal(bar.style.transform, '');
});

test('A sáv a viewport alján ül, az AI-chat felette, és a tartalom mindkettőt elkerüli', () => {
  const module = read('public/message-center.js');
  assert.match(module, /\.ks-msgbar\{position:fixed;left:50%;transform:translateX\(-50%\);bottom:0;/,
    'az értesítéssáv a viewport alján van');
  assert.match(module, /doc\.querySelector\('main'\)/, 'ugyanaz az igazítási cél, mint a chaté');
  const composer = read('public/ai-composer.js');
  assert.match(composer, /#chat\.ks-ai-composer\{[^`]*bottom:var\(--ks-msgbar-height,0px\)/,
    'a chat a sáv fölött helyezkedik el');
  const css = read('public/theme/ks-theme.css');
  assert.match(css, /--ks-stack-height:\s*calc\(var\(--chat-height, 0px\) \+ var\(--ks-msgbar-height, 0px\)\)/,
    'a közös magasság a két sáv összege');
  assert.match(css, /padding-bottom:calc\(80px \+ var\(--ks-stack-height\)\)/,
    'a tartalom a teljes sávmagasságot elkerüli');
  assert.match(css, /bottom:calc\(var\(--ks-stack-height\) \+ \.6rem\)/,
    'a műszaki leírás műveletsora is a sávok fölé kerül');
});
test('A dashboard felsĹ‘ sticky elemeit nem bĂˇntja a sĂˇv', () => {
  const css = read('public/theme/ks-theme.css');
  assert.match(css, /\.project-select-sticky\{position:sticky;top:0;/,
    'a projektvĂˇlasztĂł vĂˇltozatlanul a lap tetejĂ©n ragad');
  assert.match(css, /\.timeline-body\{position:sticky;top:56px;/,
    'az idĹ‘vonal vĂˇltozatlanul a projektvĂˇlasztĂł alatt ragad');
  const module = read('public/message-center.js');
  assert.match(module, /\.foot-nav\{bottom:var\(--ks-msgbar-height,0px\)\}/,
    'csak az alsĂł navigĂˇciĂł kerĂĽl a sĂˇv fĂ¶lĂ©');
});

test('A hĂˇrom felĂĽlet a kĂ¶zĂ¶s Ă©rtesĂ­tĂ©skezelĹ‘re dolgozik', () => {
  for (const file of ['dashboard_v2.html', 'technical.html', 'public/marketing.html', 'site.html'])
    assert.match(read(file), /Notify\.create\(/, file + ': a kĂ¶zĂ¶s Ă©rtesĂ­tĂ©skezelĹ‘ hiĂˇnyzik');
  assert.match(read('dashboard_v2.html'), /notify\.beginRun\(/,
    'a dashboard Ăşj mĹ±veletnĂ©l tĂ¶rli a rĂ©gi ĂĽzeneteket');
  assert.match(read('technical.html'), /notify\.beginRun\(/,
    'a mĹ±szaki oldal Ăşj futtatĂˇsnĂˇl tĂ¶rli a rĂ©gi ĂĽzeneteket');
});

test('A szerver kiszolgĂˇlja Ă©s betĂ¶lti az ĂĽzenetkĂ¶zpontot', () => {
  const server = read('server/index.cjs');
  assert.match(server, /'\/assets\/message-center\.js'/);
  assert.match(server, /<script src="\/assets\/message-center\.js"><\/script>/);
});
