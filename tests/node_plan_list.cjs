'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {RANGE_NAME,rightEdge,planParagraphs,tabStopRequests} = require('../server/plan_list.cjs');

// A tervjegyzék a dokumentumban bekezdésekként jelenik meg; a jobbra igazított
// tabulátor-stop a KOCKA_MERGE_TERVJEGYZEK névre szóló tartomány bekezdéseire
// kerül, a lap jobb szélének megfelelő helyre.

function paragraph(startIndex,content) {
  return {startIndex,endIndex:startIndex+content.length,
    paragraph:{elements:[{startIndex,textRun:{content}}]}};
}

function namedRangeEntry(startIndex,endIndex) {
  return {name:RANGE_NAME,namedRanges:[{name:RANGE_NAME,ranges:[{startIndex,endIndex}]}]};
}

const A4_STYLE = {pageSize:{width:{magnitude:595.28,unit:'PT'}},
  marginLeft:{magnitude:72,unit:'PT'},marginRight:{magnitude:72,unit:'PT'}};

test('A tervjegyzék bekezdése jobbra igazított tabulátor-stopot kap a lap szélén', () => {
  const first = 'EK-01 Helyszínrajz\tM=1:200\n';
  const second = 'EK-02 Metszet\tM=1:100\n';
  const third = 'scan_0012\n';
  const document = {
    documentStyle:A4_STYLE,
    body:{content:[paragraph(1,'Előzmények\n'),
      paragraph(20,first),paragraph(20+first.length,second),
      paragraph(20+first.length+second.length,third)]},
    namedRanges:{[RANGE_NAME]:namedRangeEntry(20,
      20+first.length+second.length+third.length)}
  };
  const found = planParagraphs(document);
  assert.deepEqual(found.map(item => item.startIndex),
    [20,20+first.length,20+first.length+second.length],
    'A lépték nélküli tervlap sora is a tervjegyzékhez tartozik.');
  const requests = tabStopRequests(document);
  // A lépték nélküli sorban nincs tabulátor, ezért ott nincs mit igazítani.
  assert.equal(requests.length,2);
  const firstRequest = requests[0].updateParagraphStyle;
  assert.equal(firstRequest.fields,'tabStops');
  assert.equal(firstRequest.range.startIndex,20);
  assert.equal(firstRequest.paragraphStyle.tabStops.length,1);
  assert.equal(firstRequest.paragraphStyle.tabStops[0].alignment,'END');
  assert.equal(firstRequest.paragraphStyle.tabStops[0].offset.unit,'PT');
  assert.equal(firstRequest.paragraphStyle.tabStops[0].offset.magnitude,451.28,
    'A tabulátor-stop a szövegtükör jobb szélén áll (595,28 − 72 − 72 PT).');
});

test('A tabulátor-stop a dokumentum margóiból és a bekezdés behúzásából számol', () => {
  const fromMargin = rightEdge({...A4_STYLE,marginLeft:{magnitude:56.7,unit:'PT'},
    marginRight:{magnitude:56.7,unit:'PT'}});
  assert.ok(Math.abs(fromMargin-481.88) < 0.01,'A margók levonása: '+fromMargin);
  // Centiméterben megadott stílus ugyanazt az értéket adja.
  const fromCm = rightEdge({pageSize:{width:{magnitude:21,unit:'CM'}},
    marginLeft:{magnitude:2.54,unit:'CM'},marginRight:{magnitude:2.54,unit:'CM'}});
  assert.ok(Math.abs(fromCm-451.28) < 0.01,'A cm-ben adott stílus PT-re váltva: '+fromCm);
  assert.equal(rightEdge(A4_STYLE,{indentEnd:{magnitude:12,unit:'PT'}}),439.28);
  // Használhatatlan stílus esetén az A4-es szövegtükör az alapérték.
  assert.equal(rightEdge(),451.28);
  assert.equal(rightEdge({pageSize:{width:{magnitude:0,unit:'PT'}},
    marginLeft:{magnitude:0,unit:'PT'},marginRight:{magnitude:0,unit:'PT'}}),451.28);
});

test('Névre szóló tartomány nélkül nincs igazítási kérés', () => {
  const document = {body:{content:[paragraph(1,'EK-01 Helyszínrajz\tM=1:200\n')]},
    namedRanges:{}};
  assert.deepEqual(planParagraphs(document),[]);
  assert.deepEqual(tabStopRequests(document),[]);
});
