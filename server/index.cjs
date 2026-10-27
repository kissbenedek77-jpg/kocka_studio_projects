'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const {google} = require('googleapis');
const {googleClient} = require('./google.cjs');
const {sentMail} = require('./mail.cjs');
const {previewSummary,applyEmailEdits} = require('./email_draft.cjs');
const {verifyResendWebhook,openEvent,emailTrackingStore} = require('./email_tracking.cjs');
const {createDownloadToken,readDownloadToken,downloadPage,zipDocuments} = require('./email_download.cjs');
const {PIXEL,createPixelToken,readPixelToken} = require('./email_pixel.cjs');
const {createTrackingCredential,readTrackingCredential} = require('./tracking_credential.cjs');
const {googleQuota} = require('./quota.cjs');
const {convertPdfA,standardizePdf} = require('./pdf_quality.cjs');
const {hashPassword,validHash,verifyPassword,normalizeUsername} = require('./local_auth.cjs');
const {validateInquiry,inquiryPhotos,inquiryText} = require('./inquiry.cjs');
const {validateCreativeInput,generateCreativePlan} = require('./marketing_ai.cjs');
const {validateStrategyInput,generateStrategy} = require('./marketing_strategy.cjs');
const {modelStatus,validateImageInput,generateMarketingImage} = require('./marketing_image.cjs');
const {marketingStore} = require('./marketing_store.cjs');
const {discoverTopics,validateTopic,due,nextRun,pickTopic,generatePostText,postSvg,POST_STYLES} = require('./marketing_posts.cjs');
const {facebookStatus,publishFacebookPhoto,deleteFacebookPhoto} = require('./marketing_facebook.cjs');
const {instagramStatus,publishInstagramImage,deleteInstagramMedia} = require('./marketing_instagram.cjs');
const {SIGNATURE_HTML,DOWNLOAD_BUTTON_HTML,DOWNLOAD_LINK_HTML,
  sanitizeEmailSource,renderEmailHtml} = require('./email_templates.cjs');

// MARK: Railway környezeti változók és tulajdonosi hozzáférés
const required = ['BASE_URL','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','OWNER_EMAIL','SESSION_SECRET'];
const absent = required.filter(name => !process.env[name]);
if (absent.length) throw new Error('Hiányzó környezeti változók: ' + absent.join(', '));
const config = {
  baseUrl: process.env.BASE_URL.replace(/\/$/, ''),
  legacyPublicOrigin: process.env.LEGACY_PUBLIC_ORIGIN || '',
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  ownerEmail: process.env.OWNER_EMAIL.toLowerCase(),
  sessionSecret: process.env.SESSION_SECRET,
  localUsername: process.env.LOCAL_LOGIN_USERNAME
    ? normalizeUsername(process.env.LOCAL_LOGIN_USERNAME) : process.env.OWNER_EMAIL.toLowerCase(),
  localPasswordHash: process.env.LOCAL_LOGIN_PASSWORD_HASH || '',
  sheetId: process.env.SHEET_ID || '1BqQ0F4QjWJQfpCB3zSOibKCZ41xk6GzW7V3W6gdNp7I',
  sheetName: process.env.SHEET_NAME || 'Adatok',
  templateRootFolderId: process.env.TEMPLATE_ROOT_FOLDER_ID || '1yw8ts2OTQTK0y2dn8TnovvR5HbWSqHWd',
  marketingFolderId: process.env.MARKETING_FOLDER_ID || '',
  systemFolderId: process.env.SYSTEM_FOLDER_ID || '1zmwwzmeZybDfT5xIsVgEpfp6LIHzRv0r',
  projectDataTemplateId: process.env.PROJECT_DATA_TEMPLATE_ID || '1NZPw7bJAQFfQbTNl3yzObRly1bjyt2hRfQ0QHhCN4Dg',
  imapHost: process.env.IMAP_HOST || 'mail.kockastudio.hu',
  imapPort: Number(process.env.IMAP_PORT || 993),
  imapSentFolder: process.env.IMAP_SENT_FOLDER || '',
  imapUser: process.env.IMAP_USER || '',
  imapPassword: process.env.IMAP_PASSWORD || '',
  smtpHost: process.env.SMTP_HOST || process.env.IMAP_HOST || 'mail.kockastudio.hu',
  smtpPort: Number(process.env.SMTP_PORT || 465),
  smtpUser: process.env.SMTP_USER || process.env.IMAP_USER || '',
  smtpPassword: process.env.SMTP_PASSWORD || process.env.IMAP_PASSWORD || '',
  resendApiKey: process.env.RESEND_API_KEY || '',
  resendFrom: process.env.RESEND_FROM_EMAIL || '',
  resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET || '',
  emailProvider: process.env.EMAIL_PROVIDER || '',
  clientSubmissionEmail: process.env.CLIENT_SUBMISSION_EMAIL === '1',
};
if (config.sessionSecret.length < 32) throw new Error('A SESSION_SECRET legalább 32 karakter legyen.');
if (config.localPasswordHash && !validHash(config.localPasswordHash))
  throw new Error('A LOCAL_LOGIN_PASSWORD_HASH formátuma érvénytelen.');
const loginGoogle = googleClient(config);
const mail = sentMail(config);
const owner = config.ownerEmail;
const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', 'dashboard_v2.html'), 'utf8');
const formHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const technicalHtml = fs.readFileSync(path.join(__dirname, '..', 'technical.html'), 'utf8');
const loginHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'login.html'), 'utf8');
const inquiryHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'inquiry.html'), 'utf8');
const marketingHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'marketing.html'), 'utf8');
const serviceWorkerJs=fs.readFileSync(path.join(__dirname,'..','public','service-worker.js'));
const marketingAiUsage = new Map();
const marketingStrategyUsage = new Map();
const marketingImageUsage = new Map();
const marketingPostUsage = new Map();
let marketingPostInFlight=0;
const publishingPostIds=new Set();
let marketingImageInFlight=0;
let marketingAiInFlight = 0;
let marketingStrategyInFlight = 0;
const downloadClientJs=fs.readFileSync(path.join(__dirname,'download_client.js'),'utf8');
const frontendAssets = new Map([
  ['/assets/bootstrap.min.css', ['text/css; charset=utf-8',path.join(__dirname,'..','node_modules','bootstrap','dist','css','bootstrap.min.css')]],
  ['/assets/bootstrap.bundle.min.js', ['application/javascript; charset=utf-8',path.join(__dirname,'..','node_modules','bootstrap','dist','js','bootstrap.bundle.min.js')]],
  ['/assets/fontawesome/css/all.min.css', ['text/css; charset=utf-8',path.join(__dirname,'..','node_modules','@fortawesome','fontawesome-free','css','all.min.css')]],
  ['/assets/ks-design.css', ['text/css; charset=utf-8',path.join(__dirname,'..','public','ks-design.css')]],
  ['/assets/ks-shell.js', ['application/javascript; charset=utf-8',path.join(__dirname,'..','public','ks-shell.js')]],
  ['/assets/marketing-auto.js', ['application/javascript; charset=utf-8',path.join(__dirname,'..','public','marketing-auto.js')]],
  ['/assets/pwa-register.js', ['application/javascript; charset=utf-8',path.join(__dirname,'..','public','pwa-register.js')]],
  ['/manifest.webmanifest', ['application/manifest+json; charset=utf-8',path.join(__dirname,'..','public','manifest.webmanifest')]],
  ['/assets/kocka-icon-180.png', ['image/png',path.join(__dirname,'..','public','kocka-icon-180.png')]],
  ['/assets/kocka-icon-192.png', ['image/png',path.join(__dirname,'..','public','kocka-icon-192.png')]],
  ['/assets/kocka-icon-512.png', ['image/png',path.join(__dirname,'..','public','kocka-icon-512.png')]],
  ['/assets/kocka-icon.svg', ['image/svg+xml; charset=utf-8',path.join(__dirname,'..','public','kocka-icon.svg')]],
  ['/assets/brand/logo2.png', ['image/png',path.join(__dirname,'..','public','brand-assets','logo2.png')]],
  ['/assets/brand/slide_bg.jpg', ['image/jpeg',path.join(__dirname,'..','public','brand-assets','slide_bg.jpg')]],
  ['/assets/brand/slide4_bg.jpg', ['image/jpeg',path.join(__dirname,'..','public','brand-assets','slide4_bg.jpg')]],
]);
const fontAwesomeFonts=path.join(__dirname,'..','node_modules','@fortawesome','fontawesome-free','webfonts');
for(const name of fs.readdirSync(fontAwesomeFonts))if(name.endsWith('.woff2'))
  frontendAssets.set('/assets/fontawesome/webfonts/'+name,['font/woff2',path.join(fontAwesomeFonts,name)]);
for (const subset of ['latin','latin-ext'])
  for (const weight of [300,400,600,700])
    for (const style of ['normal','italic']) {
      const name=`source-sans-pro-${subset}-${weight}-${style}.woff2`;
      frontendAssets.set('/assets/fonts/'+name,['font/woff2',path.join(__dirname,'..','node_modules','@fontsource','source-sans-pro','files',name)]);
    }
