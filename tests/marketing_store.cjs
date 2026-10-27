'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {marketingStore}=require('../server/marketing_store.cjs');

function fakeDrive(){
  const items=new Map([['template',{id:'template',name:'_template',mimeType:'application/vnd.google-apps.folder',parents:['projects']}]]);
  let number=0;
  const bytes=async stream=>{const chunks=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks)};
  return {items,files:{
    async list({q}){const parent=/^'([^']+)' in parents/.exec(q)?.[1];
      return {data:{files:[...items.values()].filter(item=>item.parents?.includes(parent)).map(({content,...item})=>({...item}))}}},
    async get({fileId,alt}){const item=items.get(fileId);if(!item)throw Error('Missing file');
      return {data:alt==='media'?item.content:(({content,...rest})=>rest)(item)}},
    async create({requestBody,media}){const id='id'+(++number),item={...requestBody,id};
      if(media)item.content=await bytes(media.body);items.set(id,item);return {data:{...item}}},
    async update({fileId,requestBody,media}){const item=items.get(fileId);Object.assign(item,requestBody);
      if(media)item.content=await bytes(media.body);return {data:{...item}}},
    async delete({fileId}){items.delete(fileId);return {data:{}}}
  }};
}

test('marketing campaigns and editable assets round trip through Drive folders',async()=>{
  const drive=fakeDrive(),store=marketingStore(drive,{templateRootFolderId:'template'});
  assert.deepEqual((await store.load()).campaigns,[]);
  await store.saveBrand({font:'Source Sans Pro',logoDataUrl:'data:image/png;base64,not-stored'});
  const campaign={id:'campaign-1',name:'Őszi otthon',channels:['facebook'],drafts:[{
    channel:'facebook',headline:'Otthon',body:'Tervezünk.',cta:'Kérj ajánlatot'}],
    graphic:{headline:'Új otthon',subtitle:'Építészeti tervezés'},
    strategyMarkdown:'# Kampányterv\n\n- [ ] Pixel ellenőrzése'};
  await store.saveCampaign(campaign);
  const png='data:image/png;base64,'+Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(30)]).toString('base64');
  const brandLogo=await store.saveAsset({campaignId:'brand',kind:'brand',name:'logo.png',dataUri:png});
  const asset=await store.saveAsset({campaignId:campaign.id,kind:'element',name:'rajz.png',dataUri:png});
  const background=await store.saveAsset({campaignId:campaign.id,kind:'background',
    name:'ai.png',dataUri:png,generated:true});
  const loaded=await store.load();
  assert.equal(loaded.brand.font,'Source Sans Pro');
  assert.equal(loaded.brand.logoDataUrl,undefined);
  assert.equal(loaded.campaigns[0].drafts[0].body,'Tervezünk.');
  assert.match(loaded.campaigns[0].strategyMarkdown,/Pixel ellenőrzése/);
  assert.equal(JSON.parse([...drive.items.values()].find(item=>item.name==='kampany.json').content.toString()).strategyMarkdown,undefined);
  assert.equal(loaded.assets[campaign.id][0].kind,'element');
  assert.equal(loaded.assets[campaign.id].find(item=>item.id===background.id).generated,true);
  assert.equal(loaded.assets.brand[0].id,brandLogo.id);
  assert.equal(await store.brandLogo(),png);
  assert.equal((await store.loadCampaigns({includeLogo:true})).brandLogoDataUrl,png);
  assert.equal((await store.asset(campaign.id,asset.id)).bytes.length,38);
  const data=[...drive.items.values()].find(item=>item.name==='kampany.json');
  const edited=JSON.parse(data.content.toString('utf8'));edited.drafts[0].body='Külső szerkesztővel módosítva.';
  data.content=Buffer.from(JSON.stringify(edited));
  assert.equal((await store.load()).campaigns[0].drafts[0].body,'Külső szerkesztővel módosítva.');
  const markdown=[...drive.items.values()].find(item=>item.name==='strategia.md');
  markdown.content=Buffer.from('# Külső szerkesztés\n');
  assert.equal((await store.load()).campaigns[0].strategyMarkdown,'# Külső szerkesztés\n');
  await store.saveCampaign({...edited,strategyMarkdown:''});
  assert.equal((await store.load()).campaigns[0].strategyMarkdown,undefined);
  await assert.rejects(store.asset('campaign-2',asset.id),{status:404});
  await store.removeAsset(campaign.id,asset.id);
  assert.equal((await store.load()).assets[campaign.id].length,1);
  const root=[...drive.items.values()].find(item=>item.name==='_Marketing');
  assert.equal(root.parents[0],'projects');
  assert.ok([...drive.items.values()].some(item=>item.name==='Kepek'));
});

test('kampánykreatívok külön mappában menthetők és csak saját kampányból olvashatók',async()=>{
  const drive=fakeDrive(),store=marketingStore(drive,{templateRootFolderId:'template'});
  await store.saveCampaign({id:'campaign-1',name:'Teszt',channels:['facebook'],drafts:[]});
  const png='data:image/png;base64,'+Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(30)]).toString('base64');
  const saved=await store.saveOutput({campaignId:'campaign-1',name:'statikus.png',mimeType:'image/png',dataUri:png});
  const svg='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64');
  await store.saveOutput({campaignId:'campaign-1',name:'statikus.svg',mimeType:'image/svg+xml',dataUri:svg});
  const jpeg='data:image/jpeg;base64,'+Buffer.from([0xff,0xd8,0xff,0xd9]).toString('base64');
  await store.saveOutput({campaignId:'campaign-1',name:'hatter.jpg',mimeType:'image/jpeg',dataUri:jpeg});
  assert.equal((await store.load()).outputs['campaign-1'].length,3);
  assert.equal((await store.output('campaign-1',saved.id)).bytes.length,38);
  await assert.rejects(store.output('campaign-2',saved.id),{status:404});
  await assert.rejects(store.saveOutput({campaignId:'campaign-1',name:'evil.svg',mimeType:'image/svg+xml',dataUri:png}));
  assert.ok([...drive.items.values()].some(item=>item.name==='Kreativok'));
});

test('a böngésző régi kampánymentése megőrzi az ütemező által mentett bejegyzést',async()=>{
  const store=marketingStore(fakeDrive(),{templateRootFolderId:'template'});
  const campaign={id:'campaign-1',name:'Teszt',channels:['facebook'],drafts:[]};
  await store.saveCampaign(campaign);
  await store.saveCampaign({...campaign,posts:[{id:'post-1',status:'draft'}],
    autoPost:{enabled:true,intervalDays:7}});
  await store.saveCampaign({...campaign,name:'Új név',posts:[]},{preservePosts:true});
  const saved=(await store.loadCampaigns()).campaigns[0];
  assert.equal(saved.name,'Új név');
  assert.equal(saved.posts[0].id,'post-1');
  assert.equal(saved.autoPost.enabled,true);
});
