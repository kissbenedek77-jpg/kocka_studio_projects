'use strict';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const rejected=(status,message)=>Object.assign(fail(status,message),{instagramRejected:true});

function status(env=process.env){
  const pageId=String(env.FACEBOOK_PAGE_ID||'');
  return {configured:Boolean(/^\d{5,30}$/.test(pageId)&&env.FACEBOOK_PAGE_ACCESS_TOKEN),
    accountId:/^\d{5,30}$/.test(String(env.INSTAGRAM_BUSINESS_ACCOUNT_ID||''))?
      String(env.INSTAGRAM_BUSINESS_ACCOUNT_ID):''};
}

async function responseJson(response,action){
  try{return await response.json()}catch{throw fail(502,'A Meta '+action+' közben értelmezhetetlen választ adott.');}
}
function metaFailure(response,data,action){
  const detail=String(data?.error?.message||'').slice(0,180);
  if(Number(data?.error?.code)===190||/expired|lejárt/i.test(detail))
    return rejected(401,'Az Instagram-közzétételhez használt Meta token lejárt. Készíts új Page Access Tokent, majd frissítsd a Railway FACEBOOK_PAGE_ACCESS_TOKEN változóját.');
  return rejected(response.status===401||response.status===403?response.status:502,
    `A Meta elutasította az Instagram ${action} műveletet (HTTP ${response.status}). ${detail}`.trim());
}
async function account({pageId,token,accountId,version,fetchImpl}){
  if(accountId)return {id:accountId,username:''};
  let response;try{response=await fetchImpl(`https://graph.facebook.com/${version}/${pageId}?fields=instagram_business_account{id,username}`,{
    headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)
  })}catch{throw rejected(502,'Az Instagram-fiók kapcsolatának ellenőrzése nem sikerült.');}
  const data=await responseJson(response,'fiókellenőrzése');
  if(!response.ok||data.error)throw metaFailure(response,data,'fiókellenőrzési');
  const profile=data.instagram_business_account;
  if(!profile?.id)throw rejected(409,'A Facebook-oldalhoz nincs kapcsolt professzionális Instagram-fiók. Az Instagramot Business vagy Creator fiókká kell tenni, majd hozzá kell kapcsolni ehhez a Facebook-oldalhoz.');
  return {id:String(profile.id),username:String(profile.username||'')};
}
function validate({pageId,token,version,imageUrl,caption}){
  if(!/^\d{5,30}$/.test(pageId||'')||!token)
    throw fail(503,'A FACEBOOK_PAGE_ID vagy FACEBOOK_PAGE_ACCESS_TOKEN nincs beállítva.');
  if(!/^v\d{1,2}\.\d$/.test(version||''))throw fail(500,'Érvénytelen Meta API-verzió.');
  let url;try{url=new URL(imageUrl)}catch{throw fail(400,'Érvénytelen Instagram-képhivatkozás.');}
  if(url.protocol!=='https:')throw fail(400,'Az Instagramnak HTTPS képhivatkozás szükséges.');
  if(typeof caption!=='string'||!caption.trim()||caption.length>2200)
    throw fail(400,'Az Instagram képaláírása 1–2200 karakter lehet.');
}
async function publishInstagramImage({imageUrl,caption},{pageId,token,accountId='',version='v26.0',fetchImpl=fetch}={}){
  validate({pageId,token,version,imageUrl,caption});
  const profile=await account({pageId,token,accountId,version,fetchImpl});
  const form=new URLSearchParams({image_url:imageUrl,caption:caption.trim()});
  let response;try{response=await fetchImpl(`https://graph.facebook.com/${version}/${profile.id}/media`,{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/x-www-form-urlencoded'},
    body:form,signal:AbortSignal.timeout(45000)
  })}catch{throw rejected(502,'Az Instagram médiafeltöltési kérése nem sikerült.');}
  const container=await responseJson(response,'médiafeltöltése');
  if(!response.ok||container.error)throw metaFailure(response,container,'médiafeltöltési');
  if(!/^\d{5,30}$/.test(String(container.id||'')))throw fail(502,'A Meta nem adott Instagram médiaazonosítót.');
  const publishForm=new URLSearchParams({creation_id:String(container.id)});
  try{response=await fetchImpl(`https://graph.facebook.com/${version}/${profile.id}/media_publish`,{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/x-www-form-urlencoded'},
    body:publishForm,signal:AbortSignal.timeout(45000)
  })}catch{throw rejected(502,'Az Instagram közzétételi kérése bizonytalan. Ellenőrizd az Instagram-fiókot, mielőtt újra próbálod.');}
  const published=await responseJson(response,'közzététele');
  if(!response.ok||published.error)throw metaFailure(response,published,'közzétételi');
  if(!/^\d{5,30}$/.test(String(published.id||'')))throw fail(502,'A Meta nem adott Instagram-bejegyzésazonosítót.');
  return {mediaId:String(published.id),username:profile.username};
}
async function deleteInstagramMedia({mediaId},{pageId,token,version='v26.0',fetchImpl=fetch}={}){
  if(!/^\d{5,30}$/.test(pageId||'')||!token)throw fail(503,'A Facebook-oldal hozzáférési adatai hiányoznak.');
  if(!/^\d{5,30}$/.test(mediaId||''))throw fail(400,'Az Instagram-bejegyzés azonosítója hiányzik vagy érvénytelen.');
  let response;try{response=await fetchImpl(`https://graph.facebook.com/${version}/${mediaId}`,{
    method:'DELETE',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)
  })}catch{throw rejected(502,'Az Instagram törlési kérése bizonytalan. Ellenőrizd a fiókot, mielőtt újra próbálod.');}
  const data=await responseJson(response,'törlése');
  if(!response.ok||data.error)throw metaFailure(response,data,'törlési');
  if(data.success!==true)throw fail(502,'A Meta nem igazolta vissza az Instagram-bejegyzés törlését.');
  return {deleted:true};
}

module.exports={instagramStatus:status,publishInstagramImage,deleteInstagramMedia};
