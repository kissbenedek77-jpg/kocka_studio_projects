'use strict';
const nodemailer = require('nodemailer');

// MARK: SMTP-küldés a MailApp.sendEmail helyett
function createMailer(config) {
  const configured = Boolean(config.smtpHost && config.smtpUser && config.smtpPassword);
  let transport = null;

  function getTransport() {
    if (!configured) throw new Error('Az SMTP-kapcsolat nincs beállítva (SMTP_HOST, SMTP_USER, SMTP_PASSWORD).');
    transport = transport || nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: {user: config.smtpUser, pass: config.smtpPassword}
    });
    return transport;
  }

  async function send(message) {
    if (!configured) throw new Error('Az SMTP-kapcsolat nincs beállítva (SMTP_HOST, SMTP_USER, SMTP_PASSWORD).');
    const from = String(config.mailFrom || config.smtpUser || '').trim();
    if (!from) throw new Error('A feladó címe nincs beállítva (MAIL_FROM).');
    const to = String(message && message.to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))
      throw new Error('A címzett e-mail-címe hiányzik vagy érvénytelen.');
    const attachments = (message.attachments || []).map(item => ({
      filename: item.filename,
      content: item.content,
      contentType: item.contentType || 'application/octet-stream'
    }));
    const info = await getTransport().sendMail({
      from,
      to,
      subject: String(message.subject || ''),
      text: String(message.body || ''),
      attachments
    });
    return {messageId: info.messageId || '', accepted: info.accepted || [], rejected: info.rejected || []};
  }

  function verify() {
    return getTransport().verify();
  }

  return {configured, send, verify};
}

module.exports = {createMailer};
