'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {isKiemeltTerseg,teruletrendezesiNyilatkozat} =
  require('../server/teruletrendezes.cjs');

const text = ['Első bekezdés.',
  'Nyilatkozom továbbá, hogy a tervezett épület megfelel a 2018. évi CXXXIX. '+
  'törvény (Magyarország és egyes kiemelt térségeinek területrendezési tervéről) '+
  'előírásainak.',
  'Utolsó bekezdés.'].join('\n\n');

test('A kiemelt térségi települések felismerhetők ékezet nélkül is', () => {
  for (const name of ['Budapest','Érd','erd','Dunavarsány','Rád','Keszthely','Tihany','Visegrád'])
    assert.equal(isKiemeltTerseg(name),true,name);
  for (const name of ['Dombóvár','Szeged','Debrecen','Pécs'])
    assert.equal(isKiemeltTerseg(name),false,name);
});

test('A területrendezési nyilatkozat csak a kiemelt térségben marad meg', () => {
  assert.match(teruletrendezesiNyilatkozat(text,'Budapest'),/2018\. évi CXXXIX/);
  const removed = teruletrendezesiNyilatkozat(text,'Dombóvár');
  assert.equal(removed.includes('2018. évi CXXXIX'),false);
  assert.match(removed,/Első bekezdés/);
  assert.match(removed,/Utolsó bekezdés/);
});
