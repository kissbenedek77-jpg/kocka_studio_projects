'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {create} = require('../public/notify.js');

const root = path.join(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');

function withCenter(center, run) {
  const previous = globalThis.KsMessages;
  globalThis.KsMessages = center;
  try { return run(); }
  finally {
    if (previous === undefined) delete globalThis.KsMessages;
    else globalThis.KsMessages = previous;
  }
}

test('A státuszüzenet a message-centerbe kerül, kulcsolva', () => {
  const calls = [];
  withCenter({notice: (text,kind,opts) => calls.push({text,kind,opts})}, () => {
    const notify = create({key:'oldal-status'});
    notify.status('Mentve.','success');
    notify.status('Hiba.','error',{links:[{label:'Megnyitás',href:'/x'}]});
  });
  assert.equal(calls.length,2);
  assert.equal(calls[0].text,'Mentve.');
  assert.equal(calls[0].kind,'success');
  assert.equal(calls[0].opts.key,'oldal-status');
  assert.deepEqual(calls[1].opts.links,[{label:'Megnyitás',href:'/x'}]);
});

test('A részleges üzenet külön sort kap, a futtatás törli a régi üzeneteket', () => {
  const calls = [];
  withCenter({notice: (text,kind,opts) => calls.push({text,kind,opts}),
    beginRun: () => calls.push({run:true})}, () => {
    const notify = create({key:'oldal-status'});
    notify.detail('Figyelem.','warning');
    notify.beginRun();
  });
  assert.equal(calls[0].opts.key,null);
  assert.equal(calls[0].kind,'warning');
  assert.equal(calls[1].run,true);
});

test('Message-center nélkül a helyi status elemre ír', () => {
  const previousDocument = globalThis.document;
  const node = {className:'',textContent:''};
  globalThis.document = {getElementById: id => id === 'sajat-status' ? node : null};
  try {
    const notify = create({key:'x',fallbackId:'sajat-status'});
    notify.status('Helyi üzenet.','success');
    assert.match(node.className,/notice success/);
    assert.equal(node.textContent,'Helyi üzenet.');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('Minden tulajdonosi oldal a közös Notify modult használja', () => {
  for (const file of ['dashboard_v2.html','technical.html','public/marketing.html','site.html'])
    assert.match(read(file),/Notify\.create\(/,
      file+': a közös értesítéskezelő hiányzik');
  const server = read('server/index.cjs');
  assert.match(server,/'\/assets\/notify\.js'/);
  assert.match(server,/<script src="\/assets\/notify\.js"><\/script>/);
});
