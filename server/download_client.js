'use strict';
const page=document.getElementById('download');
const status=document.getElementById('downloadStatus');
const validity=document.getElementById('downloadValidity');

async function startDownload(){
  try{
    status.textContent='A letöltés előkészítése…';
    status.classList.remove('error');
    const response=await fetch(page.dataset.path,{cache:'no-store',credentials:'omit'});
    if(!response.ok)throw new Error('A dokumentum jelenleg nem tölthető le. Próbálja meg újra, vagy válassza ki a fájlokat külön.');
    const blob=await response.blob();
    if(!blob.size)throw new Error('A letöltött fájl üres.');
    const objectUrl=URL.createObjectURL(blob);
    const anchor=document.createElement('a');anchor.href=objectUrl;
    anchor.download=page.dataset.filename;document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
    status.textContent='A letöltés elindult: '+page.dataset.filename;
    const expires=new Date(Number(page.dataset.expires));
    validity.textContent='A hivatkozás a levél küldésétől számított 30 napig használható'+
      (Number.isNaN(expires.getTime())?'.':', eddig: '+expires.toLocaleString('hu-HU',{timeZone:'Europe/Budapest',dateStyle:'long',timeStyle:'short'})+'.');
    validity.hidden=false;
  }catch(error){status.textContent=error.message||'A letöltés nem sikerült.';
    status.classList.add('error');validity.hidden=true;}
}
startDownload();
