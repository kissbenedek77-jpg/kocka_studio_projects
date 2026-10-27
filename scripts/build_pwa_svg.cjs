'use strict';

// Embed the final PNG unchanged so the SVG and the PNG render the same pixels.
const fs=require('node:fs');
const path=require('node:path');
const publicDir=path.join(__dirname,'..','public');
const png=fs.readFileSync(path.join(publicDir,'kocka-icon-512.png'));
if(!png.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||
  png.readUInt32BE(16)!==512||png.readUInt32BE(20)!==512)
  throw new Error('A forrásikonnak 512 × 512 pixeles PNG-nek kell lennie.');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="Kocka Stúdió ikon"><image x="0" y="0" width="512" height="512" href="data:image/png;base64,${png.toString('base64')}"/></svg>\n`;
fs.writeFileSync(path.join(publicDir,'kocka-icon.svg'),svg,'utf8');
