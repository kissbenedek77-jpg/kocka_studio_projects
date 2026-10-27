'use strict';
const crypto = require('node:crypto');
const {google} = require('googleapis');
const {googleQuota} = require('./quota.cjs');
const {googleCache} = require('./cache.cjs');

const SHEET = '_EmailMegnyitasok';
const DOWNLOAD_SHEET = '_EmailLetoltesek';
const SENT_SHEET = '_EmailKuldesek';
const HEADER = ['Esemény ID','Projekt UID','Levél ID','Címzett','Tárgy','Megnyitás UTC','Levéltípus','Forrás'];
const DOWNLOAD_HEADER = ['Esemény ID','Projekt UID','Hivatkozás ID','Címzett','Tárgy',
  'Letöltés UTC','Levéltípus','Fájlnév','Fájl sorszáma','Levél ID'];
const SENT_HEADER = ['Levél ID','Projekt UID','Címzett','Tárgy','Küldés UTC','Levéltípus','Resend ID'];

function verifyResendWebhook(raw, headers, secret, now = Date.now()) {
  const id = String(headers['svix-id'] || '');
  const timestamp = String(headers['svix-timestamp'] || '');
  const signatures = String(headers['svix-signature'] || '').split(' ');
  const seconds = Number(timestamp);
  if (!secret?.startsWith('whsec_') || !/^msg_[A-Za-z0-9_-]+$/.test(id) ||
      !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - seconds) > 300)
    throw Object.assign(new Error('Érvénytelen webhook aláírás.'),{status:401});
  const expected = crypto.createHmac('sha256',Buffer.from(secret.slice(6),'base64'))
    .update(`${id}.${timestamp}.`).update(raw).digest();
  const valid = signatures.some(item => {
    if (!item.startsWith('v1,')) return false;
    const supplied = Buffer.from(item.slice(3),'base64');
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied,expected);
  });
  if (!valid) throw Object.assign(new Error('Érvénytelen webhook aláírás.'),{status:401});
  return id;
}

function openEvent(event, webhookId, expectedFrom) {
  if (event?.type !== 'email.opened') return null;
  const data = event.data || {}, tags = data.tags || {};
  const uid = String(tags.project_uid || '').toUpperCase();
  const to = Array.isArray(data.to) ? String(data.to[0] || '').toLowerCase() : '';
  const date = new Date(event.created_at || '');
  if (!/^[A-Z0-9-]{4,64}$/.test(uid) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) ||
      data.to.length !== 1 || !String(data.email_id || '').trim() ||
      String(data.from || '').toLowerCase() !== String(expectedFrom || '').toLowerCase() ||
      Number.isNaN(date.getTime())) return null;
  return {webhookId,uid,emailId:String(data.email_id),to,subject:String(data.subject || '').slice(0,200),
    at:date.toISOString(),kind:String(tags.kind || '').slice(0,30),source:'resend'};
}