for (const [url,[type,file]] of frontendAssets)
  frontendAssets.set(url,{type,content:fs.readFileSync(file)});
function nodePage(html,page) {
  if(page==='inquiry')return html
    .replace('<style>','<link rel="stylesheet" href="/assets/bootstrap.min.css">\n  <link rel="stylesheet" href="/assets/fontawesome/css/all.min.css">\n  <link rel="stylesheet" href="/assets/ks-design.css">\n  <style>')
    .replace('<body>','<body class="ks-app ks-page-inquiry" data-runtime="node" data-ks-page="inquiry">');
  let result=html.replace('<style>','<link rel="stylesheet" href="/assets/bootstrap.min.css">\n  <link rel="stylesheet" href="/assets/fontawesome/css/all.min.css">\n  <style>')
    .replace('</style>','</style>\n  <link rel="stylesheet" href="/assets/ks-design.css">')
    .replace('<body>','<body class="ks-app ks-page-'+page+'" data-runtime="node" data-ks-page="'+page+'">')
    .replace('</body>','<script src="/assets/bootstrap.bundle.min.js"></script>\n<script src="/assets/ks-shell.js"></script>\n</body>');
  if(['login','dashboard','marketing','technical'].includes(page))result=result
    .replace('</head>','<link rel="manifest" href="/manifest.webmanifest?v=3">\n'
      +'<link rel="icon" href="/assets/kocka-icon.svg?v=4" type="image/svg+xml">\n'
      +'<link rel="apple-touch-icon" href="/assets/kocka-icon-180.png?v=3">\n'
      +'<meta name="theme-color" content="#3e3e3e">\n'
      +'<meta name="apple-mobile-web-app-capable" content="yes">\n'
      +'<meta name="apple-mobile-web-app-status-bar-style" content="default">\n'
      +'<meta name="apple-mobile-web-app-title" content="Kocka Projektek">\n</head>')
    .replace('</body>','<script src="/assets/pwa-register.js"></script>\n</body>');
  return result;
}
let publicFormAuth = null;
if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    if (!credentials?.client_email || !credentials?.private_key)
      throw new Error('hiányzó client_email vagy private_key');
    publicFormAuth = new google.auth.JWT({email:credentials.client_email,key:credentials.private_key,
      scopes:['https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive']});
  } catch (_) {
    process.stderr.write('A GOOGLE_SERVICE_ACCOUNT_JSON érvénytelen; a szerver kulcs nélküli OAuth-beállítással indul. Töröld ezt a Railway-változót.\n');
  }
}
let trackingAuth=publicFormAuth;
if(!trackingAuth&&process.env.GOOGLE_TRACKING_CREDENTIAL){
  const token=readTrackingCredential(config.sessionSecret,
    process.env.GOOGLE_TRACKING_CREDENTIAL,config.ownerEmail);
  trackingAuth=new google.auth.OAuth2(config.clientId,config.clientSecret,
    config.baseUrl+'/auth/callback');
  trackingAuth.setCredentials({refresh_token:token});
}
const localLoginReady=Boolean(config.localPasswordHash && trackingAuth?.credentials?.refresh_token);
const localPasswordVersion=crypto.createHash('sha256')
  .update(config.localUsername+'\0'+config.localPasswordHash).digest('base64url');
const guestRequests = new Map();
const failedLogins = new Map();
const inquiryAttempts = new Map();
const emailTracking = emailTrackingStore(config, trackingAuth);
const recentPixels = new Map();
function limitGuest(request) {
  const ip = String(request.headers['x-real-ip'] || request.socket.remoteAddress || 'unknown');
  const now = Date.now();
  if (guestRequests.size > 1000) {
    for (const [key, times] of guestRequests)
      if (!times.some(at => now - at < 60000)) guestRequests.delete(key);
    if (guestRequests.size > 2000) guestRequests.clear();
  }
  const recent = (guestRequests.get(ip) || []).filter(at => now - at < 60000);
  if (recent.length >= 20) {
    const error = new Error('Túl sok kérés. Próbáld újra egy perc múlva.');
    error.status = 429;
    throw error;
  }
  recent.push(now);
  guestRequests.set(ip,recent);
}

function limitInquiry(request) {
  const ip=String(request.headers['x-real-ip']||request.socket.remoteAddress||'unknown');
  const now=Date.now();
  for(const [key,times] of inquiryAttempts){
    const recent=times.filter(at=>now-at<3600000);
    if(recent.length)inquiryAttempts.set(key,recent);else inquiryAttempts.delete(key);
  }
  const recent=inquiryAttempts.get(ip)||[];
  if(recent.length>=5)throw Object.assign(new Error('Túl sok ajánlatkérés. Próbáld újra később.'),{status:429});
  inquiryAttempts.set(ip,[...recent,now]);
}

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
function marketingInstagramImageUrl(campaignId,fileId) {
  return config.baseUrl+'/media/marketing/'+pack({kind:'instagram-image',campaignId,fileId,
    exp:Date.now()+60*60*1000});
}
function authenticated(request) {
  const session = unpack(cookie(request, 'kocka_session'));
  if (session?.email !== owner || session.exp <= Date.now()) return null;
  if (session.local && localLoginReady && session.username === config.localUsername &&
      session.passwordVersion === localPasswordVersion)
    return {...session,refreshToken:trackingAuth.credentials.refresh_token};
  return session.refreshToken ? session : null;
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
function loginLocation(destination,expired=false) {
  return '/auth/login?return='+encodeURIComponent(destination)+(expired?'&reason=expired':'');
}
function expiredCookie(request) {
  return cookie(request,'kocka_session') ? [secureCookie('kocka_session','',0)] : [];
}
function loginReturn(value) {
  const input=String(value || '');
  if (!input.startsWith('/') || input.startsWith('//') || input.includes('\\')) return '/dashboard';
  try {
    const url=new URL(input,config.baseUrl);
    return url.origin===config.baseUrl && ['/dashboard','/technical','/marketing'].includes(url.pathname)
      ? url.pathname+url.search : '/dashboard';
  } catch (_) {return '/dashboard';}
}
function escapeHtml(value) {
  return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function loginPage(destination,error='') {
  const form=localLoginReady ? '<form method="post" action="/auth/local">'
    +'<input type="hidden" name="return" value="'+escapeHtml(destination)+'">'
    +'<label for="username">Felhasználónév</label><input id="username" name="username" type="text" autocomplete="username" maxlength="128" required autofocus>'
    +'<label for="password">Jelszó</label><input id="password" name="password" type="password" autocomplete="current-password" required>'
    +'<button class="button" type="submit">Belépés</button></form>' :
    '<p>A saját belépés beállításához lépj be egyszer Google-fiókkal, majd a dashboard fejlécében válaszd a Saját belépés gombot. Az ott kapott értékeket a Railway Variables között kell beállítani.</p>';
  return nodePage(loginHtml.replace('{{ERROR}}',error?'<div class="notice error" role="alert">'+escapeHtml(error)+'</div>':'')
    .replace('{{LOCAL_FORM}}',form)
    .replace('{{GOOGLE_URL}}','/auth/google?return='+encodeURIComponent(destination)),'login');
}
function loginAttemptAllowed(request) {
  const ip=String(request.headers['x-real-ip'] || request.socket.remoteAddress || 'unknown');
  const now=Date.now();
  for (const [key,attempts] of failedLogins) {
    const current=attempts.filter(at=>now-at<15*60*1000);
    if (current.length) failedLogins.set(key,current); else failedLogins.delete(key);
  }
  const attempts=failedLogins.get(ip)||[];
  return {ip,allowed:attempts.length<5};
}
async function jsonBody(request, maxBytes = 1024 * 1024) {
  const raw = await rawBody(request,maxBytes);
  return JSON.parse(raw.length ? raw.toString('utf8') : '{}');
}
async function rawBody(request, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {const error = new Error('A kérés túl nagy.'); error.status = 413; throw error;}
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,size);
}
function validRecipient(value) {return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));}

