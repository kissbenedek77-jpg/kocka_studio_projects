'use strict';
const {google} = require('googleapis');
const {rowToData, projectFromRow, extractDriveId} = require('./domain.cjs');

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

function googleClient(config, refreshToken = '') {
  const oauth = new google.auth.OAuth2(config.clientId, config.clientSecret, `${config.baseUrl}/auth/callback`);
  if (refreshToken) oauth.setCredentials({refresh_token: refreshToken});
  const sheets = google.sheets({version: 'v4', auth: oauth});
  const drive = google.drive({version: 'v3', auth: oauth});
  const book = config.sheetId;
  const quote = name => `'${String(name).replace(/'/g, "''")}'`;
  const values = async range => (await sheets.spreadsheets.values.get({spreadsheetId: book, range, valueRenderOption: 'FORMATTED_VALUE'})).data.values || [];
  const rowRange = `${quote(config.sheetName)}!A2:BM`;
  async function folderLinks() {
    const result = await sheets.spreadsheets.get({
      spreadsheetId: book, ranges: [`${quote(config.sheetName)}!E2:E`], includeGridData: true,
      fields: 'sheets(data(startRow,rowData(values(hyperlink,textFormatRuns))))'
    });
    return extractFolderLinks(result.data.sheets);
  }
  async function optionalValues(range) {
    try {return await values(range);} catch (error) {
      if (error.code === 400 || error.code === 404) return [];
      throw error;
    }
  }

  async function allRows() {
    const [rows, links] = await Promise.all([values(rowRange), folderLinks()]);
    return rows.map((row, index) => {
      const rowNumber = index + 2;
      if (links.has(rowNumber)) row[4] = links.get(rowNumber);
      return {row, rowNumber};
    })
      .filter(item => String(item.row[0] || '').trim());
  }

  async function project(uid) {
    const normalized = String(uid || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,64}$/.test(normalized)) throw new Error('Érvénytelen projektazonosító.');
    const item = (await allRows()).find(entry => String(entry.row[0]).trim().toUpperCase() === normalized);
    if (!item) throw new Error('A projekt nem található.');
    return {...item, data: rowToData(item.row)};
  }

  async function file(id) {
    return (await drive.files.get({fileId: id, fields: 'id,name,mimeType,webViewLink,parents', supportsAllDrives: true})).data;
  }

  async function listChildren(parentId) {
    const files = [];
    let pageToken;
    do {
      const result = (await drive.files.list({
        q: `'${parentId}' in parents and trashed = false`,
        fields: 'nextPageToken,files(id,name,mimeType,webViewLink,parents)',
        pageSize: 1000, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true
      })).data;
      files.push(...result.files || []);
      pageToken = result.nextPageToken;
    } while (pageToken && files.length < 3000);
    return files;
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
        .map(item => ({name: item.name, url: item.webViewLink || `https://drive.google.com/file/d/${item.id}/view`, mimeType: item.mimeType})).sort(compare),
      truncated: children.length >= 3000
    };
  }

  async function listProjects() {
    const rows = await allRows();
    const projects = [];
    for (let start = 0; start < rows.length; start += 8) {
      const batch = await Promise.all(rows.slice(start, start + 8).map(async ({row, rowNumber}) => {
      const item = projectFromRow(row, rowNumber);
      const id = extractDriveId(row[4]);
      if (id) {
        try {
          const current = await file(id);
          const parent = current.parents?.[0] ? await file(current.parents[0]) : null;
          if (parent) {
            if (['_Elkészült', '_Lezárt'].includes(parent.name)) {item.closed = true; item.stage = 'closed';}
            else item.stage = parent.name === '_Ajánlatok' ? 'preparation' : 'started';
          }
        } catch (_) { /* A Sheet rekordja megmarad akkor is, ha a Drive-mappa hiányzik. */ }
      }
      return item;
      }));
      projects.push(...batch);
    }
    return projects.sort((a, b) => b.order - a.order);
  }

  async function dashboardProject(uid) {
    const {data, row} = await project(uid);
    const folderId = extractDriveId(data.projectFolderUrl);
    let folder = null, parent = null;
    if (folderId) {
      try {folder = await file(folderId); parent = folder.parents?.[0] ? await file(folder.parents[0]) : null;}
      catch (_) { /* Fájl-ellenőrzési problémaként jelenik meg. */ }
    }
    const closed = /^(KÉSZ|KESZ|LEZÁRT|LEZART)$/i.test(String(data.status));
    const stage = closed || ['_Elkészült', '_Lezárt'].includes(parent?.name) ? 'closed'
      : !folder ? 'none' : parent?.name === '_Ajánlatok' ? 'preparation' : 'started';
    const [documentRows, memoRows, expectedRows, timelineRows] = await Promise.all([
      optionalValues("'_DokumentumIndex'!A2:E"),
      optionalValues("'_ProjektMemo'!A2:C"),
      optionalValues("'_ProjektElvártFájlok'!A2:C"),
      optionalValues("'_ProjektIdővonal'!A2:B")
    ]);
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
      } catch (_) {return {type, title, status:record[3] || '', url:''};}
    }));
    let dataSheetUrl = '', planCount = 0, programReady = false;
    if (folder) {
      const children = await listChildren(folder.id);
      const written = children.find(item => item.mimeType === 'application/vnd.google-apps.folder' && ['Írásos','írásos'].includes(item.name));
      const pdfa = children.find(item => item.mimeType === 'application/vnd.google-apps.folder' && item.name === 'PDFA');
      const writtenChildren = written ? await listChildren(written.id) : [];
      const candidates = [...children, ...writtenChildren].filter(item => item.mimeType === 'application/vnd.google-apps.spreadsheet' && /^Tervezési adatok(?:\s|\s*-)/i.test(item.name));
      if (candidates.length === 1) {
        dataSheetUrl = candidates[0].webViewLink || `https://docs.google.com/spreadsheets/d/${candidates[0].id}/edit`;
        const program = await sheets.spreadsheets.values.get({spreadsheetId:candidates[0].id, range:"'Tervezési program'!B2:B17", valueRenderOption:'FORMATTED_VALUE'}).catch(() => null);
        programReady = Boolean(program && program.data.values?.length === 16 && program.data.values.every((item, index) => String(item[0] || '').trim().startsWith(String.fromCharCode(97 + index) + ')')));
      }
      if (pdfa) planCount = (await listChildren(pdfa.id)).filter(item => item.mimeType === 'application/pdf' || /\.pdf$/i.test(item.name)).length;
    }
    const offerNames = ['totalFee','optionalFee','installment1','installment2','installment3','installment4','pricePrefix','pricePostfix','amountWords','currency','currencyLong','deadline5','deadline6','deadline7','deadline8','structuralEngineer','mechanicalEngineer','electricalEngineer','projectDescription','structuralFee','structuralOptionalFee','mechanicalFee','electricalFee','fireFee'];
    const offer = Object.fromEntries(offerNames.map((name, index) => [name, String(row[index + 40] || '')]));
    offer.peopleOptions = [[], [], []];
    return {
      uid: data.uid, name: folder?.name || data.projektCim || data.projekt_varos || data.uid,
      address: data.projektCim || '', clientName: [data.vezeteknev, data.keresztnev].filter(Boolean).join(' '),
      status: data.status, stage, folderName: folder?.name || '',
      folderUrl: folder ? `https://drive.google.com/drive/folders/${folder.id}` : '',
      dataSheetUrl, programReady, planCount, documents,
      issues: [
        {code:'node_preview', text:'A teljes fájl- és dokumentumellenőrzés átültetése még folyamatban van.', blocking:true, answerable:false},
        ...(!folder ? [{code:'folder', text:'A projektmappa hiányzik vagy nem érhető el.', blocking:true, answerable:false}] : [])
      ],
      memo: String(memoRows.find(item => item[0] === data.uid)?.[1] || ''), offer,
      startedAt: String(timelineRows.find(item => item[0] === data.uid)?.[1] || ''),
      expectedFiles: String(expectedRows.find(item => item[0] === data.uid)?.[1] || ''),
      audio: [], aiConfigured: false,
      email: data.email || '', phone: data.telefon || '', defaultPostfix: '',
      clientFormUrl: `${config.legacyFormUrl}?uid=${encodeURIComponent(data.uid)}`
    };
  }

  return {oauth, sheets, drive, values, allRows, project, listProjects, dashboardProject, folderFor};
}

module.exports = {googleClient, extractFolderLinks};
