'use strict';

const REQUIRED = ['BASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'OWNER_EMAIL', 'SESSION_SECRET'];

function loadConfig(env = process.env) {
  const absent = REQUIRED.filter(name => !env[name]);
  if (absent.length) throw new Error('Hiányzó környezeti változók: ' + absent.join(', '));
  const config = {
    port: Number(env.PORT ?? 3000),
    baseUrl: String(env.BASE_URL).replace(/\/+$/, ''),
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    ownerEmail: String(env.OWNER_EMAIL).toLowerCase(),
    sessionSecret: env.SESSION_SECRET,
    ownerRefreshToken: env.OWNER_REFRESH_TOKEN || '',
    sheetId: env.SHEET_ID || '1BqQ0F4QjWJQfpCB3zSOibKCZ41xk6GzW7V3W6gdNp7I',
    sheetName: env.SHEET_NAME || 'Adatok',
    imapHost: env.IMAP_HOST || 'mail.kockastudio.hu',
    imapPort: Number(env.IMAP_PORT || 993),
    imapUser: env.IMAP_USER || '',
    imapPassword: env.IMAP_PASSWORD || '',
    smtpHost: env.SMTP_HOST || env.IMAP_HOST || 'mail.kockastudio.hu',
    smtpPort: Number(env.SMTP_PORT || 465),
    smtpSecure: String(env.SMTP_SECURE || 'true') !== 'false',
    smtpUser: env.SMTP_USER || env.IMAP_USER || '',
    smtpPassword: env.SMTP_PASSWORD || env.IMAP_PASSWORD || '',
    mailFrom: env.MAIL_FROM || env.SMTP_USER || env.IMAP_USER || '',
    geminiApiKey: env.GEMINI_API_KEY || '',
    geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash'
  };
  if (config.sessionSecret.length < 32) throw new Error('A SESSION_SECRET legalább 32 karakter legyen.');
  return config;
}

module.exports = {loadConfig, REQUIRED};