// MARK: A meglévő dashboard RPC felület olvasási műveleteinek Node.js megfelelői
async function rpc(name, args, session) {
  const google = googleClient(config, session.refreshToken);
  const uid = args[0];
  if (name === 'dashboardLocalLoginStatus') return {
    username:config.localUsername,
    usernameConfigured:Boolean(process.env.LOCAL_LOGIN_USERNAME),
    passwordConfigured:Boolean(config.localPasswordHash),
    googleCredentialConfigured:Boolean(trackingAuth?.credentials?.refresh_token),
    ready:localLoginReady
  };
  if (name === 'dashboardPrepareLocalLogin') {
    if (!uid || typeof uid !== 'object' || Array.isArray(uid))
      throw Object.assign(new Error('Add meg a felhasználónevet és a jelszót.'),{status:400});
    let username;
    try {username=normalizeUsername(uid.username);}
    catch (error) {throw Object.assign(error,{status:400});}
    if (typeof uid.password !== 'string' || uid.password.length < 16 || uid.password.length > 1024)
      throw Object.assign(new Error('A jelszó 16–1024 karakter hosszú legyen.'),{status:400});
    const passwordHash=hashPassword(uid.password);
    return {username,passwordHash,googleCredential:createTrackingCredential(
      config.sessionSecret,session.email,session.refreshToken)};
  }
  function emailDownloadUrl(message,kind,preview = false,trackingId = '') {
    if (!message.downloads?.length) return '';
    const token = createDownloadToken(config.sessionSecret,{
      uid:String(uid).toUpperCase(),kind,to:message.to,subject:message.subject,preview,trackingId,
      refreshToken:session.refreshToken,files:message.downloads
    });
    return config.baseUrl+'/download/'+token;
  }
  if (name === 'dashboardListProjects') return google.listProjects();
  if (name === 'dashboardListClientSubmissions') return google.listClientSubmissions();
  if (name === 'dashboardMarkClientSubmissionRead') return google.markClientSubmissionRead(uid);
  if (name === 'getDashboardProject') return google.dashboardProject(uid);
  if (name === 'dashboardListFolder') return google.folderFor(uid, args[1]);
  if (name === 'dashboardSaveMemo') return google.saveMemo(uid, args[1]);
  if (name === 'dashboardSaveExpectedFiles') return google.saveExpectedFiles(uid, args[1]);
  if (name === 'dashboardExpectedPdfaFiles') return google.pdfaExpectedFiles(uid);
  if (name === 'dashboardAuditPdf') return google.auditProjectPdfs(uid);
  if (name === 'dashboardAnswerCheck') return google.answerCheck(uid, args[1], args[2]);
  if (name === 'dashboardSaveOffer') return google.saveOffer(uid, args[1]);
  if (name === 'dashboardGetTechnicalFields') return google.getTechnicalFields(uid);
  if (name === 'dashboardSaveTechnicalFields') return google.saveTechnicalFields(uid,args[1]);
  if (name === 'dashboardDraftTechnicalText') return google.draftTechnicalText(uid,args[1]);
  if (name === 'dashboardGenerateTechnical') return google.generateTechnicalDocument(uid);
  if (name === 'dashboardSetStartDate') return google.setStartDate(uid, args[1]);
  if (name === 'dashboardUploadAudio') return google.uploadAudio(uid, args[1], args[2], args[3]);
  if (name === 'dashboardSummarizeAudio') return google.summarizeAudio(uid, args[1]);
  if (name === 'dashboardPerform' && args[1] === 'sync') return google.syncProject(uid);
  if (name === 'dashboardPerform' && args[1] === 'start')
    return google.startProject(uid,args[2],args[3]);
  if (name === 'dashboardPerform' && args[1] === 'close')
    return google.closeProject(uid,args[2]);
  if (name === 'dashboardPerform' && args[1] === 'archive')
    return google.archiveProject(uid,args[2]);
  if (name === 'dashboardPerform' && args[1] === 'technical:generate')
    return google.generateTechnicalDocument(uid);
  if (name === 'dashboardDeleteProject')
    return google.deleteProject(uid,args[1]);
  if (name === 'dashboardEmailPreview') {
    const message = await google.prepareEmail(uid,args[1],{preview:true});
    return {...previewSummary(message,emailDownloadUrl(message,args[1],true)),
      inserts:{signature:SIGNATURE_HTML,button:DOWNLOAD_BUTTON_HTML,link:DOWNLOAD_LINK_HTML}};
  }
  if (name === 'dashboardRenderEmailHtml') {
    const source=args[1],downloadUrl=String(args[2]||'');
    if (downloadUrl) {
      const prefix=config.baseUrl+'/download/';
      if (!downloadUrl.startsWith(prefix)) throw new Error('Érvénytelen előnézeti hivatkozás.');
      const grant=readDownloadToken(config.sessionSecret,downloadUrl.slice(prefix.length));
      if (!grant.preview || grant.uid!==String(uid).toUpperCase())
        throw new Error('Érvénytelen előnézeti hivatkozás.');
    }
    const htmlSource=sanitizeEmailSource(source);
    return {htmlSource,html:renderEmailHtml(htmlSource,downloadUrl)};
  }
  if (name === 'dashboardSendEmail') {
    if (args[3] !== `email:${args[1]}:${String(uid || '').toUpperCase()}`)
      throw new Error('A levél küldésének jóváhagyása hiányzik.');
    mail.assertReady();
    const message = applyEmailEdits(await google.prepareEmail(uid,args[1]),args[2]);
    const trackingId=crypto.randomUUID();
    message.trackingId=trackingId;
    message.downloadUrl = emailDownloadUrl(message,args[1],false,trackingId);
    if (trackingAuth) message.pixelUrl=config.baseUrl+'/pixel/'+createPixelToken(config.sessionSecret,{
      uid:String(uid).toUpperCase(),id:trackingId,to:message.to,subject:message.subject,kind:args[1]});
    const result=await mail.send(message,{uid:String(uid).toUpperCase(),kind:args[1]});
    if (trackingAuth) {
      try {await emailTracking.recordSent({id:trackingId,uid:String(uid).toUpperCase(),
        to:message.to,subject:message.subject,at:new Date().toISOString(),kind:args[1],resendId:result.resendId});}
      catch (error) {result.warning=(result.warning ? result.warning+' ' : '')+
        'A levélnapló mentése sikertelen; a levél elküldését ne ismételd ellenőrzés nélkül.';
        process.stderr.write(`Levélnapló hiba: ${error.message}\n`);}
    }
    return result;
  }
  if (name === 'dashboardEmailOpens') {
    if (!/^[A-Z0-9-]{4,64}$/.test(String(uid || ''))) throw new Error('Érvénytelen projektazonosító.');
    if (!trackingAuth) return {configured:false,messages:[],downloads:[],sent:[]};
    return emailTracking.list(uid);
  }
  if (name === 'dashboardTrackingCredential')
    return {variable:'GOOGLE_TRACKING_CREDENTIAL',value:createTrackingCredential(
      config.sessionSecret,session.email,session.refreshToken),configured:Boolean(trackingAuth)};
  if (name === 'dashboardRestartProject')
    return google.restartProject(uid,args[1],args[2]);
  if (name === 'dashboardPerform' && args[1] === 'folder') {
    const folder = await google.ensureProjectFolder(uid);
    return {message:'A projektmappa készen áll.',url:folder.url,project:await google.dashboardProject(uid)};
  }
  if (name === 'dashboardPerform' && args[1] === 'dataSheet') {
    const sheet = await google.ensureProjectDataSheet(uid);
    return {message:'A tervezési adatlap készen áll.',url:sheet.url,project:await google.dashboardProject(uid)};
  }
  if (name === 'dashboardPerform' && typeof args[1] === 'string' && args[1].startsWith('document:')) {
    const type = args[1].slice('document:'.length);
    if (type === 'muszakiLeiras') {
      const state = await google.dashboardProject(uid);
      if (state.stage === 'closed')
        throw new Error('Lezárt projekt műszaki leírása nem módosítható.');
      if (!state.folderUrl)
        throw new Error('A műszaki leírás elkészítése előtt hozd létre a projektmappát.');
      // A hiányzó adatok a tervezetben [KIEGÉSZÍTENDŐ: ...] jelölést kapnak, ezért
      // a blokkoló ellenőrzések a piszkozat elkészítését nem akadályozzák.
    }
    const document = await google.ensureDocument(uid,type);
    const notes = Array.isArray(document.warnings) ? document.warnings.filter(Boolean) : [];
    return {message:(document.created ? 'A dokumentum létrejött.' : 'A dokumentum frissítve.')+
      (notes.length ? ' Figyelem: '+notes.join(' ') : ''),
      url:document.url,warnings:notes,project:await google.dashboardProject(uid)};
  }
  if (name === 'dashboardPerform' && typeof args[1] === 'string' && args[1].startsWith('szakasz:')) {
    const [, phaseAction, phaseNumber] = args[1].split(':');
    return google.setPhase(uid, phaseAction, phaseNumber);
  }
  if (['dashboardListSentMail','dashboardGetSentMail','dashboardListConversation',
    'dashboardGetConversationMail','dashboardGetMailAttachment'].includes(name)) {
    const {data} = await google.project(uid);
    const recipient = String(data.email || '').trim().toLowerCase();
    if (!validRecipient(recipient)) {
      if (name === 'dashboardListSentMail' || name === 'dashboardListConversation')
        return {configured: true, missingRecipient: true, messages: []};
      throw new Error('A projekthez nincs érvényes e-mail-cím.');
    }
    if(name === 'dashboardListSentMail')return mail.list(recipient);
    if(name === 'dashboardListConversation')return mail.listConversation(recipient);
    if(name === 'dashboardGetMailAttachment')return mail.attachment(recipient,args[1],args[2]);
    return mail.get(recipient, args[1]);
  }
  const error = new Error('Ez a művelet még a meglévő Apps Script dashboardon érhető el.');
  error.status = 501;
  throw error;
}

