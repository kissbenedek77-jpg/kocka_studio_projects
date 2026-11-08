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
  addEventListener(type, handler) {
    if (!this.handlers) this.handlers = {};
    this.handlers[String(type)] = handler;
  }
  focus() {}
  querySelector() { return null; }
}

function fakeDocument() {
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  return {
    readyState: 'complete',
    head,
    body,
    createElement: tag => new FakeElement(tag),
    createDocumentFragment: () => new FakeElement('#fragment'),
    addEventListener() {}
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
