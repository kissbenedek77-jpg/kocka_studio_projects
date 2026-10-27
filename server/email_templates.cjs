'use strict';
const sanitizeHtml = require('sanitize-html');
const {googleQuota} = require('./quota.cjs');
const {googleCache} = require('./cache.cjs');

const TEMPLATE_FILES = Object.freeze({offer:'ajanlat.html',contract:'szerzodes.html',
  intake:'adatbekeres.html',package:'tervcsomag.html'});
const DOWNLOAD_TOKEN = '{{DOWNLOAD_URL}}';
const SIGNATURE_HTML = '<div data-kocka-signature="1" style="margin:32px 0px 0px;font-family:Arial,sans-serif">'
  +'<div style="background-color:#77c59e;padding:3px">&nbsp;</div>'
  +'<div style="background-color:#3e3e3e;color:#ffffff;padding:24px 28px">'
  +'<span style="color:#77c59e;font-size:12px;font-weight:700">ÜDVÖZLETTEL</span><br>'
  +'<strong style="color:#ffffff;font-size:25px;font-weight:300">Kocka Stúdió</strong><br>'
  +'<span style="color:#e8e8e8;font-size:13px">Építészeti tervezés · Kocka Studio Projects</span>'
  +'</div></div>';
const DOWNLOAD_BUTTON_HTML = '<a data-kocka-placeholder="download-button" href="{{DOWNLOAD_URL}}" style="background-color:#77c59e;color:#2b2b2b;padding:12px 20px;display:inline-block;text-decoration:none;font-weight:700">Dokumentumok letöltése</a>';
const DOWNLOAD_LINK_HTML = '<a data-kocka-placeholder="download-link" href="{{DOWNLOAD_URL}}" style="color:#3e3e3e;text-decoration:underline">{{DOWNLOAD_URL}}</a>';
const STYLE = {
  color:[/^#[0-9a-f]{3,8}$/i,/^(black|white|gray|grey)$/i],
  'background-color':[/^#[0-9a-f]{3,8}$/i],
  'font-family':[/^[a-z0-9, '\-]{1,80}$/i],
  'font-size':[/^\d{1,2}px$/],
  'font-weight':[/^(normal|bold|[1-9]00)$/],
  'line-height':[/^(normal|\d+(?:\.\d+)?)$/],
  padding:[/^\d{1,2}px(?: \d{1,2}px){0,3}$/],
  margin:[/^\d{1,2}px(?: \d{1,2}px){0,3}$/],
  'text-align':[/^(left|center|right)$/],
  'text-decoration':[/^(none|underline)$/],
  display:[/^(block|inline-block)$/]
};

function escapeHtml(value) {
  return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function sanitizeEmailSource(value) {
  const source=String(value ?? '');
  if (!source || source.length > 100000) throw new Error('A HTML-levél 1–100 000 karakter lehet.');
  const clean=sanitizeHtml(source,{
    allowedTags:['div','span','p','br','strong','b','em','i','u','h1','h2','h3',
      'ul','ol','li','a','blockquote','hr'],
    allowedAttributes:{'*':['style'],a:['href','style','data-kocka-placeholder'],
      div:['style','data-kocka-signature']},
    allowedStyles:{'*':STYLE},
    allowedSchemes:['http','https','mailto'],
    disallowedTagsMode:'discard'
  });
  if (!sanitizeHtml(clean,{allowedTags:[],allowedAttributes:{}}).trim())
    throw new Error('A HTML-levél nem lehet üres.');
  return clean;
}

function fillEmailTemplate(source,{projectName,formUrl}) {
  return sanitizeEmailSource(source)
    .replaceAll('{{PROJECT_NAME}}',escapeHtml(projectName))
    .replaceAll('{{FORM_URL}}',escapeHtml(formUrl));
}

function renderEmailHtml(source,downloadUrl = '') {
  const clean=sanitizeEmailSource(source);
  if (clean.includes(DOWNLOAD_TOKEN) && !downloadUrl)
    throw new Error('Ehhez a levélhez nincs letölthető dokumentum. Töröld a letöltési helyőrzőt.');
  const body=clean.replaceAll(DOWNLOAD_TOKEN,escapeHtml(downloadUrl));
  return '<!doctype html><html lang="hu"><head><meta charset="utf-8"></head>'
    +'<body style="margin:0;padding:20px 12px;background-color:#f5f5f5;font-family:Arial,sans-serif;line-height:1.5;color:#5a5a5a">'
    +'<div style="max-width:640px;margin:0 auto;padding:32px;background-color:#ffffff">'+body+'</div></body></html>';
}

function plainTextFromHtml(html) {
  const spaced=String(html).replace(/<br\s*\/?>/gi,'\n')
    .replace(/<\/(?:div|p|h[1-3]|li)>/gi,'\n');
  return sanitizeHtml(spaced,{allowedTags:[],allowedAttributes:{}})
    .replace(/\r/g,'').replace(/\n{3,}/g,'\n\n').trim();
}

async function loadEmailTemplate(drive,folderId,kind) {
  const name=TEMPLATE_FILES[kind];
  if (!name || !folderId) throw new Error('A levélsablon mappája nincs beállítva.');
  return googleCache.get(`email-template:${folderId}:${name}`,60000,async()=>{
    const files=(await googleQuota.run('drive',100,()=>drive.files.list({
      q:`'${folderId}' in parents and name = '${name}' and trashed = false`,
      fields:'files(id,name,mimeType)',pageSize:10,supportsAllDrives:true,
      includeItemsFromAllDrives:true
    }))).data.files || [];
    const found=files.find(item=>item.name===name&&item.mimeType==='text/html');
    if (!found) throw new Error('Hiányzó HTML-levélsablon a _System mappában: '+name);
    const result=await googleQuota.run('drive',100,()=>drive.files.get({
      fileId:found.id,alt:'media',supportsAllDrives:true},{responseType:'text'}));
    return sanitizeEmailSource(result.data);
  });
}

module.exports={TEMPLATE_FILES,DOWNLOAD_TOKEN,SIGNATURE_HTML,DOWNLOAD_BUTTON_HTML,
  DOWNLOAD_LINK_HTML,escapeHtml,sanitizeEmailSource,fillEmailTemplate,
  renderEmailHtml,plainTextFromHtml,loadEmailTemplate};