async function redrawMarketingPost(store,campaign,brand,post){
  if(!post.svgId||!post.svgName||!post.imageId||!post.imageName)
    throw Object.assign(new Error('Ehhez a bejegyzéshez nem található újrarajzolható kép.'),{status:404});
  const original=(await store.output(campaign.id,post.svgId)).bytes.toString('utf8');
  const background=original.match(/<image href="(data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+)" width="1080" height="(?:720|1350)"/);
  const svg=postSvg(post,brand||{},background?.[1]||'');
  const png=await sharp(Buffer.from(svg)).png().toBuffer();
  const source=await store.saveOutput({campaignId:campaign.id,name:post.svgName,
    mimeType:'image/svg+xml',dataUri:'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64')});
  const output=await store.saveOutput({campaignId:campaign.id,name:post.imageName,
    mimeType:'image/png',dataUri:'data:image/png;base64,'+png.toString('base64')});
  post.svgId=source.id;post.imageId=output.id;
  post.imageUpdatedAt=new Date().toISOString();
  await store.saveCampaign(campaign);
  return post;
}

async function createMarketingPost(store,campaign,brand,topic,imageModel='local',automatic=false){
  if(!campaign||!campaign.id||campaign.status==='archived')
    throw Object.assign(new Error('Válassz aktív kampányt.'),{status:400});
  if(!['local','gemini-image','flux-1-schnell','flux-2-klein-4b'].includes(imageModel))
    throw Object.assign(new Error('Érvénytelen képmodell.'),{status:400});
  const day=new Date().toISOString().slice(0,10),used=marketingPostUsage.get(day)||0;
  if(used>=4||marketingPostInFlight>=1)
    throw Object.assign(new Error('A bejegyzésgeneráló napi 4 vagy egyidejű 1 kéréses korlátja betelt.'),{status:429});
  marketingPostUsage.clear();marketingPostUsage.set(day,used+1);marketingPostInFlight++;
  try{
    const now=new Date(),selected=validateTopic(topic);
    const text=await generatePostText(campaign,selected,{apiKey:process.env.GEMINI_API_KEY,
      model:process.env.GEMINI_MARKETING_MODEL||'gemini-3.5-flash-lite'});
    let background='',imageError='';
    if(imageModel!=='local'){
      const imageUsed=marketingImageUsage.get(day)||0;
      if(imageUsed<20&&marketingImageInFlight<2){
        marketingImageUsage.clear();marketingImageUsage.set(day,imageUsed+1);marketingImageInFlight++;
        try{background=(await generateMarketingImage({model:imageModel,prompt:text.imagePrompt,
          format:'portrait'},{accountId:process.env.CLOUDFLARE_ACCOUNT_ID,
          token:process.env.CLOUDFLARE_AI_TOKEN,apiKey:process.env.GEMINI_API_KEY})).image;}
        catch(error){imageError=error.message}finally{marketingImageInFlight--}
      }else imageError='Az AI-kép napi vagy egyidejű kerete betelt; helyi grafika készült.';
    }
    const id=crypto.randomUUID(),name='bejegyzes-'+now.toISOString().slice(0,10).replace(/-/g,'')+'-'+id.slice(0,8)+'.svg';
    const svg=postSvg(text,brand||{},background);
    const source=await store.saveOutput({campaignId:campaign.id,name,mimeType:'image/svg+xml',
      dataUri:'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64')});
    const png=await sharp(Buffer.from(svg)).png().toBuffer();
    const output=await store.saveOutput({campaignId:campaign.id,name:name.replace(/\.svg$/,'.png'),
      mimeType:'image/png',dataUri:'data:image/png;base64,'+png.toString('base64')});
    const post={id,createdAt:now.toISOString(),status:'draft',automatic,topic:selected,style:'fresh',
      headline:text.headline,body:text.body,imagePrompt:text.imagePrompt,imageModel:
      background?imageModel:'local',imageError,imageId:output.id,imageName:output.name,
      svgId:source.id,svgName:source.name};
    campaign.posts=[...(Array.isArray(campaign.posts)?campaign.posts:[]),post].slice(-100);
    if(automatic)campaign.autoPost={...campaign.autoPost,lastAttemptAt:now.toISOString(),
      nextRunAt:nextRun(now,campaign.autoPost.intervalDays),lastError:''};
    await store.saveCampaign(campaign);
    return post;
  }finally{marketingPostInFlight--}
}

