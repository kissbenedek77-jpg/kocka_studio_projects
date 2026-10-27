'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const {simpleParser} = require('mailparser');
const {sentMail} = require('../server/mail.cjs');
const {applyEmailEdits} = require('../server/email_draft.cjs');

const config = {imapHost:'mail.example.com',imapPort:993,imapUser:'owner@example.com',
  imapPassword:'test',smtpHost:'mail.example.com',smtpPort:465,
  smtpUser:'owner@example.com',smtpPassword:'test'};
const message = {to:'client@example.com',subject:'Ajánlat – próba',text:'Kedves Ügyfelünk!',
  attachments:[{filename:'ajanlat.pdf',content:Buffer.from('%PDF-1.4\npróba'),
    contentType:'application/pdf'}]};

function fakeServices({boxes=[{path:'Sent',name:'Sent',specialUse:'\\Sent'}],appendFails=false}={}) {
  const calls = {smtp:[],append:[],connected:false};
  class FakeImap {
    async connect() {calls.connected=true;}
    async list() {return boxes;}
    async append(...args) {calls.append.push(args);if(appendFails)throw Error('IMAP hiba');return {uid:42};}
    async logout() {calls.logout=true;}
  }
  const createTransport = options => options.streamTransport ? nodemailer.createTransport(options) : {
    async sendMail(data) {calls.smtp.push(data);return {accepted:[message.to]};},
    close() {calls.closed=true;}
  };
  return {calls,deps:{ImapFlow:FakeImap,createTransport}};
}

test('SMTP után ugyanaz a mellékletes MIME-levél kerül az Elküldött mappába',async () => {
  const {calls,deps}=fakeServices();
  const result=await sentMail(config,deps).send(message);
  assert.deepEqual(result,{sent:true,saved:true,to:message.to});
  assert.equal(calls.smtp.length,1);
  assert.equal(calls.append.length,1);
  assert.equal(calls.append[0][0],'Sent');
  assert.deepEqual(calls.append[0][1],calls.smtp[0].raw);
  assert.deepEqual(calls.append[0][2],['\\Seen']);
  const parsed=await simpleParser(calls.append[0][1]);
  assert.equal(parsed.to.value[0].address,message.to);
  assert.equal(parsed.subject,message.subject);
  assert.equal(parsed.attachments[0].filename,'ajanlat.pdf');
  assert.deepEqual(parsed.attachments[0].content,message.attachments[0].content);
});

test('Elküldött mappa hiányakor nem történik SMTP-küldés',async () => {
  const {calls,deps}=fakeServices({boxes:[]});
  await assert.rejects(sentMail(config,deps).send(message),/Elküldött levelek mappa/);
  assert.equal(calls.smtp.length,0);
});

test('Sikeres SMTP és hibás IMAP mentés külön állapotot jelez',async () => {
  const {calls,deps}=fakeServices({appendFails:true});
  const result=await sentMail(config,deps).send(message);
  assert.equal(calls.smtp.length,1);
  assert.equal(result.sent,true);
  assert.equal(result.saved,false);
  assert.match(result.warning,/Ne küldd újra/);
});

test('Szerkesztett levél és további fájl az SMTP- és IMAP-másolatban is megvan',async () => {
  const {calls,deps}=fakeServices();
  const edited=applyEmailEdits(message,{to:message.to,subject:'Szerkesztett tárgy',htmlSource:'<p>Kiegészített szöveg</p>',
    extraAttachments:[{filename:'plusz.txt',contentType:'text/plain',
      base64:Buffer.from('További melléklet').toString('base64')}]});
  await sentMail(config,deps).send(edited);
  const parsed=await simpleParser(calls.append[0][1]);
  assert.equal(parsed.subject,'Szerkesztett tárgy');
  assert.match(parsed.text,/Kiegészített szöveg/);
  assert.deepEqual(parsed.attachments.map(item => item.filename),['ajanlat.pdf','plusz.txt']);
  assert.deepEqual(calls.smtp[0].raw,calls.append[0][1]);
});

test('Resend API mellékletekkel küld, majd IMAP-on menti az Elküldött másolatot',async () => {
  const {calls,deps}=fakeServices();
  let request;
  deps.fetch=async (url,options) => {request={url,options};return {ok:true,json:async () => ({id:'email-123'})};};
  const resendConfig={...config,resendApiKey:'test-api-key',resendFrom:'owner@example.com'};
  const result=await sentMail(resendConfig,deps).send(message,{uid:'ABC123',kind:'offer'});
  assert.equal(result.saved,true);
  assert.equal(request.url,'https://api.resend.com/emails');
  assert.equal(request.options.headers.Authorization,'Bearer test-api-key');
  const body=JSON.parse(request.options.body);
  assert.equal(body.from,'owner@example.com');
  assert.deepEqual(body.to,[message.to]);
  assert.equal(body.text,message.text);
  assert.match(body.html,/<html lang="hu">/);
  assert.deepEqual(body.tags,[{name:'project_uid',value:'ABC123'},{name:'kind',value:'offer'}]);
  assert.equal(body.attachments[0].filename,'ajanlat.pdf');
  assert.equal(body.attachments[0].content,message.attachments[0].content.toString('base64'));
  assert.equal(calls.smtp.length,0);
  assert.equal(calls.append.length,1);
  const saved=await simpleParser(calls.append[0][1]);
  assert.equal(saved.from.value[0].address,'owner@example.com');
  assert.deepEqual(saved.attachments[0].content,message.attachments[0].content);
});

