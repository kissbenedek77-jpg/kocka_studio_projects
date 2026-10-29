'use strict';
const crypto = require('node:crypto');
const {Readable} = require('node:stream');
const {google} = require('googleapis');
const {FIELDS,rowToData, projectFromRow, extractDriveId} = require('./domain.cjs');
const {inquiryText,photoType} = require('./inquiry.cjs');
const {buildClientRow, clientFormUrl} = require('./client_data.cjs');
const {documentValues, findMarkers, mergeRequests, unresolvedMarkers} = require('./doc_merge.cjs');
const {conditionalBlocks,conditionalRequests} = require('./conditional_docs.cjs');
const {planScale} = require('./plans.cjs');
const {restartPostfix,appendPostfix,copiedName,expectedPath} = require('./restart.cjs');
const {technicalSheetValues, technicalProgramLines} = require('./technical_sheet.cjs');
const {parseRoomText,areaText} = require('./room_data.cjs');
const {FIELD_SHEET,MANUAL_FIELDS,CHAPTER_KEYS,fieldSheetRows,validateTechnicalField,manualValues,technicalReplacements} = require('./technical_document.cjs');
const {draftInputs,draftPrompt,parseDraftResult} = require('./technical_ai.cjs');
const {AUTO_CHAPTERS,autoFacts,autoPrompt,parseAutoResult} = require('./technical_auto.cjs');
const {technicalSupplementRequests} = require('./technical_upgrade.cjs');
const {technicalTableRequests} = require('./technical_table.cjs');
const {textTemplates,appendixRequests} = require('./technical_texts.cjs');
const {findMarker,insertRequests,findEmptyTable,fillRequests} = require('./room_table.cjs');
const {retegrendFacts,retegrendValues} = require('./retegrend.cjs');
const {pdfToText} = require('./pdf_text.cjs');
const {floorCount,bedroomCount,hasOffice} = require('./technical_program.cjs');
const {chatInput,chatPrompt,parseChatResult} = require('./technical_chat.cjs');
const {latestRenderCoverFile,coverImageObject,publicImageUrl,coverImageRequest} = require('./cover_image.cjs');
const {PHASE_COUNT,projectPhases,phaseChange} = require('./phases.cjs');
const {googleQuota} = require('./quota.cjs');
const {convertPdfA,inspectPdf} = require('./pdf_quality.cjs');
const {googleCache} = require('./cache.cjs');
const {loadEmailTemplate,fillEmailTemplate} = require('./email_templates.cjs');
const {SHEET:SUBMISSION_SHEET,HEADERS:SUBMISSION_HEADERS,completeness,parseSubmission,submissionFor} = require('./client_submission.cjs');
const OFFER_NAMES = ['totalFee','optionalFee','installment1','installment2','installment3','installment4',
  'pricePrefix','pricePostfix','amountWords','currency','currencyLong','deadline5','deadline6',
  'deadline7','deadline8','structuralEngineer','mechanicalEngineer','electricalEngineer',
  'projectDescription','structuralFee','structuralOptionalFee','mechanicalFee','electricalFee','fireFee'];
const DOCUMENT_TEMPLATES = {
  ajanlat:{title:'Ajánlat',templateId:'1xfu7b6o0BzGOPNDjeqKfkIkaBZq-7pPuVIU2TeYGRLM',folder:'_Belső'},
  szerzodes:{title:'Építész szerződés',templateId:'1ZlTFxOAzccEReFsQ93Xmtd3T1d8CnpeWpY3j7ClWR1s',folder:'_Belső'},
  meghatalmazas:{title:'Meghatalmazás',templateId:'1mWGG9qcx7BCRTFKdq4WSGFB8mj7gJ91r_3Kcnx1NnOE',folder:'írásos'},
  alairolap:{title:'Aláírólap',templateId:'154O4ujYA_Y4erOeKFv2QCLl34REOOuYSzQsK2yKFmHk',folder:'írásos'},
  muszakiLeiras:{title:'Építész műszaki leírás',
    templateId:'1TIGIBSACypr0ZvMZ2xXRABEcPArkQTwM_AqfnMNVtoA',folder:'írásos'}
};
const PHASE_SHEET = '_ProjektSzakasz';

function extractFolderLinks(sheetsData) {
  const links = new Map();
  for (const sheet of sheetsData || []) {
    for (const grid of sheet.data || []) {
      (grid.rowData || []).forEach((item, index) => {
        const cell = item.values?.[0];
        const href = cell?.hyperlink || cell?.textFormatRuns?.find(run => run.format?.link?.uri)?.format.link.uri;
        if (href) links.set((grid.startRow || 0) + index + 1, href);
      });
    }
  }
  return links;
}

function inquiryDateStamp(value) {
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('sv-SE',{
    timeZone:'Europe/Budapest',year:'numeric',month:'2-digit',day:'2-digit'
  }).format(date).replace(/-/g,'');
}

function displayProjectFolderName(name,uid,createdAt) {
  const folderName=String(name||'');
  const oldSuffix=' '+String(uid||'').slice(0,8);
  const date=inquiryDateStamp(createdAt);
  if(folderName.toUpperCase().endsWith(oldSuffix.toUpperCase()))
    return folderName.slice(0,-oldSuffix.length)+(date?' '+date:'');
  const previousFormat=folderName.match(/^(.*?)(?: \((\d+)\))? (\d{4})-(\d{2})-(\d{2})$/);
  if(previousFormat)return `${previousFormat[1]} ${previousFormat[3]}${previousFormat[4]}${previousFormat[5]}`+
    (previousFormat[2]?'#'+previousFormat[2]:'');
  return folderName;
}

function pdfAuditErrorInfo(error,stage='inspect') {
  const message=String(error.message||error).slice(0,500);
  const tool=String(error.pdfTool||'').toLowerCase();
  const diagnostic=String(error.pdfDiagnostic||'').slice(0,400);
  if(stage==='convert') return {message,
    meaning:'A PDF/A-2b átalakítás vagy az új fájl validálása nem sikerült. Az eredeti Drive-fájl nem változott.',
    action:'Nyisd meg a PDF-et, és készíts új PDF/A-2b exportot a forrásprogramból. Aláírt eredetit ne módosíts.',diagnostic};
  if(stage==='preserve') return {message,
    meaning:'Az eredeti Drive-verzió tartós megőrzése nem sikerült, ezért az alkalmazás nem írta át a fájlt.',
    action:'Ellenőrizd a Drive szerkesztési és verziókezelési jogosultságait, majd próbáld újra.',diagnostic};
  if(stage==='upload') return {message,
    meaning:'A PDF/A változat Drive-mentése megszakadt; a fájl aktuális állapotát újra kell ellenőrizni.',
    action:'Frissítsd a fájllistát és futtasd újra az ellenőrzést. Ha ismétlődik, ellenőrizd a Drive jogosultságot.',diagnostic};
  if(/30 MB/.test(message)) return {message,meaning:'A fájl meghaladja a vizsgálat 30 MB-os méretkorlátját.',
    action:'Készíts kisebb, olvasható PDF-et, majd futtasd újra az ellenőrzést.',diagnostic};
  if(/PDF hiányzik, hibás/.test(message)) return {message,
    meaning:'A letöltött fájl nem kezdődik érvényes PDF-fejléccel, vagy túl kicsi a vizsgálathoz.',
    action:'Nyisd meg a fájlt; ha nem olvasható, exportáld újra PDF-ként és töltsd fel ismét.',diagnostic};
  if(/nincs telepítve/.test(message)) return {message,
    meaning:`A szerveren hiányzik a ${tool||'PDF-ellenőrző'} program. A fájl megfelelősége nem állapítható meg.`,
    action:'A szerver Docker-képét kell javítani és újra telepíteni.',diagnostic};
  if(tool.includes('verapdf')) return {message,
    meaning:'A PDF/A vizsgálóprogram nem tudta befejezni az ellenőrzést. Ez önmagában nem jelenti, hogy a fájl nem PDF/A.',
    action:'Nyisd meg a fájlt; ha sérült, kérj új PDF/A-2b exportot. Aláírt eredetit ne módosíts: az új exportot újra alá kell írni. Ha több PDF-nél is ez történik, ellenőrizd a szerver veraPDF telepítését.',diagnostic};
  if(tool.includes('pdfsig')) return {message,
    meaning:'A digitális aláírás vizsgálóprogramja nem tudta befejezni az ellenőrzést; a PDF/A állapot sem igazolt.',
    action:'Nyisd meg a PDF-et, és ellenőrizd az aláírást egy PDF-olvasóban. Ha több fájlnál is ez történik, ellenőrizd a szerver pdfsig programját.',diagnostic};
  return {message,meaning:'A PDF letöltése vagy vizsgálata megszakadt; a megfelelőség nem állapítható meg.',
    action:'Próbáld újra. Ha ismétlődik, ellenőrizd a fájl megnyithatóságát és a Google Drive hozzáférést.',diagnostic};
}

