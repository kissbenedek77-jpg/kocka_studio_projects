'use strict';

// Egy oldal <style> blokkjának kiemelése a közös témába, az oldalra scope-olva.
// Használat: node scripts/scope_page_css.cjs <fájl> <page-id>
// Például:  node scripts/scope_page_css.cjs technical.html technical

const fs = require('node:fs');
const path = require('node:path');

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g,'');
}

// A CSS-t eső szabályokra bontja, és a szelektorokat a megadott oldalra szűkíti.
function scopeCss(css,page) {
  const prefix = 'body[data-ks-page="'+page+'"]';
  const source = stripComments(css);
  let out = '';
  let index = 0;
  while (index < source.length) {
    const brace = source.indexOf('{',index);
    if (brace < 0) break;
    const selector = source.slice(index,brace).trim();
    let depth = 1;
    let end = brace+1;
    while (end < source.length && depth > 0) {
      if (source[end] === '{') depth += 1;
      else if (source[end] === '}') depth -= 1;
      end += 1;
    }
    const body = source.slice(brace+1,end-1);
    if (!selector) { index = end; continue; }
    if (/^@(media|supports)/.test(selector)) {
      out += selector+'{\n'+scopeCss(body,page)+'}\n';
    } else if (/^@(keyframes|-webkit-keyframes|font-face|import|charset)/.test(selector)) {
      out += selector+'{'+body+'}\n';
    } else {
      const scoped = selector.split(',').map(part => {
        const value = part.trim();
        if (!value) return '';
        if (value === ':root' || value === 'html' || value === 'body') return prefix;
        if (value === '*') return prefix+' *';
        if (/^(html|body)\s+/.test(value)) return prefix+' '+value.replace(/^(html|body)\s+/,'');
        if (value.startsWith('html.') || value.startsWith('body.')) return prefix+value.replace(/^(html|body)/,'');
        return prefix+' '+value;
      }).filter(Boolean).join(', ');
      if (scoped) out += scoped+'{'+body+'}\n';
    }
    index = end;
  }
  return out;
}

const file = process.argv[2];
const page = process.argv[3];
if (!file || !page) {
  console.error('Használat: node scripts/scope_page_css.cjs <fájl> <page-id>');
  process.exit(1);
}
const full = path.join(__dirname,'..',file);
const html = fs.readFileSync(full,'utf8');
const match = html.match(/<style>([\s\S]*?)<\/style>/);
if (!match) {
  console.error('Nincs <style> blokk: '+file);
  process.exit(1);
}
const scoped = scopeCss(match[1],page);
const themeFile = path.join(__dirname,'..','public','theme','ks-theme.css');
const theme = fs.readFileSync(themeFile,'utf8');
fs.writeFileSync(themeFile,
  theme.replace(/\s*$/,'')+'\n\n/* ---- '+file+' – a korábbi oldalspecifikus stílusblokk ---- */\n'+scoped,
  'utf8');
fs.writeFileSync(full,html.replace(match[0],''),'utf8');
console.log('Kiemelve: '+file+' -> public/theme/ks-theme.css ('+scoped.length+' karakter)');
