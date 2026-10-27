'use strict';

const sharp=require('sharp');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const rejected=(status,message)=>Object.assign(fail(status,message),{facebookRejected:true});

function metaFailure(response,data){
  const detail=String(data?.error?.message||'').slice(0,180);
  const expired=Number(data?.error?.code)===190&&
    (Number(data?.error?.error_subcode)===463||/expired|lejárt/i.test(detail));
  if(expired)return rejected(401,'A Facebook-oldal hozzáférési tokenje lejárt. Készíts új Page Access Tokent, ellenőrizd a Meta Access Token Debuggerben, majd frissítsd a Railway FACEBOOK_PAGE_ACCESS_TOKEN változót.');
  if(/publish_actions/i.test(detail))return rejected(403,
    'A Meta nem engedte a képes oldalbejegyzést. Ellenőrizd, hogy a Railway FACEBOOK_PAGE_ACCESS_TOKEN valódi Page Access Token, az oldalazonosító egyezik, és a tokenhez pages_manage_posts, pages_read_engagement, pages_show_list, valamint az oldalon CREATE_CONTENT jogosultság tartozik.');
  if(/pages_manage_posts/i.test(detail))return rejected(403,
    'A Meta az alkalmazás pages_manage_posts jogosultságát utasította el. A Meta for Developers App Review / Permissions and Features részében ellenőrizd, hogy a kiválasztott alkalmazás hozzáfér-e ehhez a joghoz; a token Debuggerben is legyen pages_manage_posts, pages_read_engagement és pages_show_list. Jogosultságváltozás után új Page Access Token és Railway-változófrissítés szükséges.');
  if(/pages_manage_posts/i.test(detail))return rejected(403,
    'A Meta az alkalmazás pages_manage_posts jogosultságát utasította el. A Meta for Developers App Review / Permissions and Features részében ellenőrizd, hogy a kiválasztott alkalmazás hozzáfér-e ehhez a joghoz; a token Debuggerben is legyen pages_manage_posts, pages_read_engagement és pages_show_list. Jogosultságváltozás után új Page Access Token és Railway-változófrissítés szükséges.');
  return rejected(response.status===429?429:response.status===401||response.status===403?response.status:502,
    `A Facebook elutasította a bejegyzést (HTTP ${response.status}). ${detail}`.trim());
}