function googleClient(config, refreshToken = '', authOverride = null) {
  const oauth = new google.auth.OAuth2(config.clientId, config.clientSecret, `${config.baseUrl}/auth/callback`);
  if (refreshToken) oauth.setCredentials({refresh_token: refreshToken});
  const auth = authOverride || oauth;
  const sheets = google.sheets({version: 'v4', auth});
  const drive = google.drive({version: 'v3', auth});
  const docs = google.docs({version:'v1',auth});
  const pdfQuality=config.pdfQuality||{convertPdfA,inspectPdf};
  const book = config.sheetId;
  const quote = name => `'${String(name).replace(/'/g, "''")}'`;
  const sheetRead = call => googleQuota.run('sheetsRead', 1, call);
  const sheetWrite = call => googleQuota.run('sheetsWrite', 1, call);
  const driveRead = (cost, call) => googleQuota.run('drive', cost, call);
  const values = async range => (await sheetRead(() => sheets.spreadsheets.values.get({
    spreadsheetId: book, range, valueRenderOption: 'FORMATTED_VALUE'
  }))).data.values || [];
  const rowRange = `${quote(config.sheetName)}!A2:BM`;
  async function folderLinks() {
    const result = await sheetRead(() => sheets.spreadsheets.get({
      spreadsheetId: book, ranges: [`${quote(config.sheetName)}!E2:E`], includeGridData: true,
      fields: 'sheets(data(startRow,rowData(values(hyperlink,textFormatRuns))))'
    }));
    return extractFolderLinks(result.data.sheets);
  }
  async function ensureMemoSheet() {
    return googleCache.get(`memo-ready:${book}`, 300000, async () => {
    const title = '_ProjektMemo';
    const metadata = await sheetRead(() => sheets.spreadsheets.get({spreadsheetId:book, fields:'sheets(properties(title))'}));
    if (!(metadata.data.sheets || []).some(item => item.properties?.title === title)) {
      try {
        await sheetWrite(() => sheets.spreadsheets.batchUpdate({spreadsheetId:book, requestBody:{requests:[
          {addSheet:{properties:{title,hidden:true}}}
        ]}}));
      } catch (error) {
        if (error.status === 429) throw error;
        // Másik kérés közben már létrehozhatta ugyanazt a lapot.
        const latest = await sheetRead(() => sheets.spreadsheets.get({spreadsheetId:book, fields:'sheets(properties(title))'}));
        if (!(latest.data.sheets || []).some(item => item.properties?.title === title)) throw error;
      }
    }
    await sheetWrite(() => sheets.spreadsheets.values.update({spreadsheetId:book, range:"'_ProjektMemo'!A1:C1",
      valueInputOption:'RAW', requestBody:{values:[['UID','Jegyzet','Módosítva']]}}));
    });
  }

  async function saveMemo(uid, memo) {
    if (typeof memo !== 'string' || memo.length > 50000)
      throw new Error('A jegyzet legfeljebb 50 000 karakter lehet.');
    const {data} = await project(uid);
    await ensureMemoSheet();
    const rows = await values("'_ProjektMemo'!A2:A");
    const index = rows.findIndex(row => String(row[0] || '').trim().toUpperCase() === data.uid);
    const stamp = new Date().toISOString();
    if (index < 0) {
      await sheetWrite(() => sheets.spreadsheets.values.append({spreadsheetId:book, range:"'_ProjektMemo'!A:C",
        valueInputOption:'RAW', insertDataOption:'INSERT_ROWS',
        requestBody:{values:[[data.uid,memo,stamp]]}}));
    } else {
      await sheetWrite(() => sheets.spreadsheets.values.update({spreadsheetId:book, range:`'_ProjektMemo'!B${index + 2}:C${index + 2}`,
        valueInputOption:'RAW', requestBody:{values:[[memo,stamp]]}}));
    }
    return memo;
  }

  async function saveExpectedFiles(uid, paths) {
    const {data} = await project(uid);
    if (typeof paths !== 'string') throw new Error('Az elvárt fájllista szövegként adható meg.');
    const lines = paths.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const normalized = lines.join('\n');
    if (lines.length > 200 || normalized.length > 12000)
      throw new Error('Legfeljebb 200 elvárt fájl adható meg.');
    for (const line of lines) {
      if (line.includes('..') || line.startsWith('/') || /[\x00-\x1f]/.test(line))
        throw new Error('Érvénytelen relatív fájlútvonal: ' + line);
    }
    const title = '_ProjektElvártFájlok';
    const metadata = await sheetRead(() => sheets.spreadsheets.get({
      spreadsheetId: book, fields: 'sheets(properties(title))'
    }));
    if (!(metadata.data.sheets || []).some(item => item.properties?.title === title)) {
      await sheetWrite(() => sheets.spreadsheets.batchUpdate({spreadsheetId:book, requestBody:{requests:[
        {addSheet:{properties:{title,hidden:true}}}
      ]}}));
      await sheetWrite(() => sheets.spreadsheets.values.update({spreadsheetId:book,
        range:`'${title}'!A1:C1`, valueInputOption:'RAW',
        requestBody:{values:[['UID','Relatív fájlútvonalak','Módosítva']]}}));
    }
    const rows = await values(`'${title}'!A2:A`);
    const index = rows.findIndex(row => String(row[0] || '').trim().toUpperCase() === data.uid);
    const stamp = new Date().toISOString();
    if (index < 0) {
      await sheetWrite(() => sheets.spreadsheets.values.append({spreadsheetId:book,
        range:`'${title}'!A:C`, valueInputOption:'RAW', insertDataOption:'INSERT_ROWS',
        requestBody:{values:[[data.uid,normalized,stamp]]}}));
    } else {
      await sheetWrite(() => sheets.spreadsheets.values.update({spreadsheetId:book,
        range:`'${title}'!B${index + 2}:C${index + 2}`, valueInputOption:'RAW',
        requestBody:{values:[[normalized,stamp]]}}));
    }
    return dashboardProject(data.uid);
  }

  async function pdfaExpectedFiles(uid) {
    const {data} = await project(uid);
    const rootId = extractDriveId(data.projectFolderUrl);
    if (!rootId) return {folder:'PDFA',files:[],missing:true,truncated:false};
    const pdfa = (await listChildren(rootId)).find(item =>
      item.mimeType === 'application/vnd.google-apps.folder' &&
      String(item.name || '').trim().toLowerCase() === 'pdfa');
    if (!pdfa) return {folder:'PDFA',files:[],missing:true,truncated:false};
    const files = [];
    let truncated = false;
    const clean = name => String(name || '').replace(/[\r\n\t]+/g,' ').trim();
    const walk = async (folderId, prefix, depth) => {
      if (files.length >= 200) {truncated = true; return;}
      for (const item of await listChildren(folderId)) {
        if (files.length >= 200) {truncated = true; break;}
        const name = clean(item.name);
        if (!name || name === '.' || name === '..') continue;
        if (item.mimeType === 'application/vnd.google-apps.folder') {
          if (depth < 3) await walk(item.id,prefix + '/' + name,depth + 1);
          continue;
        }
        files.push(prefix + '/' + name);
      }
    };
    await walk(pdfa.id,'PDFA',0);
    files.sort((a,b) => a.localeCompare(b,'hu'));
    return {folder:'PDFA',files,missing:false,truncated};
  }

  async function answerCheck(uid, code, answer) {
    const state = await dashboardProject(uid);
    const issue = state.issues.find(item => item.code === code);
    if (!issue?.answerable) throw new Error('Ez az ellenőrzési pont nem válaszolható meg itt.');
    if (typeof answer !== 'string' || !answer.trim() || answer.trim().length > 3000)
      throw new Error('A válasz 1–3000 karakter lehet.');
    const normalized = answer.trim();
    if (code.startsWith('scale:') && !/^M=1:\d+(?:,\s*1:\d+)*$/.test(normalized))
      throw new Error('A méretarány formátuma például M=1:50 vagy M=1:500, 1:200.');
    const title = '_ProjektEllenőrzés';
    const metadata = await sheetRead(() => sheets.spreadsheets.get({spreadsheetId:book,
      fields:'sheets(properties(title))'}));
    if (!(metadata.data.sheets || []).some(item => item.properties?.title === title)) {
      await sheetWrite(() => sheets.spreadsheets.batchUpdate({spreadsheetId:book,
        requestBody:{requests:[{addSheet:{properties:{title,hidden:true}}}]}}));
      await sheetWrite(() => sheets.spreadsheets.values.update({spreadsheetId:book,
        range:`${quote(title)}!A1:D1`,valueInputOption:'RAW',
        requestBody:{values:[['UID','Ellenőrzés','Válasz','Időpont']]}}));
    }
    await sheetWrite(() => sheets.spreadsheets.values.append({spreadsheetId:book,
      range:`${quote(title)}!A:D`,valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',
      requestBody:{values:[[state.uid,code,normalized,new Date().toISOString()]]}}));
    return dashboardProject(state.uid);
  }

  async function allRows() {
    return googleCache.get(`rows:${book}`, 10000, async () => {
    const [rows, links] = await Promise.all([values(rowRange), folderLinks()]);
    return rows.map((row, index) => {
      const rowNumber = index + 2;
      if (links.has(rowNumber)) row[4] = links.get(rowNumber);
      return {row, rowNumber};
    })
      .filter(item => String(item.row[0] || '').trim());
    });
  }

  async function project(uid) {
    const normalized = String(uid || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,64}$/.test(normalized)) throw new Error('Érvénytelen projektazonosító.');
    const item = (await allRows()).find(entry => String(entry.row[0]).trim().toUpperCase() === normalized);
    if (!item) throw new Error('A projekt nem található.');
    return {...item, data: rowToData(item.row)};
  }

  async function createClientRecord() {
    const uid = crypto.randomUUID().replace(/-/g, '').toUpperCase();
    const row = Array(40).fill('');
    row[0] = uid;
    row[1] = new Date().toISOString();
    row[2] = 'ELŐKÉSZÍTÉS';
    row[3] = clientFormUrl(config.baseUrl, uid);
    row[6] = false;
    await sheetWrite(() => sheets.spreadsheets.values.append({spreadsheetId:book,
      range:`${quote(config.sheetName)}!A:AN`, valueInputOption:'RAW', insertDataOption:'INSERT_ROWS',
      requestBody:{values:[row]}}));
    googleCache.clear(`rows:${book}`);
    return {success:true, mode:'created', uid, url:row[3]};
  }

  async function createInquiry(data,photos=[]) {
    const uid=crypto.randomUUID().replace(/-/g,'').toUpperCase();
    const row=Array(40+OFFER_NAMES.length).fill('');
    const put=(key,value)=>{row[FIELDS.indexOf(key)]=value||'';};
    put('uid',uid);put('createdAt',new Date().toISOString());put('status','AJÁNLATKÉRÉS');
    put('clientLink',clientFormUrl(config.baseUrl,uid));put('language','hu');
    put('gdprAccepted',true);put('vezeteknev',data.lastName);put('keresztnev',data.firstName);
    put('telefon',data.phone);put('email',data.email);put('projektTipusStored',data.projectType);
    put('projekt_varos',data.city);put('projekt_kozterulet',data.street);
    put('projekt_hazszam',data.houseNumber);put('hrsz',data.parcelNumber);
    put('projektCim',[data.city,data.street,data.houseNumber||
      (data.parcelNumber?'hrsz '+data.parcelNumber:'')].filter(Boolean).join(' '));
    row[40+OFFER_NAMES.indexOf('projectDescription')]=data.description;
    await sheetWrite(() => sheets.spreadsheets.values.append({spreadsheetId:book,
      range:`${quote(config.sheetName)}!A:BM`,valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',
      requestBody:{values:[row]}}));
    googleCache.clear(`rows:${book}`);
    const warnings=[];
    try {await saveSubmission(uid,row,'customer',true);}
    catch (_) {warnings.push('A dashboard új beküldés jelzése nem készült el.');}
    let folder=null,dataSheet=null,photoCount=0;
    try {folder=await ensureProjectFolder(uid);}
    catch (_) {warnings.push('A projektmappa előkészítése nem sikerült.');}
    if(folder){
      try {dataSheet=await ensureProjectDataSheet(uid);}
      catch (_) {warnings.push('A tervezési adatlap előkészítése nem sikerült.');}
      try {
        const internal=(await listChildren(folder.id)).find(item=>
          item.mimeType==='application/vnd.google-apps.folder'&&item.name==='_Belső');
        if(!internal)throw Error('missing internal folder');
        await googleQuota.run('drive',100,() => drive.files.create({
          requestBody:{name:'Ajánlatkérés.txt',parents:[internal.id]},
          media:{mimeType:'text/plain',body:Readable.from([Buffer.from(
            inquiryText(data,uid,photos.length),'utf8')])},
          fields:'id',supportsAllDrives:true
        }));
        googleCache.clear(`children:${internal.id}`);
      } catch (_) {warnings.push('Az ajánlatkérés összefoglaló fájlja nem készült el.');}
      try {
          let target=(await listChildren(folder.id)).find(item=>
            item.mimeType==='application/vnd.google-apps.folder'&&item.name==='Kapott anyagok');
          if(!target){target=(await googleQuota.run('drive',100,()=>drive.files.create({
            requestBody:{name:'Kapott anyagok',mimeType:'application/vnd.google-apps.folder',
              parents:[folder.id]},fields:'id,name,mimeType',supportsAllDrives:true
          }))).data;googleCache.clear(`children:${folder.id}`);}
          for(const [index,photo] of photos.entries()){
            await googleQuota.run('drive',100,() => drive.files.create({
              requestBody:{name:`Helyszín-${String(index+1).padStart(2,'0')}.${photo.extension}`,
                parents:[target.id]},
              media:{mimeType:photo.mime,body:Readable.from([photo.bytes])},
              fields:'id',supportsAllDrives:true
            }));
            photoCount++;
          }
          googleCache.clear(`children:${target.id}`);
      } catch (_) {warnings.push('A Kapott anyagok mappa vagy néhány fotó nem készült el.');}
    }
    return {uid,prepared:Boolean(folder&&dataSheet),photoCount,warnings};
  }

  async function getClientData(uid) {
    return (await project(uid)).data;
  }

  async function submissionSheetExists() {
    return googleCache.get(`submission-tab:${book}`, 60000, async () => {
      const metadata = await sheetRead(() => sheets.spreadsheets.get({spreadsheetId:book,
        fields:'sheets(properties(title))'}));
      return (metadata.data.sheets || []).some(item => item.properties?.title === SUBMISSION_SHEET);
    });
  }

  async function ensureSubmissionSheet() {
    if (await submissionSheetExists()) return;
    try {
      await sheetWrite(() => sheets.spreadsheets.batchUpdate({spreadsheetId:book,
        requestBody:{requests:[{addSheet:{properties:{title:SUBMISSION_SHEET,hidden:true}}}]}}));
    } catch (error) {
      if (error.status === 429) throw error;
      googleCache.clear(`submission-tab:${book}`);
      if (!(await submissionSheetExists())) throw error;
    }
    await sheetWrite(() => sheets.spreadsheets.values.update({spreadsheetId:book,
      range:`${quote(SUBMISSION_SHEET)}!A1:G1`,valueInputOption:'RAW',
      requestBody:{values:[SUBMISSION_HEADERS]}}));
    googleCache.clear(`submission-tab:${book}`);
    googleCache.clear(`submission-rows:${book}`);
  }

  async function submissionRows() {
    if (!(await submissionSheetExists())) return [];
    return googleCache.get(`submission-rows:${book}`, 10000,
      () => values(`${quote(SUBMISSION_SHEET)}!A2:G`));
  }

  async function listClientSubmissions() {
    const states = {};
    for (const row of await submissionRows()) {
      const state = parseSubmission(row);
      if (state?.uid) states[state.uid] = state;
    }
    return states;
  }

  async function saveSubmission(uid, row, actor, sameNotificationAddress) {
    await ensureSubmissionSheet();
    const rows = await submissionRows();
    const position = rows.findIndex(item => String(item[0] || '').trim().toUpperCase() === uid);
    const previous = position < 0 ? null : parseSubmission(rows[position]);
    const now = new Date().toISOString();
    const complete = completeness({...rowToData(row),
      ertesitesi_same:sameNotificationAddress});
    const customer = actor === 'customer';
    const state = [uid, customer ? now : previous?.submittedAt || '',complete.status,
      JSON.stringify(complete.missing),customer ? '' : now,actor,now];
    if (position < 0) {
      await sheetWrite(() => sheets.spreadsheets.values.append({spreadsheetId:book,
        range:`${quote(SUBMISSION_SHEET)}!A:G`,valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',
        requestBody:{values:[state]}}));
    } else {
      await sheetWrite(() => sheets.spreadsheets.values.update({spreadsheetId:book,
        range:`${quote(SUBMISSION_SHEET)}!A${position+2}:G${position+2}`,valueInputOption:'RAW',
        requestBody:{values:[state]}}));
    }
    googleCache.clear(`submission-rows:${book}`);
    return {...parseSubmission(state),notifyOwner:customer &&
      (!previous?.submittedAt || previous.status === 'incomplete' && complete.status === 'complete')};
  }

  async function markClientSubmissionRead(uid) {
    const {data} = await project(uid);
    const rows = await submissionRows();
    const index = rows.findIndex(item => String(item[0] || '').trim().toUpperCase() === data.uid);
    if (index < 0) return submissionFor(data,null);
    const current = parseSubmission(rows[index]);
    if (!current.unread) return current;
    const seenAt = new Date().toISOString();
    await sheetWrite(() => sheets.spreadsheets.values.update({spreadsheetId:book,
      range:`${quote(SUBMISSION_SHEET)}!E${index+2}`,valueInputOption:'RAW',
      requestBody:{values:[[seenAt]]}}));
    googleCache.clear(`submission-rows:${book}`);
    return {...current,seenAt,unread:false};
  }

  async function saveClientData(input, actor = 'owner') {
    const uid = String(input?.uid || '').trim().toUpperCase();
    if (!uid) throw new Error('Előbb hozz létre egy ügyfélrekordot.');
    const {row:previous, rowNumber} = await project(uid);
    const row = buildClientRow(input, uid, previous, config.baseUrl);
    await sheetWrite(() => sheets.spreadsheets.values.batchUpdate({spreadsheetId:book,
      requestBody:{valueInputOption:'RAW', data:[
        {range:`${quote(config.sheetName)}!A${rowNumber}:D${rowNumber}`,values:[row.slice(0,4)]},
        {range:`${quote(config.sheetName)}!F${rowNumber}:AN${rowNumber}`,values:[row.slice(5,40)]}
      ]}}));
    googleCache.clear(`rows:${book}`);
    const submission = await saveSubmission(uid,row,actor,input.ertesitesi_same !== false);
    return {success:true, mode:'updated', uid, url:row[3],submission};
  }

  async function saveOffer(uid, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Az ajánlati adatok hiányoznak.');
    const values = OFFER_NAMES.map(key => {
      const value = String(input[key] ?? '').trim();
      if (value.length > (key === 'projectDescription' ? 10000 : 1000))
        throw new Error('Túl hosszú ajánlati adat: ' + key);
      return value;
    });
    for (const key of ['deadline5','deadline6','deadline7','deadline8']) {
      const value = String(input[key] || '').trim();
      if (value && (!/^\d+$/.test(value) || Number(value) > 3650))
        throw new Error('A szakaszhatáridő egész napokban adható meg.');
    }
    if (!String(input.currency || '').trim() || !String(input.currencyLong || '').trim())
      throw new Error('A deviza rövid és hosszú nevét is add meg.');
    const {rowNumber} = await project(uid);
    await sheetWrite(() => sheets.spreadsheets.values.update({spreadsheetId:book,
      range:`${quote(config.sheetName)}!AO${rowNumber}:BL${rowNumber}`,
      valueInputOption:'RAW',requestBody:{values:[values]}}));
    googleCache.clear(`rows:${book}`);
    return dashboardProject(uid);
  }

  function checkedTimelineDate(dateText) {
    if (typeof dateText !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateText))
      throw new Error('Érvénytelen dátum.');
    const date = new Date(dateText + 'T12:00:00Z');
    const today = Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Budapest',
      year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())
      .filter(item => ['year','month','day'].includes(item.type)).map(item => [item.type,item.value]));
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== dateText ||
        dateText > `${today.year}-${today.month}-${today.day}`)
      throw new Error('A dátum nem lehet hibás vagy jövőbeli.');
    return date.toISOString();
  }

  async function setStartDate(uid, dateText, contractDateText = dateText) {
    const stamp = checkedTimelineDate(dateText);
    const contractStamp = checkedTimelineDate(contractDateText);
    const state = await dashboardProject(uid);
    if (state.stage !== 'started' && state.stage !== 'closed')
      throw new Error('Indítási dátum csak elindított projektnél adható meg.');
    const title = '_ProjektIdővonal';
    const metadata = await sheetRead(() => sheets.spreadsheets.get({spreadsheetId:book,
      fields:'sheets(properties(title))'}));
    if (!(metadata.data.sheets || []).some(item => item.properties?.title === title)) {
      await sheetWrite(() => sheets.spreadsheets.batchUpdate({spreadsheetId:book,
        requestBody:{requests:[{addSheet:{properties:{title,hidden:true}}}]}}));
      await sheetWrite(() => sheets.spreadsheets.values.update({spreadsheetId:book,
        range:`'${title}'!A1:C1`,valueInputOption:'RAW',
        requestBody:{values:[['UID','Indítás időpontja','Szerződés dátuma']]}}));
    }
    const rows = await values(`'${title}'!A2:A`);
    const index = rows.findIndex(row => String(row[0] || '').trim().toUpperCase() === state.uid);
    if (index < 0) await sheetWrite(() => sheets.spreadsheets.values.append({spreadsheetId:book,
      range:`'${title}'!A:C`,valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',
      requestBody:{values:[[state.uid,stamp,contractStamp]]}}));
    else await sheetWrite(() => sheets.spreadsheets.values.update({spreadsheetId:book,
      range:`'${title}'!B${index+2}:C${index+2}`,valueInputOption:'RAW',
      requestBody:{values:[[stamp,contractStamp]]}}));
    return dashboardProject(uid);
  }

  async function file(id) {
    return googleCache.get(`file:${id}`, 30000, async () =>
      (await driveRead(5, () => drive.files.get({fileId: id,
        fields: 'id,name,mimeType,webViewLink,parents,size', supportsAllDrives: true}))).data);
  }

  async function archiveLocation(folder) {
    const parent=folder.parents?.[0]?await file(folder.parents[0]):null;
    if(['_Elkészült','_Lezárt'].includes(parent?.name))
      return {parent,archived:true,yearFolder:false};
    if(/^\d{4}$/.test(parent?.name||'')&&parent.parents?.[0]){
      const archive=await file(parent.parents[0]);
      if(archive.name==='_Lezárt')return {parent,archived:true,yearFolder:true};
    }
    return {parent,archived:false,yearFolder:false};
  }

  async function listChildren(parentId) {
    return googleCache.get(`children:${parentId}`, 10000, async () => {
    const files = [];
    let pageToken;
    do {
      const result = (await driveRead(100, () => drive.files.list({
        q: `'${parentId}' in parents and trashed = false`,
        fields: 'nextPageToken,files(id,name,mimeType,webViewLink,parents,size,modifiedTime,ownedByMe,appProperties)',
        pageSize: 1000, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true
      }))).data;
      files.push(...result.files || []);
      pageToken = result.nextPageToken;
    } while (pageToken && files.length < 3000);
    return files;
    });
  }

  async function ensureProjectFolder(uid) {
    const {data, rowNumber} = await project(uid);
    const subfolders = ['írásos','_Belső','PDFA','DWG','Adat társtervezőktől','PLN','Render'];
    let folder = null;
    const existingId = extractDriveId(data.projectFolderUrl);
    if (existingId) {
      try {folder = await file(existingId);}
      catch (error) {if (error.status === 429) throw error;}
    }
    if (!folder) {
      const inquiry=data.status==='AJÁNLATKÉRÉS';
      const inquiryDate=inquiry?inquiryDateStamp(data.createdAt):'';
      if(inquiry&&!inquiryDate)
        throw new Error('Az ajánlatkérés dátuma hiányzik; a projektmappa neve nem állítható elő.');
      const baseName = [data.projekt_varos,data.projekt_kozterulet,data.projekt_tipus,
        data.projekt_hazszam||(data.hrsz?'hrsz '+data.hrsz:'')]
        .map(value => String(value || '').trim()).filter(Boolean).join(' ').replace(/\s+/g,' ');
      const name=inquiry?`${baseName} ${inquiryDate}`:baseName;
      if (!data.projekt_varos || !(data.projekt_kozterulet&&data.projekt_hazszam)&&!data.hrsz)
        throw new Error('A projektmappa létrehozásához település és teljes cím vagy helyrajzi szám szükséges.');
      const template = await file(config.templateRootFolderId);
      const parentId = template.parents?.[0];
      if (!parentId) throw new Error('A sablonmappa szülőmappája nem érhető el.');
      const siblings=await listChildren(parentId);
      folder=siblings.find(item=>item.mimeType==='application/vnd.google-apps.folder'&&
        item.appProperties?.projectUid===uid);
      if(!folder&&!inquiry)folder=siblings.find(item=>
        item.mimeType==='application/vnd.google-apps.folder'&&item.name===name);
      if (!folder) {
        let uniqueName=name;
        if(inquiry){let number=2;while(siblings.some(item=>
          item.mimeType==='application/vnd.google-apps.folder'&&item.name===uniqueName))
          uniqueName=`${name}#${number++}`;}
        folder = (await googleQuota.run('drive',100,() => drive.files.create({
          requestBody:{name:uniqueName,mimeType:'application/vnd.google-apps.folder',
            parents:[parentId],...(inquiry?{appProperties:{projectUid:uid}}:{})},
          fields:'id,name,mimeType,parents,webViewLink,appProperties',supportsAllDrives:true
        }))).data;
        googleCache.clear(`children:${parentId}`);
      }
    }
    const children = await listChildren(folder.id);
    for (const name of subfolders) {
      if (children.some(item => item.mimeType === 'application/vnd.google-apps.folder' && item.name === name))
        continue;
      await googleQuota.run('drive',100,() => drive.files.create({
        requestBody:{name,mimeType:'application/vnd.google-apps.folder',parents:[folder.id]},
        fields:'id',supportsAllDrives:true
      }));
      googleCache.clear(`children:${folder.id}`);
    }
    const url = `https://drive.google.com/drive/folders/${folder.id}`;
    if (existingId !== folder.id) {
      const metadata = await sheetRead(() => sheets.spreadsheets.get({spreadsheetId:book,
        fields:'sheets(properties(sheetId,title))'}));
      const sheetId = (metadata.data.sheets || []).find(item => item.properties?.title === config.sheetName)?.properties?.sheetId;
      if (sheetId == null) throw new Error('Az Adatok munkalap nem található.');
      await sheetWrite(() => sheets.spreadsheets.batchUpdate({spreadsheetId:book,
        requestBody:{requests:[{updateCells:{start:{sheetId,rowIndex:rowNumber-1,columnIndex:4},
          rows:[{values:[{userEnteredValue:{stringValue:'Projekt mappa'},
            textFormatRuns:[{startIndex:0,format:{link:{uri:url}}}]}]}],
          fields:'userEnteredValue,textFormatRuns'}}]}}));
      googleCache.clear(`rows:${book}`);
    }
    return {id:folder.id, name:folder.name, url};
  }

  async function ensureProjectDataSheet(uid) {
    const folder = await ensureProjectFolder(uid);
    const rootChildren = await listChildren(folder.id);
    const written = rootChildren.find(item => item.mimeType === 'application/vnd.google-apps.folder' &&
      item.name === 'írásos');
    if (!written) throw new Error('A projekt írásos mappája nem található.');
    const writtenChildren = await listChildren(written.id);
    const candidates = [...rootChildren, ...writtenChildren].filter(item =>
      item.mimeType === 'application/vnd.google-apps.spreadsheet' &&
      /^Tervezési adatok(?:\s|\s*-)/i.test(item.name));
    if (candidates.length > 1) throw new Error('Több „Tervezési adatok” Sheet található a projektmappában.');
    let sheet = candidates[0];
    if (!sheet) {
      sheet = (await googleQuota.run('drive',100,() => drive.files.copy({
        fileId:config.projectDataTemplateId, requestBody:{name:`Tervezési adatok - ${folder.name}`,
          parents:[written.id]}, fields:'id,name,mimeType,webViewLink,parents',supportsAllDrives:true
      }))).data;
      googleCache.clear(`children:${written.id}`);
    }
    const metadata = await sheetRead(() => sheets.spreadsheets.get({spreadsheetId:sheet.id,
      fields:'sheets(properties(sheetId,title))'}));
    if (!(metadata.data.sheets || []).some(item => item.properties?.title === FIELD_SHEET)) {
      await sheetWrite(() => sheets.spreadsheets.batchUpdate({spreadsheetId:sheet.id,
        requestBody:{requests:[{addSheet:{properties:{title:FIELD_SHEET,
          gridProperties:{frozenRowCount:1}}}}]}}));
      await sheetWrite(() => sheets.spreadsheets.values.update({spreadsheetId:sheet.id,
        range:`'${FIELD_SHEET}'!A1:C${fieldSheetRows().length}`,valueInputOption:'RAW',
        requestBody:{values:fieldSheetRows()}}));
    }
    const controlId = (metadata.data.sheets || []).find(item => item.properties?.title === 'Generálás')?.properties?.sheetId;
    if (controlId != null) await googleCache.get(`dashboard-link:${sheet.id}:${uid}`,300000,async () => {
      const dashboardUrl = `${config.baseUrl}/dashboard?project=${encodeURIComponent(uid)}`;
      await sheetWrite(() => sheets.spreadsheets.batchUpdate({spreadsheetId:sheet.id,
        requestBody:{requests:[{updateCells:{start:{sheetId:controlId,rowIndex:5,columnIndex:0},
          rows:[{values:[{userEnteredValue:{stringValue:'Projekt dashboard'}},
            {userEnteredValue:{stringValue:'Dashboard megnyitása'},
              textFormatRuns:[{startIndex:0,format:{link:{uri:dashboardUrl}}}]}]}],
          fields:'userEnteredValue,textFormatRuns'}}]}}));
      return true;
    });
    return {id:sheet.id,url:sheet.webViewLink || `https://docs.google.com/spreadsheets/d/${sheet.id}/edit`};
  }

  async function getTechnicalFields(uid) {
    const sheet = await ensureProjectDataSheet(uid);
    const rows = await ensureTechnicalFieldRows(sheet.id);
    const current = new Map(rows.map(row =>
      [String(row[0] || '').trim(),String(row[1] || '')]));
    return {sheetUrl:sheet.url,aiConfigured:Boolean(process.env.GEMINI_API_KEY),
      autoChapters:AUTO_CHAPTERS,
      fields:MANUAL_FIELDS.map(([key,help]) => ({
      key,help,value:current.get(key) || ''
    }))};
  }

  async function ensureTechnicalFieldRows(sheetId) {
    const read = async () => (await sheetRead(() => sheets.spreadsheets.values.get({
      spreadsheetId:sheetId,range:`'${FIELD_SHEET}'!A2:C`,
      valueRenderOption:'FORMATTED_VALUE'
    }))).data.values || [];
    const rows = await read();
    const existing = new Set(rows.map(row => String(row[0] || '').trim()));
    const missing = MANUAL_FIELDS.filter(([key]) => !existing.has(key));
    if (!missing.length) return rows;
    await sheetWrite(() => sheets.spreadsheets.values.append({spreadsheetId:sheetId,
      range:`'${FIELD_SHEET}'!A:C`,valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',
      requestBody:{values:missing.map(([key,help]) => [key,'',help])}}));
    return read();
  }

  async function saveTechnicalFields(uid,input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('A műszaki adatok hiányoznak.');
    const allowed = new Set(MANUAL_FIELDS.map(([key]) => key));
    if (Object.keys(input).some(key => !allowed.has(key)))
      throw new Error('Ismeretlen műszaki mező.');
    const sheet = await ensureProjectDataSheet(uid);
    const rows = await ensureTechnicalFieldRows(sheet.id);
    const positions = new Map(rows.map((row,index) =>
      [String(row[0] || '').trim(),index+2]));
    for (const [key] of MANUAL_FIELDS) if (!positions.has(key))
      throw new Error('A műszaki adatlap hiányos: '+key);
    const data = [];
    for (const [key] of MANUAL_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(input,key)) continue;
      const value = String(input[key] ?? '').trim();
      if (value.length > 50000 || /\{\{[^{}]+\}\}/.test(value))
        throw new Error('Érvénytelen vagy túl hosszú műszaki adat: '+key);
      validateTechnicalField(key,value);
      data.push({range:`'${FIELD_SHEET}'!B${positions.get(key)}`,values:[[value]]});
    }
    if (data.length) await sheetWrite(() => sheets.spreadsheets.values.batchUpdate({
      spreadsheetId:sheet.id,requestBody:{valueInputOption:'RAW',data}
    }));
    return getTechnicalFields(uid);
  }

  async function draftTechnicalText(uid,input) {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) throw new Error('A Gemini API-kulcs nincs beállítva a Railway Variables között.');
    const notes = draftInputs(input);
    const {data} = await project(uid);
    const sheet = await ensureProjectDataSheet(data.uid);
    const response = await sheetRead(() => sheets.spreadsheets.values.get({
      spreadsheetId:sheet.id,range:"'Munkalap1'!A1:M20",valueRenderOption:'FORMATTED_VALUE'
    }));
    const sheetValues = technicalSheetValues(response.data.values || []);
    const model = String(process.env.GEMINI_TECHNICAL_MODEL || process.env.GEMINI_AUDIO_MODEL || 'gemini-2.5-flash');
    if (!/^[A-Za-z0-9._-]{3,80}$/.test(model)) throw new Error('Érvénytelen Gemini modellnév.');
    let answer;
    try {
      answer = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
        method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
        signal:AbortSignal.timeout(60000),
        body:JSON.stringify({contents:[{parts:[{text:draftPrompt({notes,sheetValues,
          projectType:data.projektTipus})}]}],generationConfig:{temperature:0.2,maxOutputTokens:8192,
          responseMimeType:'application/json',responseSchema:{type:'OBJECT',properties:{
            sections:{type:'ARRAY',items:{type:'OBJECT',properties:{
              key:{type:'STRING'},text:{type:'STRING'}},required:['key','text']}}
          },required:['sections']}}})
      });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError')
        throw new Error('Az AI-tervezet időtúllépés miatt nem készült el.');
      throw new Error('Az AI-tervezet szolgáltatása nem érhető el.');
    }
    if (!answer.ok) throw new Error('Az AI-tervezet nem készült el (HTTP '+answer.status+').');
    const result = parseDraftResult(await answer.json(),notes);
    return {sections:result,model};
  }

  // Egyszerű AI-chat a műszaki adatlap felett: a beírt megjegyzés alapján a
  // meglévő fejezetszövegek fogalmazódnak újra. A válasz nem mentődik el; a
  // felület tölti a mezőkbe, és a megszokott mentés rögzíti.
  async function technicalChat(uid,input) {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) throw new Error('A chat nem használható: a GEMINI_API_KEY nincs beállítva a Railway Variables között.');
    const fields = await getTechnicalFields(uid);
    const current = Object.fromEntries(fields.fields.map(field => [field.key,field.value]));
    const {message,notes} = chatInput(input,current);
    const {data} = await project(uid);
    const model = String(process.env.GEMINI_TECHNICAL_MODEL || process.env.GEMINI_AUDIO_MODEL || 'gemini-2.5-flash');
    if (!/^[A-Za-z0-9._-]{3,80}$/.test(model)) throw new Error('Érvénytelen Gemini modellnév.');
    let answer;
    try {
      answer = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
        method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
        signal:AbortSignal.timeout(60000),
        body:JSON.stringify({contents:[{parts:[{text:chatPrompt({message,notes,
          projectType:data.projektTipus})}]}],generationConfig:{temperature:0.3,maxOutputTokens:8192,
          responseMimeType:'application/json',responseSchema:{type:'OBJECT',properties:{
            reply:{type:'STRING'},sections:{type:'ARRAY',items:{type:'OBJECT',properties:{
              key:{type:'STRING'},text:{type:'STRING'}},required:['key','text']}}
          },required:['reply','sections']}}})
      });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError')
        throw new Error('A chat válasza időtúllépés miatt nem készült el.');
      throw new Error('A chat szolgáltatása nem érhető el.');
    }
    if (!answer.ok) throw new Error('A chat nem készült el (HTTP '+answer.status+').');
    const result = parseChatResult(await answer.json(),notes);
    return {reply:result.reply,sections:result.sections,model};
  }

  // MARK: A teljes műszaki leírás automatikus előállítása
  // A rendelkezésre álló tényszerű projektadatokból fejezetszövegek készülnek,
  // azok a műszaki adatlapra mentődnek, majd ebből létrejön a DRAFT dokumentum.
  // Egy részadat hibája nem állítja meg a folyamatot: figyelmeztetés lesz belőle,
  // a hiányzó adat helyén [KIEGÉSZÍTENDŐ: ...] jelölés marad.
  async function generateTechnicalDocument(uid) {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) throw new Error('Az AI-szöveg nem készíthető el: a GEMINI_API_KEY nincs beállítva a Railway Variables között. Állítsd be a kulcsot, majd indítsd újra a szolgáltatást.');
    const model = String(process.env.GEMINI_TECHNICAL_MODEL || process.env.GEMINI_AUDIO_MODEL || 'gemini-2.5-flash');
    if (!/^[A-Za-z0-9._-]{3,80}$/.test(model))
      throw new Error('Az AI-szöveg nem készíthető el: a GEMINI_TECHNICAL_MODEL beállítás érvénytelen. Csak betű, szám, pont, kötőjel és aláhúzás használható, 3–80 karakter között (például gemini-2.5-flash).');
    const {data} = await project(uid);
    if (!extractDriveId(data.projectFolderUrl))
      throw new Error('A műszaki leírás nem készíthető el: a projektmappa még nem jött létre. Nyisd meg az 1. lépést, hozd létre a projektmappát, majd indítsd újra a szövegezést.');
    const warnings = [];
    const warn = message => {
      const text = String(message || '').trim().slice(0,500);
      if (text && !warnings.includes(text)) warnings.push(text);
    };
    let parts = [];
    try {
      const sheet = await ensureProjectDataSheet(data.uid);
      await ensureTechnicalFieldRows(sheet.id);
      const inputs = await sheetRead(() => sheets.spreadsheets.values.batchGet({
        spreadsheetId:sheet.id,
        ranges:["'Munkalap1'!A1:M20","'Tervezési program'!A2:B17",`'${FIELD_SHEET}'!A2:B`,
          "'Rétegrend sablonok'!A1:C400"],
        valueRenderOption:'FORMATTED_VALUE'
      }));
      parts = inputs.data.valueRanges || [];
    } catch (error) {
      if (error.status === 429) throw error;
      warn('A tervezési adatlap adatai nem olvashatók: '+error.message);
    }
    let sheetValues = {};
    try { sheetValues = technicalSheetValues(parts[0]?.values || []); }
    catch (error) { warn('A tervezési adatlap számai nem használhatók: '+error.message); }
    const program = (parts[1]?.values || []).map(row =>
      String(row?.[1] ?? '').replace(/\{\{[^{}]+\}\}/g,' ').trim()).filter(Boolean);
    let manual = {};
    try { manual = manualValues(parts[2]?.values || []); }
    catch (error) { warn('A műszaki adatlap szövegei nem olvashatók: '+error.message); }
    let plans = [], roomData = null, roomText = '', retegrend = null, projectChildren = [];
    try {
      const projectFolder = await ensureProjectFolder(data.uid);
      projectChildren = await listChildren(projectFolder.id);
      const children = projectChildren;
      // Első lépés: a Metszetek tervlap rétegrendjei. Innen származik a fal,
      // a födém és a fedélszerkezet anyaga és vastagsága.
      retegrend = await metszetFacts(children,parts[3]?.values || [],warn);
      const folderNamed = name => children.find(item =>
        item.mimeType === 'application/vnd.google-apps.folder' &&
        String(item.name || '').trim().toLowerCase() === name);
      const pdfa = folderNamed('pdfa');
      plans = pdfa ? (await listChildren(pdfa.id)).filter(item =>
        item.mimeType === 'application/pdf' || /\.pdf$/i.test(item.name)).map(item => {
        const name = String(item.name || '').replace(/[\r\n\t]+/g,' ').trim();
        return {name,scale:planScale(name)};
      }) : [];
      const pln = folderNamed('pln');
      if (pln) {
        const roomFile = (await listChildren(pln.id)).find(item =>
          /^(?:helyiségek|helyiséglista)\.txt$/i.test(item.name));
        if (!roomFile) warn('A PLN mappában nincs helyiségek.txt vagy helyiséglista.txt, ezért a helyiséglista nem kerül a szövegbe. A fejezeteknél [KIEGÉSZÍTENDŐ: …] jelölés marad.');
        else if (Number(roomFile.size || 0) > 2*1024*1024)
          warn('A PLN helyiséglista (PLN/'+roomFile.name+') meghaladja a 2 MB-ot, ezért nem dolgozható fel. Oszd fel vagy tölts fel kisebb fájlt.');
        else {
          const response = await googleQuota.run('drive',100, () => drive.files.get({
            fileId:roomFile.id,alt:'media',supportsAllDrives:true},{responseType:'arraybuffer'}));
          roomText = Buffer.from(response.data).toString('utf8');
          try { roomData = parseRoomText(roomText,'PLN/'+roomFile.name); }
          catch (error) {
            if (error.status === 429) throw error;
            warn(error.message+' A szöveg a nyers lista alapján, a helyiséglista-jelölés mellett készül el.');
          }
        }
      }
    } catch (error) {
      if (error.status === 429) throw error;
      warn('A projektmappa tartalma nem olvasható: '+error.message);
    }
    const planFacts = {};
    const floors = floorCount(roomData,plans);
    if (floors) planFacts['Alaprajz tervlapok száma'] = String(floors);
    const bedrooms = bedroomCount(roomData);
    if (bedrooms) planFacts['Hálószobák száma'] = String(bedrooms);
    if (roomData) planFacts['Iroda a bejárat közelében'] = hasOffice(roomData) ?
      'igen – a helyiséglistában iroda/dolgozó szerepel' :
      'nem – a helyiséglistában nincs iroda/dolgozó';
    const facts = autoFacts({data,sheetValues,program,roomData,roomText,plans,manual,
      retegrend,planFacts});
    let sections = {};
    try {
      const answer = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
        method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
        signal:AbortSignal.timeout(90000),
        body:JSON.stringify({contents:[{parts:[{text:autoPrompt({facts,chapters:AUTO_CHAPTERS,
          projectType:data.projektTipus})}]}],generationConfig:{temperature:0.2,maxOutputTokens:16384,
          responseMimeType:'application/json',responseSchema:{type:'OBJECT',properties:{
            sections:{type:'ARRAY',items:{type:'OBJECT',properties:{
              key:{type:'STRING'},text:{type:'STRING'}},required:['key','text']}}
          },required:['sections']}}})
      });
      if (!answer.ok) throw new Error('a szolgáltatás HTTP '+answer.status+' hibát adott'+
        (answer.status===429?' (átmeneti túlterhelés)':''));
      sections = parseAutoResult(await answer.json(),AUTO_CHAPTERS);
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError')
        warn('Az AI-szöveg 90 másodpercen belül nem készült el. A dokumentum a hiányjelölésekkel most is elkészül; később újraszövegezhető.');
      else
        warn('Az AI-szöveg nem készült el: '+(error.message||String(error))+
          '. A dokumentum a hiányzó részek jelölésével most is elkészül, és később újraszövegezhető.');
    }
    let saved = null;
    if (Object.keys(sections).length) {
      try { saved = await saveTechnicalFields(data.uid,sections); }
      catch (error) {
        if (error.status === 429) throw error;
        warn('A fejezetszövegek mentése nem sikerült: '+error.message);
      }
    }
    // A hosszú fejezetszövegek (tűzvédelem, szerkezetek, rétegrendek, tervezői
    // nyilatkozat) alapértéke a sablonból, a projekt adataival kitöltve kerül a
    // felületre – csak akkor, ha a mező még üres.
    try {
      const templateDoc = (await googleQuota.run('docsRead',1,() => docs.documents.get({
        documentId:DOCUMENT_TEMPLATES.muszakiLeiras.templateId,includeTabsContent:false
      }))).data;
      const computed = technicalReplacements({project:data,sheetRows:parts[0]?.values || [],
        programRows:parts[1]?.values || [],fieldRows:parts[2]?.values || [],pdfFiles:plans,
        roomData,plans,textTemplates:textTemplates(templateDoc),
        extraValues:{...retegrendValues(retegrend),
          RETEGRENDEK_JOVAHAGYOTT_SZOVEG:(retegrend?.lines || []).join('\n')}},warnings);
      const defaults = {};
      for (const key of CHAPTER_KEYS)
        if (!String(manual[key] || '').trim() && String(computed[key] || '').trim())
          defaults[key] = computed[key];
      if (Object.keys(defaults).length) await saveTechnicalFields(data.uid,defaults);
    } catch (error) {
      if (error.status === 429) throw error;
      warn('A fejezetszövegek alapértékének előállítása nem sikerült: '+
        (error.message||String(error)));
    }
    let document;
    try { document = await ensureDocument(data.uid,'muszakiLeiras'); }
    catch (error) {
      throw new Error('A műszaki leírás dokumentuma nem készült el: '+(error.message||String(error))+
        (warnings.length?' Közben: '+warnings.join(' '):''));
    }
    for (const warning of document.warnings || []) warn(warning);
    const hasText = Object.keys(sections).length > 0;
    const base = document.created
      ? (hasText ? 'A nyers műszaki leírás és a fejezetszövegek elkészültek.'
        : 'A nyers műszaki leírás elkészült, de az AI-szöveg most nem készült el.')
      : (hasText ? 'A fejezetszövegek elkészültek, és a meglévő műszaki leírás frissült.'
        : 'A meglévő műszaki leírás frissült, de az AI-szöveg most nem készült el.');
    const storedValue = key => Object.prototype.hasOwnProperty.call(sections,key)
      ? sections[key]
      : (saved?.fields.find(field => field.key === key)?.value || '');
    return {message:base+(warnings.length?' Figyelem: '+warnings.join(' '):''),
      url:document.url,created:document.created,model,sections,warnings,
      chapters:AUTO_CHAPTERS.map(item => ({key:item.key,title:item.title,
        value:storedValue(item.key)})),
      project:await dashboardProject(data.uid)};
  }

  // MARK: A címlapkép cseréje a legfrissebb rendercsomagból
  // A Docs API a képet szerveroldalon, hitelesítés nélkül tölti le, ezért a render
  // fájlnak a csere pillanatában nyilvánosan olvashatónak kell lennie. Ezért rövid
  // idejű „anyone with link” olvasási jogot adunk, majd a csere után azonnal
  // visszavonjuk. Az elhelyezett címlapkép méretét és pozícióját a replaceImage megtartja.
  async function refreshTechnicalCoverImage(uid, documentId) {
    const folder = await ensureProjectFolder(uid);
    const render = (await listChildren(folder.id)).find(item =>
      item.mimeType === 'application/vnd.google-apps.folder' &&
      /^render$/i.test(String(item.name || '')));
    if (!render) return false;
    const files = (await listChildren(render.id)).map(item => ({id:item.id, name:item.name,
      mimeType:item.mimeType, modifiedTime:item.modifiedTime}));
    const cover = latestRenderCoverFile(files);
    if (!cover) return false;
    const document = (await googleQuota.run('docsRead', 1, () => docs.documents.get({
      documentId, includeTabsContent:false
    }))).data;
    const target = coverImageObject(document);
    const permission = (await googleQuota.run('drive', 100, () => drive.permissions.create({
      fileId: cover.id, supportsAllDrives: true,
      requestBody: {role:'reader', type:'anyone'}
    }))).data;
    try {
      await googleQuota.run('docsWrite', 1, () => docs.documents.batchUpdate({documentId,
        requestBody: {requests:[coverImageRequest(target.objectId, publicImageUrl(cover.id))]}}));
    } finally {
      if (permission?.id) await googleQuota.run('drive', 100, () => drive.permissions.delete({
        fileId: cover.id, permissionId: permission.id, supportsAllDrives: true
      })).catch(() => {});
    }
    return true;
  }

  // A rétegrendek forrása a Metszetek tervlap. Ez a generálás első lépése: a
  // szöveget itt olvassuk ki, és a fal/födém/fedélszerkezet adatait minden
  // későbbi fejezet innen kapja. Ha a PDF nem olvasható, figyelmeztetés és
  // hiányjelölés lesz – adatot nem találunk ki.
  async function metszetTexts(children, warn = () => {}) {
    const pdfa = (children || []).find(item =>
      item.mimeType === 'application/vnd.google-apps.folder' && /^pdfa$/i.test(item.name));
    if (!pdfa) {
      warn('A PDFA mappa hiányzik, ezért a rétegrendek a Metszetek tervlap nélkül, '+
        'a „Rétegrend sablonok” munkalapról készülnek.');
      return [];
    }
    let files = [];
    try {
      files = (await listChildren(pdfa.id)).filter(item =>
        /\.pdf$/i.test(item.name) && /metszet/i.test(item.name));
    } catch (error) {
      if (error.status === 429) throw error;
      warn('A Metszetek tervlap nem kereshető ki: '+(error.message||String(error)));
      return [];
    }
    if (!files.length) {
      warn('A PDFA mappában nincs Metszetek tervlap, ezért a rétegrendek a '+
        '„Rétegrend sablonok” munkalapról készülnek.');
      return [];
    }
    const texts = [];
    for (const item of files.slice(0,2)) {
      if (Number(item.size || 0) > 25*1024*1024) {
        warn('A Metszetek tervlap 25 MB-nál nagyobb ('+item.name+'), ezért a szövege '+
          'nem olvasható ki.');
        continue;
      }
      try {
        const response = await googleQuota.run('drive',100,() => drive.files.get({
          fileId:item.id,alt:'media',supportsAllDrives:true},{responseType:'arraybuffer'}));
        const text = await pdfToText(Buffer.from(response.data));
        if (text.trim()) texts.push({name:item.name,text});
        else warn('A Metszetek tervlapból ('+item.name+') nem olvasható szöveg; a '+
          'rétegrendek a munkalapról készülnek.');
      } catch (error) {
        if (error.status === 429) throw error;
        warn('A Metszetek tervlap szövege nem olvasható ('+(error.message||String(error))+
          '); a rétegrendek a „Rétegrend sablonok” munkalapról készülnek.');
      }
    }
    return texts;
  }

  async function metszetFacts(children, sheetRows, warn) {
    const planTexts = await metszetTexts(children, warn);
    return retegrendFacts({sheetRows,planTexts});
  }

  async function ensureDocument(uid, type) {
    const template = DOCUMENT_TEMPLATES[type];
    if (!template) throw new Error('Ismeretlen vagy még nem átültetett dokumentumtípus.');
    const {data,row} = await project(uid);
    const headers = (await values(`${quote(config.sheetName)}!AO1:BM1`))[0] || [];
    const extras = {};
    headers.forEach((header,index) => {
      const name = String(header || '').trim();
      if (name && !(name in extras)) extras[name] = String(row[40+index] || '');
    });
    let mergeValues = documentValues(data,extras);
    const source = (await googleQuota.run('docsRead',1,() => docs.documents.get({
      documentId:template.templateId,includeTabsContent:false
    }))).data;
    // A dokumentum összeállítása nem állhat meg egy részadat hibájától: a hiba
    // figyelmeztetés lesz, a hiányzó helyen pedig [KIEGÉSZÍTENDŐ: ...] jelölés marad.
    const warnings = [];
    const warn = message => {
      const text = String(message || '').trim().slice(0,500);
      if (text && !warnings.includes(text)) warnings.push(text);
    };
    if (type === 'muszakiLeiras') {
      let dataSheet = null;
      let parts = [];
      try {
        dataSheet = await ensureProjectDataSheet(uid);
        await ensureTechnicalFieldRows(dataSheet.id);
        const inputs = await sheetRead(() => sheets.spreadsheets.values.batchGet({
          spreadsheetId:dataSheet.id,
          ranges:["'Munkalap1'!A1:J20","'Tervezési program'!A2:B17",
            `'${FIELD_SHEET}'!A2:B`,"'Munkalap2'!A1:B500",
            "'Rétegrend sablonok'!A1:C400"],
          valueRenderOption:'FORMATTED_VALUE'
        }));
        parts = inputs.data.valueRanges || [];
      } catch (error) {
        if (error.status === 429) throw error;
        dataSheet = null;
        warn('A tervezési adatlap adatai nem olvashatók ('+(error.message||String(error))+
          '). A dokumentum a korábban mentett és a kézzel megadott adatokkal készül el.');
      }
      let projectChildren = [];
      try {
        const projectFolder = await ensureProjectFolder(uid);
        projectChildren = await listChildren(projectFolder.id);
      } catch (error) {
        if (error.status === 429) throw error;
        warn('A projektmappa tartalma nem olvasható ('+(error.message||String(error))+
          '). A tervjegyzék és az iratjegyzék a korábbi adatokból készül.');
      }
      let pdfFiles = [], writtenFiles = [];
      try {
        const pdfFolder = projectChildren.find(item =>
          item.mimeType === 'application/vnd.google-apps.folder' && item.name === 'PDFA');
        pdfFiles = pdfFolder ? (await listChildren(pdfFolder.id)).filter(item =>
          item.mimeType === 'application/pdf' || /\.pdf$/i.test(item.name)) : [];
        const writtenFolder = projectChildren.find(item =>
          item.mimeType === 'application/vnd.google-apps.folder' && /^írásos$/i.test(item.name));
        writtenFiles = writtenFolder ? await listChildren(writtenFolder.id) : [];
      } catch (error) {
        if (error.status === 429) throw error;
        warn('A PDFA vagy az Írásos mappa tartalma nem olvasható ('+(error.message||String(error))+
          '). A tervjegyzék és az iratjegyzék hiányos lehet.');
      }
      let roomData = null;
      // A rétegrendek a generálás első lépése: a Metszetek tervlap szövege és a
      // „Rétegrend sablonok” munkalap együtt adja a fal/födém/fedélszerkezet
      // anyagát és vastagságát.
      const retegrend = await metszetFacts(projectChildren,parts[4]?.values || [],warn);
      const plnFolder = projectChildren.find(item =>
        item.mimeType === 'application/vnd.google-apps.folder' && /^pln$/i.test(item.name));
      if (plnFolder) {
        try {
          const matches = (await listChildren(plnFolder.id)).filter(item =>
            /^(?:helyiségek|helyiséglista)\.txt$/i.test(item.name));
          const preferred = matches.filter(item => /^helyiségek\.txt$/i.test(item.name));
          if (preferred.length > 1 || (!preferred.length && matches.length > 1))
            warn('A PLN mappában több helyiséglista szövegfájl van. A rendszer a(z) „'+
              ((preferred[0] || matches[0])?.name || 'helyiségek.txt')+'” fájlt használja; '+
              'a többit töröld vagy nevezd át, hogy egyértelmű legyen a forrás.');
          const roomFile = preferred[0] || matches[0];
          if (roomFile) {
            if (Number(roomFile.size || 0) > 2*1024*1024)
              warn('A PLN/'+roomFile.name+' meghaladja a 2 MB-ot, ezért a helyiséglista nem kerül a szövegbe. '+
                'Tölts fel egy 2 MB-nál kisebb fájlt; a helyén [KIEGÉSZÍTENDŐ: …] jelölés marad.');
            else {
              const response = await googleQuota.run('drive',100,() => drive.files.get({
                fileId:roomFile.id,alt:'media',supportsAllDrives:true},{responseType:'arraybuffer'}));
              roomData = parseRoomText(Buffer.from(response.data).toString('utf8'),
                'PLN/'+roomFile.name);
            }
          } else
            warn('A PLN mappában nincs helyiségek.txt vagy helyiséglista.txt, ezért a helyiséglista '+
              'nem kerül a szövegbe. A helyén [KIEGÉSZÍTENDŐ: …] jelölés marad.');
          if (roomData) {
            try {
              const previousRows = parts[3]?.values || [];
              const normalizedRows = rows => rows.map(row =>
                [String(row?.[0] || ''),String(row?.[1] || '')]);
              if (dataSheet && JSON.stringify(normalizedRows(previousRows)) !==
                  JSON.stringify(normalizedRows(roomData.tableRows))) {
                const rows = roomData.tableRows.slice();
                while (rows.length < previousRows.length) rows.push(['','']);
                await sheetWrite(() => sheets.spreadsheets.values.update({
                  spreadsheetId:dataSheet.id,range:`'Munkalap2'!A1:B${rows.length}`,
                  valueInputOption:'RAW',requestBody:{values:rows}}));
              }
              const rows = parts[0]?.values || [];
              // A helyiséglista összege a tervezett nettó lakóterület (J7) cellába
              // kerül. A kézzel beírt értéket nem írjuk felül: eltérés esetén
              // csak figyelmeztetünk, hogy a döntés a tervezőé maradjon.
              const current = String(rows[6]?.[9] || '').replace(/\s/g,'').replace(',','.');
              const total = roomData.totalCents/100;
              if (dataSheet && !current) {
                await sheetWrite(() => sheets.spreadsheets.values.update({
                  spreadsheetId:dataSheet.id,range:"'Munkalap1'!J7",valueInputOption:'RAW',
                  requestBody:{values:[[total]]}}));
                if (!rows[6]) rows[6]=[];
                rows[6][9]=areaText(roomData.totalCents);
              } else if (dataSheet && Number(current) !== total)
                warn('A helyiséglista összege ('+areaText(roomData.totalCents)+
                  ') eltér a Munkalap1!J7 cella értékétől ('+String(rows[6]?.[9]||'')+
                  '). A cellát nem írtuk át; ellenőrizd, melyik a helyes nettó alapterület.');
            } catch (error) {
              if (error.status === 429) throw error;
              warn('A helyiséglista nem írható vissza a tervezési adatlapra ('+
                (error.message||String(error))+'). A dokumentum a beolvasott listával készül el, '+
                'de a Munkalap2 és a J7 cella kézi ellenőrzést igényelhet.');
            }
          }
        } catch (error) {
          if (error.status === 429) throw error;
          warn('A PLN helyiséglista nem dolgozható fel: '+(error.message||String(error))+
            ' A helyiséglista helyén [KIEGÉSZÍTENDŐ: …] jelölés marad.');
        }
      } else
        warn('A projektmappában nincs PLN mappa, ezért a helyiséglista nem kerül a szövegbe. '+
          'A helyén [KIEGÉSZÍTENDŐ: …] jelölés marad.');
      try {
        mergeValues = technicalReplacements({project:data,sheetRows:parts[0]?.values || [],
          programRows:parts[1]?.values || [],fieldRows:parts[2]?.values || [],pdfFiles,writtenFiles,
          roomData,plans:pdfFiles,textTemplates:textTemplates(source),
          extraValues:{...retegrendValues(retegrend),
          RETEGRENDEK_JOVAHAGYOTT_SZOVEG:(retegrend?.lines || []).join('\n')}},warnings);
      } catch (error) {
        if (error.status === 429) throw error;
        warn('A műszaki leírás adatainak összeállítása nem sikerült ('+(error.message||String(error))+
          '). A dokumentum az alapadatokkal és a kézzel megadott mezőkkel készül el.');
        mergeValues = documentValues(data,extras);
        try { Object.assign(mergeValues,manualValues(parts[2]?.values || [])); }
        catch (manualError) {
          warn('A műszaki adatlap kézi mezői sem olvashatók ('+
            (manualError.message||String(manualError))+').');
        }
        if (roomData?.listing) mergeValues.HELYISEGLISTA = roomData.listing;
      }
      if (!String(mergeValues.HELYISEGLISTA || '').trim())
        mergeValues.HELYISEGLISTA = '[KIEGÉSZÍTENDŐ: helyiséglista – töltsd fel a PLN/helyiségek.txt '+
          'fájlt, vagy írd be a Műszaki leírás lap HELYISEGLISTA mezőjét.]';
    }
    conditionalBlocks(source);
    findMarkers(source,mergeValues,{allowUnknown:type === 'muszakiLeiras',allowConditional:true});
    const folder = await ensureProjectFolder(uid);
    const target = (await listChildren(folder.id)).find(item =>
      item.mimeType === 'application/vnd.google-apps.folder' && item.name === template.folder);
    if (!target) throw new Error('A dokumentum célmappája hiányzik: ' + template.folder);
    const indexName = '_DokumentumIndex';
    const metadata = await sheetRead(() => sheets.spreadsheets.get({spreadsheetId:book,
      fields:'sheets(properties(title))'}));
    if (!(metadata.data.sheets || []).some(item => item.properties?.title === indexName)) {
      await sheetWrite(() => sheets.spreadsheets.batchUpdate({spreadsheetId:book,
        requestBody:{requests:[{addSheet:{properties:{title:indexName,hidden:true}}}]}}));
      await sheetWrite(() => sheets.spreadsheets.values.update({spreadsheetId:book,
        range:`'${indexName}'!A1:E1`,valueInputOption:'RAW',requestBody:{values:[
          ['UID','Típus','Dokumentum ID','Állapot','Utolsó szinkron']]}}));
    }
    const records = await values(`'${indexName}'!A2:E`);
    const recordIndex = records.findIndex(item => String(item[0]).trim().toUpperCase() === data.uid && item[1] === type);
    const record = recordIndex < 0 ? null : records[recordIndex];
    if (record?.[3] === 'FINAL') throw new Error('A véglegesített dokumentum nem módosítható.');
    let documentId = String(record?.[2] || '');
    let created = false;
    if (!documentId) {
      const name = [template.title,[data.projekt_varos,data.projekt_kozterulet,
        data.projekt_tipus,data.projekt_hazszam].filter(Boolean).join(' ')].filter(Boolean).join(' - ');
      const existing = (await listChildren(target.id)).filter(item => item.name === name &&
        item.mimeType === 'application/vnd.google-apps.document');
      if (existing.length > 1) throw new Error('Több azonos nevű dokumentum található: ' + name);
      if (existing.length) documentId = existing[0].id;
      else {
        const copy = await googleQuota.run('drive',100,() => drive.files.copy({fileId:template.templateId,
          requestBody:{name,parents:[target.id]},fields:'id',supportsAllDrives:true}));
        documentId = copy.data.id;
        created = true;
        googleCache.clear(`children:${target.id}`);
      }
    }
    let document = (await googleQuota.run('docsRead',1,() => docs.documents.get({
      documentId,includeTabsContent:false
    }))).data;
    // A sablonszövegek appendixe csak a sablonban marad meg: a kész példányból
    // a fejlécétől a dokumentum végéig töröljük.
    if (type === 'muszakiLeiras') {
      try {
        const appendix = appendixRequests(document);
        if (appendix.length) {
          await googleQuota.run('docsWrite',1,() => docs.documents.batchUpdate({documentId,
            requestBody:{requests:appendix,
              ...(document.revisionId ? {writeControl:{requiredRevisionId:document.revisionId}} : {})}}));
          document = (await googleQuota.run('docsRead',1,() => docs.documents.get({
            documentId,includeTabsContent:false
          }))).data;
        }
      } catch (error) {
        if (error.status === 429) throw error;
        warn('A sablonszövegek appendixe nem távolítható el automatikusan ('+
          (error.message||String(error))+'). A dokumentum végén ellenőrizd a függeléket.');
      }
    }
    // A sablonból hiányzó, de az AI által kitöltött fejezetek (helyszín,
    // koncepció, iratjegyzék, mérleg, tervlapok) helyét minden példányban
    // biztosítani kell – az első generáláskor is. Ha egy horgony hiányzik,
    // az csak figyelmeztetés, a dokumentum elkészül.
    if (type === 'muszakiLeiras') {
      try {
        const additions = technicalSupplementRequests(document);
        if (additions.length) {
          await googleQuota.run('docsWrite',1,() => docs.documents.batchUpdate({documentId,
            requestBody:{requests:additions,
              ...(document.revisionId ? {writeControl:{requiredRevisionId:document.revisionId}} : {})}
          }));
          document = (await googleQuota.run('docsRead',1,() => docs.documents.get({
            documentId,includeTabsContent:false
          }))).data;
        }
      } catch (error) {
        if (error.status === 429) throw error;
        warn('A helyszín- és koncepciófejezetek helye nem illeszthető be automatikusan ('+
          (error.message||String(error))+'). A dokumentum a sablon szerinti fejezetekkel készül el.');
      }
    }
    const conditional = conditionalRequests(source,document,mergeValues);
    if (conditional.length) {
      await googleQuota.run('docsWrite',1,() => docs.documents.batchUpdate({
        documentId,requestBody:{requests:conditional,
          ...(document.revisionId ? {writeControl:{requiredRevisionId:document.revisionId}} : {})}
      }));
      document = (await googleQuota.run('docsRead',1,() => docs.documents.get({
        documentId,includeTabsContent:false
      }))).data;
    }
    // A „Meglévő” oszlop és a „Szintterületi mutató” sor csak akkor marad a
    // generált példányban, ha van mögötte tényszerű adat. A táblázat szerkezetét
    // a sablon adja, ezért ezt a másolatban kell igazítani.
    if (type === 'muszakiLeiras') {
      try {
        const shaping = technicalTableRequests(document, mergeValues);
        if (shaping.length) {
          await googleQuota.run('docsWrite',1,() => docs.documents.batchUpdate({documentId,
            requestBody:{requests:shaping,
              ...(document.revisionId ? {writeControl:{requiredRevisionId:document.revisionId}} : {})}}));
          document = (await googleQuota.run('docsRead',1,() => docs.documents.get({
            documentId,includeTabsContent:false
          }))).data;
        }
      } catch (error) {
        if (error.status === 429) throw error;
        warn('A tervezési adatok táblázatának igazítása nem sikerült ('+
          (error.message||String(error))+'). A táblázat a sablon szerinti marad.');
      }
    }
    // A helyiséglista táblázatként, szintfejekkel, alszummákkal és teljes
    // összeggel jelenik meg. A jelölő helyére táblázat kerül, ezért a szöveges
    // helyettesítés előtt kell beszúrni.
    if (type === 'muszakiLeiras' && roomData?.tableRows?.length > 1) {
      try {
        const marker = findMarker(document);
        const inserts = insertRequests(marker, roomData.tableRows);
        if (inserts.length) {
          await googleQuota.run('docsWrite',1,() => docs.documents.batchUpdate({documentId,
            requestBody:{requests:inserts,
              ...(document.revisionId ? {writeControl:{requiredRevisionId:document.revisionId}} : {})}}));
          document = (await googleQuota.run('docsRead',1,() => docs.documents.get({
            documentId,includeTabsContent:false
          }))).data;
          const table = findEmptyTable(document, roomData.tableRows);
          if (table) {
            const fill = fillRequests(table, roomData.tableRows);
            if (fill.length) {
              await googleQuota.run('docsWrite',1,() => docs.documents.batchUpdate({documentId,
                requestBody:{requests:fill,
                  ...(document.revisionId ? {writeControl:{requiredRevisionId:document.revisionId}} : {})}}));
              document = (await googleQuota.run('docsRead',1,() => docs.documents.get({
                documentId,includeTabsContent:false
              }))).data;
            }
          } else
            warn('A helyiséglista beszúrt táblázata nem található, ezért a lista szövegként '+
              'jelenik meg a dokumentumban.');
        }
      } catch (error) {
        if (error.status === 429) throw error;
        warn('A helyiséglista táblázatként nem jeleníthető meg ('+
          (error.message||String(error))+'); ellenőrizd a dokumentumot.');
      }
    }
    const requests = mergeRequests(document,mergeValues,
      {allowUnknown:type === 'muszakiLeiras',restoreMissing:type === 'muszakiLeiras',
        allowConditional:true});
    if (requests.length) await googleQuota.run('docsWrite',1,() => docs.documents.batchUpdate({
      documentId,requestBody:{requests,
        ...(document.revisionId ? {writeControl:{requiredRevisionId:document.revisionId}} : {})}
    }));
    if (type === 'muszakiLeiras') await refreshTechnicalCoverImage(uid, documentId);
    const stamp = new Date().toISOString();
    if (!record) await sheetWrite(() => sheets.spreadsheets.values.append({spreadsheetId:book,
      range:`'${indexName}'!A:E`,valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',
      requestBody:{values:[[data.uid,type,documentId,'DRAFT',stamp]]}}));
    else await sheetWrite(() => sheets.spreadsheets.values.update({spreadsheetId:book,
      range:`'${indexName}'!C${recordIndex+2}:E${recordIndex+2}`,valueInputOption:'RAW',
      requestBody:{values:[[documentId,'DRAFT',stamp]]}}));
    return {created,url:`https://docs.google.com/document/d/${documentId}/edit`,warnings};
  }

  async function syncProject(uid) {
    const state = await dashboardProject(uid);
    const drafts = state.documents.filter(item => item.status === 'DRAFT' && item.url &&
      Object.prototype.hasOwnProperty.call(DOCUMENT_TEMPLATES,item.type));
    if (!drafts.length) throw new Error('Nincs szinkronizálható DRAFT dokumentum.');
    for (const item of drafts) await ensureDocument(uid,item.type);
    return {message:`${drafts.length} DRAFT dokumentum szinkronizálva.`,
      project:await dashboardProject(uid)};
  }

  async function documentRecords(uid) {
    const rows = await values("'_DokumentumIndex'!A2:E");
    return rows.map((row,index) => ({uid:String(row[0] || '').trim().toUpperCase(),
      type:String(row[1] || ''),id:String(row[2] || ''),status:String(row[3] || ''),
      rowNumber:index+2})).filter(item => item.uid === uid && item.id);
  }

  async function projectMoveContext(uid, expectedParent) {
    const {data,rowNumber} = await project(uid);
    const folderId = extractDriveId(data.projectFolderUrl);
    if (!folderId) throw new Error('A projektmappa hivatkozása hiányzik.');
    const folder = await file(folderId);
    if (folder.parents?.[0] !== expectedParent)
      throw new Error('A projektmappa nincs a művelet várt helyén: '+folder.name);
    return {data,rowNumber,folder};
  }

  async function assertDestinationFree(folder, destinationId) {
    if ((await listChildren(destinationId)).some(item => item.id !== folder.id &&
      item.name === folder.name && item.mimeType === 'application/vnd.google-apps.folder'))
      throw new Error('A célmappában már van ilyen nevű projektmappa: '+folder.name);
  }

  async function moveFolder(folder, destinationId) {
    await assertDestinationFree(folder,destinationId);
    const previous = folder.parents?.[0];
    await googleQuota.run('drive',100,() => drive.files.update({fileId:folder.id,
      addParents:destinationId,removeParents:previous,fields:'id,parents',supportsAllDrives:true}));
    googleCache.clear(`file:${folder.id}`);
    googleCache.clear(`children:${previous}`);
    googleCache.clear(`children:${destinationId}`);
  }

  async function exportDocumentPdf(record, folderId) {
    const source = await file(record.id);
    if (source.mimeType && source.mimeType !== 'application/vnd.google-apps.document')
      throw new Error('A dokumentum nem Google Docs fájl: '+source.name);
    const name = String(source.name || record.type).replace(/\.+\s*$/,'')+'.pdf';
    const output = await googleQuota.run('drive',100,() => drive.files.export({
      fileId:record.id,mimeType:'application/pdf'},{responseType:'arraybuffer'}));
    const bytes = await pdfQuality.convertPdfA(Buffer.from(output.data));
    if (!bytes.length) throw new Error('Az exportált PDF üres: '+source.name);
    const older = (await listChildren(folderId)).filter(item => item.name === name);
    await googleQuota.run('drive',100,() => drive.files.create({
      requestBody:{name,mimeType:'application/pdf',parents:[folderId]},
      media:{mimeType:'application/pdf',body:Readable.from([bytes])},
      fields:'id,name',supportsAllDrives:true
    }));
    for (const item of older) await googleQuota.run('drive',100,() => drive.files.update({
      fileId:item.id,requestBody:{trashed:true},fields:'id',supportsAllDrives:true
    }));
    googleCache.clear(`children:${folderId}`);
  }

  async function auditProjectPdfs(uid) {
    const {data}=await project(uid);
    const rootId=extractDriveId(data.projectFolderUrl);
    if(!rootId) throw new Error('A projektmappa hiányzik.');
    const targets=[];
    async function collect(folder,prefix,depth=0) {
      if(depth>10) throw new Error('A projektmappa 10 szintnél mélyebb; a PDF-vizsgálat nem teljes.');
      const children=await listChildren(folder.id);
      if(children.length>=3000) throw new Error('A mappalista nem teljes; a PDF-vizsgálat nem indítható.');
      for(const item of children) {
        if(item.mimeType==='application/vnd.google-apps.folder') {
          await collect(item,prefix?prefix+'/'+item.name:item.name,depth+1);
        } else if(item.mimeType==='application/pdf'||/\.pdf$/i.test(item.name)) {
          targets.push({item,path:prefix?prefix+'/'+item.name:item.name});
          if(targets.length>100) throw new Error('Több mint 100 PDF található; a vizsgálatot bontsd kisebb csomagokra.');
        }
      }
    }
    await collect({id:rootId},'');
    const normalized=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const results=[];
    for(const {item,path:filePath} of targets) {
      const signatureSheet=/alairo[\s_+-]*(?:lap|cimlap)/.test(normalized(item.name));
      const specialist=filePath.startsWith('Adat társtervezőktől/')||
        /szakag|statik|gepesz|villamos|tuzved/.test(normalized(item.name));
      let stage='download';
      try {
        if(Number(item.size||0)>30*1024*1024) throw new Error('A fájl 30 MB-nál nagyobb.');
        const fileBytes=await googleQuota.run('drive',100,()=>drive.files.get({
          fileId:item.id,alt:'media',supportsAllDrives:true},{responseType:'arraybuffer'}));
        const original=Buffer.from(fileBytes.data);
        stage='inspect';
        let check=await pdfQuality.inspectPdf(original);
        let converted=false;
        if(!check.pdfa.compliant&&!check.signature.signed){
          stage='convert';
          const output=Buffer.from(await pdfQuality.convertPdfA(original));
          const verified=await pdfQuality.inspectPdf(output);
          if(!verified.pdfa.compliant||verified.signature.signed)
            throw new Error('Az átalakított fájl PDF/A megfelelősége nem igazolható.');
          stage='preserve';
          const current=(await googleQuota.run('drive',100,()=>drive.files.get({
            fileId:item.id,fields:'id,mimeType,headRevisionId,md5Checksum,parents',
            supportsAllDrives:true}))).data;
          if(!current.headRevisionId||!current.md5Checksum||
            current.md5Checksum.toLowerCase()!==crypto.createHash('md5').update(original).digest('hex'))
            throw new Error('Az eredeti fájl verziója nem azonosítható, vagy időközben megváltozott.');
          const retained=await googleQuota.run('drive',100,()=>drive.revisions.update({
            fileId:item.id,revisionId:current.headRevisionId,
            requestBody:{keepForever:true},fields:'id,keepForever'}));
          if(retained.data?.keepForever!==true)
            throw new Error('Az eredeti fájlverzió tartós megőrzése nem igazolt.');
          stage='upload';
          const saved=(await googleQuota.run('drive',100,()=>drive.files.update({
            fileId:item.id,requestBody:{mimeType:'application/pdf'},
            media:{mimeType:'application/pdf',body:Readable.from([output])},
            fields:'id,md5Checksum',supportsAllDrives:true}))).data;
          if(saved?.id!==item.id||!saved.md5Checksum||
            saved.md5Checksum.toLowerCase()!==crypto.createHash('md5').update(output).digest('hex'))
            throw new Error('A Drive-on tárolt PDF/A fájl ellenőrzőösszege eltér.');
          googleCache.clear(`file:${item.id}`);
          googleCache.clear(`children:${current.parents?.[0]||rootId}`);
          check=verified;converted=true;
        }
        results.push({id:item.id,path:filePath,pdfa:check.pdfa.compliant,profile:check.pdfa.profile,
          pdfaReason:check.pdfa.reason||'',
          signatureSheet,specialist,signed:check.signature.signed,
          signatureVerified:check.signature.verified,signatures:signatureSheet?
            check.signature.signatures:[],converted,error:''});
      } catch(error) {
        if(error.status===429) throw error;
        const problem=pdfAuditErrorInfo(error,stage);
        results.push({id:item.id,path:filePath,pdfa:false,profile:'',signatureSheet,specialist,
          signed:false,signatureVerified:false,signatures:[],error:problem.message,
          meaning:problem.meaning,action:problem.action,diagnostic:problem.diagnostic});
      }
    }
    const architect=results.filter(item=>item.signatureSheet&&!item.specialist);
    const specialists=results.filter(item=>item.signatureSheet&&item.specialist);
    return {files:results,architectSignature:{present:architect.length>0,
      verified:architect.length>0&&architect.every(item=>item.signatureVerified)},
    specialistSignatures:{present:specialists.length>0,
      verified:specialists.length>0&&specialists.every(item=>item.signatureVerified)}};
  }

  async function markDocumentsFinal(records) {
    if (!records.length) return;
    const stamp = new Date().toISOString();
    await sheetWrite(() => sheets.spreadsheets.values.batchUpdate({spreadsheetId:book,
      requestBody:{valueInputOption:'RAW',data:records.map(item => ({
        range:`'_DokumentumIndex'!D${item.rowNumber}:E${item.rowNumber}`,
        values:[['FINAL',stamp]]
      }))}}));
  }

  async function setProjectStatus(rowNumber,status) {
    await sheetWrite(() => sheets.spreadsheets.values.update({spreadsheetId:book,
      range:`${quote(config.sheetName)}!C${rowNumber}`,valueInputOption:'RAW',
      requestBody:{values:[[status]]}}));
    googleCache.clear(`rows:${book}`);
  }

  async function startProject(uid,confirmation,contractDateText) {
    const initial = await project(uid);
    const normalized = initial.data.uid;
    if (confirmation !== 'start:'+normalized) throw new Error('Az indítás megerősítése hiányzik.');
    const today = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Budapest',
      year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const contractDate = contractDateText || today;
    checkedTimelineDate(contractDate);
    const state = await dashboardProject(normalized);
    if (state.stage === 'started') {
      if (initial.data.status !== 'AKTÍV') await setProjectStatus(initial.rowNumber,'AKTÍV');
      return {message:'A projekt már elindult.',url:state.folderUrl,
        project:await dashboardProject(normalized)};
    }
    if (state.stage !== 'preparation') throw new Error('A projekt nincs az ajánlati előkészítésben.');
    const templateRoot = await file(config.templateRootFolderId);
    const preparationId = templateRoot.parents?.[0];
    const startedId = preparationId && (await file(preparationId)).parents?.[0];
    if (!startedId) throw new Error('Az indított projektek célmappája nem található.');
    const context = await projectMoveContext(normalized,preparationId);
    await assertDestinationFree(context.folder,startedId);
    let records = (await documentRecords(normalized)).filter(item =>
      DOCUMENT_TEMPLATES[item.type]?.folder === '_Belső');
    if (!records.length) throw new Error('Nincs véglegesíthető dokumentum a _Belső mappában.');
    for (const record of records) if (record.status !== 'FINAL')
      await ensureDocument(normalized,record.type);
    await ensureProjectDataSheet(normalized);
    await ensureDocument(normalized,'meghatalmazas');
    await ensureDocument(normalized,'alairolap');
    records = (await documentRecords(normalized)).filter(item =>
      DOCUMENT_TEMPLATES[item.type]?.folder === '_Belső');
    const internal = (await listChildren(context.folder.id)).find(item =>
      item.mimeType === 'application/vnd.google-apps.folder' && item.name === '_Belső');
    if (!internal) throw new Error('A _Belső projektmappa hiányzik.');
    for (const record of records) if (record.status !== 'FINAL')
      await exportDocumentPdf(record,internal.id);
    await markDocumentsFinal(records.filter(item => item.status !== 'FINAL'));
    await moveFolder(context.folder,startedId);
    await setProjectStatus(context.rowNumber,'AKTÍV');
    if (!state.startedAt) await setStartDate(normalized,today,contractDate);
    return {message:'A projekt elindult; a belső dokumentumok PDF-változata elkészült.',
      url:`https://drive.google.com/drive/folders/${context.folder.id}`,
      project:await dashboardProject(normalized)};
  }

  async function closeProject(uid,confirmation) {
    const initial = await project(uid);
    const normalized = initial.data.uid;
    if (confirmation !== 'close:'+normalized) throw new Error('A lezárás megerősítése hiányzik.');
    const state = await dashboardProject(normalized);
    if (state.stage === 'closed') {
      const existing = await file(extractDriveId(initial.data.projectFolderUrl));
      const {archived}=await archiveLocation(existing);
      if (archived) {
        if (initial.data.status !== 'KÉSZ') await setProjectStatus(initial.rowNumber,'KÉSZ');
        return {message:'A projekt már lezárult.',url:state.folderUrl,
          project:await dashboardProject(normalized)};
      }
    }
    if (state.stage !== 'started' && state.stage !== 'closed')
      throw new Error('Csak elindított projekt zárható le.');
    const missing = state.issues.filter(item => item.blocking && !item.resolved);
    if (missing.length) throw new Error('A lezárás előtt javítandó: '+missing.map(item => item.text).join(' '));
    if (!state.documents.some(item => item.type === 'muszakiLeiras' && item.url))
      throw new Error('A lezáráshoz műszaki leírás szükséges.');
    const templateRoot = await file(config.templateRootFolderId);
    const preparationId = templateRoot.parents?.[0];
    const startedId = preparationId && (await file(preparationId)).parents?.[0];
    if (!startedId) throw new Error('Az indított projektek mappája nem található.');
    const context = await projectMoveContext(normalized,startedId);
    let records = (await documentRecords(normalized)).filter(item =>
      DOCUMENT_TEMPLATES[item.type]?.folder === 'írásos');
    for (const record of records) if (record.status !== 'FINAL')
      await ensureDocument(normalized,record.type);
    records = (await documentRecords(normalized)).filter(item =>
      DOCUMENT_TEMPLATES[item.type]?.folder === 'írásos');
    for (const record of records) {
      const document = (await googleQuota.run('docsRead',1,() => docs.documents.get({
        documentId:record.id,includeTabsContent:false
      }))).data;
      const unresolved = unresolvedMarkers(document);
      if (unresolved.length) throw new Error('A dokumentumban kitöltetlen mezők maradtak: '+
        record.type+' – '+unresolved.slice(0,8).join(', '));
    }
    const written = (await listChildren(context.folder.id)).find(item =>
      item.mimeType === 'application/vnd.google-apps.folder' && item.name === 'írásos');
    if (!written) throw new Error('Az írásos projektmappa hiányzik.');
    for (const record of records) if (record.status !== 'FINAL')
      await exportDocumentPdf(record,written.id);
    await markDocumentsFinal(records.filter(item => item.status !== 'FINAL'));
    let archive = (await listChildren(startedId)).find(item =>
      item.mimeType === 'application/vnd.google-apps.folder' && item.name === '_Elkészült');
    if (!archive) archive = (await googleQuota.run('drive',100,() => drive.files.create({
      requestBody:{name:'_Elkészült',mimeType:'application/vnd.google-apps.folder',parents:[startedId]},
      fields:'id,name,mimeType',supportsAllDrives:true
    }))).data;
    await moveFolder(context.folder,archive.id);
    await setProjectStatus(context.rowNumber,'KÉSZ');
    return {message:'A projekt lezárult; az írásos dokumentumok PDF-változata elkészült.',
      url:`https://drive.google.com/drive/folders/${context.folder.id}`,
      project:await dashboardProject(normalized)};
  }

  async function archiveProject(uid,confirmation) {
    const initial=await project(uid),normalized=initial.data.uid;
    if(confirmation!=='archive:'+normalized)
      throw new Error('Az archiválás megerősítése hiányzik.');
    const state=await dashboardProject(normalized);
    if(state.stage!=='started'&&state.stage!=='closed')
      throw new Error('Csak elindított vagy lezárt projekt archiválható.');
    if(state.stage==='started')await closeProject(normalized,'close:'+normalized);
    const {data,rowNumber}=await project(normalized);
    const folderId=extractDriveId(data.projectFolderUrl);
    if(!folderId)throw new Error('A projektmappa hiányzik.');
    const folder=await file(folderId);
    const location=await archiveLocation(folder);
    if(location.yearFolder)return {message:'A projekt már év szerinti archívumban van.',
      url:`https://drive.google.com/drive/folders/${folderId}`,
      project:await dashboardProject(normalized)};
    const template=await file(config.templateRootFolderId);
    const preparationId=template.parents?.[0];
    const startedId=preparationId&&(await file(preparationId)).parents?.[0];
    if(!startedId)throw new Error('Az archívum gyökérmappája nem található.');
    const completed=location.parent?.name==='_Elkészült'&&
      location.parent.parents?.[0]===startedId;
    const directArchive=location.parent?.name==='_Lezárt'&&
      location.parent.parents?.[0]===startedId;
    if(!completed&&!directArchive)
      throw new Error('A projektmappa nincs a lezárt projektek várt helyén.');
    let archive=(await listChildren(startedId)).find(item=>
      item.name==='_Lezárt'&&item.mimeType==='application/vnd.google-apps.folder');
    if(!archive){archive=(await googleQuota.run('drive',100,()=>drive.files.create({
      requestBody:{name:'_Lezárt',mimeType:'application/vnd.google-apps.folder',
        parents:[startedId]},fields:'id,name,mimeType,parents',supportsAllDrives:true
    }))).data;googleCache.clear(`children:${startedId}`);}
    const year=new Intl.DateTimeFormat('en',{timeZone:'Europe/Budapest',year:'numeric'}).format(new Date());
    let yearFolder=(await listChildren(archive.id)).find(item=>
      item.name===year&&item.mimeType==='application/vnd.google-apps.folder');
    if(!yearFolder){yearFolder=(await googleQuota.run('drive',100,()=>drive.files.create({
      requestBody:{name:year,mimeType:'application/vnd.google-apps.folder',
        parents:[archive.id]},fields:'id,name,mimeType,parents',supportsAllDrives:true
    }))).data;googleCache.clear(`children:${archive.id}`);}
    await moveFolder(folder,yearFolder.id);
    if(data.status!=='KÉSZ')await setProjectStatus(rowNumber,'KÉSZ');
    return {message:`A projekt a _Lezárt/${year} mappába került.`,
      url:`https://drive.google.com/drive/folders/${folderId}`,
      project:await dashboardProject(normalized)};
  }

  async function deleteProject(uid,confirmation) {
    const initial=await project(uid),normalized=initial.data.uid;
    if(confirmation!=='delete:'+normalized)
      throw new Error('A végleges törlés megerősítése hiányzik.');
    const all=await allRows();
    if(all.filter(item=>String(item.row[0]).trim().toUpperCase()===normalized).length!==1)
      throw new Error('Az azonosító több sorban szerepel; a törlés nem biztonságos.');
    const folderId=extractDriveId(initial.data.projectFolderUrl);
    if(folderId&&all.some(item=>item.rowNumber!==initial.rowNumber&&
        extractDriveId(item.row[4])===folderId))
      throw new Error('A projektmappát másik projekt is használja; a törlés nem biztonságos.');
    const template=await file(config.templateRootFolderId);
    const preparationId=template.parents?.[0];
    const startedId=preparationId&&(await file(preparationId)).parents?.[0];
    if(!preparationId||!startedId)
      throw new Error('A projektmappák gyökere nem ellenőrizhető.');
    let folder=null;
    if(folderId){
      try{folder=(await driveRead(5,()=>drive.files.get({fileId:folderId,
        fields:'id,name,mimeType,parents,ownedByMe,capabilities(canDelete)',
        supportsAllDrives:true}))).data;}
      catch(error){if(error.status!==404)throw error;}
    }
    if(folder){
      const location=await archiveLocation(folder);
      const parent=location.parent;
      let allowed=[preparationId,startedId].includes(parent?.id);
      if(!allowed&&['_Elkészült','_Lezárt'].includes(parent?.name))
        allowed=parent.parents?.[0]===startedId;
      if(!allowed&&location.yearFolder){
        const archive=await file(parent.parents[0]);
        allowed=archive.parents?.[0]===startedId;
      }
      if(folder.id===config.templateRootFolderId||!allowed||
          folder.mimeType!=='application/vnd.google-apps.folder'||
          folder.ownedByMe!==true||folder.capabilities?.canDelete!==true)
        throw new Error('A projektmappa nem törölhető biztonságosan. Ellenőrizd a helyét és a tulajdonjogát.');
      async function assertOwnedChildren(parentId,depth=0){
        if(depth>20)throw new Error('A projektmappa túl mély; a törlés nem biztonságos.');
        const children=await listChildren(parentId);
        if(children.length>=3000)throw new Error('A mappalista nem teljes; a törlés nem biztonságos.');
        for(const child of children){
          if(child.ownedByMe!==true)
            throw new Error('A projektben nem saját tulajdonú fájl található: '+child.name);
          if(child.mimeType==='application/vnd.google-apps.folder')
            await assertOwnedChildren(child.id,depth+1);
        }
      }
      await assertOwnedChildren(folder.id);
    }
    const uidTabs=[
      ['_DokumentumIndex',0],['_ProjektMemo',0],['_ProjektJegyzetek',0],
      ['_ProjektElvártFájlok',0],['_ProjektIdővonal',0],['_ProjektEllenőrzés',0],
      ['_ProjektÚjraindítás',0],['_ProjektSzakasz',0],[SUBMISSION_SHEET,0],
      ['_EmailMegnyitasok',1],['_EmailLetoltesek',1],['_EmailKuldesek',1]
    ];
    const metadata=await sheetRead(()=>sheets.spreadsheets.get({spreadsheetId:book,
      fields:'sheets(properties(sheetId,title))'}));
    const tabIds=new Map((metadata.data.sheets||[]).map(item=>[
      item.properties?.title,item.properties?.sheetId]));
    const mainSheetId=tabIds.get(config.sheetName);
    if(mainSheetId==null)throw new Error('Az Adatok munkalap nem található.');
    const present=uidTabs.filter(([title])=>tabIds.has(title));
    const batches=present.length?(await sheetRead(()=>sheets.spreadsheets.values.batchGet({
      spreadsheetId:book,ranges:present.map(([title])=>`${quote(title)}!A2:B`),
      valueRenderOption:'FORMATTED_VALUE'}))).data.valueRanges||[]:[];
    const requests=[];
    function deleteRows(sheetId,indices){
      const sorted=[...indices].sort((a,b)=>b-a);
      for(let i=0;i<sorted.length;){
        let end=sorted[i]+1,start=sorted[i];i++;
        while(i<sorted.length&&sorted[i]===start-1)start=sorted[i++];
        requests.push({deleteDimension:{range:{sheetId,dimension:'ROWS',
          startIndex:start,endIndex:end}}});
      }
    }
    for(const [index,[title,column]] of present.entries()){
      const rows=batches[index]?.values||[],sheetId=tabIds.get(title);
      const matching=[],references=[];
      rows.forEach((row,offset)=>{
        if(String(row[column]||'').trim().toUpperCase()===normalized)
          matching.push(offset+1);
        else if(title==='_ProjektÚjraindítás'&&
            String(row[1]||'').trim().toUpperCase()===normalized)
          references.push(offset+1);
      });
      for(const rowIndex of references)requests.push({updateCells:{
        start:{sheetId,rowIndex,columnIndex:1},
        rows:[{values:[{userEnteredValue:{stringValue:''}}]}],fields:'userEnteredValue'}});
      deleteRows(sheetId,matching);
    }
    deleteRows(mainSheetId,[initial.rowNumber-1]);
    if(folder){await googleQuota.run('drive',100,()=>drive.files.delete({
      fileId:folder.id,supportsAllDrives:true}));
      googleCache.clear(`file:${folder.id}`);
      googleCache.clear(`children:${folder.parents[0]}`);
    }
    await sheetWrite(()=>sheets.spreadsheets.batchUpdate({spreadsheetId:book,
      requestBody:{requests}}));
    googleCache.clear(`rows:${book}`);
    return {message:'A projekt Drive-mappája és az alkalmazás Sheet-adatai végleg törölve.'};
  }

  async function prepareEmail(uid,kind,{preview=false}={}) {
    const {data} = await project(uid);
    if (!['offer','contract','intake','package'].includes(kind))
      throw new Error('Ismeretlen e-mail típus.');
    const recipient = String(data.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
      throw new Error('Az ügyfél e-mail-címe hiányzik vagy érvénytelen.');
    const projectName = [data.projekt_varos,data.projekt_kozterulet,
      data.projekt_tipus,data.projekt_hazszam].filter(Boolean).join(' ') ||
      data.projektCim || data.uid;
    const htmlSource=fillEmailTemplate(await loadEmailTemplate(drive,config.systemFolderId,kind),{
      projectName,formUrl:`${config.baseUrl}/form?uid=${encodeURIComponent(data.uid)}`
    });
    const base = {to:recipient,attachments:[],downloads:[],htmlSource};
    if (kind === 'intake') return {...base,subject:'Adatbekérő – '+projectName};
    const records = await documentRecords(data.uid);
    async function downloadableDocument(record) {
      const source = await file(record.id);
      const filename = String(source.name || record.type).replace(/\.+\s*$/,'')+'.pdf';
      return {id:record.id,filename,mimeType:'application/vnd.google-apps.document'};
    }
    if (kind === 'offer' || kind === 'contract') {
      const type = kind === 'offer' ? 'ajanlat' : 'szerzodes';
      const record = records.find(item => item.type === type);
      if (!record) throw new Error('A küldendő dokumentum még nem készült el.');
      if (record.status !== 'FINAL') await ensureDocument(data.uid,type);
      const download = await downloadableDocument(record);
      return {...base,subject:(kind === 'offer' ? 'Ajánlat' : 'Szerződés')+' – '+projectName,
        downloads:[download]};
    }
    const state = await dashboardProject(data.uid);
    if (state.stage !== 'started' && state.stage !== 'closed')
      throw new Error('A tervcsomag csak elindított projektnél küldhető.');
    const technical = records.find(item => item.type === 'muszakiLeiras');
    if (!technical) throw new Error('A műszaki leírás hiányzik.');
    for (const record of records.filter(item => DOCUMENT_TEMPLATES[item.type]?.folder === 'írásos'))
      if (record.status !== 'FINAL') await ensureDocument(data.uid,record.type);
    const technicalDoc = (await googleQuota.run('docsRead',1,() => docs.documents.get({
      documentId:technical.id,includeTabsContent:false
    }))).data;
    const missing = unresolvedMarkers(technicalDoc);
    if (missing.length) throw new Error('A műszaki leírás kitöltetlen mezőket tartalmaz: '+
      missing.slice(0,8).join(', '));
    const projectFolder = await file(extractDriveId(data.projectFolderUrl));
    const children = await listChildren(projectFolder.id);
    const downloads = new Map();
    for (const name of ['PDFA','írásos']) {
      const folder = children.find(item => item.name === name &&
        item.mimeType === 'application/vnd.google-apps.folder');
      if (!folder) continue;
      for (const item of await listChildren(folder.id)) {
        if (item.mimeType !== 'application/pdf' && !/\.pdf$/i.test(item.name)) continue;
        if (downloads.has(item.name)) continue;
        downloads.set(item.name,{id:item.id,filename:item.name,mimeType:'application/pdf'});
      }
    }
    for (const record of records.filter(item => DOCUMENT_TEMPLATES[item.type]?.folder === 'írásos')) {
      const download = await downloadableDocument(record);
      if (!downloads.has(download.filename)) downloads.set(download.filename,download);
    }
    const payload = [...downloads.values()];
    if (!payload.length) throw new Error('Nincs küldhető PDF a projektben.');
    return {...base,subject:'Tervcsomag – '+projectName,downloads:payload};
  }

  async function restartProject(uid,requestedPostfix,confirmation) {
    const sourceProject = await project(uid);
    const sourceUid = sourceProject.data.uid;
    if (confirmation !== 'restart:'+sourceUid)
      throw new Error('Az újraindítás megerősítése hiányzik.');
    const postfix = restartPostfix(requestedPostfix);
    const sourceId = extractDriveId(sourceProject.data.projectFolderUrl);
    if (!sourceId) throw new Error('A lezárt projektmappa nem található.');
    const source = await file(sourceId);
    const {archived}=await archiveLocation(source);
    if (!archived)
      throw new Error('A forrásprojekt nincs lezárt projektmappában.');
    const templateRoot = await file(config.templateRootFolderId);
    const preparationId = templateRoot.parents?.[0];
    if (!preparationId) throw new Error('Az ajánlati projektmappa nem található.');
    const baseName = [sourceProject.data.projekt_varos,sourceProject.data.projekt_kozterulet,
      sourceProject.data.projekt_tipus,sourceProject.data.projekt_hazszam]
      .filter(Boolean).join(' ') || source.name;
    const name = appendPostfix(baseName,postfix);
    if ((await listChildren(preparationId)).some(item => item.name === name &&
      item.mimeType === 'application/vnd.google-apps.folder'))
      throw new Error('Már van ilyen nevű projekt az ajánlatok között: '+name);
    let newUid;
    const used = new Set((await allRows()).map(item => String(item.row[0]).trim().toUpperCase()));
    do {newUid = crypto.randomUUID().replace(/-/g,'').toUpperCase();} while (used.has(newUid));
    const target = (await googleQuota.run('drive',100,() => drive.files.create({
      requestBody:{name,mimeType:'application/vnd.google-apps.folder',parents:[preparationId]},
      fields:'id,name,mimeType,parents',supportsAllDrives:true
    }))).data;
    const copiedIds = new Map();
    let rowAdded = false;
    try {
      async function copyTree(fromId,toId,depth=0) {
        if (depth > 12) throw new Error('A projektmappa túl mélyen beágyazott.');
        for (const item of await listChildren(fromId)) {
          const nextName = copiedName(item,postfix);
          if (item.mimeType === 'application/vnd.google-apps.folder') {
            const folder = (await googleQuota.run('drive',100,() => drive.files.create({
              requestBody:{name:nextName,mimeType:item.mimeType,parents:[toId]},
              fields:'id,name,mimeType',supportsAllDrives:true
            }))).data;
            copiedIds.set(item.id,folder.id);
            await copyTree(item.id,folder.id,depth+1);
          } else {
            const copy = (await googleQuota.run('drive',100,() => drive.files.copy({
              fileId:item.id,requestBody:{name:nextName,parents:[toId]},
              fields:'id,name,mimeType',supportsAllDrives:true
            }))).data;
            copiedIds.set(item.id,copy.id);
          }
        }
      }
      await copyTree(source.id,target.id);
      const newRow = sourceProject.row.slice();
      newRow[0] = newUid;
      newRow[1] = new Date().toISOString();
      newRow[2] = 'ELŐKÉSZÍTÉS';
      newRow[3] = clientFormUrl(config.baseUrl,newUid);
      newRow[4] = '';
      await sheetWrite(() => sheets.spreadsheets.values.append({spreadsheetId:book,
        range:`${quote(config.sheetName)}!A:BM`,valueInputOption:'RAW',
        insertDataOption:'INSERT_ROWS',requestBody:{values:[newRow]}}));
      rowAdded = true;
      googleCache.clear(`rows:${book}`);
      const {rowNumber} = await project(newUid);
      const metadata = await sheetRead(() => sheets.spreadsheets.get({spreadsheetId:book,
        fields:'sheets(properties(sheetId,title))'}));
      const sheetId = (metadata.data.sheets || []).find(item =>
        item.properties?.title === config.sheetName)?.properties?.sheetId;
      if (sheetId == null) throw new Error('Az Adatok munkalap nem található.');
      const url = `https://drive.google.com/drive/folders/${target.id}`;
      await sheetWrite(() => sheets.spreadsheets.batchUpdate({spreadsheetId:book,
        requestBody:{requests:[{updateCells:{start:{sheetId,rowIndex:rowNumber-1,columnIndex:4},
          rows:[{values:[{userEnteredValue:{stringValue:'Projekt mappa'},
            textFormatRuns:[{startIndex:0,format:{link:{uri:url}}}]}]}],
          fields:'userEnteredValue,textFormatRuns'}}]}}));
      googleCache.clear(`rows:${book}`);
      const restartTitle = '_ProjektÚjraindítás';
      if (!(metadata.data.sheets || []).some(item => item.properties?.title === restartTitle)) {
        await sheetWrite(() => sheets.spreadsheets.batchUpdate({spreadsheetId:book,
          requestBody:{requests:[{addSheet:{properties:{title:restartTitle,hidden:true}}}]}}));
        await sheetWrite(() => sheets.spreadsheets.values.update({spreadsheetId:book,
          range:`${quote(restartTitle)}!A1:D1`,valueInputOption:'RAW',
          requestBody:{values:[['UID','Forrás UID','Utótag','Időpont']]}}));
      }
      await sheetWrite(() => sheets.spreadsheets.values.append({spreadsheetId:book,
        range:`${quote(restartTitle)}!A:D`,valueInputOption:'RAW',
        insertDataOption:'INSERT_ROWS',
        requestBody:{values:[[newUid,sourceUid,postfix,new Date().toISOString()]]}}));
      const records = await documentRecords(sourceUid);
      const copies = [];
      for (const record of records) {
        if (!DOCUMENT_TEMPLATES[record.type] || !copiedIds.has(record.id)) continue;
        const newId = copiedIds.get(record.id);
        const title = DOCUMENT_TEMPLATES[record.type].title+' - '+name;
        await googleQuota.run('drive',100,() => drive.files.update({fileId:newId,
          requestBody:{name:title},fields:'id',supportsAllDrives:true}));
        copies.push([newUid,record.type,newId,'DRAFT',new Date().toISOString()]);
      }
      if (copies.length) await sheetWrite(() => sheets.spreadsheets.values.append({
        spreadsheetId:book,range:"'_DokumentumIndex'!A:E",valueInputOption:'RAW',
        insertDataOption:'INSERT_ROWS',requestBody:{values:copies}}));
      const expected = await values("'_ProjektElvártFájlok'!A2:B").catch(error => {
        if (error.status === 429) throw error;
        return [];
      });
      const oldPaths = String(expected.find(item => String(item[0]).trim().toUpperCase() === sourceUid)?.[1] || '');
      if (oldPaths) await saveExpectedFiles(newUid,oldPaths.split(/\r?\n/)
        .map(path => expectedPath(path,postfix)).join('\n'));
      return {uid:newUid,folderUrl:url,postfix};
    } catch (error) {
      if (!rowAdded) await googleQuota.run('drive',100,() => drive.files.update({
        fileId:target.id,requestBody:{trashed:true},fields:'id',supportsAllDrives:true
      })).catch(() => {});
      throw error;
    }
  }

  async function audioFolder(rootId, create) {
    const internal = (await listChildren(rootId)).find(item =>
      item.mimeType === 'application/vnd.google-apps.folder' && item.name === '_Belső');
    if (!internal) {
      if (!create) return null;
      throw new Error('A projekt _Belső mappája hiányzik.');
    }
    let folder = (await listChildren(internal.id)).find(item =>
      item.mimeType === 'application/vnd.google-apps.folder' && item.name === 'Hangjegyzetek');
    if (!folder && create) {
      folder = (await googleQuota.run('drive',100,() => drive.files.create({
        requestBody:{name:'Hangjegyzetek',mimeType:'application/vnd.google-apps.folder',parents:[internal.id]},
        fields:'id,name,mimeType',supportsAllDrives:true
      }))).data;
      googleCache.clear(`children:${internal.id}`);
    }
    return folder || null;
  }

  async function uploadAudio(uid, rawName, rawMime, base64) {
    const name = String(rawName || '').replace(/[\\/<>:"|?*\x00-\x1f]/g,'_').slice(0,120);
    const extension = (name.match(/\.([^.]+)$/) || [,''])[1].toLowerCase();
    const mime = String(rawMime || '') || ({mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',
      webm:'audio/webm',ogg:'audio/ogg'}[extension] || '');
    if (!name || !/^audio\/[a-z0-9.+-]+$/i.test(mime) || typeof base64 !== 'string' ||
        !base64 || base64.length > 12*1024*1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
      throw new Error('Legfeljebb 8 MB-os hangfájl tölthető fel.');
    const bytes = Buffer.from(base64,'base64');
    if (!bytes.length || bytes.length > 8*1024*1024)
      throw new Error('A hangfájl túl nagy.');
    const root = await ensureProjectFolder(uid);
    const target = await audioFolder(root.id,true);
    const upload = (await googleQuota.run('drive',100,() => drive.files.create({
      requestBody:{name,parents:[target.id]},media:{mimeType:mime,body:Readable.from([bytes])},
      fields:'id,name,webViewLink',supportsAllDrives:true
    }))).data;
    googleCache.clear(`children:${target.id}`);
    return {id:upload.id,url:upload.webViewLink || `https://drive.google.com/file/d/${upload.id}/view`,
      project:await dashboardProject(uid)};
  }

  async function summarizeAudio(uid, fileId) {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) throw new Error('A Gemini API-kulcs nincs beállítva a Railway Variables között.');
    if (!/^[A-Za-z0-9_-]{10,128}$/.test(String(fileId || '')))
      throw new Error('Érvénytelen hangfájlazonosító.');
    const {data} = await project(uid);
    const rootId = extractDriveId(data.projectFolderUrl);
    if (!rootId) throw new Error('A projektben nincs hangjegyzet.');
    const target = await audioFolder(rootId,false);
    if (!target) throw new Error('A projektben nincs hangjegyzet.');
    const item = (await listChildren(target.id)).find(file => file.id === fileId &&
      /^audio\//.test(file.mimeType || ''));
    if (!item) throw new Error('A hangfájl nem ehhez a projekthez tartozik.');
    if (Number(item.size) > 8*1024*1024)
      throw new Error('A hangfájl túl nagy az AI-kivonathoz.');
    const media = await driveRead(5,() => drive.files.get({fileId,alt:'media',
      supportsAllDrives:true},{responseType:'arraybuffer'}));
    const bytes = Buffer.from(media.data);
    if (bytes.length > 8*1024*1024) throw new Error('A hangfájl túl nagy az AI-kivonathoz.');
    const model = String(process.env.GEMINI_AUDIO_MODEL || 'gemini-2.5-flash');
    if (!/^[A-Za-z0-9._-]{3,80}$/.test(model)) throw new Error('Érvénytelen Gemini modellnév.');
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
      method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
      signal:AbortSignal.timeout(60000),
      body:JSON.stringify({contents:[{parts:[
        {text:'Készíts magyar nyelvű, tömör projektjegyzetet a hangfelvételből. Csak az elhangzott tényeket és döntéseket írd le. A bizonytalan részeket jelöld kérdésként. Ne találj ki adatokat. Szerkezet: tények, döntések, nyitott kérdések.'},
        {inline_data:{mime_type:item.mimeType,data:bytes.toString('base64')}}
      ]}]})
    });
    if (!response.ok) throw new Error('Az AI-kivonat nem készült el (HTTP '+response.status+').');
    const result = await response.json();
    const summary = (result.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('\n').trim();
    if (!summary || summary.length > 9000) throw new Error('Az AI nem adott használható szöveges kivonatot.');
    return {summary:'[AI-kivonat – '+item.name+']\n'+summary};
  }

  async function folderFor(uid, folderId) {
    const {data} = await project(uid);
    const rootId = extractDriveId(data.projectFolderUrl);
    if (!rootId) return {missing: true, name: '', folders: [], files: []};
    const requested = folderId || rootId;
    if (!/^[A-Za-z0-9_-]{10,128}$/.test(requested)) throw new Error('Érvénytelen mappaazonosító.');
    let current = await file(requested);
    const folder = current;
    let inside = false;
    for (let depth = 0; depth < 30; depth++) {
      if (current.id === rootId) {inside = true; break;}
      if (!current.parents?.length) break;
      current = await file(current.parents[0]);
    }
    if (!inside || folder.mimeType !== 'application/vnd.google-apps.folder')
      throw new Error('A mappa nem a kiválasztott projekthez tartozik.');
    const children = await listChildren(folder.id);
    const compare = (a, b) => a.name.localeCompare(b.name, 'hu');
    return {
      id: folder.id, name: folder.name,
      folders: children.filter(item => item.mimeType === 'application/vnd.google-apps.folder')
        .map(item => ({id: item.id, name: item.name})).sort(compare),
      files: children.filter(item => item.mimeType !== 'application/vnd.google-apps.folder')
        .map(item => ({id:item.id,name: item.name,
          url: item.webViewLink || `https://drive.google.com/file/d/${item.id}/view`,
          mimeType: item.mimeType})).sort(compare),
      truncated: children.length >= 3000
    };
  }

  async function projectImage(uid,fileId) {
    if(!/^[A-Za-z0-9_-]{10,128}$/.test(String(fileId||'')))
      throw Object.assign(new Error('Érvénytelen képazonosító.'),{status:400});
    const {data}=await project(uid);
    const rootId=extractDriveId(data.projectFolderUrl);
    if(!rootId)throw Object.assign(new Error('A projektmappa nem található.'),{status:404});
    const item=await file(fileId);
    if(!/^image\/(jpeg|png|webp|heic)$/.test(item.mimeType||'')||
        Number(item.size)>12*1024*1024)
      throw Object.assign(new Error('A kép nem jeleníthető meg.'),{status:415});
    let parentId=item.parents?.[0],received=false,inside=false;
    for(let depth=0;parentId&&depth<30;depth++){
      if(parentId===rootId){inside=true;break;}
      const parent=await file(parentId);
      if(parent.name==='Kapott anyagok'&&parent.mimeType==='application/vnd.google-apps.folder')
        received=true;
      parentId=parent.parents?.[0];
    }
    if(!inside||!received)
      throw Object.assign(new Error('A kép nem a projekt kapott anyagai között található.'),{status:403});
    const result=await driveRead(100,()=>drive.files.get({fileId,alt:'media',
      supportsAllDrives:true},{responseType:'arraybuffer'}));
    const bytes=Buffer.from(result.data);
    const detected=photoType(bytes);
    if(!detected||bytes.length>12*1024*1024)
      throw Object.assign(new Error('A kép nem jeleníthető meg.'),{status:415});
    return {bytes,mime:detected.mime};
  }

  async function listProjects() {
    const rows = await allRows();
    const submissions = await listClientSubmissions();
    const projects = [];
    for (let start = 0; start < rows.length; start += 8) {
      const batch = await Promise.all(rows.slice(start, start + 8).map(async ({row, rowNumber}) => {
      const item = projectFromRow(row, rowNumber);
      item.clientSubmission = submissionFor(rowToData(row),submissions[item.uid]);
      const id = extractDriveId(row[4]);
      if (id) {
        try {
          const current = await file(id);
          item.name=displayProjectFolderName(current.name,item.uid,row[1])||item.name;
          const {parent,archived}=await archiveLocation(current);
          if (parent) {
            if (archived) {item.closed = true; item.stage = 'closed';}
            else item.stage = parent.name === '_Ajánlatok' ? 'preparation' : 'started';
          }
        } catch (error) {
          if (error.status === 429) throw error;
          /* A Sheet rekordja megmarad akkor is, ha a Drive-mappa hiányzik. */
        }
      }
      return item;
      }));
      projects.push(...batch);
    }
    return projects.sort((a, b) => b.order - a.order);
  }

  // MARK: Projekt szakaszok (folyamatjelző) állapotának tárolása a _ProjektSzakasz lapon
  async function ensurePhaseSheet() {
    return googleCache.get(`phase-ready:${book}`, 300000, async () => {
      const metadata = await sheetRead(() => sheets.spreadsheets.get({spreadsheetId:book,
        fields:'sheets(properties(title))'}));
      if ((metadata.data.sheets || []).some(item => item.properties?.title === PHASE_SHEET)) return;
      try {
        await sheetWrite(() => sheets.spreadsheets.batchUpdate({spreadsheetId:book, requestBody:{requests:[
          {addSheet:{properties:{title:PHASE_SHEET, hidden:true}}}]}}));
      } catch (error) {
        if (error.status === 429) throw error;
        const latest = await sheetRead(() => sheets.spreadsheets.get({spreadsheetId:book,
          fields:'sheets(properties(title))'}));
        if (!(latest.data.sheets || []).some(item => item.properties?.title === PHASE_SHEET)) throw error;
        return;
      }
      await sheetWrite(() => sheets.spreadsheets.values.update({spreadsheetId:book,
        range:`${quote(PHASE_SHEET)}!A1:D1`, valueInputOption:'RAW',
        requestBody:{values:[['UID','Szakasz','Kezdés','Kész']]}}));
    });
  }

  async function setPhase(uid, action, szakasz) {
    const normalized = String(uid || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,64}$/.test(normalized)) throw new Error('Érvénytelen projektazonosító.');
    const index = Number(szakasz);
    if (!Number.isInteger(index) || index < 1 || index > PHASE_COUNT) throw new Error('Érvénytelen szakasz.');
    const {row,data} = await project(normalized);
    if (/^(KÉSZ|KESZ|LEZÁRT|LEZART)$/i.test(String(data.status)))
      throw new Error('Lezárt projekt szakasza nem módosítható.');
    const offer = Object.fromEntries(OFFER_NAMES.map((name, position) => [name, String(row[position+40] || '')]));
    const exists = Array.from({length:index},(_,i) => Number(offer['deadline'+(i+5)] || 0) > 0)
      .every(Boolean);
    const timelineRows = await values(`${quote('_ProjektIdővonal')}!A2:B`).catch(error => {
      if (error.status === 429) throw error;
      return [];
    });
    const startedAt = String(timelineRows.find(item =>
      String(item[0] || '').trim().toUpperCase() === normalized)?.[1] || '');
    const currentPhases = projectPhases(await values(`${quote(PHASE_SHEET)}!A2:D`).catch(error => {
      if (error.status === 429) throw error;
      return [];
    }), normalized);
    const change = phaseChange(String(action), index, {started:Boolean(startedAt),
      exists, phases:currentPhases}, new Date().toISOString());
    await ensurePhaseSheet();
    const rows = await values(`${quote(PHASE_SHEET)}!A2:B`).catch(error => {
      if (error.status === 429) throw error;
      return [];
    });
    const position = rows.findLastIndex(item => String(item[0] || '').trim().toUpperCase() === normalized &&
      Number(item[1]) === index);
    if (position < 0 || action === 'restart') await sheetWrite(() => sheets.spreadsheets.values.append({spreadsheetId:book,
      range:`${quote(PHASE_SHEET)}!A:D`, valueInputOption:'RAW', insertDataOption:'INSERT_ROWS',
      requestBody:{values:[[normalized, index, change.kezdes, change.kesz]]}}));
    else await sheetWrite(() => sheets.spreadsheets.values.update({spreadsheetId:book,
      range:`${quote(PHASE_SHEET)}!C${position+2}:D${position+2}`, valueInputOption:'RAW',
      requestBody:{values:[[change.kezdes, change.kesz]]}}));
    googleCache.clear(`rows:${book}`);
    return {message:`A ${index}. szakasz állapota mentve.`, project: await dashboardProject(normalized)};
  }

  async function dashboardProject(uid) {
    const {data, row} = await project(uid);
    const folderId = extractDriveId(data.projectFolderUrl);
    let folder = null, parent = null, archived=false;
    if (folderId) {
      try {folder = await file(folderId); ({parent,archived}=await archiveLocation(folder));}
      catch (error) {
        if (error.status === 429) throw error;
        /* Fájl-ellenőrzési problémaként jelenik meg. */
      }
    }
    const closed = /^(KÉSZ|KESZ|LEZÁRT|LEZART)$/i.test(String(data.status));
    const stage = closed || archived ? 'closed'
      : !folder ? 'none' : parent?.name === '_Ajánlatok' ? 'preparation' : 'started';
    const optionalRanges = [
      ['_DokumentumIndex','A2:E'], ['_ProjektMemo','A2:C'],
      ['_ProjektJegyzetek','A2:C'], ['_ProjektElvártFájlok','A2:C'],
      ['_ProjektIdővonal','A2:C'], ['_ProjektEllenőrzés','A2:D'],
      ['_ProjektÚjraindítás','A2:C'], ['_ProjektSzakasz','A2:D'],
      [SUBMISSION_SHEET,'A2:G']
    ];
    const metadata = await sheetRead(() => sheets.spreadsheets.get({
      spreadsheetId:book, fields:'sheets(properties(title))'
    }));
    const existingTabs = new Set((metadata.data.sheets || []).map(item => item.properties?.title));
    const present = optionalRanges.filter(([name]) => existingTabs.has(name));
    const batches = present.length ? (await sheetRead(() => sheets.spreadsheets.values.batchGet({
      spreadsheetId:book, ranges:present.map(([name, range]) => `${quote(name)}!${range}`),
      valueRenderOption:'FORMATTED_VALUE'
    }))).data.valueRanges || [] : [];
    const rowsByTab = new Map(present.map(([name], index) => [name, batches[index]?.values || []]));
    const [documentRows, memoRows, noteRows, expectedRows, timelineRows, checkRows, restartRows,
      phaseRows, submissionRowsForProject] = optionalRanges.map(([name]) => rowsByTab.get(name) || []);
    const types = {
      ajanlat:'Ajánlat', szerzodes:'Építész szerződés', muszakiLeiras:'Építész műszaki leírás',
      meghatalmazas:'Meghatalmazás', alairolap:'Aláírólap'
    };
    const records = documentRows.filter(item => String(item[0]).trim().toUpperCase() === data.uid);
    const documents = await Promise.all(Object.entries(types).map(async ([type, title]) => {
      const record = records.find(item => item[1] === type);
      if (!record) return {type, title, status:'', url:''};
      try {
        const document = await file(record[2]);
        return {type, title, status:record[3] || '', url:document.webViewLink || `https://docs.google.com/document/d/${document.id}/edit`};
      } catch (error) {
        if (error.status === 429) throw error;
        return {type, title, status:record[3] || '', url:''};
      }
    }));
    let dataSheetUrl = '', planCount = 0, programReady = false, roomsReady = false;
    let programError = '';
    let audio = [];
    let dataSheetConflict = false;
    let pdfFiles = [];
    if (folder) {
      const children = await listChildren(folder.id);
      const written = children.find(item => item.mimeType === 'application/vnd.google-apps.folder' && ['Írásos','írásos'].includes(item.name));
      const pdfa = children.find(item => item.mimeType === 'application/vnd.google-apps.folder' && item.name === 'PDFA');
      const pln = children.find(item => item.mimeType === 'application/vnd.google-apps.folder' && item.name === 'PLN');
      const writtenChildren = written ? await listChildren(written.id) : [];
      const audioTarget = await audioFolder(folder.id,false);
      if (audioTarget) audio = (await listChildren(audioTarget.id)).filter(item =>
        item.mimeType !== 'application/vnd.google-apps.folder').map(item => ({
        id:item.id,name:item.name,url:item.webViewLink || `https://drive.google.com/file/d/${item.id}/view`
      }));
      const candidates = [...children, ...writtenChildren].filter(item => item.mimeType === 'application/vnd.google-apps.spreadsheet' && /^Tervezési adatok(?:\s|\s*-)/i.test(item.name));
      dataSheetConflict = candidates.length > 1;
      if (candidates.length === 1) {
        dataSheetUrl = candidates[0].webViewLink || `https://docs.google.com/spreadsheets/d/${candidates[0].id}/edit`;
        try {
          const inputs = await sheetRead(() => sheets.spreadsheets.values.batchGet({
            spreadsheetId:candidates[0].id,
            ranges:["'Munkalap1'!A1:M20","'Tervezési program'!A2:B17"],
            valueRenderOption:'FORMATTED_VALUE'
          }));
          const parts = inputs.data.valueRanges || [];
          const sheetValues = technicalSheetValues(parts[0]?.values || []);
          technicalProgramLines(parts[1]?.values || [],
            {...documentValues(data),...sheetValues});
          programReady = true;
        } catch (error) {
          if (error.status === 429) throw error;
          programError = error.message || String(error);
        }
      }
      if (pdfa) pdfFiles = (await listChildren(pdfa.id)).filter(item =>
        item.mimeType === 'application/pdf' || /\.pdf$/i.test(item.name));
      planCount = pdfFiles.length;
      if (pln) roomsReady = (await listChildren(pln.id)).some(item => item.name.toLowerCase() === 'helyiségek.txt');
    }
    const offer = Object.fromEntries(OFFER_NAMES.map((name, index) => [name, String(row[index + 40] || '')]));
    const all = await allRows();
    offer.peopleOptions = [55,56,57].map(index => Array.from(new Set(all.map(item =>
      String(item.row[index] || '').trim()).filter(Boolean))).sort((a,b) => a.localeCompare(b,'hu')));
    const savedMemo = memoRows.find(item => String(item[0] || '').trim().toUpperCase() === data.uid);
    const memo = savedMemo ? String(savedMemo[1] || '') : noteRows
      .filter(item => String(item[0] || '').trim().toUpperCase() === data.uid)
      .map(item => (item[1] ? '[' + item[1] + ']\n' : '') + String(item[2] || ''))
      .join('\n\n');
    const expectedFiles = String(expectedRows.find(item => item[0] === data.uid)?.[1] || '');
    const answers = new Map(checkRows.filter(item => String(item[0]).trim().toUpperCase() === data.uid)
      .map(item => [String(item[1]),String(item[2] || '')]));
    const postfix = String(restartRows.find(item => item[0] === data.uid)?.[2] || '').trim();
    const issues = [];
    let hasUnknownScale = false;
    const addIssue = (code,text,blocking,answerable=false) => issues.push({code,text,blocking,answerable});
    if (!folder) addIssue('folder','A projektmappa hiányzik vagy nem érhető el.',true);
    if (dataSheetConflict) addIssue('data_sheet_conflict','Több Tervezési adatok Sheet található a projektmappában.',true);
    if (folder && !dataSheetUrl && !dataSheetConflict)
      addIssue('data_sheet','A tervezési adatlap hiányzik.',true);
    if (dataSheetUrl && !programReady)
      addIssue('program',programError || 'A tervezési program a–p pontjai nem teljesek.',true);
    if (folder) {
      if (closed !== archived)
        addIssue('status_folder','A projekt státusza és a mappa helye ellentmond egymásnak.',false,true);
      if (!roomsReady) addIssue('rooms','A PLN/helyiségek.txt fájl hiányzik.',true);
      if (!planCount) addIssue('plans','Nincs PDF tervlap a PDFA mappában.',true);
      for (const pdf of pdfFiles) {
        const title = String(pdf.name || '').replace(/\.pdf$/i,'').replace(/[\r\n\t]+/g,' ').trim();
        // Ha a fájlnévből nem állapítható meg a méretarány, nem kérdezünk rá:
        // a tervjegyzékben csak a tervlap neve szerepel.
        if (title && !planScale(title)) hasUnknownScale = true;
      }
      if (hasUnknownScale)
        addIssue('scale','Egy vagy több tervlap méretaránya nem állapítható meg a fájlnévből; '+
          'a tervjegyzékben csak a tervlap neve szerepel.',false,false);
      const expectedName = [data.projekt_varos,data.projekt_kozterulet,
        data.projekt_tipus,data.projekt_hazszam].map(item => String(item || '').trim())
        .filter(Boolean).join(' ').replace(/\s+/g,' ').trim() + (postfix ? ' - '+postfix : '');
      if (expectedName && folder.name !== expectedName)
        addIssue('folder_name','A projektmappa neve eltér az adatlap alapján várttól. Mi az eltérés oka?',false,true);
      const rootId = folder.id;
      for (const relative of expectedFiles.split(/\r?\n/).map(item => item.trim()).filter(Boolean)) {
        const parts = relative.split('/').filter(Boolean);
        let currentId = rootId, found = false;
        if (parts.length && parts.length <= 12 && !parts.some(part => part === '..')) {
          for (let index = 0; index < parts.length; index++) {
            const child = (await listChildren(currentId)).find(item => item.name === parts[index] &&
              (index === parts.length-1 || item.mimeType === 'application/vnd.google-apps.folder'));
            if (!child) break;
            if (index === parts.length-1) found = true;
            else currentId = child.id;
          }
        }
        if (!found) addIssue('expected:'+relative,'Hiányzó elvárt fájl: '+relative,true);
      }
    }
    if (!expectedFiles.trim())
      addIssue('expected_list','Nincs projektspecifikus elvárt fájllista; a teljes fájlkészlet nem ellenőrizhető.',false);
    for (const type of ['ajanlat','szerzodes','muszakiLeiras'])
      if (!documents.some(item => item.type === type && item.url))
        addIssue('document:'+type,`Hiányzik a(z) ${types[type]} dokumentum.`,type === 'szerzodes');
    for (const issue of issues) {
      issue.answer = answers.get(issue.code) || '';
      issue.resolved = Boolean(issue.answer);
    }
    const displayName=displayProjectFolderName(folder?.name,data.uid,data.createdAt);
    return {
      uid: data.uid, name: displayName || data.projektCim || data.projekt_varos || data.uid,
      clientSubmission:submissionFor(data,parseSubmission(submissionRowsForProject.find(item =>
        String(item[0] || '').trim().toUpperCase() === data.uid))),
      address: data.projektCim || '', clientName: [data.vezeteknev, data.keresztnev].filter(Boolean).join(' '),
      status: data.status, stage, folderName: folder?.name || '',
      folderUrl: folder ? `https://drive.google.com/drive/folders/${folder.id}` : '',
      dataSheetUrl, programReady, planCount, documents,
      issues,
      memo, offer,
      startedAt: String(timelineRows.find(item => item[0] === data.uid)?.[1] || ''),
      contractDate: String(timelineRows.find(item => item[0] === data.uid)?.[2] ||
        timelineRows.find(item => item[0] === data.uid)?.[1] || ''),
      phases: projectPhases(phaseRows, data.uid),
      expectedFiles,
      audio, aiConfigured: Boolean(process.env.GEMINI_API_KEY),
      email: data.email || '', phone: data.telefon || '', defaultPostfix: '',
      clientFormUrl: `/form?uid=${encodeURIComponent(data.uid)}`
    };
  }

  return {oauth, sheets, drive, values, allRows, project, listProjects, dashboardProject, folderFor,projectImage,
    createClientRecord, createInquiry, getClientData, saveClientData, ensureProjectFolder, ensureProjectDataSheet,
    listClientSubmissions, markClientSubmissionRead,
    saveMemo, saveExpectedFiles, pdfaExpectedFiles, answerCheck, saveOffer, setStartDate, ensureDocument,
    uploadAudio, summarizeAudio, draftTechnicalText, generateTechnicalDocument, technicalChat,
    syncProject, startProject, closeProject,
    archiveProject,deleteProject,prepareEmail,
    restartProject, getTechnicalFields, saveTechnicalFields, setPhase,auditProjectPdfs};
}

module.exports = {googleClient, extractFolderLinks};
