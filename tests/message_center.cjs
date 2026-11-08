'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createMessageStore, createBrowserApi, normalizeLevel} = require('../public/message-center.js');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// Kis DOM-utánzat az üzenetközpont felületének füsttesztjéhez. Csak azt tudja,
// amit a message-center.js használ; a valódi böngészőt nem helyettesíti.
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
    querySelector(selector) { return selector === 'main.shell' ? main : null; }
  };
}

function collect(element, predicate, found = []) {
  if (!element || typeof element !== 'object') return found;
  if (predicate(element)) found.push(element);
  for (const child of element.children || []) collect(child, predicate, found);
  return found;
}

test('Az üzenetközpont szintnevei egységesek', () => {
  assert.equal(normalizeLevel(''), 'info');
  assert.equal(normalizeLevel('success'), 'success');
  assert.equal(normalizeLevel('warning'), 'warning');
  assert.equal(normalizeLevel('error'), 'error');
  assert.equal(normalizeLevel('note'), 'note');
  assert.equal(normalizeLevel(true), 'error');
  assert.equal(normalizeLevel(false), 'info');
  assert.equal(normalizeLevel('ismeretlen'), 'info');
});

test('A kulcsolt üzenet helyben frissül, nem gyűlik', () => {
  const store = createMessageStore();
  store.notice('Mentés…', '', {key: 'status'});
  store.notice('Mentés…', '', {key: 'status'});
  let items = store.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].count, 2);
  store.notice('A műszaki leírás mentve.', 'success', {key: 'status'});
  items = store.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'A műszaki leírás mentve.');
  assert.equal(items[0].level, 'success');
  assert.equal(items[0].count, 1);
  // Üres szöveg a kulcsolt üzenet törlése.
  store.notice('', '', {key: 'status'});
  assert.equal(store.list().length, 0);
});

test('Az új futtatás eltünteti a régi üzeneteket, a rögzített marad', () => {
  const store = createMessageStore();
  store.notice('Régi hiba', 'error');
  store.notice('Régi figyelmeztetés', 'warning');
  store.notice('Google-hozzáférés lejárt', 'error', {key: 'google', sticky: true});
  store.beginRun();
  const items = store.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].key, 'google');
  assert.equal(items[0].sticky, true);
});

test('A sorok egyenként törölhetők és a lista kiüríthető', () => {
  const store = createMessageStore();
  const first = store.notice('Első', 'info');
  store.notice('Második', 'warning');
  assert.equal(store.list().length, 2);
  assert.equal(store.remove(first.id), true);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].text, 'Második');
  store.clear();
  assert.equal(store.list().length, 0);
  assert.equal(store.remove('nincs-ilyen'), false);
});

test('A lista legfeljebb a beállított számú üzenetet tartja meg', () => {
  const store = createMessageStore({max: 3});
  for (let index = 0; index < 5; index += 1) store.notice('Üzenet ' + index, 'info');
  const items = store.list();
  assert.equal(items.length, 3);
  assert.equal(items[0].text, 'Üzenet 2');
  assert.equal(items[2].text, 'Üzenet 4');
});

test('Az azonos szövegű, egymást követő üzenet nem duplikálódik', () => {
  const store = createMessageStore();
  store.notice('Ugyanaz', 'info');
  store.notice('Ugyanaz', 'info');
  const items = store.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].count, 2);
});

test('A felület kirajzolja az üzeneteket, és a törlés frissíti a jelvényt', () => {
  const doc = fakeDocument();
  const api = createBrowserApi({document: doc, sessionStorage: null});
  const launcher = collect(doc.body, node => node.className === 'ks-msg-launcher')[0];
  const panel = collect(doc.body, node => node.className === 'ks-msg-panel')[0];
  assert.ok(launcher, 'a jobb oldali fül elkészül');
  assert.ok(panel, 'a panel elkészül');
  assert.equal(panel.hidden, true, 'a panel alapból csukva van');

  api.notice('Valami hiba történt.', 'error');
  const badge = collect(launcher, node => node.className.indexOf('ks-msg-badge') === 0)[0];
  assert.equal(badge.textContent, '1');
  assert.match(badge.className, /error/);
  const row = collect(panel, node => node.className.indexOf('ks-msg-item') === 0)[0];
  assert.ok(row, 'az üzenet sora megjelenik');
  assert.match(row.className, /error/);

  const removeButton = collect(row, node => node.className === 'ks-msg-remove')[0];
  assert.ok(removeButton, 'a sor törlőgombot kap');
  removeButton.handlers.click();
  assert.equal(api.list().length, 0);
  assert.equal(badge.textContent, '');
});

