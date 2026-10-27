'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const nodemailer=require('nodemailer');
const {sentMail}=require('../server/mail.cjs');

const address=value=>({address:value});
async function rawMail(from,to,subject,text,attachments=[]) {
  const transport=nodemailer.createTransport({streamTransport:true,buffer:true});
  const result=await transport.sendMail({from,to,subject,text,attachments});
  return result.message;
}
async function setup() {
  const sentRaw=await rawMail('owner@example.com','client@example.com','Ajánlat','Elküldött tartalom');
  const incomingRaw=await rawMail('client@example.com','owner@example.com','Re: Ajánlat','Ügyfél válasza',
    [{filename:'valasz.txt',content:Buffer.from('válasz'),contentType:'text/plain'}]);
  const folders={Sent:[{uid:7,envelope:{from:[address('owner@example.com')],to:[address('client@example.com')],
    subject:'Ajánlat',messageId:'<out@example.com>'},internalDate:new Date('2026-10-01T10:00:00Z'),source:sentRaw}],
  INBOX:[{uid:3,envelope:{from:[address('other@example.com')],to:[address('owner@example.com')],subject:'Más'},
    internalDate:new Date('2026-10-01T11:00:00Z'),source:incomingRaw},
    {uid:4,envelope:{from:[address('client@example.com')],to:[address('owner@example.com')],subject:'Re: Ajánlat',
      messageId:'<in@example.com>'},internalDate:new Date('2026-10-02T10:00:00Z'),source:incomingRaw,
      bodyStructure:{childNodes:[{disposition:'attachment'}]}}]};
  const calls=[];
  class FakeImap {
    async connect() {}
    async list(){return [{path:'INBOX',name:'INBOX'},{path:'Sent',name:'Sent',specialUse:'\\Sent'}]}
    async getMailboxLock(path){this.path=path;this.mailbox={uidValidity:path==='Sent'?100:200};return {release(){}}}
    async search(query){calls.push({path:this.path,query});return folders[this.path].map(item=>item.uid)}
    async *fetch(ids){for(const item of folders[this.path])if(ids.includes(item.uid))yield item}
    async fetchOne(uid){return folders[this.path].find(item=>item.uid===uid)}
    async logout(){}
  }
  const mail=sentMail({imapHost:'mail.example.com',imapPort:993,imapUser:'owner@example.com',
    imapPassword:'secret'}, {ImapFlow:FakeImap});
  return {mail,calls};
}

test('A bejövő és kimenő levelek időrendben, pontos projektcím alapján jelennek meg',async()=>{
  const {mail,calls}=await setup();
  const result=await mail.listConversation('client@example.com');
  assert.deepEqual(result.messages.map(item=>item.id),['sent:100:7','incoming:200:4']);
  assert.deepEqual(result.messages.map(item=>item.direction),['sent','incoming']);
  assert.equal(result.messages[1].attachmentCount,1);
  assert.deepEqual(calls.map(call=>call.query),[{to:'client@example.com'},{from:'client@example.com'}]);
});

test('A bejövő válasz törzse és melléklete csak a kapcsolódó projektnél olvasható',async()=>{
  const {mail}=await setup();
  const detail=await mail.get('client@example.com','incoming:200:4');
  assert.match(detail.text,/Ügyfél válasza/);
  assert.equal(detail.attachments[0].filename,'valasz.txt');
  const file=await mail.attachment('client@example.com','incoming:200:4',0);
  assert.equal(Buffer.from(file.base64,'base64').toString(),'válasz');
  await assert.rejects(mail.get('client@example.com','incoming:200:3'),/nem a kiválasztott projekthez/);
  await assert.rejects(mail.attachment('other@example.com','incoming:200:4',0),/nem található/);
  await assert.rejects(mail.get('client@example.com','incoming:201:4'),/nem érvényes/);
});