function emailTrackingStore(config, auth, deps = {}) {
  const sheets = deps.sheets || (auth ? google.sheets({version:'v4',auth}) : null);
  const book = config.sheetId;
  let pendingWrite = Promise.resolve();
  const read = call => googleQuota.run('sheetsRead',1,call);
  const write = call => googleQuota.run('sheetsWrite',1,call);
  const titlesKey=`email-tracking-titles:${book}:${crypto.randomUUID()}`;
  const sheetTitles=()=>googleCache.get(titlesKey,60000,async()=>{
    const result=await read(() => sheets.spreadsheets.get({spreadsheetId:book,
      fields:'sheets(properties(title))'}));
    return new Set((result.data.sheets||[]).map(item=>item.properties?.title));
  });
  async function sheetExists(title = SHEET) {return (await sheetTitles()).has(title)}
  async function ensureSheet(title = SHEET, header = HEADER) {
    if (await sheetExists(title)) return;
    try {
      await write(() => sheets.spreadsheets.batchUpdate({spreadsheetId:book,
        requestBody:{requests:[{addSheet:{properties:{title,hidden:true}}}]}}));
    } catch (error) {
      googleCache.clear(titlesKey);
      if (error.status === 429 || !(await sheetExists(title))) throw error;
      return;
    }
    googleCache.clear(titlesKey);
    await write(() => sheets.spreadsheets.values.update({spreadsheetId:book,
      range:`'${title}'!A1:${title === SHEET ? 'H' : title === DOWNLOAD_SHEET ? 'J' : 'G'}1`,valueInputOption:'RAW',
      requestBody:{values:[header]}}));
  }
  async function rows(range = 'A2:H', title = SHEET) {
    if (!(await sheetExists(title))) return [];
    return (await read(() => sheets.spreadsheets.values.get({spreadsheetId:book,
      range:`'${title}'!${range}`,valueRenderOption:'FORMATTED_VALUE'}))).data.values || [];
  }
  async function writeEvent(event) {
    if (!sheets) throw new Error('A megnyitásnaplóhoz GOOGLE_SERVICE_ACCOUNT_JSON szükséges.');
    await ensureSheet();
    if (event.source!=='pixel') {
      const ids = await rows('A2:A');
      if (ids.some(row => row[0] === event.webhookId)) return {recorded:false};
    }
    await write(() => sheets.spreadsheets.values.append({spreadsheetId:book,
      range:`'${SHEET}'!A:H`,valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',
      requestBody:{values:[[event.webhookId,event.uid,event.emailId,event.to,event.subject,event.at,event.kind,event.source||'resend']]}}));
    return {recorded:true};
  }
  function record(event) {
    pendingWrite = pendingWrite.catch(() => {}).then(() => writeEvent(event));
    return pendingWrite;
  }
  function recordDownload(event) {
    pendingWrite = pendingWrite.catch(() => {}).then(async () => {
      if (!sheets) throw new Error('A letöltésnaplóhoz GOOGLE_SERVICE_ACCOUNT_JSON szükséges.');
      await ensureSheet(DOWNLOAD_SHEET,DOWNLOAD_HEADER);
      await write(() => sheets.spreadsheets.values.append({spreadsheetId:book,
        range:`'${DOWNLOAD_SHEET}'!A:J`,valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',
        requestBody:{values:[[crypto.randomUUID(),event.uid,event.id,event.to,event.subject,
          new Date().toISOString(),event.kind,event.filename,String(event.index),event.trackingId||'']]}}));
      return {recorded:true};
    });
    return pendingWrite;
  }
  function recordSent(event) {
    pendingWrite = pendingWrite.catch(() => {}).then(async () => {
      if (!sheets) throw new Error('A levélnaplóhoz GOOGLE_SERVICE_ACCOUNT_JSON szükséges.');
      await ensureSheet(SENT_SHEET,SENT_HEADER);
      await write(() => sheets.spreadsheets.values.append({spreadsheetId:book,
        range:`'${SENT_SHEET}'!A:G`,valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',
        requestBody:{values:[[event.id,event.uid,event.to,event.subject,event.at,event.kind,event.resendId||'']]}}));
      return {recorded:true};
    });
    return pendingWrite;
  }
  async function list(uid) {
    if (!sheets) return {configured:false,messages:[],downloads:[],sent:[]};
    const existing=await sheetTitles();
    const requested=[[SHEET,'A2:H'],[DOWNLOAD_SHEET,'A2:J'],[SENT_SHEET,'A2:G']]
      .filter(([title])=>existing.has(title));
    const allRows=new Map();
    if(requested.length){const result=await read(()=>sheets.spreadsheets.values.batchGet({
      spreadsheetId:book,ranges:requested.map(([title,range])=>`'${title}'!${range}`),
      valueRenderOption:'FORMATTED_VALUE'}));
      requested.forEach(([title],index)=>allRows.set(title,result.data.valueRanges?.[index]?.values||[]));}
    const groups = new Map();
    for (const row of allRows.get(SHEET)||[]) {
      if (row[1] !== uid || !row[2] || !row[3] || !row[5]) continue;
      const key = row[2]+'\0'+row[3];
      if (!groups.has(key)) groups.set(key,{emailId:row[2],to:row[3],subject:row[4]||'',kind:row[6]||'',times:[]});
      const group=groups.get(key);
      if (!group.times.some(item=>item.id===row[0])) group.times.push({id:row[0],at:row[5],source:row[7]||'resend'});
    }
    const messages=Array.from(groups.values()).map(item=>({...item,
      times:item.times.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)),count:item.times.length}));
    messages.sort((a,b)=>Date.parse(b.times.at(-1).at)-Date.parse(a.times.at(-1).at));
    const downloads=[];
    for (const row of allRows.get(DOWNLOAD_SHEET)||[]) {
      if (row[1] !== uid || !row[2] || !row[5]) continue;
      downloads.push({id:row[0],linkId:row[2],to:row[3],subject:row[4],
        at:row[5],kind:row[6],filename:row[7],trackingId:row[9]||''});
    }
    downloads.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
    const sent=[];
    for (const row of allRows.get(SENT_SHEET)||[]) {
      if (row[1]!==uid || !row[0]) continue;
      sent.push({id:row[0],to:row[2]||'',subject:row[3]||'',at:row[4]||'',
        kind:row[5]||'',resendId:row[6]||''});
    }
    sent.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
    return {configured:true,messages,downloads,sent};
  }
  return {record,recordDownload,recordSent,list};
}

module.exports = {verifyResendWebhook,openEvent,emailTrackingStore};
