'use strict';
const {ImapFlow} = require('imapflow');
const {simpleParser} = require('mailparser');

function sentMail(config) {
  const configured = Boolean(config.imapUser && config.imapPassword);
  async function withMailbox(callback) {
    const client = new ImapFlow({
      host: config.imapHost, port: config.imapPort, secure: true,
      auth: {user: config.imapUser, pass: config.imapPassword}, logger: false
    });
    await client.connect();
    try {
      const boxes = await client.list();
      const sent = boxes.find(box => box.specialUse === '\\Sent') || boxes.find(box => /^(sent|sent items|elküldött|elküldött elemek)$/i.test(box.name));
      if (!sent) throw new Error('Az IMAP-fiókban nincs elküldött levelek mappa.');
      const lock = await client.getMailboxLock(sent.path);
      try {return await callback(client, sent.path);} finally {lock.release();}
    } finally {await client.logout().catch(() => {});}
  }
  async function list(recipient) {
    if (!configured) return {configured: false, messages: []};
    return withMailbox(async client => {
      const ids = await client.search({to: recipient}) || [];
      const selected = ids.slice(-100).reverse();
      const messages = [];
      if (!selected.length) return {configured: true, messages};
      for await (const item of client.fetch(selected, {uid: true, envelope: true, internalDate: true})) {
        const recipients = [...item.envelope?.to || [], ...item.envelope?.cc || [], ...item.envelope?.bcc || []];
        if (!recipients.some(address => String(address.address || '').toLowerCase() === recipient.toLowerCase())) continue;
        messages.push({id: `${client.mailbox.uidValidity}:${item.uid}`, date: (item.internalDate || item.envelope?.date || '').toString(), subject: item.envelope?.subject || '(tárgy nélkül)'});
      }
      messages.sort((a, b) => new Date(b.date) - new Date(a.date));
      return {configured: true, messages};
    });
  }
  async function get(recipient, id) {
    if (!configured) throw new Error('Az IMAP-kapcsolat nincs beállítva.');
    const match = String(id).match(/^(\d{1,20}):(\d{1,20})$/);
    if (!match) throw new Error('Érvénytelen levélazonosító.');
    return withMailbox(async client => {
      if (String(client.mailbox.uidValidity) !== match[1]) throw new Error('A levélazonosító már nem érvényes.');
      const uid = Number(match[2]);
      if (!Number.isSafeInteger(uid) || uid < 1) throw new Error('Érvénytelen levélazonosító.');
      const message = await client.fetchOne(uid, {source: true, envelope: true, internalDate: true}, {uid: true});
      if (!message) throw new Error('A levél nem található.');
      const recipients = [...message.envelope.to || [], ...message.envelope.cc || [], ...message.envelope.bcc || []];
      if (!recipients.some(item => String(item.address).toLowerCase() === recipient.toLowerCase()))
        throw new Error('Ez a levél nem a kiválasztott címzetthez tartozik.');
      const parsed = await simpleParser(message.source, {skipHtmlToText: false});
      return {id, date: (message.internalDate || '').toString(), subject: parsed.subject || '',
        to: parsed.to?.text || '', text: String(parsed.text || '').slice(0, 100000)};
    });
  }
  return {list, get};
}
module.exports = {sentMail};
