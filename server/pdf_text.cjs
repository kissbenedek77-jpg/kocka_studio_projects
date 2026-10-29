'use strict';

// PDF-szöveg kiolvasása a Poppler pdftotext parancsával. A Docker-kép tartalmazza
// a popplert; ha a helyi gépen nincs, a hívó figyelmeztetést kap és a
// rétegrend-adatok hiányjelöléssel készülnek. Hálózatot nem használ.
const {spawn} = require('node:child_process');
const BINARY = process.env.PDFTOTEXT_BIN || 'pdftotext';
const LIMIT = 4*1024*1024;

function pdfToText(buffer, {timeout = 20000} = {}) {
  return new Promise((resolve,reject) => {
    if (!buffer?.length) return resolve('');
    let child;
    try {
      child = spawn(BINARY,['-layout','-enc','UTF-8','-','-'],{windowsHide:true,
        stdio:['pipe','pipe','ignore']});
    } catch (error) {
      return reject(new Error('A PDF-szövegolvasó nem indítható: '+(error.message||String(error))));
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
      finish(new Error('A PDF szövegének kiolvasása időtúllépés miatt nem fejeződött be.'));
    },timeout);
    child.on('error',error => finish(error.code === 'ENOENT'
      ? new Error('A PDF-szövegolvasó (pdftotext) nem érhető el ezen a környezeten.')
      : error));
    child.stdout.on('data',chunk => {
      size += chunk.length;
      if (size > LIMIT) {child.kill(); return finish(new Error('A PDF szövege 4 MB-nál hosszabb.'));}
      chunks.push(chunk);
    });
    child.on('close',code => finish(null,code === 0
      ? Buffer.concat(chunks).toString('utf8') : ''));
    child.stdin.on('error',() => {});
    child.stdin.end(buffer);
  });
}

module.exports = {pdfToText};