test('A felület minimalizálható, bezárható és újra kinyitható', () => {
  const doc = fakeDocument();
  const api = createBrowserApi({document: doc, sessionStorage: null});
  const launcher = collect(doc.body, node => node.className === 'ks-msg-launcher')[0];
  const panel = collect(doc.body, node => node.className === 'ks-msg-panel')[0];

  api.open();
  assert.equal(panel.hidden, false);
  assert.equal(launcher.hidden, true);

  api.minimize();
  assert.equal(panel.hidden, false);
  assert.equal(panel.classList.contains('minimized'), true);
  assert.equal(launcher.hidden, true);

  api.close();
  assert.equal(panel.hidden, true);
  assert.equal(launcher.hidden, false);

  launcher.handlers.click();
  assert.equal(panel.hidden, false);
});

test('Új hiba esetén a panel magától kinyílik, figyelmeztetésnél nem', () => {
  const doc = fakeDocument();
  const api = createBrowserApi({document: doc, sessionStorage: null});
  const panel = collect(doc.body, node => node.className === 'ks-msg-panel')[0];
  api.notice('Csak figyelmeztetés.', 'warning');
  assert.equal(panel.hidden, true, 'a figyelmeztetés nem nyitja ki a panelt');
  api.notice('Hiba történt.', 'error');
  assert.equal(panel.hidden, false, 'az új hiba kinyitja a panelt');
});

test('A dashboardon felső sáv jelenik meg a jobb széli fül helyett', () => {
  const doc = fakeDocument('dashboard');
  const api = createBrowserApi({document: doc, sessionStorage: null});
  const bar = collect(doc.body, node => node.className === 'ks-msgbar')[0];
  const launcher = collect(doc.body, node => node.className === 'ks-msg-launcher');
  assert.ok(bar, 'a felső üzenetsáv elkészül');
  assert.equal(launcher.length, 0, 'a jobb széli fül megszűnik a dashboardon');
  assert.equal(bar.hidden, true, 'üzenet nélkül a sáv rejtett');
  assert.equal(doc.documentElement.style.values['--ks-msgbar-height'], '0px',
    'üzenet nélkül nincs sticky eltolás');

  api.notice('Hiba történt.', 'error');
  assert.equal(bar.hidden, false, 'aktív állapotban a sáv látszik');
  assert.equal(bar.dataset.state, 'collapsed', 'alapból összecsukott');
  assert.equal(doc.documentElement.style.values['--ks-msgbar-height'], '46px',
    'összecsukva helyet foglal, így letolja a többi sticky elemet');

  const head = collect(bar, node => node.className === 'ks-msgbar-head')[0];
  head.handlers.click();
  assert.equal(bar.dataset.state, 'open', 'kattintásra kinyílik');
  assert.equal(doc.documentElement.style.values['--ks-msgbar-height'], '0px',
    'kinyitva a tartalom fölé lóg, nem tolja le a sticky elemeket');

  head.handlers.click();
  assert.equal(bar.dataset.state, 'collapsed', 'újabb kattintásra összecsukódik');
  assert.equal(doc.documentElement.style.values['--ks-msgbar-height'], '46px');

  api.clear();
  assert.equal(bar.hidden, true, 'kiürítés után a sáv eltűnik');
  assert.equal(doc.documentElement.style.values['--ks-msgbar-height'], '0px');
});

test('A dashboard sticky elemei az üzenetsáv magasságát követik', () => {
  const css = read('public/ks-design.css');
  assert.match(css,
    /\.project-select-sticky\{position:sticky;top:var\(--ks-msgbar-height,0px\)/,
    'a projektválasztó a sáv alatt ragad');
  assert.match(css,
    /\.timeline-body\{position:sticky;top:calc\(var\(--ks-msgbar-height,0px\) \+ 56px\)/,
    'az idővonal a projektválasztó alatt ragad');
});

test('A három felület az üzenetközpontra dolgozik', () => {
  for (const file of ['dashboard_v2.html', 'technical.html', 'public/marketing.html'])
    assert.match(read(file), /KsMessages\.notice\(/, file + ': a notice a központba ír');
  assert.match(read('dashboard_v2.html'), /KsMessages\.beginRun\(/,
    'a dashboard új műveletnél törli a régi üzeneteket');
  assert.match(read('technical.html'), /KsMessages\.beginRun\(/,
    'a műszaki oldal új futtatásnál törli a régi üzeneteket');
});

test('A szerver kiszolgálja és betölti az üzenetközpontot', () => {
  const server = read('server/index.cjs');
  assert.match(server, /'\/assets\/message-center\.js'/);
  assert.match(server, /<script src="\/assets\/message-center\.js"><\/script>/);
});
