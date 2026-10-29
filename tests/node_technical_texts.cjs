'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {textTemplates,templateDefaults,appendixRequests} = require('../server/technical_texts.cjs');
const {retegekFromRows,retegekFromText,retegrendFacts,retegrendValues} = require('../server/retegrend.cjs');
const {programReplacements,programLines,PROGRAM_TEXTS,bedroomCount,exitCount} = require('../server/technical_program.cjs');
const {chatInput,chatPrompt,parseChatResult} = require('../server/technical_chat.cjs');

const para = (start,content) => ({startIndex:start,endIndex:start+content.length,
  paragraph:{elements:[{startIndex:start,textRun:{content}}]}});

test('A sablonszöveg-appendix kiolvasható és a jelölők kitölthetők', () => {
  const document = {body:{content:[
    para(1,'Bevezető\n'),
    para(20,'SABLONSZÖVEGEK – a generátor használja\n'),
    para(60,'[[TUZVEDELMI]]\n'),
    para(80,'Tűzszakasz: {{tuzszakasz_m2}} m²\n'),
    para(120,'[[/TUZVEDELMI]]\n'),
    para(150,'[[SZERKEZETEK]]\n'),
    para(170,'Fal: {{retegrend:fal_anyag}}.\n'),
    para(200,'[[/SZERKEZETEK]]\n')
  ]}};
  const templates = textTemplates(document);
  assert.equal(templates.TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG,'Tűzszakasz: {{tuzszakasz_m2}} m²');
  assert.equal(templates['SZERKEZETEK LEÍRÁSA'],'Fal: {{retegrend:fal_anyag}}.');
  const defaults = templateDefaults(templates,{'tuzszakasz_m2':'200,05'});
  assert.equal(defaults.TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG,'Tűzszakasz: 200,05 m²');
  assert.match(defaults['SZERKEZETEK LEÍRÁSA'],/\[KIEGÉSZÍTENDŐ: retegrend:fal_anyag\.\]/);
  const [removal] = appendixRequests(document);
  assert.equal(removal.deleteContentRange.range.startIndex,20);
  assert.equal(removal.deleteContentRange.range.endIndex,document.body.content.at(-1).endIndex-1);
});

test('A rétegrend a munkalapról és a Metszetek szövegéből is felismerhető', () => {
  const blocks = retegekFromRows([
    ['F Határoló fal'],
    ['30 cm','Porotherm N+F kerámia falazat'],
    ['16 cm','Austrotherm Grafit EPS hőszigetelés'],
    [''],
    ['M1 Födém'],
    ['25 cm','vasbeton födém'],
    [''],
    ['T1 Fedélszék'],
    ['15 cm','szaruzat, fa tetőszerkezet']
  ]);
  assert.equal(blocks.length,3);
  const textBlocks = retegekFromText([
    'M1 Födém',
    '2 cm padlóburkolat',
    '20 cm vasbeton lemez'
  ].join('\n'));
  assert.equal(textBlocks[0].layers.length,2);
  const facts = retegrendFacts({sheetRows:[
    ['F Határoló fal'],['38 cm','vázkerámia falazat'],['16 cm','EPS hőszigetelés'],[''],
    ['M1 Födém'],['25 cm','vasbeton födém'],[''],
    ['T1 Fedélszék'],['15 cm','fa szaruzat']
  ]});
  assert.equal(facts.wall.material,'vázkerámia falazat');
  assert.equal(facts.wall.thickness,'38 cm');
  assert.match(facts.wall.insulation,/EPS/);
  assert.match(facts.slab.material,/vasbeton/);
  assert.match(facts.roof.material,/fa szaruzat/);
  const values = retegrendValues(facts);
  assert.equal(values['retegrend:fal_vastagsag'],'38 cm');
  assert.match(values['retegrend:fodem'],/vasbeton/);
});

test('A tervezési program a projekt adatait és a helyiséglistát használja', () => {
  const roomData = {
    totalCents:20005,
    rooms:[
      {floor:'Földszint',name:'előszoba'},
      {floor:'Földszint',name:'nappali-konyha-étkező'},
      {floor:'Földszint',name:'iroda'},
      {floor:'Földszint',name:'hálószoba'},
      {floor:'Emelet',name:'gyerekszoba'},
      {floor:'Emelet',name:'gyerekszoba'},
      {floor:'Emelet',name:'fürdő'}
    ]
  };
  const result = programReplacements({project:{projekt_varos:'Kaposvár',hrsz:'0123/4'},
    sheetValues:{'TERVEZESI_ADATOK:Munkalap1!B2':'Lke-8','TERVEZESI_ADATOK:Munkalap1!F9':'2'},
    roomData,plans:[]});
  assert.match(result.warnings.join(' '),/0-val kezdődik/);
  assert.equal(result.values.telepules,'Kaposvár');
  assert.equal(result.values.ovezet,'Lke-8');
  assert.equal(result.values.szintek,'többszintes');
  assert.match(result.values.haloszobak,/szülői és két gyerek/);
  assert.match(result.values.helyisegek,/iroda\/vendégszoba/);
  assert.equal(result.values.parkolo,'2');
  assert.equal(result.facts.bedrooms,3);
  assert.equal(exitCount(roomData),1);
  assert.equal(bedroomCount(roomData),3);
  const lines = programLines([],result.values);
  assert.equal(lines.length,16);
  assert.match(lines[2][0],/Kaposvár belterületi/);
  assert.match(lines[6].join('\n'),/többszintes/);
  assert.doesNotMatch(lines[8].join('\n'),/\{\{/);
  assert.match(PROGRAM_TEXTS.p,/régészeti/);
});

test('A chat csak szerkeszthető mezőt fogad el és a választ ellenőrzi', () => {
  const input = chatInput({message:'Rövidítsd a tűzvédelmet.'},{
    'TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG':'Hosszú tűzvédelmi szöveg.',
    'DOKUMENTUM:kiadas_datuma':'2026.10.07.'
  });
  assert.deepEqual(Object.keys(input.notes),['TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG']);
  assert.match(chatPrompt({...input,projectType:'Lakóház'}),/Rövidítsd a tűzvédelmet/);
  const parsed = parseChatResult({candidates:[{content:{parts:[{text:JSON.stringify({
    reply:'Rövidítve.',sections:[
      {key:'TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG',text:'Rövid tűzvédelmi szöveg.'},
      {key:'DOKUMENTUM:kiadas_datuma',text:'2026.01.01.'}]})}]}}]},input.notes);
  assert.equal(parsed.reply,'Rövidítve.');
  assert.deepEqual(Object.keys(parsed.sections),['TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG']);
  assert.throws(()=>chatInput({message:'  '},{}),/Írj be/);
});