let marketingScheduleRunning=false;
async function runMarketingSchedule(){
  if(marketingScheduleRunning||!trackingAuth||!process.env.GEMINI_API_KEY)return;
  marketingScheduleRunning=true;
  try{
    const store=marketingStore(googleClient(config,'',trackingAuth).drive,config);
    const {brand,campaigns}=await store.loadCampaigns();
    const scheduled=campaigns.filter(item=>due(item.autoPost)&&item.status!=='archived').slice(0,4);
    const logoDataUrl=scheduled.length?await store.brandLogo():'';
    for(const campaign of scheduled){
      try{const topics=await discoverTopics(),topic=pickTopic(topics,campaign.posts||[]);
        await createMarketingPost(store,campaign,{...brand,logoDataUrl},topic,campaign.autoPost.imageModel||'local',true);
      }catch(error){campaign.autoPost={...campaign.autoPost,lastAttemptAt:new Date().toISOString(),
        lastError:String(error.message).slice(0,250)};
        try{await store.saveCampaign(campaign)}catch(saveError){process.stderr.write('Bejegyzésütemezés mentési hiba: '+saveError.message+'\n')}
      }
    }
  }catch(error){process.stderr.write('Bejegyzésütemezés hiba: '+error.message+'\n')}
  finally{marketingScheduleRunning=false}
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, config.baseUrl);
  try {
    if (request.method === 'GET' && url.pathname === '/health') return send(response, 200, {ok: true});
    if (request.method === 'GET' && config.legacyPublicOrigin &&
        config.baseUrl !== config.legacyPublicOrigin.replace(/\/$/, '') &&
        request.headers.host === new URL(config.legacyPublicOrigin).host &&
        ['/', '/ajanlatkeres', '/dashboard', '/form', '/technical', '/marketing'].includes(url.pathname))
      return redirect(response, config.baseUrl + url.pathname + url.search);
    if (request.method === 'GET' && frontendAssets.has(url.pathname)) {
      const asset=frontendAssets.get(url.pathname);
      response.writeHead(200,{'Content-Type':asset.type,'Content-Length':asset.content.length,
        'Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'});
      return response.end(asset.content);
    }
    if (request.method === 'GET' && url.pathname === '/service-worker.js') {
      response.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8',
        'Content-Length':serviceWorkerJs.length,'Cache-Control':'no-cache',
        'Service-Worker-Allowed':'/','X-Content-Type-Options':'nosniff'});
      return response.end(serviceWorkerJs);
    }
    if (request.method === 'GET' && url.pathname === '/download-client.js') {
      response.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8',
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      return response.end(downloadClientJs);
    }
    if(request.method==='GET'&&url.pathname==='/api/project-image'){
      const session=authenticated(request);
      if(!session)return send(response,401,{error:'A munkamenet lejárt. Jelentkezz be újra.'},
        {'Set-Cookie':expiredCookie(request)});
      const uid=url.searchParams.get('uid')||'',fileId=url.searchParams.get('file')||'';
      if(!/^[A-Za-z0-9-]{4,64}$/.test(uid))
        return send(response,400,{error:'Érvénytelen projektazonosító.'});
      const image=await googleClient(config,session.refreshToken).projectImage(uid,fileId);
      response.writeHead(200,{'Content-Type':image.mime,'Content-Length':image.bytes.length,
        'Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff',
        'Referrer-Policy':'no-referrer'});
      return response.end(image.bytes);
    }
    if (request.method === 'GET' && url.pathname.startsWith('/media/marketing/')) {
      const match=url.pathname.match(/^\/media\/marketing\/([A-Za-z0-9_-]+)$/),grant=match&&unpack(match[1]);
      if(!grant||grant.kind!=='instagram-image'||grant.exp<Date.now()||
        !/^[A-Za-z0-9_-]{1,90}$/.test(String(grant.campaignId||''))||
        !/^[A-Za-z0-9_-]{1,90}$/.test(String(grant.fileId||''))||!trackingAuth)
        return send(response,404,{error:'A marketing képhivatkozás érvénytelen vagy lejárt.'});
      const store=marketingStore(googleClient(config,'',trackingAuth).drive,config);
      const {bytes}=await store.output(grant.campaignId,grant.fileId);
      const image=await sharp(bytes).resize(1080,1350,{fit:'inside',withoutEnlargement:true})
        .jpeg({quality:85,mozjpeg:true}).toBuffer();
      response.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':image.length,
        'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff',
        'Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'});
      return response.end(image);
    }
    if (request.method === 'GET' && url.pathname.startsWith('/pixel/')) {
      const match=url.pathname.match(/^\/pixel\/([A-Za-z0-9_-]+)$/);
      if (!match || !trackingAuth) return send(response,404,{error:'Érvénytelen követőkép.'});
      const grant=readPixelToken(config.sessionSecret,match[1]);
      response.writeHead(200,{'Content-Type':'image/gif','Content-Length':PIXEL.length,
        'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff',
        'Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'});
      response.end(PIXEL);
      const now=Date.now(),last=recentPixels.get(match[1])||0;
      if(now-last>=60000){recentPixels.set(match[1],now);
        if(recentPixels.size>5000)for(const [key,at] of recentPixels)
          if(now-at>60000)recentPixels.delete(key);
        emailTracking.record({webhookId:crypto.randomUUID(),uid:grant.uid,emailId:grant.id,
          to:grant.to,subject:grant.subject,at:new Date(now).toISOString(),kind:grant.kind,source:'pixel'})
          .catch(error=>process.stderr.write(`Követőkép napló hiba: ${error.message}\n`));}
      return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/download/')) {
      const match = url.pathname.match(/^\/download\/([A-Za-z0-9_-]+)(?:\/(?:file\/(\d{1,3})|(archive)))?$/);
      if (!match) return send(response,404,{error:'A letöltési hivatkozás érvénytelen.'});
      const grant = readDownloadToken(config.sessionSecret,match[1]);
      if (match[2] === undefined && !match[3]) {
        response.writeHead(200,{'Content-Type':'text/html; charset=utf-8',
          'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
          'Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow',
          'Content-Security-Policy':"default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'"});
        return response.end(downloadPage(grant,match[1]));
      }
      if (match[3] && grant.files.length<2)
        return send(response,404,{error:'A fájlcsomag nem található.'});
      const drive = googleClient(config,grant.refreshToken).drive;
      async function pdfBytes(item){const result=item.mimeType==='application/pdf'?
        await googleQuota.run('drive',100,()=>drive.files.get({fileId:item.id,alt:'media',
          supportsAllDrives:true},{responseType:'arraybuffer'})):
        await googleQuota.run('drive',100,()=>drive.files.export({fileId:item.id,
          mimeType:'application/pdf'},{responseType:'arraybuffer'}));
        const bytes=item.mimeType==='application/pdf' ?
          await standardizePdf(Buffer.from(result.data)) :
          await convertPdfA(Buffer.from(result.data));
        if(!bytes.length||bytes.length>30*1024*1024)
          throw Object.assign(new Error('A dokumentum nem tölthető le (üres vagy túl nagy).'),{status:422});
        return bytes;
      }
      const index=match[3]?-1:Number(match[2]);
      const item=match[3]?null:grant.files[index];
      if(!match[3]&&!item)return send(response,404,{error:'A dokumentum nem található.'});
      let bytes;
      if(match[3]){const files=[];let total=0;
        for(const file of grant.files){const content=await pdfBytes(file);total+=content.length;
          if(total>100*1024*1024)
            throw Object.assign(new Error('A tervcsomag túl nagy az egy kattintásos letöltéshez. A fájlok külön letölthetők.'),{status:422});
          files.push({filename:file.filename,bytes:content});}
        bytes=zipDocuments(files);
      }else bytes=await pdfBytes(item);
      const filename=match[3]?'Tervcsomag.zip':String(item.filename||'dokumentum.pdf').replace(/[\x00-\x1f\x7f"\\/]/g,'_');
      const ascii = filename.replace(/[^\x20-\x7e]/g,'_').replace(/["\\]/g,'_');
      response.writeHead(200,{'Content-Type':match[3]?'application/zip':'application/pdf',
        'Content-Disposition':`attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length':bytes.length,'Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
        'X-Robots-Tag':'noindex, nofollow'});
      if (trackingAuth && !grant.preview) response.once('finish',()=>{
        emailTracking.recordDownload({uid:grant.uid,id:grant.id,to:grant.to,
          subject:grant.subject,kind:grant.kind,filename,index,trackingId:grant.trackingId})
          .catch(error=>process.stderr.write(`Letöltési napló hiba: ${error.message}\n`));
      });
      response.end(bytes);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/webhooks/resend') {
      if (!config.resendWebhookSecret || !trackingAuth)
        return send(response, 503, {error:'A megnyitáskövetés nincs beállítva.'});
      const raw = await rawBody(request, 128 * 1024);
      const webhookId = verifyResendWebhook(raw,request.headers,config.resendWebhookSecret);
      const event = JSON.parse(raw.toString('utf8'));
      const opened = openEvent(event,webhookId,config.resendFrom);
      if (opened) await emailTracking.record(opened);
      return send(response, 200, {ok:true});
    }
    if (request.method === 'GET' && url.pathname === '/auth/login') {
      const destination=loginReturn(url.searchParams.get('return') ||
        (url.searchParams.get('project') ? '/dashboard?project='+encodeURIComponent(url.searchParams.get('project')) : ''));
      if (authenticated(request)) return redirect(response,destination);
      const expired=url.searchParams.get('reason')==='expired'||Boolean(cookie(request,'kocka_session'));
      response.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
        ...(!expiredCookie(request).length?{}:{'Set-Cookie':expiredCookie(request)})});
      return response.end(loginPage(destination,expired?'A munkamenet lejárt. Jelentkezz be újra a folytatáshoz.':''));
    }
    if (request.method === 'POST' && url.pathname === '/auth/local') {
      if (!localLoginReady) return send(response,503,{error:'A helyi belépés nincs beállítva.'});
      if (request.headers.origin !== config.baseUrl ||
          !String(request.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded'))
        return send(response,403,{error:'Érvénytelen belépési kérés.'});
      const params=new URLSearchParams((await rawBody(request,4096)).toString('utf8'));
      const destination=loginReturn(params.get('return'));
      const attempt=loginAttemptAllowed(request);
      if (!attempt.allowed) {
        response.writeHead(429,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
          'Retry-After':'900','X-Frame-Options':'DENY'});
        return response.end(loginPage(destination,'Túl sok sikertelen próbálkozás. Próbáld újra 15 perc múlva.'));
      }
      const suppliedUsername=String(params.get('username') || '').trim().toLowerCase();
      const validPassword=verifyPassword(params.get('password') || '',config.localPasswordHash);
      if (suppliedUsername !== config.localUsername || !validPassword) {
        failedLogins.set(attempt.ip,[...(failedLogins.get(attempt.ip)||[]),Date.now()]);
        response.writeHead(401,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
          'X-Frame-Options':'DENY'});
        return response.end(loginPage(destination,'Hibás felhasználónév vagy jelszó.'));
      }
      failedLogins.delete(attempt.ip);
      const maxAge=30*24*3600;
      return redirect(response,destination,[secureCookie('kocka_session',
        pack({email:owner,username:config.localUsername,local:true,
          passwordVersion:localPasswordVersion,exp:Date.now()+maxAge*1000}),maxAge)]);
    }
    if (request.method === 'GET' && url.pathname === '/auth/google') {
      const state = crypto.randomBytes(24).toString('base64url');
      const destination=loginReturn(url.searchParams.get('return'));
      const location = loginGoogle.oauth.generateAuthUrl({access_type:'offline', scope:['openid','email',
        'https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/drive'], state,
        ...(localLoginReady && url.searchParams.get('renew')!=='1' ? {} : {prompt:'consent'})});
      return redirect(response, location, [secureCookie('kocka_oauth_state', state, 600),
        secureCookie('kocka_oauth_return', destination, 600)]);
    }
    if (request.method === 'GET' && url.pathname === '/auth/callback') {
      const state = cookie(request, 'kocka_oauth_state');
      if (!state || state !== url.searchParams.get('state')) return send(response, 403, {error:'Érvénytelen bejelentkezési állapot.'});
      const {tokens} = await loginGoogle.oauth.getToken(url.searchParams.get('code') || '');
      const ticket = await loginGoogle.oauth.verifyIdToken({idToken: tokens.id_token, audience: config.clientId});
      const email = String(ticket.getPayload().email || '').toLowerCase();
      if (email !== owner || !ticket.getPayload().email_verified) return send(response, 403, {error:'Nincs hozzáférés ehhez a dashboardhoz.'});
      const refreshToken=tokens.refresh_token || trackingAuth?.credentials?.refresh_token;
      if (!refreshToken) return send(response, 400, {error:'A Google nem adott frissítési tokent. Vond vissza az alkalmazás hozzáférését, majd jelentkezz be újra.'});
      if (tokens.refresh_token && trackingAuth?.credentials?.refresh_token)
        trackingAuth.setCredentials({refresh_token:tokens.refresh_token});
      const target=loginReturn(cookie(request,'kocka_oauth_return'));
      const maxAge=localLoginReady?30*24*3600:12*3600;
      return redirect(response, target, [secureCookie('kocka_session', pack({email, refreshToken, exp:Date.now() + maxAge*1000}), maxAge),
        secureCookie('kocka_oauth_state', '', 0), secureCookie('kocka_oauth_return', '', 0)]);
    }
    if (request.method === 'GET' && url.pathname === '/auth/logout')
      return redirect(response, '/auth/login', [secureCookie('kocka_session', '', 0)]);
    if (request.method === 'GET' && url.pathname === '/') {
      const project = url.searchParams.get('project');
      return redirect(response, '/dashboard' + (project ? '?project=' + encodeURIComponent(project) : ''));
    }
    if (request.method === 'GET' && url.pathname === '/ajanlatkeres') {
      response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
      return response.end(nodePage(inquiryHtml,'inquiry'));
    }
    if (request.method === 'POST' && url.pathname === '/api/inquiry') {
      if(!trackingAuth)return send(response,503,{error:'Az ajánlatkérés jelenleg nem fogadható. Kérjük, írj az info@kockastudio.hu címre.'});
      const type=String(request.headers['content-type']||'');
      if(request.headers.origin!==config.baseUrl||request.headers['x-kocka-inquiry']!=='1'||
          !/^multipart\/form-data;\s*boundary=/i.test(type))
        return send(response,403,{error:'Érvénytelen ajánlatkérési kérés.'});
      limitGuest(request);limitInquiry(request);
      const raw=await rawBody(request,38*1024*1024);
      let form;
      try{form=await new Response(raw,{headers:{'Content-Type':type}}).formData();}
      catch(_){return send(response,400,{error:'Az űrlap vagy a fotók nem olvashatók.'});}
      if(form.get('website'))return send(response,201,{uid:'BEÉRKEZETT'});
      const data=validateInquiry(form),photos=await inquiryPhotos(form);
      const result=await googleClient(config,'',trackingAuth).createInquiry(data,photos);
      let notificationSent=false;
      try{
        const summary=inquiryText(data,result.uid,photos.length);
        const warning=result.warnings.length?'\n\nElőkészítési figyelmeztetés: '+result.warnings.join(' '):'';
        const message=await mail.send({to:owner,
          subject:`Új ajánlatkérés · ${data.city} · ${result.uid.slice(0,8)}`,
          text:summary+'\n\nDashboard: '+config.baseUrl+'/dashboard?project='+result.uid+warning,
          attachments:photos.map((photo,index)=>({
            filename:`Helyszín-${String(index+1).padStart(2,'0')}.${photo.extension}`,
            contentType:photo.mime,content:photo.bytes}))});
        notificationSent=Boolean(message.sent);
      }catch(_){process.stderr.write('Ajánlatkérési értesítő e-mail nem ment ki.\n');}
      return send(response,201,{uid:result.uid,prepared:result.prepared,
        photosSaved:result.photoCount,notificationSent,
        warnings:result.warnings,
        ...(notificationSent?{}:{warning:'Az ajánlatkérést rögzítettük, de az automatikus értesítés nem ment ki.'})});
    }
    if (request.method === 'GET' && url.pathname === '/form') {
      const rawUid = url.searchParams.get('uid') || '';
      const uid = /^[A-Za-z0-9-]{4,64}$/.test(rawUid) ? rawUid.toUpperCase() : '';
      const embed = url.searchParams.get('embed') === '1';
      if (rawUid && !uid) return send(response, 400, {error:'Érvénytelen projektazonosító.'});
      if (embed && (!uid || !authenticated(request)))
        return send(response, 401, {error:'A beágyazott szerkesztőhöz tulajdonosi bejelentkezés szükséges.'},
          {'Set-Cookie':expiredCookie(request)});
      if (!authenticated(request) && !trackingAuth)
        return send(response, 503, {error:'A nyilvános ügyfélűrlaphoz GOOGLE_TRACKING_CREDENTIAL szükséges.'});
      response.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff'});
      const html=nodePage(formHtml.replace("'<?= uid ?>'", JSON.stringify(uid)),'form');
      return response.end(embed ? html.replace('data-ks-page="form"','data-ks-page="form" data-embed="true"') : html);
    }
    if (request.method === 'POST' && url.pathname === '/api/form') {
      const session = authenticated(request);
      if (!session && !trackingAuth) return send(response, 401, {error:'A munkamenet lejárt. Jelentkezz be újra.'},
        {'Set-Cookie':expiredCookie(request)});
      if (request.headers.origin !== config.baseUrl || request.headers['x-kocka-form'] !== '1')
        return send(response, 403, {error:'Érvénytelen kérés.'});
      if (!session) limitGuest(request);
      const body = await jsonBody(request);
      if (!Array.isArray(body.args) || body.args.length > 1 || typeof body.name !== 'string')
        return send(response, 400, {error:'Érvénytelen űrlapkérés.'});
      const formGoogle = session ? googleClient(config, session.refreshToken) : googleClient(config, '', trackingAuth);
      if (body.name === 'createNewRecordForWeb') return send(response, 200, {result:await formGoogle.createClientRecord()});
      if (body.name === 'getData') return send(response, 200, {result:await formGoogle.getClientData(body.args[0])});
      if (body.name === 'saveData') {
        const result = await formGoogle.saveClientData(body.args[0],session ? 'owner':'customer');
        if (config.clientSubmissionEmail && result.submission?.notifyOwner) {
          const status = result.submission.status === 'complete' ? 'teljes':'hiányos';
          const dashboardUrl = config.baseUrl+'/dashboard?project='+encodeURIComponent(result.uid);
          try {
            await mail.send({to:owner,subject:`Ügyféladatok beküldve · ${status} · ${result.uid}`,
              text:`A(z) ${result.uid} azonosítójú projekt ügyféladatait beküldték.\nÁllapot: ${status}.\nHiányzó mezők száma: ${result.submission.missing.length}.\nProjekt: ${dashboardUrl}`});
          } catch (_) {
            process.stderr.write('Az ügyfélbeküldési e-mail nem ment ki. Ellenőrizd a Resend és IMAP beállításait.\n');
          }
        }
        delete result.submission?.notifyOwner;
        return send(response, 200, {result});
      }
      return send(response, 404, {error:'Ismeretlen űrlapművelet.'});
    }
    if (request.method === 'GET' && url.pathname === '/dashboard') {
      if (!authenticated(request)) {
        const project = url.searchParams.get('project') || '';
        const cookies=expiredCookie(request);
        return redirect(response, loginLocation('/dashboard'+
          (/^[A-Za-z0-9-]{4,64}$/.test(project) ? '?project=' + encodeURIComponent(project) : ''),
          Boolean(cookies.length)),cookies);
      }
      response.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      return response.end(nodePage(dashboardHtml.replace('<?= clientFormUrl ?>', '/form'),'dashboard'));
    }
    if (request.method === 'GET' && url.pathname === '/marketing') {
      if (!authenticated(request))
        return redirect(response,loginLocation('/marketing',Boolean(expiredCookie(request).length)),expiredCookie(request));
      response.writeHead(200, {'Content-Type':'text/html; charset=utf-8',
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      return response.end(nodePage(marketingHtml,'marketing'));
    }
    if(url.pathname.startsWith('/api/marketing/posts/')){
      const session=authenticated(request);
      if(!session)return send(response,401,{error:'A munkamenet lejárt. Jelentkezz be újra.'},
        {'Set-Cookie':expiredCookie(request)});
      if(request.method==='GET'&&url.pathname==='/api/marketing/posts/topics')
        return send(response,200,{topics:await discoverTopics()});
      if(request.method==='GET'&&url.pathname==='/api/marketing/posts/status')
        return send(response,200,{facebook:facebookStatus(),instagram:instagramStatus()});
      if(request.method!=='POST'||request.headers.origin!==config.baseUrl||
        request.headers['x-kocka-rpc']!=='1')return send(response,403,{error:'Érvénytelen kérés.'});
      const body=await jsonBody(request,4000);
      if(!/^[A-Za-z0-9_-]{1,90}$/.test(String(body.campaignId||'')))
        return send(response,400,{error:'Érvénytelen kampányazonosító.'});
      const store=marketingStore(googleClient(config,session.refreshToken).drive,config);
      const imageAction=['/api/marketing/posts/generate','/api/marketing/posts/redraw',
        '/api/marketing/posts/approve'].includes(url.pathname);
      const {brand,campaigns,brandLogoDataUrl}=await store.loadCampaigns({includeLogo:imageAction});
      const postBrand=imageAction?{...brand,logoDataUrl:brandLogoDataUrl}:brand;
      const campaign=campaigns.find(item=>item.id===body.campaignId);
      if(!campaign)return send(response,404,{error:'A kampány még nincs elmentve a Drive-ra.'});
      if(url.pathname==='/api/marketing/posts/generate')
        return send(response,200,{post:await createMarketingPost(store,campaign,postBrand,body.topic,
          body.imageModel||'local')});
      if(url.pathname==='/api/marketing/posts/redraw'){
        const post=campaign.posts?.find(item=>item.id===body.postId);
        if(!post||!['draft','approved'].includes(post.status))
          return send(response,409,{error:'Csak még nem publikált bejegyzés képe frissíthető.'});
        if(!POST_STYLES.includes(body.style))return send(response,400,{error:'Ismeretlen bejegyzéskép-stílus.'});
        if(post.status==='draft'){
          if(typeof body.headline!=='string'||!body.headline.trim()||body.headline.length>120)
            return send(response,400,{error:'A képfelirat hiányos vagy túl hosszú.'});
          post.headline=body.headline.trim();
        }
        post.style=body.style;
        return send(response,200,{post:await redrawMarketingPost(store,campaign,postBrand,post)});
      }
      if(url.pathname==='/api/marketing/posts/approve'){
        const post=campaign.posts?.find(item=>item.id===body.postId);
        if(!post||post.status!=='draft')return send(response,409,{error:'Csak szerkesztett tervezet hagyható jóvá.'});
        if(typeof body.headline!=='string'||!body.headline.trim()||body.headline.length>120||
          typeof body.text!=='string'||!body.text.trim()||body.text.length>5000)
          return send(response,400,{error:'A bejegyzés címe vagy szövege hiányos.'});
        if(!POST_STYLES.includes(body.style))return send(response,400,{error:'Ismeretlen bejegyzéskép-stílus.'});
        post.style=body.style;
        post.headline=body.headline.trim();post.body=body.text.trim();
        await redrawMarketingPost(store,campaign,postBrand,post);
        post.status='approved';
        post.approvedAt=new Date().toISOString();await store.saveCampaign(campaign);
        return send(response,200,{post});
      }
      if(url.pathname==='/api/marketing/posts/publish'){
        const post=campaign.posts?.find(item=>item.id===body.postId);
        if(!post||post.status!=='approved')
          return send(response,409,{error:'Csak jóváhagyott, még nem publikált bejegyzés küldhető.'});
        if(publishingPostIds.has(post.id))return send(response,409,{error:'A publikálás már folyamatban van.'});
        if(!facebookStatus().configured)
          return send(response,503,{error:'A Facebook-oldal nincs beállítva. Add meg a FACEBOOK_PAGE_ID és FACEBOOK_PAGE_ACCESS_TOKEN Railway-változókat.'});
        publishingPostIds.add(post.id);
        try{
        const {bytes}=await store.output(campaign.id,post.imageId);
        post.status='publishing';await store.saveCampaign(campaign);
        let published;
        try{published=await publishFacebookPhoto({image:bytes,body:post.body,
          generatedWithAi:post.imageModel!=='local'},{
          pageId:process.env.FACEBOOK_PAGE_ID,token:process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
          version:process.env.FACEBOOK_GRAPH_VERSION||'v26.0'});}
        catch(error){post.status=error.facebookRejected?'approved':'publish_uncertain';
          post.publishError=error.message;await store.saveCampaign(campaign);throw error;}
        post.status='published';post.publishedAt=new Date().toISOString();
        post.facebookPostId=published.postId;post.facebookPhotoId=published.photoId;
        post.publishError='';await store.saveCampaign(campaign);
        return send(response,200,{post});
        }finally{publishingPostIds.delete(post.id)}
      }
      if(url.pathname==='/api/marketing/posts/reset-publish'){
        const post=campaign.posts?.find(item=>item.id===body.postId);
        if(publishingPostIds.has(body.postId))
          return send(response,409,{error:'A publikálási kérés még folyamatban van.'});
        if(!post||!['publish_uncertain','publishing'].includes(post.status)||body.confirmNotPublished!==true)
          return send(response,409,{error:'Csak bizonytalan állapotú, a Facebook-oldalon ellenőrzött bejegyzés állítható vissza.'});
        post.status='approved';post.publishError='';
        await store.saveCampaign(campaign);
        return send(response,200,{post});
      }
      if(url.pathname==='/api/marketing/posts/instagram-publish'){
        const post=campaign.posts?.find(item=>item.id===body.postId);
        if(!post||post.status!=='published'||!post.imageId)
          return send(response,409,{error:'Instagramra csak már Facebookon publikált, képpel rendelkező bejegyzés küldhető.'});
        if(post.instagramMediaId)return send(response,409,{error:'Ez a bejegyzés már megjelent az Instagramon.'});
        if(publishingPostIds.has(post.id))return send(response,409,{error:'A bejegyzés publikálása még folyamatban van.'});
        if(!instagramStatus().configured)
          return send(response,503,{error:'Az Instagram-kapcsolathoz add meg a FACEBOOK_PAGE_ID és FACEBOOK_PAGE_ACCESS_TOKEN Railway-változókat.'});
        publishingPostIds.add(post.id);
        try{
          const published=await publishInstagramImage({imageUrl:marketingInstagramImageUrl(campaign.id,post.imageId),
            caption:post.body},{pageId:process.env.FACEBOOK_PAGE_ID,token:process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
              accountId:process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID||'',version:process.env.FACEBOOK_GRAPH_VERSION||'v26.0'});
          post.instagramMediaId=published.mediaId;post.instagramUsername=published.username;
          post.instagramPublishedAt=new Date().toISOString();await store.saveCampaign(campaign);
          return send(response,200,{post});
        }finally{publishingPostIds.delete(post.id)}
      }
      if(url.pathname==='/api/marketing/posts/delete'){
        const post=campaign.posts?.find(item=>item.id===body.postId);
        if(!post||post.status!=='published'||!post.facebookPhotoId||body.confirmPublishedDelete!==true)
          return send(response,409,{error:'Csak publikált, Facebook-képpel rendelkező bejegyzés törölhető megerősítés után.'});
        if(!facebookStatus().configured)
          return send(response,503,{error:'A Facebook-oldal nincs beállítva, ezért a bejegyzés nem törölhető biztonságosan a kampánylistából sem.'});
        if(post.instagramMediaId){
          await deleteInstagramMedia({mediaId:post.instagramMediaId},{pageId:process.env.FACEBOOK_PAGE_ID,
            token:process.env.FACEBOOK_PAGE_ACCESS_TOKEN,version:process.env.FACEBOOK_GRAPH_VERSION||'v26.0'});
          post.instagramMediaId='';post.instagramUsername='';post.instagramPublishedAt='';
          await store.saveCampaign(campaign);
        }
        await deleteFacebookPhoto({photoId:post.facebookPhotoId},{pageId:process.env.FACEBOOK_PAGE_ID,
          token:process.env.FACEBOOK_PAGE_ACCESS_TOKEN,version:process.env.FACEBOOK_GRAPH_VERSION||'v26.0'});
        campaign.posts=campaign.posts.filter(item=>item.id!==post.id);
        await store.saveCampaign(campaign);
        return send(response,200,{deleted:true});
      }
      if(url.pathname==='/api/marketing/posts/schedule'){
        if(typeof body.enabled!=='boolean')return send(response,400,{error:'Érvénytelen ütemezés.'});
        if(body.enabled&&(!trackingAuth||!process.env.GEMINI_API_KEY))
          return send(response,503,{error:'Az automatikus készítéshez GOOGLE_TRACKING_CREDENTIAL és GEMINI_API_KEY szükséges.'});
        const days=Number(body.intervalDays);
        if(!Number.isInteger(days)||days<3||days>30)
          return send(response,400,{error:'Az ismétlés 3–30 nap lehet.'});
        if(!['local','gemini-image','flux-1-schnell','flux-2-klein-4b'].includes(body.imageModel))
          return send(response,400,{error:'Érvénytelen képmodell.'});
        let first=new Date(body.firstRunAt);
        if(body.enabled&&(!Number.isFinite(first.getTime())||first.getTime()<Date.now()-60000||
          first.getTime()>Date.now()+366*86400000))
          return send(response,400,{error:'Adj meg érvényes jövőbeli első időpontot.'});
        campaign.autoPost={enabled:body.enabled,intervalDays:days,imageModel:body.imageModel,
          nextRunAt:body.enabled?first.toISOString():campaign.autoPost?.nextRunAt||'',
          lastAttemptAt:body.enabled?'':campaign.autoPost?.lastAttemptAt||'',lastError:''};
        await store.saveCampaign(campaign);
        return send(response,200,{autoPost:campaign.autoPost});
      }
      return send(response,404,{error:'Az oldal nem található.'});
    }
    if (url.pathname.startsWith('/api/marketing/store/')) {
      const session=authenticated(request);
      if(!session)return send(response,401,{error:'A munkamenet lejárt. Jelentkezz be újra.'},
        {'Set-Cookie':expiredCookie(request)});
      if(request.method!=='GET'&&
        (request.headers.origin!==config.baseUrl||request.headers['x-kocka-rpc']!=='1'))
        return send(response,403,{error:'Érvénytelen kérés.'});
      const store=marketingStore(googleClient(config,session.refreshToken).drive,config);
      if(request.method==='GET'&&url.pathname==='/api/marketing/store/state')
        return send(response,200,await store.load());
      if(request.method==='POST'&&url.pathname==='/api/marketing/store/brand')
        return send(response,200,await store.saveBrand((await jsonBody(request,40000)).brand));
      if(request.method==='POST'&&url.pathname==='/api/marketing/store/campaign')
        return send(response,200,await store.saveCampaign((await jsonBody(request,300000)).campaign,
          {preservePosts:true}));
      if(request.method==='POST'&&url.pathname==='/api/marketing/store/asset')
        return send(response,200,await store.saveAsset(await jsonBody(request,14*1024*1024)));
      if(request.method==='POST'&&url.pathname==='/api/marketing/store/output')
        return send(response,200,await store.saveOutput(await jsonBody(request,28*1024*1024)));
      if(request.method==='DELETE'&&url.pathname==='/api/marketing/store/asset') {
        const body=await jsonBody(request,1000);
        return send(response,200,await store.removeAsset(body.campaignId,body.fileId));
      }
      if(request.method==='GET'&&url.pathname==='/api/marketing/store/asset') {
        const {item,bytes}=await store.asset(url.searchParams.get('campaignId'),url.searchParams.get('fileId'));
        response.writeHead(200,{'Content-Type':item.mimeType,'Content-Length':bytes.length,
          'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
        return response.end(bytes);
      }
      if(request.method==='GET'&&url.pathname==='/api/marketing/store/output') {
        const {item,bytes}=await store.output(url.searchParams.get('campaignId'),url.searchParams.get('fileId'));
        response.writeHead(200,{'Content-Type':item.mimeType,'Content-Length':bytes.length,
          'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
          ...(['text/html','image/svg+xml'].includes(item.mimeType)?{
            'Content-Disposition':`attachment; filename="${item.name.replace(/[^A-Za-z0-9_.-]/g,'_')}"`}:{})});
        return response.end(bytes);
      }
      return send(response,404,{error:'Az oldal nem található.'});
    }
    if (request.method === 'GET' && url.pathname === '/api/marketing/image/models') {
      if (!authenticated(request)) return send(response,401,{error:'A munkamenet lejárt. Jelentkezz be újra.'});
      return send(response,200,{models:modelStatus()});
    }
    if (request.method === 'POST' && url.pathname === '/api/marketing/image') {
      if (!authenticated(request)) return send(response,401,{error:'A munkamenet lejárt. Jelentkezz be újra.'},
        {'Set-Cookie':expiredCookie(request)});
      if (request.headers.origin !== config.baseUrl || request.headers['x-kocka-rpc'] !== '1')
        return send(response,403,{error:'Érvénytelen kérés.'});
      const body=await jsonBody(request,2*1024*1024);
      validateImageInput(body);
      if (body.model === 'gemini-image' && !process.env.GEMINI_API_KEY)
        return send(response,503,{error:'A Gemini képgeneráláshoz GEMINI_API_KEY szükséges a Railway Variables között.'});
      if (body.model !== 'gemini-image' && (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_AI_TOKEN))
        return send(response,503,{error:'A Cloudflare képgenerálás nincs beállítva. A Railway Variables között add meg a CLOUDFLARE_ACCOUNT_ID és CLOUDFLARE_AI_TOKEN változót.'});
      const day=new Date().toISOString().slice(0,10),used=marketingImageUsage.get(day)||0;
      if (used>=20 || marketingImageInFlight>=2)
        return send(response,429,{error:'Az alkalmazás napi 20 AI-képes korlátját vagy a két egyidejű kérés határát elérted. Próbáld később.'},
          {'Retry-After':'3600'});
      marketingImageUsage.clear();marketingImageUsage.set(day,used+1);marketingImageInFlight++;
      try{return send(response,200,await generateMarketingImage(body,{
        accountId:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_AI_TOKEN,
        apiKey:process.env.GEMINI_API_KEY
      }));}finally{marketingImageInFlight--;}
    }
    if (request.method === 'POST' && url.pathname === '/api/marketing/creative') {
      const session=authenticated(request);
      if (!session) return send(response,401,{error:'A munkamenet lejárt. Jelentkezz be újra.'},
        {'Set-Cookie':expiredCookie(request)});
      if (request.headers.origin !== config.baseUrl || request.headers['x-kocka-rpc'] !== '1')
        return send(response,403,{error:'Érvénytelen kérés.'});
      if (!process.env.GEMINI_API_KEY)
        return send(response,503,{error:'A GEMINI_API_KEY nincs beállítva a Railway Variables között.'});
      const body=await jsonBody(request,6*1024*1024);
      validateCreativeInput(body);
      const day=new Date().toISOString().slice(0,10),used=marketingAiUsage.get(day)||0;
      if (used>=12 || marketingAiInFlight>=2)
        return send(response,429,{error:'Az AI-kreatív napi vagy egyidejű kéréshatárát elérted.'},
          {'Retry-After':'3600'});
      marketingAiUsage.clear();marketingAiUsage.set(day,used+1);marketingAiInFlight++;
      try{return send(response,200,await generateCreativePlan(body,{
        apiKey:process.env.GEMINI_API_KEY,
        model:process.env.GEMINI_MARKETING_MODEL||'gemini-3.5-flash-lite'
      }));}
      finally{marketingAiInFlight--;}
    }
    if (request.method === 'POST' && url.pathname === '/api/marketing/strategy') {
      if (!authenticated(request)) return send(response,401,{error:'A munkamenet lejárt. Jelentkezz be újra.'},
        {'Set-Cookie':expiredCookie(request)});
      if(request.headers.origin!==config.baseUrl||request.headers['x-kocka-rpc']!=='1')
        return send(response,403,{error:'Érvénytelen kérés.'});
      const body=await jsonBody(request,8000);
      validateStrategyInput(body);
      if(!process.env.GEMINI_API_KEY)
        return send(response,503,{error:'A GEMINI_API_KEY nincs beállítva a Railway Variables között.'});
      const day=new Date().toISOString().slice(0,10),used=marketingStrategyUsage.get(day)||0;
      if(used>=12||marketingStrategyInFlight>=2)
        return send(response,429,{error:'A kampánytervező napi 12 vagy egyidejű 2 AI-kéréses korlátja betelt.'},
          {'Retry-After':'3600'});
      marketingStrategyUsage.clear();marketingStrategyUsage.set(day,used+1);marketingStrategyInFlight++;
      try{return send(response,200,await generateStrategy(body,{
        apiKey:process.env.GEMINI_API_KEY,
        model:process.env.GEMINI_MARKETING_MODEL||'gemini-3.5-flash-lite'
      }));}finally{marketingStrategyInFlight--;}
    }
    if (request.method === 'GET' && url.pathname === '/technical') {
      if (!authenticated(request)) {
        const cookies=expiredCookie(request);
        return redirect(response,loginLocation('/technical?uid='+encodeURIComponent(url.searchParams.get('uid') || ''),
          Boolean(cookies.length)),cookies);
      }
      response.writeHead(200, {'Content-Type':'text/html; charset=utf-8',
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      return response.end(nodePage(technicalHtml,'technical'));
    }
    if (request.method === 'POST' && url.pathname === '/api/rpc') {
      if (!authenticated(request)) return send(response, 401, {error:'A munkamenet lejárt. Jelentkezz be újra.'},
        {'Set-Cookie':expiredCookie(request)});
      if (request.headers.origin !== config.baseUrl || request.headers['x-kocka-rpc'] !== '1')
        return send(response, 403, {error:'Érvénytelen kérés.'});
      const body = await jsonBody(request, 12 * 1024 * 1024 + 4096);
      if (!Array.isArray(body.args) || body.args.length > 5 || typeof body.name !== 'string')
        return send(response, 400, {error:'Érvénytelen RPC kérés.'});
      return send(response, 200, {result: await rpc(body.name, body.args, authenticated(request))});
    }
    return send(response, 404, {error:'Az oldal nem található.'});
  } catch (error) {
    if (error?.response?.data?.error === 'invalid_grant' || /\binvalid_grant\b/.test(String(error.message || '')))
      return send(response,503,{error:'A Google-hozzáférés lejárt. Újítsd meg a Google-kapcsolatot, majd frissítsd a Railway GOOGLE_TRACKING_CREDENTIAL változóját.',googleReconnect:true});
    const status = error.status || 500;
    if (status >= 500) process.stderr.write(`Kérés hiba: ${error.message}\n`);
    return send(response, status,
      {error: status === 500 ? 'A művelet nem sikerült. Ellenőrizd a szerver naplóját.' : error.message},
      status === 429 ? {'Retry-After':'60'} : {});
  }
});
server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => {
  process.stdout.write(`Kocka dashboard listening on ${server.address().port}\n`);
});
setTimeout(runMarketingSchedule,60000).unref();
setInterval(runMarketingSchedule,6*3600000).unref();
