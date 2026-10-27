'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {parseRoomText} = require('../server/room_data.cjs');

test('PLN helyiséglista szintenkénti területe és forrásösszeg eltérése látható', () => {
  const content = [
    '| Helyiség szintjének neve | Helyiség neve | Mért terület',
    '1 | Udvari szint | fürdő | 7,20',
    '2 | Udvari szint | szoba | 41,28',
    '3 | Bejárati szint | előtér | 10,05',
    '| | | 58,52'
  ].join('\n');
  const data=parseRoomText(content);
  assert.equal(data.totalCents,5853);
  assert.match(data.listing,/Udvari szint összesen\t48,48 m²/);
  assert.match(data.listing,/ELLENŐRIZENDŐ.*58,52 m²/);
  assert.throws(()=>parseRoomText('rossz fájl'),/oszlopai/);
});

test('A PLN helyiségszámot és burkolatot csak akkor veszi át, ha a forrás tartalmazza', () => {
  const data=parseRoomText([
    '| Helyiség szintjének neve | Helyiség száma | Helyiség neve | Padlóburkolat | Mért terület',
    '1 | Földszint | 01 | előtér | greslap | 8,25',
    '2 | Földszint | 02 | nappali | parketta | 21,75'
  ].join('\n'));
  assert.match(data.listing,/01 előtér\t8,25 m²; burkolat: greslap/);
  assert.match(data.listing,/02 nappali\t21,75 m²; burkolat: parketta/);
  assert.deepEqual(data.tableRows[1],['Földszint','']);
  assert.deepEqual(data.tableRows[2],['01 előtér','8,25']);
});
