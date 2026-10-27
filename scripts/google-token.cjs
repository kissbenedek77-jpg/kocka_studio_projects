'use strict';
const http = require('node:http');
const {google} = require('googleapis');

// MARK: Egyszeri OAuth-segéd a nyilvános űrlaphoz szükséges OWNER_REFRESH_TOKEN előállításához
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Add meg a GOOGLE_CLIENT_ID és GOOGLE_CLIENT_SECRET környezeti változót.');
  process.exit(1);
}
const port = Number(process.env.OAUTH_SETUP_PORT || 53682);
const redirectUri = process.env.OAUTH_REDIRECT_URI || `http://127.0.0.1:${port}/oauth2callback`;
const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
const url = oauth.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: [
    'openid', 'email',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents'
  ]
});
console.log('1. Add hozzá ezt az átirányítási URI-t a Google Cloud OAuth klienshez:');
console.log('   ' + redirectUri);
console.log('2. Nyisd meg ezt a címet a tulajdonosi Google-fiókkal:');
console.log('   ' + url);
console.log('3. A jóváhagyás után a frissítési token itt jelenik meg.');

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, redirectUri);
  if (requestUrl.pathname !== '/oauth2callback') {
    response.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
    return response.end('Nem található.');
  }
  try {
    const {tokens} = await oauth.getToken(requestUrl.searchParams.get('code') || '');
    if (!tokens.refresh_token) {
      response.writeHead(400, {'Content-Type': 'text/plain; charset=utf-8'});
      response.end('A Google nem adott frissítési tokent. Vond vissza az alkalmazás hozzáférését, majd próbáld újra.');
      return;
    }
    response.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8'});
    response.end('A token kiírása a terminálban történt. Az ablak bezárható.');
    console.log('\nOWNER_REFRESH_TOKEN=' + tokens.refresh_token);
  } catch (error) {
    response.writeHead(500, {'Content-Type': 'text/plain; charset=utf-8'});
    response.end('Hiba a token cseréjekor: ' + error.message);
    console.error(error.message);
  } finally {
    server.close();
  }
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Várakozás a Google visszairányítására a ${port} porton...`);
});