function facebookStatus(env=process.env){
  return {configured:Boolean(/^\d{5,30}$/.test(env.FACEBOOK_PAGE_ID||'')&&env.FACEBOOK_PAGE_ACCESS_TOKEN),
    pageId:/^\d{5,30}$/.test(env.FACEBOOK_PAGE_ID||'')?env.FACEBOOK_PAGE_ID:''};
}
async function publishFacebookPhoto({image,body,generatedWithAi=false},{pageId,token,version='v26.0',fetchImpl=fetch}={}){
  if(!/^\d{5,30}$/.test(pageId||'')||!token)
    throw fail(503,'A FACEBOOK_PAGE_ID vagy FACEBOOK_PAGE_ACCESS_TOKEN nincs beállítva.');
  if(!/^v\d{1,2}\.\d$/.test(version))throw fail(500,'Érvénytelen Meta API-verzió.');
  if(typeof body!=='string'||!body.trim()||body.length>5000||!Buffer.isBuffer(image)||
    !image.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))
    throw fail(400,'Hiányos Facebook-bejegyzés.');
  let identity;try{identity=await fetchImpl(`https://graph.facebook.com/${version}/me?fields=id`,{
    headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)
  })}catch{throw rejected(502,'A Facebook-token ellenőrzése nem sikerült; a bejegyzést nem küldtük el. Próbáld újra később.');}
  let identityData;try{identityData=await identity.json()}
  catch{throw rejected(502,'A Facebook-token ellenőrzése értelmezhetetlen választ adott; a bejegyzést nem küldtük el.');}
  if(!identity.ok||identityData.error)throw metaFailure(identity,identityData);
  if(String(identityData.id||'')!==pageId)throw rejected(403,
    'A FACEBOOK_PAGE_ACCESS_TOKEN nem a FACEBOOK_PAGE_ID alatt megadott oldalhoz tartozik. A céges oldal Page Access Tokenjét másold a Railway-változóba, és ellenőrizd az oldal számszerű azonosítóját.');
  let bytes;try{bytes=await sharp(image).resize(1080,1350,{fit:'inside'})
    .jpeg({quality:83,mozjpeg:true}).toBuffer();}
  catch{throw fail(422,'A kreatív képe nem alakítható Facebook-kompatibilis formátumra.');}
  if(bytes.length>10*1024*1024)throw fail(422,'A Facebookra küldendő kép túl nagy.');
  const form=new FormData();form.set('caption',body.trim());form.set('published','true');
  form.set('is_gen_ai',generatedWithAi?'true':'false');
  form.set('provenance_type',generatedWithAi?'EXPLICIT':'NONE');
  form.set('source',new Blob([bytes],{type:'image/jpeg'}),'bejegyzes.jpg');
  let response;try{response=await fetchImpl(`https://graph.facebook.com/${version}/${pageId}/photos`,{
    method:'POST',headers:{Authorization:'Bearer '+token},body:form,signal:AbortSignal.timeout(45000)
  })}catch{throw fail(502,'A Facebook kérés eredménye bizonytalan. Ellenőrizd az oldalt, mielőtt újra próbálod.');}
  let data;try{data=await response.json()}catch{throw fail(502,'A Facebook nem értelmezhető választ adott. Ellenőrizd az oldalt.');}
  if(!response.ok||data.error)throw metaFailure(response,data);
  if(!/^\d+(?:_\d+)?$/.test(String(data.post_id||data.id||'')))
    throw fail(502,'A Facebook nem adott bejegyzésazonosítót. Ellenőrizd az oldalt.');
  return {postId:String(data.post_id||data.id),photoId:String(data.id||'')};
}

async function deleteFacebookPhoto({photoId},{pageId,token,version='v26.0',fetchImpl=fetch}={}){
  if(!/^\d{5,30}$/.test(pageId||'')||!token)
    throw fail(503,'A FACEBOOK_PAGE_ID vagy FACEBOOK_PAGE_ACCESS_TOKEN nincs beállítva.');
  if(!/^\d{5,30}$/.test(photoId||''))throw fail(400,'A Facebook-kép azonosítója hiányzik vagy érvénytelen.');
  if(!/^v\d{1,2}\.\d$/.test(version))throw fail(500,'Érvénytelen Meta API-verzió.');
  let identity;try{identity=await fetchImpl(`https://graph.facebook.com/${version}/me?fields=id`,{
    headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)
  })}catch{throw rejected(502,'A Facebook-token ellenőrzése nem sikerült; a bejegyzést nem töröltük.');}
  let identityData;try{identityData=await identity.json()}
  catch{throw rejected(502,'A Facebook-token ellenőrzése értelmezhetetlen választ adott; a bejegyzést nem töröltük.');}
  if(!identity.ok||identityData.error)throw metaFailure(identity,identityData);
  if(String(identityData.id||'')!==pageId)throw rejected(403,
    'A FACEBOOK_PAGE_ACCESS_TOKEN nem a FACEBOOK_PAGE_ID alatt megadott oldalhoz tartozik. A bejegyzést nem töröltük.');
  let response;try{response=await fetchImpl(`https://graph.facebook.com/${version}/${photoId}`,{
    method:'DELETE',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)
  })}catch{throw fail(502,'A Facebook törlési kérése bizonytalan. Ellenőrizd az oldalt, mielőtt újra próbálod.');}
  let data;try{data=await response.json()}catch{throw fail(502,'A Facebook a törlésre értelmezhetetlen választ adott.');}
  if(!response.ok||data.error)throw metaFailure(response,data);
  if(data.success!==true)throw fail(502,'A Facebook nem igazolta vissza a bejegyzés törlését.');
  return {deleted:true};
}
module.exports={facebookStatus,publishFacebookPhoto,deleteFacebookPhoto};
