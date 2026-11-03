'use strict';

// PDF-szöveg kiolvasása a Poppler pdftotext parancsával. A Docker-kép tartalmazza
// a popplert; ha a helyi gépen nincs, a hívó figyelmeztetést kap és a
// rétegrend-adatok hiányjelöléssel készülnek. Hálózatot nem használ.
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const BINARY = process.env.PDFTOTEXT_BIN || 'pdftotext';
const LIMIT = 4*1024*1024;

// Egy pdftotext hívás. Siker esetén a kimenet pufferét adja vissza, különben
// hibát dob. Az `unavailable` jelzi, hogy a hívás meg sem indult (nincs bináris),
// ilyenkor a fájlos tartalék sem segíthet.
function pdftotext(args, {input, timeout = 20000} = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(BINARY, args, {windowsHide:true,
        stdio:[input ? 'pipe' : 'ignore','pipe','ignore']});
    } catch (error) {
      const failure = new Error('A PDF-szövegolvasó nem indítható: '+
        (error.message||String(error)));
      failure.unavailable = true;
      return reject(failure);
    }
    const chunks = [];
    let size = 0, done = false;
    const finish = (error,value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      const failure = new Error('A PDF szövegének kiolvasása időtúllépés miatt nem fejeződött be.');
      failure.unavailable = true;
      finish(failure);
    },timeout);
    child.on('error',error => {
      const failure = error.code === 'ENOENT'
        ? new Error('A PDF-szövegolvasó (pdftotext) nem érhető el ezen a környezeten.')
        : error;
      failure.unavailable = failure.unavailable || error.code === 'ENOENT';
      finish(failure);
    });
    child.stdout.on('data',chunk => {
      size += chunk.length;
      if (size > LIMIT) {
        child.kill();
        const failure = new Error('A PDF szövege 4 MB-nál hosszabb.');
        failure.unavailable = true;
        return finish(failure);
      }
      chunks.push(chunk);
    });
    child.on('close',code => {
      if (code === 0) return finish(null,Buffer.concat(chunks));
      finish(new Error('A PDF-szövegolvasó hibakóddal lépett ki: '+code+'.'));
    });
    if (input) {
      child.stdin.on('error',() => {});
      child.stdin.end(input);
    }
  });
}

// A régebbi kiadások (például a Xpdf 4.00) nem olvassák a szabványos bemenetet,
// ezért tartalékként ideiglenes fájlból dolgoznak. Élesben (Poppler) már az
// első, bemenet nélküli hívás sikerül.
async function pdftotextFromFile(buffer, {timeout = 20000} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'kocka-pdftotext-'));
  const source = path.join(directory,'source.pdf');
  const target = path.join(directory,'output.txt');
  try {
    fs.writeFileSync(source,buffer);
    await pdftotext(['-layout','-enc','UTF-8',source,target],{timeout});
    return fs.readFileSync(target);
  } finally {
    fs.rmSync(directory,{recursive:true,force:true});
  }
}

async function pdfToText(buffer, {timeout = 20000} = {}) {
  if (!buffer?.length) return '';
  let firstError = null;
  try {
    return (await pdftotext(['-layout','-enc','UTF-8','-','-'],
      {input:buffer,timeout})).toString('utf8');
  } catch (error) {
    if (error.unavailable) throw error;
    firstError = error;
  }
  try {
    return (await pdftotextFromFile(buffer,{timeout})).toString('utf8');
  } catch (error) {
    if (error.unavailable) throw error;
    // Ha a fájlos tartalék sem működik, az első hiba az informatívabb.
    throw firstError || error;
  }
}

module.exports = {pdfToText};
