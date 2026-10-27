'use strict';
const {ImapFlow} = require('imapflow');
const {simpleParser} = require('mailparser');
const nodemailer = require('nodemailer');
const {emailHtml} = require('./email_download.cjs');
const {renderEmailHtml,plainTextFromHtml} = require('./email_templates.cjs');

function sentMail(config, deps = {}) {
  const ImapClient = deps.ImapFlow || ImapFlow;
  const createTransport = deps.createTransport || nodemailer.createTransport;
  const fetchResend = deps.fetch || globalThis.fetch;
  const configured = Boolean(config.imapUser && config.imapPassword);
  const smtpConfigured = Boolean(config.smtpHost && config.smtpUser && config.smtpPassword);
  const resendConfigured = Boolean(config.resendApiKey && config.resendFrom);
  const provider = String(config.emailProvider || (config.resendApiKey || config.resendFrom ? 'resend' : 'smtp')).toLowerCase();
  function assertReady() {
    if (provider !== 'resend' && provider !== 'smtp')
      throw new Error('Az EMAIL_PROVIDER értéke resend vagy smtp lehet.');
    if (provider === 'resend' && !resendConfigured)
      throw new Error('A Resend küldéshez RESEND_API_KEY és RESEND_FROM_EMAIL szükséges.');
    if (provider === 'smtp' && !smtpConfigured)
      throw new Error('Az SMTP küldéshez SMTP_HOST, SMTP_USER és SMTP_PASSWORD szükséges.');
    if (!configured)
      throw new Error('Az Elküldött mappához IMAP_USER és IMAP_PASSWORD szükséges.');
  }
  function sentFolder(boxes) {
    if (config.imapSentFolder) return boxes.find(box =>
      box.path === config.imapSentFolder || box.name === config.imapSentFolder);
    return boxes.find(box => box.specialUse === '\\Sent') ||
      boxes.find(box => /^(sent|sent items|elküldött|elküldött elemek)$/i.test(box.name));
  }
  function imapClient() {
    return new ImapClient({host:config.imapHost,port:config.imapPort,secure:true,
      auth:{user:config.imapUser,pass:config.imapPassword},logger:false});
  }
  async function withMailbox(callback, direction = 'sent') {
    const client = imapClient();
    await client.connect();
    try {
      const boxes = await client.list();
      const folder = direction === 'incoming' ? boxes.find(box =>
        String(box.path).toUpperCase() === 'INBOX' || box.specialUse === '\\Inbox') : sentFolder(boxes);
      if (!folder) throw new Error(direction === 'incoming' ?
        'Az IMAP-fiókban nincs Beérkező levelek mappa.' :
        'Az IMAP-fiókban nincs elküldött levelek mappa.');
      const lock = await client.getMailboxLock(folder.path);
      try {return await callback(client, folder.path);} finally {lock.release();}
    } finally {await client.logout().catch(() => {});}
  }
  function belongs(envelope, recipient, direction) {
    const addresses = direction === 'incoming' ? envelope?.from || [] :
      [...envelope?.to || [], ...envelope?.cc || [], ...envelope?.bcc || []];
    return addresses.some(item => String(item.address || '').toLowerCase() === recipient.toLowerCase());
  }
  function attachmentCount(part) {
    if (!part) return 0;
    if (part.childNodes?.length) return part.childNodes.reduce((sum, child) => sum + attachmentCount(child), 0);
    return part.disposition === 'attachment' || part.parameters?.name || part.dispositionParameters?.filename ? 1 : 0;
  }
  async function listFolder(recipient, direction) {
    if (!configured) return {configured: false, messages: []};
    return withMailbox(async client => {
      const ids = await client.search(direction === 'incoming' ? {from: recipient} : {to: recipient}) || [];
      const selected = ids.slice(-100);
      const messages = [];
      if (!selected.length) return {configured: true, messages};
      for await (const item of client.fetch(selected, {uid: true, envelope: true, internalDate: true, bodyStructure: true})) {
        if (!belongs(item.envelope, recipient, direction)) continue;
        messages.push({id: `${direction}:${client.mailbox.uidValidity}:${item.uid}`,direction,
          messageId:item.envelope?.messageId || '',
          date: (item.internalDate || item.envelope?.date || '').toString(),
          subject: item.envelope?.subject || '(tárgy nélkül)',
          from:(item.envelope?.from || []).map(address => address.address).join(', '),
          to:(item.envelope?.to || []).map(address => address.address).join(', '),
          attachmentCount:attachmentCount(item.bodyStructure)});
      }
      messages.sort((a, b) => new Date(b.date) - new Date(a.date));
      return {configured: true, messages};
    }, direction);
  }
  const list = recipient => listFolder(recipient, 'sent');
  async function listConversation(recipient) {
    if (!configured) return {configured:false,messages:[]};
    const [sent,incoming] = await Promise.allSettled([
      listFolder(recipient,'sent'),listFolder(recipient,'incoming')]);
    const errors=[];
    if(sent.status==='rejected')errors.push('Elküldött: '+sent.reason.message);
    if(incoming.status==='rejected')errors.push('Beérkező: '+incoming.reason.message);
    if(errors.length===2)throw new Error(errors.join(' · '));
    return {configured:true,messages:[...(sent.value?.messages||[]),...(incoming.value?.messages||[])]
      .sort((a,b)=>new Date(a.date)-new Date(b.date)),...(errors.length?{error:errors.join(' · ')}:{})};
  }
  async function get(recipient, id) {
    if (!configured) throw new Error('Az IMAP-kapcsolat nincs beállítva.');
    const match = String(id).match(/^(?:(sent|incoming):)?(\d{1,20}):(\d{1,20})$/);
    if (!match) throw new Error('Érvénytelen levélazonosító.');
    const direction=match[1]||'sent';
    return withMailbox(async client => {
      if (String(client.mailbox.uidValidity) !== match[2]) throw new Error('A levélazonosító már nem érvényes.');
      const uid = Number(match[3]);
      if (!Number.isSafeInteger(uid) || uid < 1) throw new Error('Érvénytelen levélazonosító.');
      const message = await client.fetchOne(uid, {source: true, envelope: true, internalDate: true}, {uid: true});
      if (!message) throw new Error('A levél nem található.');
      if (!belongs(message.envelope,recipient,direction))
        throw new Error('Ez a levél nem a kiválasztott projekthez tartozik.');
      if(message.source.length>30*1024*1024)throw new Error('A levél túl nagy a megjelenítéshez.');
      const parsed = await simpleParser(message.source, {skipHtmlToText: false});
      return {id, date: (message.internalDate || '').toString(), subject: parsed.subject || '',
        direction,from:parsed.from?.text||'',to:parsed.to?.text || '',
        text: String(parsed.text || '').slice(0, 100000),
        attachments:(parsed.attachments||[]).map((file,index)=>({index,
          filename:file.filename||`Melléklet ${index+1}`,size:file.size||file.content?.length||0,
          contentType:file.contentType||'application/octet-stream'}))};
    },direction);
  }
  async function attachment(recipient,id,index) {
    if(!configured)throw new Error('Az IMAP-kapcsolat nincs beállítva.');
    if(!Number.isSafeInteger(index)||index<0||index>100)throw new Error('Érvénytelen mellékletazonosító.');
    const match=String(id).match(/^(?:(sent|incoming):)?(\d{1,20}):(\d{1,20})$/);
    if(!match)throw new Error('Érvénytelen levélazonosító.');
    const uid=Number(match[3]);
    if(!Number.isSafeInteger(uid)||uid<1)throw new Error('Érvénytelen levélazonosító.');
    const direction=match[1]||'sent';
    return withMailbox(async client=>{
      if(String(client.mailbox.uidValidity)!==match[2])throw new Error('A levélazonosító már nem érvényes.');
      const message=await client.fetchOne(uid,{source:true,envelope:true},{uid:true});
      if(!message||!belongs(message.envelope,recipient,direction))throw new Error('A levél nem található.');
      if(message.source.length>30*1024*1024)throw new Error('A levél túl nagy a melléklet letöltéséhez.');
      const parsed=await simpleParser(message.source);
      const file=parsed.attachments[index];
      if(!file||file.content.length>20*1024*1024)throw new Error('A melléklet nem található vagy túl nagy.');
      return {filename:file.filename||`Melléklet ${index+1}`,contentType:file.contentType||'application/octet-stream',
        base64:file.content.toString('base64')};
    },direction);
  }
  async function send(message, tracking = {}) {
    assertReady();
    if (!message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(message.to || '')))
      throw new Error('Érvénytelen e-mail-cím.');
    const sender = provider === 'resend' ? config.resendFrom : config.smtpUser;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(sender)))
      throw new Error('A feladó e-mail-címe érvénytelen.');
    const baseHtml = message.htmlSource ? renderEmailHtml(message.htmlSource,message.downloadUrl) :
      emailHtml(message.text,message.downloadUrl);
    const html = message.pixelUrl ? baseHtml.replace('</body>',
      `<img src="${message.pixelUrl}" width="1" height="1" alt="" style="display:block;width:1px;height:1px"></body>`) : baseHtml;
    const text = message.htmlSource ? plainTextFromHtml(baseHtml) :
      message.text + (message.downloadUrl ?
        '\n\nDokumentumok letöltése (a hivatkozás 30 napig használható):\n'+message.downloadUrl : '');
    const mime = content => createTransport({streamTransport:true,buffer:true,newline:'windows'})
      .sendMail({from:sender,to:message.to,subject:message.subject,
        ...(message.trackingId ? {messageId:`<${message.trackingId}@kockastudio.hu>`} : {}),
        text,html:content,attachments:message.attachments || []});
    // A saját Elküldött másolat megnyitása ne számítson ügyfélmegnyitásnak.
    const savedRaw=await mime(baseHtml);
    const sentRaw=message.pixelUrl?await mime(html):savedRaw;
    if (![savedRaw,sentRaw].every(raw=>Buffer.isBuffer(raw.message)&&raw.message.length<=25*1024*1024))
      throw new Error('A levél túl nagy a küldéshez (legfeljebb 25 MB).');
    const client = imapClient();
    await client.connect();
    try {
      const sent = sentFolder(await client.list());
      if (!sent) throw new Error('Az IMAP-fiókban nincs Elküldött levelek mappa. Ellenőrizd az IMAP_SENT_FOLDER beállítást; a levél nem lett elküldve.');
      let resendId = '';
      if (provider === 'resend') {
        let response;
        try {
          response = await fetchResend('https://api.resend.com/emails',{
            method:'POST',headers:{Authorization:'Bearer '+config.resendApiKey,
              'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),
            body:JSON.stringify({from:sender,to:[message.to],subject:message.subject,
              text,html,
              ...(tracking.uid ? {tags:[{name:'project_uid',value:tracking.uid},
                {name:'kind',value:String(tracking.kind || 'other')}]} : {}),
              attachments:(message.attachments || []).map(file => ({
                filename:file.filename,content:Buffer.from(file.content).toString('base64')}))})});
        } catch (_) {
          throw new Error('A Resend válasza nem érkezett meg. Újraküldés előtt ellenőrizd a Resend levelezési naplóját.');
        }
        const result = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error('A Resend nem fogadta el a levelet: '+String(result.message || response.status).slice(0,300));
        if (!result.id)
          throw new Error('A Resend válasza hiányos. Újraküldés előtt ellenőrizd a Resend levelezési naplóját.');
        resendId = String(result.id);
      } else {
        const transport = createTransport({host:config.smtpHost,port:config.smtpPort,
          secure:config.smtpPort === 465,
          auth:{user:config.smtpUser,pass:config.smtpPassword}});
        try {
          const info = await transport.sendMail({raw:sentRaw.message,envelope:sentRaw.envelope});
          if (!info.accepted?.some(address =>
            String(address).toLowerCase() === String(message.to).toLowerCase()))
            throw new Error('A címzettet az SMTP-szerver nem fogadta el.');
        } finally {transport.close();}
      }
      try {
        const saved = await client.append(sent.path,savedRaw.message,['\\Seen'],new Date());
        if (!saved) throw new Error('Az IMAP APPEND sikertelen.');
        return {sent:true,saved:true,to:message.to,...(resendId ? {resendId} : {})};
      } catch (_) {
        return {sent:true,saved:false,to:message.to,
          warning:'A levél elküldve, de az Elküldött mappába mentés nem sikerült. Ne küldd újra ellenőrzés nélkül.',
          ...(resendId ? {resendId} : {})};
      }
    } finally {await client.logout().catch(() => {});}
  }
  return {list, listConversation, get, attachment, send, assertReady, smtpConfigured, resendConfigured};
}
module.exports = {sentMail};
