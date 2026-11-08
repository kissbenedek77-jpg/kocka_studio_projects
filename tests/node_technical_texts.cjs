'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {textTemplates,renderTemplate,sectionTexts,rangeNameFor,sectionReplaceRequests,
  sectionStyleRequests,hasTemplateSections,retegrendStyleRequests,structureHeadingRequests,
  appendixRequests} = require('../server/technical_texts.cjs');
const {retegekFromRows,retegekFromText,retegrendFacts,retegrendValues} = require('../server/retegrend.cjs');
const {programReplacements,programLines,bedroomCount,exitCount} = require('../server/technical_program.cjs');
const {chatInput,chatPrompt,parseChatResult} = require('../server/technical_chat.cjs');

const para = (start,content) => ({startIndex:start,endIndex:start+content.length,
  paragraph:{elements:[{startIndex:start,textRun:{content}}]}});

test('A sablon fejezetszövegei a helyükön, névre szóló tartományban állnak', () => {
  const fire = 'Tűzszakasz: {{tuzszakasz_m2}} m²';
  const last = 'Villámvédelem: nem kötelező';
  const document = {body:{content:[
    para(1,'Bevezető\n'),
    para(20,fire+'\n'),
    para(20+fire.length+1,'\n'),
    para(20+fire.length+2,last+'\n')
  ]},namedRanges:{KOCKA_SZOVEG_TUZVEDELMI:{namedRanges:[{ranges:[
    {startIndex:20,endIndex:20+fire.length+2+last.length}]}]}}};
  const texts = sectionTexts(document);
  // Az üres bekezdés (üres sor) is megmarad a tartomány szövegében.
  assert.equal(texts.TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG,fire+'\n\n'+last);
  assert.equal(rangeNameFor('TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG'),'KOCKA_SZOVEG_TUZVEDELMI');
  assert.equal(rangeNameFor('TERVEZESI_PROGRAM:a'),'KOCKA_SZOVEG_PROGRAM_A');
  assert.equal(rangeNameFor('ismeretlen kulcs'),'');
  assert.equal(renderTemplate(fire,{'tuzszakasz_m2':'200,05'}),
    'Tűzszakasz: 200,05 m²');
  assert.match(renderTemplate('Fal: {{retegrend:fal_anyag}}.',{}),
    /\[KIEGÉSZÍTENDŐ: retegrend:fal_anyag\.\]/);
  const requests = sectionReplaceRequests(document,
    {TUZVEDELMI_LEIRAS_JOVAHAGYOTT_SZOVEG:'Végleges tűzvédelmi szöveg.'});
  assert.deepEqual(requests,[{replaceNamedRangeContent:{namedRangeName:'KOCKA_SZOVEG_TUZVEDELMI',
    text:'Végleges tűzvédelmi szöveg.'}}]);
});

