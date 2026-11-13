'use strict';

// A nyilvános weboldal tartalmi modellje. A szövegek oldalakra, azokon belül
// csoportokra és mezőkre tagolódnak; a projektek külön listát alkotnak
// képekkel. A formátum szándékosan egyszerű, hogy a szerkesztő és az export
// ugyanazt használja.

const PUBLIC_BASE = String(process.env.WEB_PUBLIC_BASE || 'https://kockastudio.up.railway.app')
  .replace(/\/+$/,'');
const MAX_FIELD = 8000;
const MAX_DESCRIPTION = 12000;

// A mezőnevek magyar címkéi. Az ismeretlen kulcsok a saját nevükkel jelennek
// meg, így a tartalom bővíthető anélkül, hogy kódot kellene módosítani.
const LABELS = {
  hero:'Hero cím',
  intro:'Bevezető',
  home_intro:'Bemutatkozás (főoldal)',
  values_intro:'Értékek bevezető',
  team_intro:'Szakterületek bevezető',
  clients_intro:'Megbízók bevezető',
  testimonial:'Idézet',
  testimonial_author:'Idézet szerzője',
  testimonial_role:'Idézet szerepe',
  focus_intro:'Fókuszterületek bevezető',
  approach:'Megközelítés',
  approach_intro:'Megközelítés bevezető',
  process_intro:'Folyamat bevezető'
};
const PATTERNS = [
  [/^service_(\d+)$/,'Szolgáltatás $1'],
  [/^focus_(\d+)$/,'Fókuszterület $1'],
  [/^approach_(\d+)$/,'Megközelítés pont $1'],
  [/^process_(\d+)_title$/,'Folyamat $1 – cím'],
  [/^process_(\d+)_desc$/,'Folyamat $1 – leírás'],
  [/^value_(\d+)$/,'Érték $1'],
  [/^team_(\d+)_role$/,'Szakterület $1 – szerep'],
  [/^team_(\d+)$/,'Szakterület $1'],
  [/^client_(\d+)_desc$/,'Megbízó $1 – leírás'],
  [/^client_(\d+)$/,'Megbízó $1']
];
const GROUP_RULES = [
  [/^(hero|intro|home_intro)$/,'Fejléc és bevezető'],
  [/^values?/,'Értékek'],
  [/^team_/,'Szakterületek'],
  [/^clients?_/,'Megbízók'],
  [/^testimonial/,'Idézet'],
  [/^service_/,'Szolgáltatások'],
  [/^focus_/,'Fókuszterületek'],
  [/^approach/,'Megközelítés'],
  [/^process_/,'Folyamat']
];

function labelFor(key) {
  if (LABELS[key]) return LABELS[key];
  for (const [pattern,label] of PATTERNS)
    if (pattern.test(key)) return key.replace(pattern,label);
  return key.replace(/_/g,' ').replace(/^\w/,letter => letter.toUpperCase());
}

function groupFor(key) {
  for (const [pattern,label] of GROUP_RULES) if (pattern.test(key)) return label;
  return 'Általános';
}

function clean(value, limit = MAX_FIELD) {
  return String(value == null ? '' : value).replace(/\u0000/g,'').trim().slice(0,limit);
}

function absolute(src) {
  const value = String(src || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return PUBLIC_BASE+value;
  return PUBLIC_BASE+'/'+value.replace(/^\.\//,'').replace(/^\.\.\//,'');
}

// kulcs=érték sorok beolvasása (a # kezdetű sorok megjegyzések).
function parseTxt(content) {
  const pairs = [];
  for (const raw of String(content || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    pairs.push([line.slice(0,index).trim(),line.slice(index+1).trim()]);
  }
  return pairs;
}

function serializeTxt(fields, title) {
  const lines = ['# Kocka Stúdió – szerkesztett tartalom'];
  if (title) lines.push('# oldal: '+String(title).replace(/\r?\n/g,' ').trim());
  lines.push('');
  for (const field of fields) lines.push(`${field.key}=${String(field.value || '').replace(/\r?\n/g,' ').trim()}`);
  return lines.join('\n')+'\n';
}

// Egy oldal csoportokba rendezett mezői. A csoportok sorrendje a szövegben való
// első előfordulás szerint alakul, így a szerkesztő a dokumentum rendjét követi.
function pageFromPairs(id,title,file,pairs) {
  const groups = [];
  const byName = new Map();
  for (const [key,value] of pairs) {
    const name = groupFor(key);
    if (!byName.has(name)) {
      const group = {title:name,fields:[]};
      byName.set(name,group);
      groups.push(group);
    }
    byName.get(name).fields.push({key,label:labelFor(key),
      multiline:value.length > 90 || /intro|desc|description/.test(key),
      value:clean(value)});
  }
  return {id,title,file,groups};
}

// Az oldal címe a fájl elején álló `# oldal: Név` (vagy `# page: Név`) sorból
// származik; ha nincs ilyen, a fájlnévből képzett cím.
const PAGE_TITLE = /^#\s*(?:oldal|cím|cim|page|title)\s*[:=]\s*(.+)$/im;
// Ismert fájlnevekhez szép cím, hogy az ékezetes oldalcímek megmaradjanak.
const PAGE_TITLES = {
  home:'Főoldal', fooldal:'Főoldal', rolunk:'Rólunk', szolgaltatasok:'Szolgáltatások',
  kapcsolat:'Kapcsolat', naplo:'Napló', munkaink:'Munkáink', projektek:'Projektek',
  arak:'Árak', galeria:'Galéria'
};

function pageTitleFrom(text,file) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const value = line.trim();
    if (!value) continue;
    const match = value.match(PAGE_TITLE);
    if (match) return clean(match[1],120);
    if (!value.startsWith('#')) break;
  }
  const key = String(file || '').replace(/\.txt$/i,'').replace(/[-_]+/g,' ').trim().toLowerCase();
  if (PAGE_TITLES[key]) return PAGE_TITLES[key];
  return clean(key ? key.replace(/^./,letter => letter.toUpperCase()) : 'Oldal',120);
}

// A [blokk] szintaxist használó fájlok rekordlistát írnak le (pl. projektek),
// nem egy oldalt, ezért nem jelennek meg oldalként a szerkesztőben.
function hasBlocks(text) {
  return /^\s*\[[^\]]+\]\s*$/m.test(String(text || ''));
}

