'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {googleClient} = require('./google.cjs');
const {sentMail} = require('./mail.cjs');

// MARK: Railway környezeti változók és tulajdonosi hozzáférés
const required = ['BASE_URL','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','OWNER_EMAIL','SESSION_SECRET'];
const absent = required.filter(name => !process.env[name]);
if (absent.length) throw new Error('Hiányzó környezeti változók: ' + absent.join(', '));
const config = {
  baseUrl: process.env.BASE_URL.replace(/\/$/, ''),
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  ownerEmail: process.env.OWNER_EMAIL.toLowerCase(),
  sessionSecret: process.env.SESSION_SECRET,
  sheetId: process.env.SHEET_ID || '1BqQ0F4QjWJQfpCB3zSOibKCZ41xk6GzW7V3W6gdNp7I',
  sheetName: process.env.SHEET_NAME || 'Adatok',
  legacyFormUrl: process.env.LEGACY_FORM_URL || 'https://script.google.com/macros/s/AKfycbwmN9Kz3fUH5iH_0wD7vUa9qpaPTUvAPUtCEHCgLkzZSgcYAjUGsFo-NhliKIppxlfLNA/exec',
  imapHost: process.env.IMAP_HOST || 'mail.kockastudio.hu',
  imapPort: Number(process.env.IMAP_PORT || 993),
  imapUser: process.env.IMAP_USER || '',
  imapPassword: process.env.IMAP_PASSWORD || ''
};
if (config.sessionSecret.length < 32) throw new Error('A SESSION_SECRET legalább 32 karakter legyen.');
const loginGoogle = googleClient(config);
const mail = sentMail(config);
const owner = config.ownerEmail;
const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', 'dashboard_v2.html'), 'utf8');

function cookie(request, name) {
  const item = String(request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(name + '='));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}
function pack(payload) {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash('sha256').update(config.sessionSecret).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}
function unpack(token) {
  try {
    const bytes = Buffer.from(String(token), 'base64url');
    const key = crypto.createHash('sha256').update(config.sessionSecret).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
  } catch (_) {return null;}
}
function authenticated(request) {
  const session = unpack(cookie(request, 'kocka_session'));
  return session?.email === owner && session.exp > Date.now() && session.refreshToken ? session : null;
}
function send(response, code, body, headers = {}) {
  response.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});
  response.end(JSON.stringify(body));
}
function redirect(response, target, cookies = []) {
  response.writeHead(302, {Location: target, 'Set-Cookie': cookies, 'Cache-Control':'no-store'});
  response.end();
}
function secureCookie(name, value, age) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
}
async function jsonBody(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 1024 * 1024) throw new Error('A kérés túl nagy.');
  }
  return JSON.parse(text || '{}');
}
function validRecipient(value) {return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));}

// MARK: A meglévő dashboard RPC felület olvasási műveleteinek Node.js megfelelői
async function rpc(name, args, session) {
  const google = googleClient(config, session.refreshToken);
  const uid = args[0];
  if (name === 'dashboardListProjects') return google.listProjects();
  if (name === 'getDashboardProject') return google.dashboardProject(uid);
  if (name === 'dashboardListFolder') return google.folderFor(uid, args[1]);
  if (name === 'dashboardListSentMail' || name === 'dashboardGetSentMail') {
    const {data} = await google.project(uid);
    const recipient = String(data.email || '').trim().toLowerCase();
    if (!validRecipient(recipient)) {
      if (name === 'dashboardListSentMail') return {configured: true, missingRecipient: true, messages: []};
      throw new Error('A projekthez nincs érvényes e-mail-cím.');
    }
    return name === 'dashboardListSentMail' ? mail.list(recipient) : mail.get(recipient, args[1]);
  }
  const error = new Error('Ez a művelet még a meglévő Apps Script dashboardon érhető el.');
  error.status = 501;
  throw error;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, config.baseUrl);
  try {
    if (request.method === 'GET' && url.pathname === '/health') return send(response, 200, {ok: true});
    if (request.method === 'GET' && url.pathname === '/auth/login') {
      const state = crypto.randomBytes(24).toString('base64url');
      const location = loginGoogle.oauth.generateAuthUrl({access_type:'offline', scope:['openid','email',
        'https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/drive'], state, prompt:'consent'});
      return redirect(response, location, [secureCookie('kocka_oauth_state', state, 600)]);
    }
    if (request.method === 'GET' && url.pathname === '/auth/callback') {
      const state = cookie(request, 'kocka_oauth_state');
      if (!state || state !== url.searchParams.get('state')) return send(response, 403, {error:'Érvénytelen bejelentkezési állapot.'});
      const {tokens} = await loginGoogle.oauth.getToken(url.searchParams.get('code') || '');
      const ticket = await loginGoogle.oauth.verifyIdToken({idToken: tokens.id_token, audience: config.clientId});
      const email = String(ticket.getPayload().email || '').toLowerCase();
      if (email !== owner || !ticket.getPayload().email_verified) return send(response, 403, {error:'Nincs hozzáférés ehhez a dashboardhoz.'});
      if (!tokens.refresh_token) return send(response, 400, {error:'A Google nem adott frissítési tokent. Vond vissza az alkalmazás hozzáférését, majd jelentkezz be újra.'});
      return redirect(response, '/dashboard', [secureCookie('kocka_session', pack({email, refreshToken:tokens.refresh_token, exp:Date.now() + 12*3600*1000}), 12*3600), secureCookie('kocka_oauth_state', '', 0)]);
    }
    if (request.method === 'GET' && url.pathname === '/auth/logout')
      return redirect(response, '/auth/login', [secureCookie('kocka_session', '', 0)]);
    if (request.method === 'GET' && url.pathname === '/') return redirect(response, '/dashboard');
    if (request.method === 'GET' && url.pathname === '/form') {
      const uid = url.searchParams.get('uid');
      return redirect(response, config.legacyFormUrl + (uid ? '?uid=' + encodeURIComponent(uid) : ''));
    }
    if (request.method === 'GET' && url.pathname === '/dashboard') {
      if (!authenticated(request)) return redirect(response, '/auth/login');
      response.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      const preview = '<div class="notice">Node.js előnézet: a projektlista, a mappák és az elküldött levelek olvashatók. Az adatbevitel, dokumentumok és életciklus-műveletek még a jelenlegi Apps Script felületen működnek.</div>';
      return response.end(dashboardHtml.replace('<?= clientFormUrl ?>', '/form').replace('<main class="shell">', '<main class="shell">' + preview));
    }
    if (request.method === 'POST' && url.pathname === '/api/rpc') {
      if (!authenticated(request)) return send(response, 401, {error:'Jelentkezz be újra.'});
      if (request.headers.origin !== config.baseUrl || request.headers['x-kocka-rpc'] !== '1')
        return send(response, 403, {error:'Érvénytelen kérés.'});
      const body = await jsonBody(request);
      if (!Array.isArray(body.args) || body.args.length > 5 || typeof body.name !== 'string')
        return send(response, 400, {error:'Érvénytelen RPC kérés.'});
      return send(response, 200, {result: await rpc(body.name, body.args, authenticated(request))});
    }
    return send(response, 404, {error:'Az oldal nem található.'});
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) process.stderr.write(`Kérés hiba: ${error.message}\n`);
    return send(response, status, {error: status === 500 ? 'A művelet nem sikerült. Ellenőrizd a szerver naplóját.' : error.message});
  }
});
server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => {
  process.stdout.write(`Kocka dashboard listening on ${server.address().port}\n`);
});
