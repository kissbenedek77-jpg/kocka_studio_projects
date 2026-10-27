'use strict';

const {Readable} = require('node:stream');
const {googleQuota} = require('./quota.cjs');

const FOLDER = 'application/vnd.google-apps.folder';
const IMAGE_TYPES = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
const OUTPUT_TYPES=new Set(['image/png','image/jpeg','image/svg+xml','video/webm','text/html']);
const fail = (message,status=400) => Object.assign(new Error(message),{status});
const validId = value => /^[A-Za-z0-9_-]{1,90}$/.test(String(value || ''));
const safeName = value => String(value || '').replace(/[\\/<>:"|?*\x00-\x1f]/g,'_').trim().slice(0,100);
const q = value => String(value).replace(/\\/g,'\\\\').replace(/'/g,"\\'");

function marketingStore(drive,config) {
  const run = (cost,call) => googleQuota.run('drive',cost,call);
  async function children(parent) {
    const files=[];let pageToken;
    do {
      const result=await run(100,()=>drive.files.list({
        q:`'${q(parent)}' in parents and trashed = false`,pageSize:1000,pageToken,
        fields:'nextPageToken,files(id,name,mimeType,appProperties,size)',supportsAllDrives:true,
        includeItemsFromAllDrives:true
      }));
      files.push(...(result.data.files||[]));pageToken=result.data.nextPageToken;
    } while(pageToken);
    return files;
  }
  async function root(create=false) {
    if(config.marketingFolderId) {
      const item=(await run(5,()=>drive.files.get({fileId:config.marketingFolderId,
        fields:'id,name,mimeType',supportsAllDrives:true}))).data;
      if(item.mimeType!==FOLDER)throw fail('A MARKETING_FOLDER_ID nem mappára mutat.',500);
      return item;
    }
    const template=(await run(5,()=>drive.files.get({fileId:config.templateRootFolderId,
      fields:'id,parents',supportsAllDrives:true}))).data;
    const parent=template.parents?.[0];
    if(!parent)throw fail('A _template mappa szülője nem található.',500);
    const found=(await children(parent)).find(item=>item.name==='_Marketing'&&item.mimeType===FOLDER);
    if(found||!create)return found||null;
    return (await run(100,()=>drive.files.create({requestBody:{name:'_Marketing',mimeType:FOLDER,
      parents:[parent]},fields:'id,name,mimeType',supportsAllDrives:true}))).data;
  }
  async function folder(parent,name,create=false) {
    const found=(await children(parent)).find(item=>item.name===name&&item.mimeType===FOLDER);
    if(found||!create)return found||null;
    return (await run(100,()=>drive.files.create({requestBody:{name,mimeType:FOLDER,parents:[parent]},
      fields:'id,name,mimeType',supportsAllDrives:true}))).data;
  }
  async function campaignFolder(id,create=false,name='') {
    if(!validId(id))throw fail('Érvénytelen kampányazonosító.');
    const home=await root(create);if(!home)return null;
    const found=(await children(home.id)).find(item=>item.mimeType===FOLDER&&
      item.appProperties?.marketingCampaignId===id);
    if(found||!create)return found||null;
    const label=safeName(name)||'Új kampány';
    return (await run(100,()=>drive.files.create({requestBody:{
      name:`${label} (${id})`,mimeType:FOLDER,parents:[home.id],
      appProperties:{marketingCampaignId:id}
    },fields:'id,name,mimeType,appProperties',supportsAllDrives:true}))).data;
  }
  async function readFile(id) {
    const response=await run(5,()=>drive.files.get({fileId:id,alt:'media',supportsAllDrives:true},
      {responseType:'arraybuffer'}));
    return Buffer.from(response.data);
  }
  async function putFile(parent,name,mime,bytes,existing) {
    const media={mimeType:mime,body:Readable.from([bytes])};
    if(existing)return (await run(100,()=>drive.files.update({fileId:existing.id,
      requestBody:{name,mimeType:mime},media,fields:'id,name,mimeType',supportsAllDrives:true}))).data;
    return (await run(100,()=>drive.files.create({requestBody:{name,mimeType:mime,parents:[parent]},
      media,fields:'id,name,mimeType',supportsAllDrives:true}))).data;
  }
  async function load() {
    const home=await root(false);
    if(!home)return {brand:null,campaigns:[],assets:{},outputs:{},folders:{},folderUrl:''};
    const entries=await children(home.id);
    const brandFile=entries.find(item=>item.name==='beallitasok.json'&&item.mimeType==='application/json');
    let brand=null;
    if(brandFile)try{brand=JSON.parse((await readFile(brandFile.id)).toString('utf8'))}
      catch(_){throw fail('A _Marketing/beallitasok.json nem érvényes JSON.',422)}
    const logo=entries.find(item=>item.name.startsWith('logo.')&&IMAGE_TYPES[item.mimeType]);
    const assets={brand:logo?[{id:logo.id,name:logo.name,mimeType:logo.mimeType,kind:'brand'}]:[]};
    const campaigns=[],folders={},outputs={};
    for(const entry of entries.filter(item=>item.mimeType===FOLDER&&item.appProperties?.marketingCampaignId)) {
      const files=await children(entry.id),data=files.find(item=>item.name==='kampany.json');
      if(!data)continue;
      let campaign;
      try{campaign=JSON.parse((await readFile(data.id)).toString('utf8'))}
      catch(_){throw fail(`${entry.name}/kampany.json nem érvényes JSON.`,422)}
      if(!campaign||campaign.id!==entry.appProperties.marketingCampaignId||
        typeof campaign.name!=='string'||!Array.isArray(campaign.channels)||!Array.isArray(campaign.drafts))
        throw fail(`${entry.name}/kampany.json szerkezete hibás.`,422);
      const strategy=files.find(item=>item.name==='strategia.md');
      if(strategy)campaign.strategyMarkdown=(await readFile(strategy.id)).toString('utf8');
      campaigns.push(campaign);
      folders[campaign.id]=`https://drive.google.com/drive/folders/${entry.id}`;
      const images=files.find(item=>item.name==='Kepek'&&item.mimeType===FOLDER);
      assets[campaign.id]=images?(await children(images.id))
        .filter(item=>IMAGE_TYPES[item.mimeType]).map(item=>({id:item.id,name:item.name,
          mimeType:item.mimeType,kind:item.appProperties?.marketingAssetKind||'photo',
          generated:item.appProperties?.generated==='1'})):[];
      const creatives=files.find(item=>item.name==='Kreativok'&&item.mimeType===FOLDER);
      outputs[campaign.id]=creatives?(await children(creatives.id))
        .filter(item=>OUTPUT_TYPES.has(item.mimeType)).map(item=>({id:item.id,name:item.name,
          mimeType:item.mimeType,size:Number(item.size)||0})):[];
    }
    return {brand,campaigns,assets,outputs,folders,folderUrl:`https://drive.google.com/drive/folders/${home.id}`};
  }
  async function loadCampaigns({includeLogo=false}={}) {
    const home=await root(false);if(!home)return {brand:null,campaigns:[]};
    const entries=await children(home.id);
    const brandFile=entries.find(item=>item.name==='beallitasok.json'&&item.mimeType==='application/json');
    const brand=brandFile?JSON.parse((await readFile(brandFile.id)).toString('utf8')):null;
    const logo=includeLogo?entries.find(item=>item.name.startsWith('logo.')&&IMAGE_TYPES[item.mimeType]):null;
    const brandLogoDataUrl=logo?`data:${logo.mimeType};base64,${(await readFile(logo.id)).toString('base64')}`:'';
    const campaigns=[];
    for(const entry of entries.filter(item=>item.mimeType===FOLDER&&item.appProperties?.marketingCampaignId)){
      const data=(await children(entry.id)).find(item=>item.name==='kampany.json');if(!data)continue;
      const campaign=JSON.parse((await readFile(data.id)).toString('utf8'));
      if(campaign?.id===entry.appProperties.marketingCampaignId&&Array.isArray(campaign.drafts))campaigns.push(campaign);
    }
    return {brand,campaigns,brandLogoDataUrl};
  }
  async function saveBrand(brand) {
    if(!brand||typeof brand!=='object'||Array.isArray(brand))throw fail('Érvénytelen arculati beállítások.');
    const clean={...brand};delete clean.logoDataUrl;
    const bytes=Buffer.from(JSON.stringify(clean,null,2)+'\n');
    if(bytes.length>32768)throw fail('Az arculati beállítások túl nagyok.');
    const home=await root(true),old=(await children(home.id)).find(item=>item.name==='beallitasok.json');
    await putFile(home.id,'beallitasok.json','application/json',bytes,old);
    return {saved:true,folderUrl:`https://drive.google.com/drive/folders/${home.id}`};
  }
  async function saveCampaign(campaign,{preservePosts=false}={}) {
    if(!campaign||!validId(campaign.id)||typeof campaign.name!=='string'||
      !Array.isArray(campaign.channels)||!Array.isArray(campaign.drafts))throw fail('Érvénytelen kampány.');
    if(campaign.strategyMarkdown!==undefined&&
      (typeof campaign.strategyMarkdown!=='string'||Buffer.byteLength(campaign.strategyMarkdown)>60000))
      throw fail('A kampányterv túl nagy vagy érvénytelen.');
    const target=await campaignFolder(campaign.id,true,campaign.name);
    const entries=await children(target.id),old=entries.find(item=>item.name==='kampany.json');
    const metadata={...campaign};delete metadata.strategyMarkdown;
    if(preservePosts&&old){
      const saved=JSON.parse((await readFile(old.id)).toString('utf8'));
      if(Array.isArray(saved.posts))metadata.posts=saved.posts;
      if(saved.autoPost&&typeof saved.autoPost==='object')metadata.autoPost=saved.autoPost;
    }
    const bytes=Buffer.from(JSON.stringify(metadata,null,2)+'\n');
    if(bytes.length>256*1024)throw fail('A kampány adatai túl nagyok.');
    const targetName=`${safeName(campaign.name)||'Új kampány'} (${campaign.id})`;
    if(target.name!==targetName)await run(100,()=>drive.files.update({fileId:target.id,
      requestBody:{name:targetName},fields:'id,name',supportsAllDrives:true}));
    if(!old||!(await readFile(old.id)).equals(bytes))
      await putFile(target.id,'kampany.json','application/json',bytes,old);
    if(typeof campaign.strategyMarkdown==='string'&&campaign.strategyMarkdown.trim()){
      const text=Buffer.from(campaign.strategyMarkdown.trimEnd()+'\n','utf8');
      const existing=entries.find(item=>item.name==='strategia.md');
      if(!existing||!(await readFile(existing.id)).equals(text))
        await putFile(target.id,'strategia.md','text/markdown',text,existing);
    }else if(campaign.strategyMarkdown===''){
      const existing=entries.find(item=>item.name==='strategia.md');
      if(existing)await run(100,()=>drive.files.delete({fileId:existing.id,supportsAllDrives:true}));
    }
    if(!entries.some(item=>item.name==='OLVASS_EL.txt'))await putFile(target.id,'OLVASS_EL.txt','text/plain',
      Buffer.from('A kampany.json UTF-8 szövegfájl. A kampány leírása, hirdetésszövegei, grafikai feliratai és mérőszámai itt szerkeszthetők. A strategia.md a külön szerkeszthető marketing cselekvési terv. A Kepek mappa tartalmazza a logót, háttérképeket, grafikai elemeket és fotókat. Külső módosítás után frissítsd a marketing oldalt.\n'),null);
    return {saved:true,folderUrl:`https://drive.google.com/drive/folders/${target.id}`};
  }
  async function assetFolder(campaignId,create=false) {
    if(campaignId==='brand')return root(create);
    const target=await campaignFolder(campaignId,create);
    return target?folder(target.id,'Kepek',create):null;
  }
  async function asset(campaignId,fileId) {
    if(!validId(fileId))throw fail('Érvénytelen fájlazonosító.');
    const target=await assetFolder(campaignId,false);
    if(!target)throw fail('A képmappa nem található.',404);
    const item=(await children(target.id)).find(file=>file.id===fileId&&IMAGE_TYPES[file.mimeType]);
    if(!item)throw fail('A kép nem található ebben a kampányban.',404);
    return {item,bytes:await readFile(item.id)};
  }
  async function brandLogo() {
    const home=await root(false);if(!home)return '';
    const logo=(await children(home.id)).find(item=>item.name.startsWith('logo.')&&IMAGE_TYPES[item.mimeType]);
    if(!logo)return '';
    return `data:${logo.mimeType};base64,${(await readFile(logo.id)).toString('base64')}`;
  }
  async function saveAsset({campaignId,kind,name,dataUri,generated=false}) {
    if(!validId(campaignId)||!['brand','logo','background','element','photo'].includes(kind)||
      (campaignId==='brand')!==(kind==='brand'))throw fail('Érvénytelen képtípus.');
    const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUri||''));
    if(!match)throw fail('Érvénytelen képformátum.');
    const bytes=Buffer.from(match[2],'base64'),mime=match[1];
    if(bytes.length<16||bytes.length>10*1024*1024||
      !(mime==='image/png'&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||
        mime==='image/jpeg'&&bytes[0]===0xff&&bytes[1]===0xd8||
        mime==='image/webp'&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'))
      throw fail('A képfájl sérült vagy túl nagy.');
    const target=await assetFolder(campaignId,true),entries=await children(target.id);
    const old=kind==='photo'?null:entries.find(item=>item.appProperties?.marketingAssetKind===kind||
      (kind==='brand'&&item.name.startsWith('logo.')));
    const filename=kind==='photo'?(safeName(name)||`foto-${Date.now()}.${IMAGE_TYPES[mime]}`):
      `${kind==='brand'?'logo':kind==='element'?'grafikai-elem':kind==='background'?'hatterkep':'logo'}.${IMAGE_TYPES[mime]}`;
    const media={mimeType:mime,body:Readable.from([bytes])};
    const requestBody={name:filename,mimeType:mime,
      appProperties:{marketingAssetKind:kind,generated:generated?'1':'0'}};
    const file=old?(await run(100,()=>drive.files.update({fileId:old.id,requestBody,media,
      fields:'id,name,mimeType,appProperties',supportsAllDrives:true}))).data:
      (await run(100,()=>drive.files.create({requestBody:{...requestBody,parents:[target.id]},media,
        fields:'id,name,mimeType,appProperties',supportsAllDrives:true}))).data;
    return {id:file.id,name:file.name,mimeType:mime,kind,generated:Boolean(generated)};
  }
  async function removeAsset(campaignId,fileId) {
    await asset(campaignId,fileId);
    await run(100,()=>drive.files.delete({fileId,supportsAllDrives:true}));
    return {deleted:true};
  }
  async function creativeFolder(campaignId,create=false){
    const target=await campaignFolder(campaignId,create);
    return target?folder(target.id,'Kreativok',create):null;
  }
  async function output(campaignId,fileId){
    if(!validId(campaignId)||!validId(fileId))throw fail('Érvénytelen fájlazonosító.');
    const target=await creativeFolder(campaignId,false);
    if(!target)throw fail('A kreatívok mappája nem található.',404);
    const item=(await children(target.id)).find(file=>file.id===fileId&&OUTPUT_TYPES.has(file.mimeType));
    if(!item)throw fail('A kreatív nem található ebben a kampányban.',404);
    return {item,bytes:await readFile(item.id)};
  }
  async function saveOutput({campaignId,name,mimeType,dataUri}){
    if(!validId(campaignId)||campaignId==='brand'||!OUTPUT_TYPES.has(mimeType)||
      typeof name!=='string'||safeName(name)!==name||name.length>100||!name)
      throw fail('Érvénytelen kampánykreatív.');
    const extensions={'image/png':'.png','image/jpeg':'.jpg','image/svg+xml':'.svg','video/webm':'.webm','text/html':'.html'};
    if(!name.toLowerCase().endsWith(extensions[mimeType]))throw fail('A kreatív kiterjesztése nem egyezik a formátummal.');
    const prefix='data:'+mimeType+';base64,';
    if(typeof dataUri!=='string'||!dataUri.startsWith(prefix)||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(dataUri.slice(prefix.length)))throw fail('Érvénytelen kreatívfájl.');
    const bytes=Buffer.from(dataUri.slice(prefix.length),'base64');
    if(!bytes.length||bytes.length>20*1024*1024||
      mimeType==='image/png'&&!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||
      mimeType==='image/jpeg'&&!(bytes[0]===0xff&&bytes[1]===0xd8)||
      mimeType==='video/webm'&&!bytes.subarray(0,4).equals(Buffer.from('1a45dfa3','hex'))||
      mimeType==='image/svg+xml'&&!/^\s*<svg\b/i.test(bytes.toString('utf8')))
      throw fail('A kreatívfájl sérült vagy túl nagy.');
    const target=await creativeFolder(campaignId,true);
    const existing=(await children(target.id)).find(item=>item.name===name&&item.mimeType===mimeType);
    const file=await putFile(target.id,name,mimeType,bytes,existing);
    return {id:file.id,name,mimeType,size:bytes.length};
  }
  return {load,loadCampaigns,saveBrand,saveCampaign,asset,brandLogo,saveAsset,removeAsset,output,saveOutput};
}

module.exports={marketingStore};
