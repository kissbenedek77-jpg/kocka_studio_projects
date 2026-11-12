'use strict';

// A weboldal-kezelő kezdő tartalmának kinyerése a másik projektből
// (kocka_studio_uj_honlap/shared). Egyszeri fejlesztői segédeszköz: az
// eredménye a data/website/seed.json, amit a szerver az első induláskor
// bemásol a saját tárolójába.
//
// Használat:
//   node scripts/build_web_seed.cjs [forrasMappa]
// A forrásmappa alapértéke: C:\munka\kocka_studio_uj_honlap\shared

const fs = require('node:fs');
const path = require('node:path');
const {parseTxt,pageFromPairs,projectFromLegacy,buildSeed} = require('../server/web_content.cjs');

const source = process.argv[2] || 'C:\\munka\\kocka_studio_uj_honlap\\shared';
const output = path.join(__dirname,'..','data','website','seed.json');

function readIf(file) {
  try { return fs.readFileSync(file,'utf8'); }
  catch (_) { return ''; }
}

// A projects.js egy JSON-tömböt tartalmaz; a hozzá tartozó záró zárójelet
// karakterenként keressük meg (a fájlban további tömbök is lehetnek).
function extractArray(source, startIndex) {
  let depth = 0, inString = false, escape = false;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex,index+1);
    }
  }
  return '';
}

function readProjects(file) {
  const source = readIf(file);
  if (!source) return [];
  const start = source.indexOf('[');
  if (start < 0) return [];
  try { return JSON.parse(extractArray(source,start)); }
  catch (_) { return []; }
}

const rolunk = parseTxt(readIf(path.join(source,'data','rolunk.txt')));
const szolgaltatasok = parseTxt(readIf(path.join(source,'data','szolgaltatasok.txt')));
const legacyProjects = readProjects(path.join(source,'js','projects.js'));

// A home_intro a főoldalhoz tartozik, ezért onnan emeljük át.
const homeIntro = rolunk.find(([key]) => key === 'home_intro');
const rolunkPairs = rolunk.filter(([key]) => key !== 'home_intro');

const pages = [
  pageFromPairs('home','Főoldal','index',[
    ['hero',''],
    ['home_intro',homeIntro ? homeIntro[1] : ''],
    ['cta','']
  ]),
  pageFromPairs('rolunk','Rólunk','rolunk',rolunkPairs),
  pageFromPairs('szolgaltatasok','Szolgáltatások','szolgaltatasok',szolgaltatasok)
];
const projects = legacyProjects.map(projectFromLegacy);

const seed = buildSeed({pages,projects});
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(seed,null,2),'utf8');
console.log(`Seed elkészült: ${output}`);
console.log(`Oldalak: ${pages.length}, projektek: ${projects.length}, `+
  `kép: ${projects.reduce((sum,project)=>sum+project.images.length,0)}`);
