'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {loadConfig} = require('./config.cjs');
const {googleClient} = require('./google.cjs');
const {createStore} = require('./store.cjs');
const {createDashboard} = require('./dashboard.cjs');
const {renderForm, handleFormRequest} = require('./form.cjs');
const {createMailer} = require('./mailer.cjs');
const {sentMail} = require('./mail.cjs');

const config = loadConfig();
const loginGoogle = googleClient(config);
const mail = sentMail(config);
const mailer = createMailer(config);
const owner = config.ownerEmail;
const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', 'dashboard_v2.html'), 'utf8');
const formHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const MAX_BODY = 16 * 1024 * 1024;

// MARK: Munkamenet és HTTP segédek
function cookie(request, name) {
  const item = String(request.headers.cookie || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(name + '='));
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
  return session && session.email === owner && session.exp > Date.now() && session.refreshToken ? session : null;
}
function send(response, code, body, headers = {}) {
  response.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff', ...headers});
  response.end(JSON.stringify(body));
}
function sendHtml(response, html) {
  response.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  response.end(html);
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
    if (text.length > MAX_BODY) throw new Error('A kérés túl nagy.');
  }
  return JSON.parse(text || '{}');
}
function originAllowed(request) {
  const origin = request.headers.origin;
  return !origin || origin === config.baseUrl;
}

// MARK: Kéréskiszolgáló
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, config.baseUrl);
  try {
    if (request.method === 'GET' && url.pathname === '/health') return send(response, 200, {ok: true});

    if (request.method === 'GET' && url.pathname === '/auth/login') {
      const state = crypto.randomBytes(24).toString('base64url');
      const location = loginGoogle.oauth.generateAuthUrl({
        access_type: 'offline',
        scope: ['openid', 'email',
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/documents'],
        state, prompt: 'consent'
      });
      return redirect(response, location, [secureCookie('kocka_oauth_state', state, 600)]);
    }
    if (request.method === 'GET' && url.pathname === '/auth/callback') {
      const state = cookie(request, 'kocka_oauth_state');
      if (!state || state !== url.searchParams.get('state'))
        return send(response, 403, {error:'Érvénytelen bejelentkezési állapot.'});
      const {tokens} = await loginGoogle.oauth.getToken(url.searchParams.get('code') || '');
      const ticket = await loginGoogle.oauth.verifyIdToken({idToken: tokens.id_token, audience: config.clientId});
      const email = String(ticket.getPayload().email || '').toLowerCase();
      if (email !== owner || !ticket.getPayload().email_verified)
        return send(response, 403, {error:'Nincs hozzáférés ehhez a dashboardhoz.'});
      if (!tokens.refresh_token)
        return send(response, 400, {error:'A Google nem adott frissítési tokent. Vond vissza az alkalmazás hozzáférését, majd jelentkezz be újra.'});
      return redirect(response, '/dashboard', [
        secureCookie('kocka_session', pack({email, refreshToken: tokens.refresh_token, exp: Date.now() + 12 * 3600 * 1000}), 12 * 3600),
        secureCookie('kocka_oauth_state', '', 0)
      ]);
    }
    if (request.method === 'GET' && url.pathname === '/auth/logout')
      return redirect(response, '/auth/login', [secureCookie('kocka_session', '', 0)]);
    if (request.method === 'GET' && url.pathname === '/') return redirect(response, '/dashboard');

    // MARK: Nyilvános ügyfélűrlap
    if (request.method === 'GET' && url.pathname === '/form') {
      const uid = String(url.searchParams.get('uid') || '').trim();
      if (uid && !/^[A-Za-z0-9-]{4,64}$/.test(uid))
        return send(response, 400, {error:'Érvénytelen projektazonosító.'});
      return sendHtml(response, renderForm(formHtml, uid));
    }
    if (request.method === 'POST' && url.pathname === '/api/form') {
      if (!originAllowed(request) || request.headers['x-kocka-form'] !== '1')
        return send(response, 403, {error:'Érvénytelen kérés.'});
      if (!config.ownerRefreshToken) {
        const error = new Error('Az űrlap mentéséhez OWNER_REFRESH_TOKEN környezeti változó szükséges.');
        error.status = 503;
        throw error;
      }
      const body = await jsonBody(request);
      const google = googleClient(config, config.ownerRefreshToken);
      const store = createStore(config, google);
      return send(response, 200, {result: await handleFormRequest(store, body)});
    }

    // MARK: Tulajdonosi dashboard
    if (request.method === 'GET' && url.pathname === '/dashboard') {
      if (!authenticated(request)) return redirect(response, '/auth/login');
      return sendHtml(response, dashboardHtml.replace('<?= clientFormUrl ?>', '/form'));
    }
    if (request.method === 'POST' && url.pathname === '/api/rpc') {
      const session = authenticated(request);
      if (!session) return send(response, 401, {error:'Jelentkezz be újra.'});
      if (!originAllowed(request) || request.headers['x-kocka-rpc'] !== '1')
        return send(response, 403, {error:'Érvénytelen kérés.'});
      const body = await jsonBody(request);
      if (!Array.isArray(body.args) || body.args.length > 8 || typeof body.name !== 'string')
        return send(response, 400, {error:'Érvénytelen RPC kérés.'});
      const google = googleClient(config, session.refreshToken);
      const store = createStore(config, google);
      const dashboard = createDashboard({google, store, mail, mailer, config});
      return send(response, 200, {result: await dashboard.call(body.name, body.args)});
    }

    return send(response, 404, {error:'Az oldal nem található.'});
  } catch (error) {
    const status = error.status || 400;
    if (status >= 500) process.stderr.write(`Kérés hiba: ${error.stack || error.message}\n`);
    else if (error.message) process.stderr.write(`Kérés elutasítva: ${error.message}\n`);
    return send(response, status, {error: status === 500 ? 'A művelet nem sikerült. Ellenőrizd a szerver naplóját.' : error.message});
  }
});

if (require.main === module) {
  server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => {
    process.stdout.write(`Kocka dashboard listening on ${server.address().port}\n`);
  });
}

module.exports = {server, authenticated, pack, unpack};