test('A Resend és az Elküldött másolat HTML-ben gombot, szövegben letöltési linket kap',async () => {
  const {calls,deps}=fakeServices();
  let body;
  deps.fetch=async (_url,options) => {body=JSON.parse(options.body);
    return {ok:true,json:async () => ({id:'email-download'})};};
  const downloadUrl='https://example.test/download/opaque-token';
  await sentMail({...config,resendApiKey:'test-api-key',resendFrom:'owner@example.com'},deps)
    .send({...message,attachments:[],downloadUrl});
  assert.deepEqual(body.attachments,[]);
  assert.match(body.html,/Dokumentumok letöltése/);
  assert.match(body.html,/Ha a gomb nem működik/);
  assert.match(body.text,/https:\/\/example\.test\/download\/opaque-token/);
  const saved=await simpleParser(calls.append[0][1]);
  assert.match(saved.html,/Dokumentumok letöltése/);
  assert.match(saved.text,/opaque-token/);
  assert.equal(saved.attachments.length,0);
});

test('A látható HTML egyezik; a követőkép csak a kiküldött levélbe kerül',async()=>{
  const {calls,deps}=fakeServices();
  let body;
  deps.fetch=async (_url,options)=>{body=JSON.parse(options.body);
    return {ok:true,json:async()=>({id:'email-html'})}};
  const url='https://example.test/download/protected-token';
  const htmlSource='<div style="background-color:#1e4355;color:#ffffff">Fejléc</div>'+
    '<h2>Ajánlat</h2><p><a href="{{DOWNLOAD_URL}}" style="background-color:#1e4355;color:#ffffff;padding:12px 20px;display:inline-block">Dokumentumok letöltése</a></p>'+
    '<p><a href="{{DOWNLOAD_URL}}">{{DOWNLOAD_URL}}</a></p>';
  const trackingId='15ac641d-f45e-48a2-ae2b-4848325cc7a7';
  await sentMail({...config,resendApiKey:'test-api-key',resendFrom:'owner@example.com'},deps)
    .send({...message,htmlSource,downloadUrl:url,attachments:[],trackingId,
      pixelUrl:'https://example.test/pixel/opaque-token'});
  assert.match(body.html,/Fejléc/);
  assert.match(body.html,/background-color:#1e4355/);
  assert.match(body.html,/https:\/\/example\.test\/download\/protected-token/);
  assert.doesNotMatch(body.html,/\{\{DOWNLOAD_URL\}\}/);
  assert.match(body.text,/protected-token/);
  assert.match(body.html,/https:\/\/example\.test\/pixel\/opaque-token/);
  assert.doesNotMatch(body.text,/pixel\/opaque-token/);
  const saved=await simpleParser(calls.append[0][1]);
  assert.equal(saved.html,body.html.replace(/<img src="https:\/\/example\.test\/pixel\/opaque-token"[^>]*>/,''));
  assert.equal(saved.messageId,`<${trackingId}@kockastudio.hu>`);
  assert.equal(saved.text.trim(),body.text.trim());
  assert.equal(saved.attachments.length,0);
});

test('Resend hiba és hiányzó Elküldött mappa esetén nem ment vagy küld levelet',async () => {
  const resendConfig={...config,resendApiKey:'test-api-key',resendFrom:'owner@example.com'};
  const failed=fakeServices();
  failed.deps.fetch=async () => ({ok:false,status:403,json:async () => ({message:'Domain not verified'})});
  await assert.rejects(sentMail(resendConfig,failed.deps).send(message),/Domain not verified/);
  assert.equal(failed.calls.append.length,0);
  const missing=fakeServices({boxes:[]});
  let sent=false;
  missing.deps.fetch=async () => {sent=true;throw Error('Nem hívható');};
  await assert.rejects(sentMail(resendConfig,missing.deps).send(message),/Elküldött levelek mappa/);
  assert.equal(sent,false);
});

test('Hiányos Resend-beállítás nem válthat vissza SMTP-re',async () => {
  const {calls,deps}=fakeServices();
  const mail=sentMail({...config,resendApiKey:'test-api-key'},deps);
  await assert.rejects(mail.send(message),/RESEND_FROM_EMAIL/);
  assert.equal(calls.connected,false);
  assert.equal(calls.smtp.length,0);
});

test('A megadott IMAP Elküldött mappa kapja a Resend-levél másolatát',async () => {
  const {calls,deps}=fakeServices({boxes:[
    {path:'Sent',name:'Sent',specialUse:'\\Sent'},
    {path:'INBOX/Elküldött',name:'Elküldött'}]});
  deps.fetch=async () => ({ok:true,json:async () => ({id:'email-123'})});
  const mail=sentMail({...config,emailProvider:'resend',resendApiKey:'test-api-key',
    resendFrom:'owner@example.com',imapSentFolder:'INBOX/Elküldött'},deps);
  await mail.send(message);
  assert.equal(calls.append[0][0],'INBOX/Elküldött');
});
