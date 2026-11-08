'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// Minden teszthez friss modulpéldány kell, mert a gyűjtő állapotot tart.
function fresh() {
  const file = require.resolve('../server/log_buffer.cjs');
  delete require.cache[file];
  return require(file);
}

test('A naplógyűjtő rögzíti és kurzor szerint adja vissza a bejegyzéseket', () => {
  const buffer = fresh();
  buffer.record('info','Első sor');
  buffer.record('error','Második sor');
  const all = buffer.read(0);
  assert.equal(all.entries.length,2);
  assert.equal(all.cursor,2);
  assert.equal(all.entries[0].text,'Első sor');
  assert.equal(all.entries[1].level,'error');
  assert.equal(buffer.read(all.cursor).entries.length,0,'a kurzor utáni üres');
  buffer.record('warning','Harmadik sor');
  const more = buffer.read(all.cursor);
  assert.equal(more.entries.length,1);
  assert.equal(more.entries[0].text,'Harmadik sor');
  assert.equal(more.entries[0].level,'warning');
});

test('A napló kimaszkolja a titkokat', () => {
  const buffer = fresh();
  buffer.record('info','api_key=szupertitkos');
  buffer.record('info','Authorization: Bearer abc.def.ghi');
  buffer.record('info','AIzaSyD-123456789012345678901234567890123');
  const text = buffer.read(0).entries.map(entry => entry.text).join('\n');
  assert.doesNotMatch(text,/szupertitkos/,'az API-kulcs nem kerül a naplóba');
  assert.match(text,/api_key=\*\*\*/);
  assert.match(text,/Bearer \*\*\*/);
  assert.doesNotMatch(text,/AIzaSyD-123/);
});

test('A napló legfeljebb a beállított számú bejegyzést tartja meg', () => {
  const buffer = fresh();
  for (let index = 0; index < buffer.MAX_ENTRIES + 5; index += 1)
    buffer.record('info','Sor ' + index);
  const all = buffer.read(0, 300);
  assert.equal(all.entries.length, 300);
  assert.equal(all.entries[all.entries.length-1].text,'Sor ' + (buffer.MAX_ENTRIES + 4),
    'a legfrissebb bejegyzés megmarad');
  assert.equal(all.cursor, buffer.MAX_ENTRIES + 5);
  assert.equal(all.entries[0].text,'Sor ' + (buffer.MAX_ENTRIES + 5 - 300),
    'a legrégebbiek kiestek a gyűrűpufferből');
});

test('A naplógyűjtő a folyamat kimenetét is rögzíti', () => {
  const buffer = fresh();
  const written = [];
  const fake = {
    write(chunk, encoding, callback) {
      written.push(String(chunk));
      if (typeof callback === 'function') callback();
      return true;
    }
  };
  buffer.install([[fake,'info']]);
  const result = fake.write('Helló napló\n');
  assert.equal(result,true,'az eredeti write eredménye megmarad');
  assert.deepEqual(written,['Helló napló\n'],'az eredeti kimenet is lefut');
  const entries = buffer.read(0).entries;
  assert.equal(entries.length,1);
  assert.equal(entries[0].text,'Helló napló');
});

test('A napló olvasása legfeljebb 300 bejegyzést ad vissza', () => {
  const buffer = fresh();
  for (let index = 0; index < 400; index += 1) buffer.record('info','Sor ' + index);
  const many = buffer.read(0, 1000);
  assert.equal(many.entries.length,300);
  assert.equal(many.cursor,400);
});
