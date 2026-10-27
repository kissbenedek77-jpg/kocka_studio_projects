'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../server/domain.cjs');
const projectSheet = require('../server/project-sheet.cjs');

const PLN_TEXT = [
  ' | Helyiség szintjének neve | Helyiségkategória kódja | Helyiségkategória neve | Helyiség száma | Helyiség neve | Padlószint | Belmagasság | Mért terület',
  '---|---|---|---|---|---|---|---|---',
  ...[
    ['terasz', '27,74'], ['szélfogó', '9,36'], ['szoba', '15,50'], ['közlekedő', '9,07'],
    ['nappali', '21,50'], ['konyha+étkező', '13,72'], ['gardrób', '2,95'], ['wc', '1,12'],
    ['fürdő', '6,96'], ['háztartási helyiség', '4,90'], ['szoba', '12,31'], ['szoba', '12,99']
  ].map((room, index) => `1 | Udvari szint | | Általános | ${index + 1} | ${room[0]} | 0,00 | 3,30 | ${room[1]}`),
  ' | | | | | | | | 138,12'
].join('\r\n');

test('A PLN helyiséglista parse-olása és összesítése', () => {
  const parsed = domain.parseProjectRoomText(PLN_TEXT, 'PLN/helyiséglista.txt');
  assert.equal(parsed.rooms.length, 12);
  assert.equal(parsed.sourceTotal, 13812);
  const result = domain.buildRoomList(parsed);
  assert.equal(result.totalCents, 13812);
  assert.equal(result.fireAreaCents, 11038);
  assert.equal(result.warning, '');
  assert.deepEqual(result.rows.slice(-2), [['Teljes összesen', '138,12'], ['Terasz nélkül', '110,38']]);
});

test('Eltérő forrás-összesen figyelmeztetést ad', () => {
  const parsed = domain.parseProjectRoomText(PLN_TEXT.replace('138,12', '110,52'), 'PLN/helyiséglista.txt');
  const result = domain.buildRoomList(parsed);
  assert.match(result.warning, /138,12 m².*110,52 m²/);
});

test('Hibás terület a forrás sorában azonnal hibát ad', () => {
  const broken = PLN_TEXT.replace('9,36', 'hibás');
  assert.throws(() => domain.parseProjectRoomText(broken, 'PLN/helyiséglista.txt'), /4\. sorában/);
});

test('Építményérték a 600 E Ft/m² szabály szerint', () => {
  assert.deepEqual(domain.buildingValueCells(11053), ['600', '110,53 m²', '66 318 E Ft', '66 318 E Ft']);
  assert.throws(() => domain.buildingValueCells(0), /nettó helyiségterület/);
});

test('A PLN/helyiségek.txt elsőbbséget élvez a helyiséglista.txt-vel szemben', async () => {
  const google = {
    async listChildren(id) {
      if (id === 'project') return [{id: 'pln', name: 'PLN', mimeType: 'application/vnd.google-apps.folder'}];
      return [{id: '1', name: 'helyiséglista.txt'}, {id: '2', name: 'helyiségek.txt'}];
    }
  };
  const file = await projectSheet.findProjectRoomFile(google, 'project');
  assert.equal(file.name, 'helyiségek.txt');
});

test('Az újraindítás fájlnevei utótagot kapnak, a rendszermappák nem', () => {
  assert.equal(domain.restartExpectedPath('PDFA/EK-01.pdf', 'MOD_2609'), 'PDFA/EK-01 - MOD_2609.pdf');
  assert.equal(domain.restartExpectedPath('PLN/helyiségek.txt', 'MOD_2609'), 'PLN/helyiségek.txt');
  assert.equal(domain.restartExpectedPath('írásos/szerződés.pdf', 'MOD_2609'), 'írásos/szerződés - MOD_2609.pdf');
  assert.throws(() => domain.validateRestartPostfix('x/y'), /tiltott karakter/);
  assert.equal(domain.validateRestartPostfix('', new Date('2026-09-29T10:00:00Z')), 'MOD_2609');
});
