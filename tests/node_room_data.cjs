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

test('A tabulátoros, pontosvesszős és magyar fejlécváltozat is feldolgozható', () => {
  const tab=parseRoomText([
    'Szint\tMegnevezés\tTerület (m²)',
    'Földszint\tNappali\t21,75',
    'Földszint\tKonyha\t8,25'
  ].join('\n'),'PLN/Helyiségek.txt');
  assert.match(tab.listing,/Nappali\t21,75 m²/);
  assert.match(tab.listing,/Földszint összesen\t30,00 m²/);
  const semicolon=parseRoomText([
    'Helyiség szintje;Helyiség neve;Alapterület',
    'Emelet;Szoba;12,5',
    'Emelet;Fürdő;4,5'
  ].join('\n'));
  assert.match(semicolon.listing,/Szoba\t12,50 m²/);
  assert.match(semicolon.listing,/Emelet összesen\t17,00 m²/);
});

test('A saját generált helyiséglista (szintfejekkel) is visszaolvasható', () => {
  const data=parseRoomText([
    'Helyiség száma és neve\tTerület (m²)',
    'Földszint',
    '01 előtér\t8,25 m²',
    '02 nappali\t21,75 m²',
    'Földszint összesen\t30,00 m²',
    'Teljes összesen\t30,00 m²',
    'Terasz nélkül\t30,00 m²'
  ].join('\n'),'PLN/Helyiségek.txt');
  assert.equal(data.totalCents,3000);
  assert.match(data.listing,/Földszint összesen\t30,00 m²/);
  assert.match(data.listing,/Teljes összesen\t30,00 m²/);
  assert.equal(data.tableRows.filter(row=>/összesen/.test(row[0])).length,2);
});

test('A valós PLN formátum (címsor, „Honszint neve”, szintfejes sorok) feldolgozható', () => {
  const data=parseRoomText([
    'Helyiséglista\t\t',
    'Honszint neve\tHelyiség neve\tMért terület\t',
    'Földszint\t\t\t',
    '\tnappali\t26,07\t',
    '\tszoba\t16,79\t',
    'Emelet\t\t\t',
    '\tfürdő\t6,20\t',
    '\t\t72,06\t'
  ].join('\r\n'),'PLN/helyiségek.txt');
  assert.equal(data.totalCents,4906);
  assert.match(data.listing,/^Földszint\nnappali\t26,07 m²\nszoba\t16,79 m²\nFöldszint összesen\t42,86 m²/);
  assert.match(data.listing,/Emelet összesen\t6,20 m²/);
  assert.match(data.listing,/Teljes összesen\t49,06 m²/);
  assert.match(data.listing,/ELLENŐRIZENDŐ.*72,06 m²/);
  assert.deepEqual(data.tableRows[1],['Földszint','']);
  assert.deepEqual(data.tableRows[2],['nappali','26,07']);
});

test('A feldolgozhatatlan helyiséglista hibája megmondja a teendőt és a hibás sort', () => {
  assert.throws(()=>parseRoomText([
    'Valami;más;dolog',
    'Földszint;Nappali;20'
  ].join('\n'),'PLN/Helyiségek.txt'),
  error => error.message.includes('PLN/Helyiségek.txt') &&
    error.message.includes('Elfogadott fejlécnevek') &&
    error.message.includes('Első sor: „Valami;más;dolog”'));
  assert.throws(()=>parseRoomText([
    'Szint\tHelyiség neve\tTerület',
    'Földszint\tNappali\thúsz négyzetméter'
  ].join('\n'),'PLN/Helyiségek.txt'),
  error => error.message.includes('2. sor') &&
    error.message.includes('húsz négyzetméter') &&
    error.message.includes('például 12,50'));
});