// A data mappából származó fájlokból oldalak, a fájlban lévő kulcsokkal és
// sorrendben. Ismeretlen kulcs is bekerül, így a forma a fájlt követi.
function pagesFromFiles(files) {
  const pages = [];
  for (const item of files || []) {
    const file = String(item && item.file || '').replace(/\.txt$/i,'').replace(/[^a-zA-Z0-9_-]/g,'');
    if (!file || hasBlocks(item && item.text)) continue;
    const pairs = parseTxt(item.text);
    if (!pairs.length) continue;
    const page = pageFromPairs(file,pageTitleFrom(item.text,file),file,pairs);
    page.titleFromFile = PAGE_TITLE.test(String(item.text || ''));
    pages.push(page);
  }
  return pages;
}

// A meglévő (szerkesztett) oldalak és a fájlokból olvasott szerkezet
// összevonása: a mezők és a sorrend a fájlból jön, a már ismert értékek
// megmaradnak, az új kulcsok értéke a fájlból származik, a fájlból eltűnt
// mezők pedig kikerülnek a formáról.
function mergePages(current,scanned) {
  const byId = new Map((current || []).map(page => [page.id,page]));
  return (scanned || []).map(page => {
    const old = byId.get(page.id);
    if (!old) return page;
    const values = new Map();
    for (const group of old.groups || [])
      for (const field of group.fields || []) values.set(field.key,field.value);
    const merged = {
      ...page,
      title: page.titleFromFile ? page.title : (old.title || page.title),
      groups: page.groups.map(group => ({...group,fields:group.fields.map(field =>
        values.has(field.key) ? {...field,value:values.get(field.key)} : field)}))
    };
    delete merged.titleFromFile;
    return merged;
  });
}

// A régi projects.js bejegyzéséből a szerkesztő saját projektobjektuma.
function projectFromLegacy(project) {
  const images = Array.isArray(project.images) ? project.images : [];
  const thumbs = Array.isArray(project.thumbs) ? project.thumbs : [];
  return {
    id: String(project.id || '').trim().slice(0,90),
    title: clean(project.title,200),
    type: clean(project.type,120),
    location: clean(project.location,160),
    year: String(project.year ?? '').slice(0,10),
    tagline: clean(project.tagline,600),
    description: clean(project.description,MAX_DESCRIPTION),
    credits: clean(project.credits,400),
    category: clean(project.category,60),
    early: Boolean(project.early),
    images: images.map((src,index) => ({
      src: absolute(src),
      thumb: absolute(thumbs[index] || src),
      name: String(src || '').split('/').pop() || ('kep-'+(index+1)+'.jpg'),
      source: 'legacy'
    })).filter(item => item.src)
  };
}

function buildSeed({pages,projects,now = Date.now()}) {
  return {
    version: 1,
    updatedAt: new Date(now).toISOString(),
    pages: (pages || []).map(page => ({
      id: page.id, title: page.title, file: page.file,
      groups: (page.groups || []).map(group => ({
        title: group.title,
        fields: (group.fields || []).map(field => ({
          key: field.key, label: field.label,
          multiline: Boolean(field.multiline), value: field.value
        }))
      }))
    })),
    projects: (projects || []).map(project => ({
      ...project,
      images: (project.images || []).map(image => ({
        src: image.src, thumb: image.thumb || image.src,
        name: image.name, source: image.source || 'legacy'
      }))
    }))
  };
}