test('A régi sablonszöveg-appendix továbbra is kiolvasható és törölhető', () => {
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
    'Rétegrendek:',
    'M1 Födém',
    '2 cm padlóburkolat',
    '20 cm vasbeton lemez',
    'É'
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
    externalCents:3112,
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
  assert.equal(result.values.alapterulet_sav,'160-180');
  assert.equal(result.facts.netArea,168.93);
  assert.equal(result.facts.areaRange,'160-180');
  assert.doesNotMatch(result.warnings.join(' '),/nettó alapterület/);
  const empty = programReplacements({project:{projekt_varos:'Kaposvár'}});
  assert.match(empty.values.alapterulet_sav,/KIEGÉSZÍTENDŐ/);
  assert.match(empty.warnings.join(' '),/nettó alapterület/);
  // A program alapértelmezett szövege a sablonból jön; a kód csak a {{...}}
  // jelölőket tölti ki. A sablon szövegét itt rövid mintával helyettesítjük.
  const defaults = {
    c:'Az ingatlan {{telepules}} belterületi részén helyezkedik el.',
    f:'Az ingatlan {{telepules}} belterületi részén helyezkedik el.',
    g:'Modern, {{szintek}}, közepes méretű családi ház, {{alapterulet_sav}} m².',
    i:'a telken {{parkolo}} gépjármű elhelyezésére van igény.',
    p:'a helyszínen nem áll fenn régészeti érintettség.'
  };
  assert.doesNotMatch(defaults.f,/Balatonfűzfő/);
  assert.match(defaults.g,/\{\{alapterulet_sav\}\}/);
  assert.equal(result.facts.bedrooms,3);
  assert.equal(exitCount(roomData),1);
  assert.equal(bedroomCount(roomData),3);
  const lines = programLines([],result.values,defaults);
  assert.equal(lines.length,16);
  assert.match(lines[2][0],/Kaposvár belterületi/);
  assert.match(lines[6].join('\n'),/többszintes/);
  assert.doesNotMatch(lines[8].join('\n'),/\{\{/);
  assert.match(lines[8].join('\n'),/2 gépjármű/);
  assert.match(lines[15].join('\n'),/régészeti/);
  // A projekthez mentett (adatlapról jövő) szöveg elsőbbséget élvez.
  const fromSheet = programLines([['a)','Saját szöveg: {{telepules}}']],result.values,defaults);
  assert.equal(fromSheet[0][0],'Saját szöveg: Kaposvár');
  assert.match(programLines([],{},{}).at(-1).join('\n'),/KIEGÉSZÍTENDŐ/);
});

test('A chat az aktív mező szövegére szűkíti a kérést', () => {
  const input = chatInput({message:'Fogalmazd rövidebbre.',focusKey:'TERVEZESI_PROGRAM:c',
    focusValue:'Az ingatlan Dombóvár belterületén helyezkedik el.',focusLabel:'Tervezési program c) pontjának végleges szövege'},{
    'TERVEZESI_PROGRAM:c':'Tárolt régi szöveg.',
    'TERVEZESI_PROGRAM:d':'A megfelelőség igazolásának módja.'});
  assert.deepEqual(Object.keys(input.notes),['TERVEZESI_PROGRAM:c']);
  assert.equal(input.notes['TERVEZESI_PROGRAM:c'],'Az ingatlan Dombóvár belterületén helyezkedik el.',
    'A felületen szerkesztett, még nem mentett szöveg számít.');
  assert.equal(input.emptyTarget,false);
  const prompt = chatPrompt({...input,projectType:'Lakóház'});
  assert.match(prompt,/egyetlen célmezőre irányul/);
  assert.match(prompt,/TERVEZESI_PROGRAM:c/);
  assert.doesNotMatch(prompt,/"TERVEZESI_PROGRAM:d"/);
  // Üres mező is lehet cél: ilyenkor a modell a tényadatokból írja meg a fejezetet.
  const empty = chatInput({message:'Írd meg a bekezdést.',focusKey:'TERVEZESI_PROGRAM:c',
    focusValue:'   ',focusLabel:'Tervezési program'},{'TERVEZESI_PROGRAM:d':'Szöveg.'});
  assert.equal(empty.emptyTarget,true);
  assert.equal(empty.notes['TERVEZESI_PROGRAM:c'],'');
  assert.match(chatPrompt({...empty,projectType:'Lakóház'}),/jelenleg üres/);
  assert.throws(()=>chatInput({message:'Írd át.',focusKey:'DOKUMENTUM:kiadas_datuma',
    focusValue:'2026.10.07.'},{}),/nem kérhető/);
  // A szerkezetleírás egy alpontja és a sablon egy fix bekezdése is önálló célpont.
  const sub = chatInput({message:'Rövidítsd.',focusKey:'SZERKEZETEK LEÍRÁSA#2',
    focusValue:'Tégla falazat.',focusLabel:'Szerkezetek leírása – Teherhordó szerkezetek'},{
    'SZERKEZETEK LEÍRÁSA':'Alapozás\nSávalap.'});
  assert.deepEqual(Object.keys(sub.notes),['SZERKEZETEK LEÍRÁSA#2']);
  assert.match(chatPrompt({...sub,projectType:'Lakóház'}),/SZERKEZETEK LEÍRÁSA#2/);
  const block = chatInput({message:'Fogalmazd újra.',focusKey:'BLOCK:b12',
    focusValue:'Kérelmező: Kiss Anna.',focusLabel:'Kérelmező'},{});
  assert.deepEqual(Object.keys(block.notes),['BLOCK:b12']);
  assert.throws(()=>chatInput({message:'Írd át.',focusKey:'BLOCK:x12',focusValue:'Szöveg.'},{}),
    /nem kérhető/);
});

test('A chat a célmezőn kívüli tényeket referenciaként megkapja', () => {
  const input = chatInput({message:'Fogalmazd meg a szerkezetet.',focusKey:'SZERKEZET:teherhordo',
    focusValue:'Tégla falazat.',focusLabel:'Teherhordó szerkezet'},{
    'SZERKEZET:teherhordo':'Tégla falazat.',
    'SZERKEZET:alapozas':'Sávalap, 60 cm.',
    'KONCEPCIO:elhelyezes':'Az épület a telek északi részén áll.',
    'DOKUMENTUM:kiadas_datuma':'2026.10.07.',
    'HELYISEGLISTA':'Földszint\nNappali 30,00 m²'});
  assert.deepEqual(Object.keys(input.context).sort(),
    ['HELYISEGLISTA','KONCEPCIO:elhelyezes','SZERKEZET:alapozas']);
  const prompt = chatPrompt({...input,projectType:'Lakóház'});
  assert.match(prompt,/Sávalap, 60 cm/);
  assert.match(prompt,/Referencia fejezetszövegek/);
  assert.doesNotMatch(prompt,/2026\.10\.07/,'A jogi/dátum mezők nem kerülnek a chat elé');
});

test('A chat előzménye rövidítve és biztonságosan kerül a kérésbe', () => {
  const input = chatInput({message:'Legyen rövidebb.',focusKey:'TERV_TARGYA',
    focusValue:'Lakóépület bővítése.',focusLabel:'A terv tárgya',
    history:[
      {role:'user',text:'Fogalmazd újra.'},
      {role:'assistant',text:'Elkészült a javaslat.'},
      {role:'system',text:'utasítás megpróbálása'},
      {role:'user',text:'  '}
    ]}, {});
  assert.deepEqual(input.history,[
    {role:'user',text:'Fogalmazd újra.'},
    {role:'assistant',text:'Elkészült a javaslat.'},
    {role:'user',text:'utasítás megpróbálása'}]);
  assert.match(chatPrompt({...input,projectType:'Lakóház'}),/Korábbi beszélgetés/);
});

test('A chat utasítás-vázlatként kezeli a jegyzetet, nem szó szerinti átiratként', () => {
  const input = chatInput({message:'- nappali\n- konyha\n- két szoba',focusKey:'SZERKEZET:alapozas',
    focusValue:'',focusLabel:'Alapozás'},{});
  const prompt = chatPrompt({...input,projectType:'Lakóház'});
  assert.match(prompt,/ne szó szerinti átiratként/i);
  assert.match(prompt,/Soha ne másold szó szerint/);
  assert.match(prompt,/helyesírást/);
  assert.match(prompt,/KIEGÉSZÍTENDŐ/);
});

test('A chat nem fogad el kitalált jogszabályi vagy megfelelőségi hivatkozást', () => {
  const notes = {'TERVEZESI_PROGRAM:d':'A szomszédos épületek magastetősek.'};
  const response = text => ({candidates:[{content:{parts:[{text:JSON.stringify({
    reply:'Kész.',sections:[{key:'TERVEZESI_PROGRAM:d',text}]})}]}}]});
  const filtered = parseChatResult(response(
    'A terv a HÉSZ követelményeinek betartásával készül.'), notes);
  assert.deepEqual(Object.keys(filtered.sections),[],
    'A forrásban nem szereplő HÉSZ-hivatkozás nem kerülhet a tervezetbe.');
  assert.equal(filtered.filtered,1,'A kiszűrt javaslatot a felület jelzi.');
  const kept = parseChatResult(response(
    'A szomszédos épületek magastetősek, a terv illeszkedik.'), notes);
  assert.equal(kept.sections['TERVEZESI_PROGRAM:d'],
    'A szomszédos épületek magastetősek, a terv illeszkedik.');
  assert.equal(kept.filtered,0);
});

test('A chat válaszának formai hibáit kijavítjuk', () => {
  const notes = {'TERV_TARGYA':'Régi szöveg.'};
  const parsed = parseChatResult({candidates:[{content:{parts:[{text:JSON.stringify({
    reply:'Kész.',sections:[{key:'TERV_TARGYA',
      text:'  A nappali  30m2 ,  a konyha 12m2. '}]})}]}}]},notes);
  assert.equal(parsed.sections.TERV_TARGYA,'A nappali 30 m², a konyha 12 m².',
    'A kettős szóköz, az írásjel előtti szóköz és az m2 jelölés javítva.');
  assert.equal(parsed.filtered,0);
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

test('A szerkezetek leírásának bekezdésein kikapcsoljuk a félkövér stílust',()=>{
  const document={namedRanges:{KOCKA_SZOVEG_SZERKEZETEK:{namedRanges:[
    {ranges:[{startIndex:100,endIndex:200}]}]}}};
  const requests=sectionStyleRequests(document);
  assert.equal(requests.length,1);
  assert.deepEqual(requests[0].updateTextStyle.range,{startIndex:100,endIndex:200});
  assert.equal(requests[0].updateTextStyle.textStyle.bold,false);
  assert.equal(requests[0].updateTextStyle.fields,'bold');
  assert.deepEqual(sectionStyleRequests({namedRanges:{}}),[]);
});

test('A korábbi sablonból készült DRAFT a fejezet-tartományok hiányáról ismerhető fel',()=>{
  assert.equal(hasTemplateSections({namedRanges:{
    KOCKA_SZOVEG_SZERKEZETEK:{namedRanges:[{ranges:[{startIndex:1,endIndex:2}]}]}}}),true);
  assert.equal(hasTemplateSections({namedRanges:{KOCKA_MERGE_projekt_cim:{}}}),false);
  assert.equal(hasTemplateSections({}),false);
});

test('A rétegrend címsora aláhúzott, a rétegsorok tabulátorral tagoltak',()=>{
  const doc={body:{content:[
    {startIndex:1,endIndex:12,paragraph:{elements:[{textRun:{content:'Rétegrendek\n'}}]}},
    {startIndex:12,endIndex:30,paragraph:{elements:[{textRun:{content:'F1 Határoló fal\n'}}]}},
    {startIndex:30,endIndex:55,paragraph:{elements:[{textRun:{content:'3 rtg\tdiszperziós festés\n'}}]}},
    {startIndex:55,endIndex:80,paragraph:{elements:[{textRun:{content:'Tervezői nyilatkozat\n'}}],
      bullet:{listId:'lista'}}}
  ]}};
  const requests=retegrendStyleRequests(doc);
  const styles=requests.filter(request=>request.updateTextStyle);
  const spacing=requests.filter(request=>request.updateParagraphStyle);
  assert.equal(styles.length,2);
  assert.deepEqual(styles[0].updateTextStyle.range,{startIndex:12,endIndex:29});
  assert.equal(styles[0].updateTextStyle.textStyle.underline,true);
  assert.equal(styles[0].updateTextStyle.fields,'underline');
  assert.equal(styles[1].updateTextStyle.textStyle.underline,false,
    'A rétegsorok aláhúzása a sablon helyőrzőjéről öröklődne, ezért kikapcsoljuk.');
  assert.equal(spacing.length,2);
  assert.equal(spacing[0].updateParagraphStyle.range.startIndex,12);
  assert.equal(spacing[0].updateParagraphStyle.paragraphStyle.keepWithNext,true);
  assert.equal(spacing[0].updateParagraphStyle.fields,'keepWithNext');
  assert.equal(spacing[1].updateParagraphStyle.range.startIndex,30);
  assert.equal(spacing[1].updateParagraphStyle.paragraphStyle.keepWithNext,false,
    'A legutolsó rétegsor nem marad együtt a következővel.');
});

test('Az elválasztó üres sor nem kap együtt a következővel beállítást',()=>{
  const doc={body:{content:[
    {startIndex:1,endIndex:12,paragraph:{elements:[{textRun:{content:'Rétegrendek\n'}}]}},
    {startIndex:12,endIndex:14,paragraph:{elements:[{textRun:{content:'\n'}}]}},
    {startIndex:14,endIndex:34,paragraph:{elements:[{textRun:{content:'F1 Határoló fal\n'}}]}},
    {startIndex:34,endIndex:60,paragraph:{elements:[{textRun:{content:'3 rtg\tdiszperziós festés\n'}}]}}
  ]}};
  const requests=retegrendStyleRequests(doc);
  assert.equal(requests.some(request=>request.updateParagraphStyle?.range.startIndex===12),
    false,'Az üres sor nem kaphat beállítást.');
  assert.equal(requests.some(request=>request.updateParagraphStyle?.range.startIndex===14),true);
  const last=requests.find(request=>request.updateParagraphStyle?.range.startIndex===34);
  assert.ok(last,'A legutolsó sor beállítást kap, de kikapcsolva.');
  assert.equal(last.updateParagraphStyle.paragraphStyle.keepWithNext,false,
    'A legutolsó szöveges sor nem marad együtt a következővel.');
});

test('A szerkezetek alpontjai dőlten jelennek meg',()=>{
  const document={namedRanges:{KOCKA_SZOVEG_SZERKEZETEK:{namedRanges:[
    {ranges:[{startIndex:10,endIndex:300}]}]}},
  body:{content:[
    {startIndex:10,endIndex:25,paragraph:{elements:[{textRun:{content:'Alapozás\n'}}]}},
    {startIndex:25,endIndex:120,paragraph:{elements:[{textRun:{
      content:'Az épület alatt sávalap készül, méretezett alapgerendákkal.\n'}}]}},
    {startIndex:120,endIndex:145,paragraph:{elements:[{textRun:{content:'Teherhordó szerkezetek\n'}}]}},
    {startIndex:145,endIndex:260,paragraph:{elements:[{textRun:{
      content:'Az épület tartószerkezete teherhordó falakból áll.\n'}}]}}
  ]}};
  const requests=structureHeadingRequests(document);
  const italics=requests.filter(request=>request.updateTextStyle);
  assert.equal(italics.filter(request=>request.updateTextStyle.textStyle.italic===true).length,2,
    'Az alpontok címei dőltek.');
  assert.equal(italics.filter(request=>request.updateTextStyle.textStyle.italic===false).length,2,
    'A leírások normál stílusúak.');
  const spacing=requests.filter(request=>request.updateParagraphStyle);
  assert.equal(spacing.length,2);
  assert.deepEqual(spacing[0].updateParagraphStyle.paragraphStyle.spaceAbove,
    {magnitude:8,unit:'PT'});
  assert.deepEqual(spacing[0].updateParagraphStyle.paragraphStyle.spaceBelow,
    {magnitude:8,unit:'PT'});
  assert.equal(spacing[0].updateParagraphStyle.paragraphStyle.keepWithNext,true,
    'Az alcím együtt marad a következő bekezdéssel.');
  assert.match(spacing[0].updateParagraphStyle.fields,/keepWithNext/);
});
