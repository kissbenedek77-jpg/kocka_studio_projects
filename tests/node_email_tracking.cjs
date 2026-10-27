'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {verifyResendWebhook,openEvent,emailTrackingStore} = require('../server/email_tracking.cjs');
const {PIXEL,createPixelToken,readPixelToken}=require('../server/email_pixel.cjs');

test('Resend webhook aláírás és időbélyeg ellenőrzése', () => {
  const secret='whsec_'+Buffer.from('test signing key').toString('base64');
  const now=Date.parse('2026-10-02T12:00:00Z'),timestamp=String(Math.floor(now/1000));
  const raw=Buffer.from('{"type":"email.opened"}');
  const id='msg_test123';
  const signature=crypto.createHmac('sha256',Buffer.from('test signing key'))
    .update(`${id}.${timestamp}.`).update(raw).digest('base64');
  const headers={'svix-id':id,'svix-timestamp':timestamp,'svix-signature':'v1,'+signature};
  assert.equal(verifyResendWebhook(raw,headers,secret,now),id);
  assert.throws(()=>verifyResendWebhook(Buffer.from('{}'),headers,secret,now),/Érvénytelen/);
  assert.throws(()=>verifyResendWebhook(raw,headers,secret,now+301000),/Érvénytelen/);
  assert.equal(verifyResendWebhook(Buffer.from('{"event_type":"ping","data":{"success":true}}'),{
    'svix-id':'msg_loFOjxBNrRLzqYUf','svix-timestamp':'1731705121',
    'svix-signature':'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0='
  },'whsec_plJ3nmyCDGBKInavdOK15jsl',1731705121000),'msg_loFOjxBNrRLzqYUf');
});

test('Csak az alkalmazás címzettel és UID-val jelölt megnyitása kerül naplóba', () => {
  const event={type:'email.opened',created_at:'2026-10-02T12:00:00Z',data:{
    email_id:'email-1',from:'studio@example.com',to:['client@example.com'],subject:'Ajánlat',
    tags:{project_uid:'ABC123',kind:'offer'}}};
  assert.deepEqual(openEvent(event,'msg_1','studio@example.com'),{
    webhookId:'msg_1',uid:'ABC123',emailId:'email-1',to:'client@example.com',
    subject:'Ajánlat',at:'2026-10-02T12:00:00.000Z',kind:'offer',source:'resend'});
  assert.equal(openEvent(event,'msg_1','other@example.com'),null);
  assert.equal(openEvent({...event,data:{...event.data,tags:{}}},'msg_1','studio@example.com'),null);
});

test('A megnyitások ismételt webhook nélkül, címzettenként és időponttal számolódnak', async () => {
  const rows=[],sheetNames=[];
  const sheets={spreadsheets:{
    get:async()=>({data:{sheets:sheetNames.map(title=>({properties:{title}}))}}),
    batchUpdate:async()=>{sheetNames.push('_EmailMegnyitasok');return {data:{}}},
    values:{
      update:async()=>({data:{}}),
      get:async options=>({data:{values:options.range.endsWith('A2:A')?
        rows.map(row=>[row[0]]):rows.map(row=>row.slice())}}),
      batchGet:async options=>({data:{valueRanges:options.ranges.map(range=>({
        values:range.includes('_EmailMegnyitasok')?rows.map(row=>row.slice()):[]}))}}),
      append:async options=>{rows.push(options.requestBody.values[0].slice());return {data:{}}}
    }
  }};
  const store=emailTrackingStore({sheetId:'test'},null,{sheets});
  const base={uid:'ABC123',emailId:'email-1',to:'client@example.com',subject:'Ajánlat',kind:'offer'};
  const duplicate={...base,webhookId:'msg_1',at:'2026-10-02T12:00:00Z'};
  assert.deepEqual(await Promise.all([store.record(duplicate),store.record(duplicate)]),
    [{recorded:true},{recorded:false}]);
  await store.record({...base,webhookId:'msg_2',at:'2026-10-02T13:00:00Z'});
  const result=await store.list('ABC123');
  assert.equal(result.messages.length,1);
  assert.equal(result.messages[0].count,2);
  assert.deepEqual(result.messages[0].times.map(item=>item.id),['msg_1','msg_2']);
  assert.equal((await store.list('XYZ123')).messages.length,0);
});