// A beérkező (esetleg régi vagy hiányos) tartalom védelme: csak a várt
// struktúra és méretek maradhatnak meg.
function normalizeContent(content) {
  if (!content || typeof content !== 'object') throw new Error('A weboldal tartalma hiányzik.');
  const pages = (Array.isArray(content.pages) ? content.pages : []).slice(0,20).map(page => ({
    id: String(page?.id || '').trim().slice(0,40),
    title: clean(page?.title,120),
    file: String(page?.file || '').replace(/[^a-z0-9_-]/gi,'').slice(0,60),
    groups: (Array.isArray(page?.groups) ? page.groups : []).slice(0,40).map(group => ({
      title: clean(group?.title,120),
      fields: (Array.isArray(group?.fields) ? group.fields : []).slice(0,120).map(field => ({
        key: String(field?.key || '').trim().slice(0,80),
        label: clean(field?.label,120),
        multiline: Boolean(field?.multiline),
        value: clean(field?.value,MAX_FIELD)
      })).filter(field => field.key)
    }))
  })).filter(page => page.id);
  const projects = (Array.isArray(content.projects) ? content.projects : []).slice(0,500)
    .map(project => ({
      id: String(project?.id || '').trim().replace(/[^A-Za-z0-9_-]/g,'-').slice(0,90),
      title: clean(project?.title,200),
      type: clean(project?.type,120),
      location: clean(project?.location,160),
      year: String(project?.year ?? '').replace(/[^0-9]/g,'').slice(0,4),
      tagline: clean(project?.tagline,600),
      description: clean(project?.description,MAX_DESCRIPTION),
      credits: clean(project?.credits,400),
      category: clean(project?.category,60),
      early: Boolean(project?.early),
      images: (Array.isArray(project?.images) ? project.images : []).slice(0,200).map(image => ({
        src: clean(image?.src,1000),
        thumb: clean(image?.thumb || image?.src,1000),
        name: clean(image?.name,160),
        source: image?.source === 'upload' ? 'upload' : 'legacy'
      })).filter(image => image.src)
    }))
    .filter(project => project.id);
  if (!pages.length && !projects.length) throw new Error('A weboldal tartalma üres.');
  return {version:1,updatedAt:new Date().toISOString(),pages,projects};
}

const PROJECT_FIELDS = [
  ['title','Cím',false],['type','Típus',false],['location','Helyszín',false],
  ['year','Év',false],['category','Kategória',false],['tagline','Rövid leírás',true],
  ['description','Leírás',true],['credits','Kreditek',false]
];

// Egy oldal visszaírása a régi kulcs=érték TXT formátumba (az export része).
// A címet megjegyzésként is kiírjuk, hogy a következő beolvasáskor megmaradjon.
function exportPageTxt(page) {
  const fields = [];
  for (const group of page.groups || [])
    for (const field of group.fields || []) fields.push(field);
  return serializeTxt(fields,page.title);
}

// A projektek szövegei a weboldal által használt blokkos TXT formában
// ([projekt-id] blokkok, kulcs=érték sorokkal).
const PROJECT_TXT_KEYS = ['title','type','location','year','tagline','description','credits'];

function exportProjectsTxt(projects) {
  const lines = [
    '# Kocka Stúdió – projektek szövegei',
    '# Szerkeszthető TXT. A blokkok [projekt-id] sorral kezdődnek.',
    '# Mezők: '+PROJECT_TXT_KEYS.join(', '),
    ''
  ];
  for (const project of projects || []) {
    lines.push('['+project.id+']');
    for (const key of PROJECT_TXT_KEYS) {
      const value = String(project[key] == null ? '' : project[key]).replace(/\r?\n/g,' ').trim();
      if (value) lines.push(key+'='+value);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// A projektlista visszaírása a weboldal által használt projects.js formába.
function exportProjectsJs(projects) {
  const list = (projects || []).map(project => ({
    id: project.id,
    year: project.year ? Number(project.year) : undefined,
    location: project.location,
    title: project.title,
    type: project.type,
    category: project.category,
    description: project.description,
    credits: project.credits,
    early: Boolean(project.early),
    cover: project.images[0]?.src || '',
    images: project.images.map(image => image.src),
    thumbs: project.images.map(image => image.thumb)
  }));
  return '/* Kocka Stúdió – a weboldal-kezelőből exportálva */\nconst PROJECTS = '
    + JSON.stringify(list,null,2)+';\n';
}

module.exports = {PUBLIC_BASE,PROJECT_FIELDS,parseTxt,serializeTxt,pageFromPairs,
  pageTitleFrom,hasBlocks,pagesFromFiles,mergePages,
  projectFromLegacy,buildSeed,normalizeContent,absolute,labelFor,groupFor,clean,
  exportPageTxt,exportProjectsTxt,exportProjectsJs};