test('A dokumentumletöltések a címzettel és időponttal külön naplóba kerülnek',async () => {
  const sheetsInBook=[],events=[];
  const sheets={spreadsheets:{
    get:async()=>({data:{sheets:sheetsInBook.map(title=>({properties:{title}}))}}),
    batchUpdate:async options=>{sheetsInBook.push(options.requestBody.requests[0].addSheet.properties.title);
      return {data:{}}},
    values:{
      update:async()=>({data:{}}),
      get:async options=>({data:{values:options.range.includes('_EmailLetoltesek')?events:[]}}),
      batchGet:async options=>({data:{valueRanges:options.ranges.map(range=>({
        values:range.includes('_EmailLetoltesek')?events.map(row=>row.slice()):[]}))}}),
      append:async options=>{events.push(options.requestBody.values[0]);return {data:{}}}
    }
  }};
  const store=emailTrackingStore({sheetId:'test'},null,{sheets});
  await store.recordDownload({uid:'ABC123',id:'link-1',to:'client@example.com',
    subject:'Ajánlat',kind:'offer',filename:'ajanlat.pdf',index:0});
  assert.ok(sheetsInBook.includes('_EmailLetoltesek'));
  const result=await store.list('ABC123');
  assert.equal(result.downloads.length,1);
  assert.equal(result.downloads[0].to,'client@example.com');
  assert.equal(result.downloads[0].filename,'ajanlat.pdf');
  assert.ok(!Number.isNaN(Date.parse(result.downloads[0].at)));
});

test('A követőkép titkosított tokenje csak az adott levélhez érvényes',()=>{
  const data={uid:'ABC123',id:'15ac641d-f45e-48a2-ae2b-4848325cc7a7',
    to:'client@example.com',subject:'Ajánlat',kind:'offer'};
  const token=createPixelToken('test-secret',data,Date.parse('2026-10-04'));
  assert.equal(readPixelToken('test-secret',token,Date.parse('2026-10-05')).id,data.id);
  assert.ok(PIXEL.length>0);
  assert.throws(()=>readPixelToken('other-secret',token,Date.parse('2026-10-05')),/Érvénytelen/);
  assert.throws(()=>readPixelToken('test-secret',token,Date.parse('2027-10-05')),/Érvénytelen/);
});

test('Az elküldött levél, a követőkép és a letöltés időpontja egy levélhez kapcsolódik',async()=>{
  const tables=new Map();let batchReads=0;
  const name=range=>range.match(/'([^']+)'/)?.[1];
  const sheets={spreadsheets:{
    get:async()=>({data:{sheets:[...tables.keys()].map(title=>({properties:{title}}))}}),
    batchUpdate:async options=>{tables.set(options.requestBody.requests[0].addSheet.properties.title,[]);return {data:{}}},
    values:{update:async()=>({data:{}}),
      get:async options=>({data:{values:(tables.get(name(options.range))||[]).map(row=>
        options.range.endsWith('A2:A')?[row[0]]:row)}}),
      append:async options=>{tables.get(name(options.range)).push(options.requestBody.values[0]);return {data:{}}},
      batchGet:async options=>{batchReads++;return {data:{valueRanges:options.ranges.map(range=>({
        values:tables.get(name(range))||[]}))}}}
    }
  }};
  const store=emailTrackingStore({sheetId:'test'},null,{sheets});
  const id='15ac641d-f45e-48a2-ae2b-4848325cc7a7';
  await store.recordSent({id,uid:'ABC123',to:'client@example.com',subject:'Ajánlat',
    at:'2026-10-04T10:00:00Z',kind:'offer',resendId:'email-1'});
  await store.record({webhookId:crypto.randomUUID(),uid:'ABC123',emailId:id,
    to:'client@example.com',subject:'Ajánlat',at:'2026-10-04T10:05:00Z',kind:'offer',source:'pixel'});
  await store.recordDownload({uid:'ABC123',id:'link-1',trackingId:id,to:'client@example.com',
    subject:'Ajánlat',kind:'offer',filename:'ajanlat.pdf',index:0});
  const result=await store.list('ABC123');
  assert.equal(batchReads,1);
  assert.equal(result.sent[0].id,id);
  assert.equal(result.messages[0].times[0].source,'pixel');
  assert.equal(result.downloads[0].trackingId,id);
});
