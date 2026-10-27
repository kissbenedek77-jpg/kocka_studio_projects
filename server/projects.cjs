'use strict';
const domain = require('./domain.cjs');
const projectSheet = require('./project-sheet.cjs');
const documents = require('./documents.cjs');

const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function getProjectsParentFolder(google) {
  const templateRoot = await google.file(domain.TEMPLATE_ROOT_FOLDER_ID);
  if (!templateRoot.parents?.length) throw new Error('A sablonmappa szülőmappája nem érhető el.');
  return google.file(templateRoot.parents[0]);
}

async function getStartedProjectsFolder(google) {
  const preparation = await getProjectsParentFolder(google);
  if (!preparation.parents?.length) throw new Error('Az előkészítő mappa szülőmappája nem érhető el.');
  return google.file(preparation.parents[0]);
}

async function getExistingProjectFolder(google, store, ctx) {
  const url = await store.getFolderUrl(ctx.rowNumber);
  const id = domain.extractDriveId(url);
  if (!id) return null;
  try {return await google.file(id);} catch (_) {return null;}
}

async function ensureProjectSubfolders(google, folderId) {
  for (const name of domain.PROJECT_SUBFOLDERS) await google.ensureFolder(folderId, name);
}

async function setProjectFolderLink(google, rowNumber, folder) {
  await google.setCellLink(rowNumber, 5, 'Projekt mappa',
    folder.webViewLink || 'https://drive.google.com/drive/folders/' + folder.id);
}

async function ensureProjectFolder(google, store, ctx) {
  let folder = await getExistingProjectFolder(google, store, ctx);
  if (folder) {
    await ensureProjectSubfolders(google, folder.id);
    await setProjectFolderLink(google, ctx.rowNumber, folder);
    return folder;
  }
  const name = domain.buildProjectFolderName(ctx.data);
  if (!name) throw new Error('A projektmappa létrehozásához projekt város, közterület és házszám szükséges.');
  const parent = await getProjectsParentFolder(google);
  folder = await google.ensureFolder(parent.id, name);
  await ensureProjectSubfolders(google, folder.id);
  await setProjectFolderLink(google, ctx.rowNumber, folder);
  return folder;
}

async function getProjectFolderForMove(google, folder, expectedParent, action) {
  if (!folder) throw new Error('A kijelölt projekthez nem található elérhető projektmappa az E oszlopban.');
  if (!folder.parents?.length || folder.parents[0] !== expectedParent.id)
    throw new Error('A projektmappa nincs a ' + action + ' várt helyén: ' + folder.name);
  return folder;
}

async function assertProjectFolderDestinationAvailable(google, folder, destination) {
  const children = await google.listChildren(destination.id);
  const conflict = children.find(item => item.mimeType === FOLDER_MIME && item.name === folder.name && item.id !== folder.id);
  if (conflict) throw new Error('A célmappában már van ilyen nevű projektmappa: ' + folder.name);
}

async function moveProjectFolder(google, folder, destination) {
  await assertProjectFolderDestinationAvailable(google, folder, destination);
  await google.moveFile(folder.id, destination.id, folder.parents?.[0] || '');
}

async function ensureProjectDataSheet(google, store, ctx, folder) {
  const spreadsheet = await projectSheet.ensureProjectDataSpreadsheet(google, folder);
  await projectSheet.setProjectDashboardLink(google, spreadsheet.id, store.baseUrl, ctx.uid);
  return spreadsheet;
}

async function getProjectDocumentRecords(store, uid) {
  return store.getDocumentRecords(uid);
}

async function getDashboardIssues(google, store, ctx, folder, dataSheet, documentsList, planEntries, programReady, dataSheetError) {
  const issues = [];
  const expectedFiles = (await store.getExpectedFiles(ctx.uid)).split(/\r?\n/).filter(Boolean);
  const add = (code, text, blocking, answerable) =>
    issues.push({code, text, blocking: !!blocking, answerable: !!answerable});
  if (!folder) add('folder', 'A projektmappa hiányzik.', true, false);
  if (dataSheetError) add('data_sheet_conflict', dataSheetError, true, false);
  if (folder && !dataSheet) add('data_sheet', 'A tervezési adatlap hiányzik.', true, false);
  if (dataSheet && !programReady) add('program', 'A tervezési program a–p pontjai nem teljesek.', true, false);
  if (folder) {
    const parentName = folder.parents?.length ? (await google.file(folder.parents[0])).name : '';
    const archived = parentName === '_Elkészült' || parentName === '_Lezárt';
    if (domain.isClosedStatus(ctx.data.status) !== archived)
      add('status_folder', 'A projekt státusza és a mappa helye ellentmond egymásnak.', false, true);
    const pln = (await google.listChildren(folder.id)).find(item => item.mimeType === FOLDER_MIME && item.name === 'PLN');
    const rooms = pln ? (await google.listChildren(pln.id)).some(file => file.name.toLowerCase() === 'helyiségek.txt') : false;
    if (!rooms) add('rooms', 'A PLN/helyiségek.txt fájl hiányzik.', true, false);
    if (!planEntries.length) add('plans', 'Nincs PDF tervlap a PDFA mappában.', true, false);
    planEntries.filter(entry => !entry.scale).forEach(entry => {
      add('scale:' + entry.title, 'A tervlap méretaránya nem ismert: ' + entry.title + '. Mi a helyes méretarány?', false, true);
    });
    const postfix = await store.getRestartPostfix(ctx.uid);
    const expectedName = domain.appendProjectPostfix(domain.buildProjectFolderName(ctx.data), postfix);
    if (expectedName && folder.name !== expectedName)
      add('folder_name', 'A projektmappa neve eltér az adatlap alapján várttól. Mi az eltérés oka?', false, true);
    for (const path of expectedFiles) {
      if (!await projectRelativeFileExists(google, folder.id, path))
        add('expected:' + path, 'Hiányzó elvárt fájl: ' + path, true, false);
    }
  }
  if (!expectedFiles.length)
    add('expected_list', 'Nincs projektspecifikus elvárt fájllista; a teljes fájlkészlet nem ellenőrizhető.', false, false);
  ['ajanlat', 'szerzodes'].forEach(type => {
    if (!documentsList.some(doc => doc.type === type && doc.url))
      add('document:' + type, 'Hiányzik a(z) ' + domain.DOCUMENT_TEMPLATES[type].title + ' dokumentum.',
        type === 'szerzodes', false);
  });
  if (!documentsList.some(doc => doc.type === 'muszakiLeiras' && doc.url))
    add('document:muszakiLeiras', 'A műszaki leírás még nem készült el.', false, false);
  const answers = await store.getAnswers(ctx.uid);
  return issues.map(issue => ({...issue, answer: answers[issue.code] || '', resolved: !!answers[issue.code]}));
}

async function projectRelativeFileExists(google, rootId, path) {
  const parts = String(path).split('/').filter(Boolean);
  if (!parts.length) return false;
  let folderId = rootId;
  for (let index = 0; index < parts.length - 1; index++) {
    const children = await google.listChildren(folderId);
    const child = children.find(item => item.mimeType === FOLDER_MIME && item.name === parts[index]);
    if (!child) return false;
    folderId = child.id;
  }
  const files = await google.listChildren(folderId);
  return files.some(item => item.name === parts[parts.length - 1]);
}

async function getDashboardOffer(google, store, ctx) {
  const book = `'${store.sheetName}'`;
  const values = (await google.values(`${book}!AO${ctx.rowNumber}:BL${ctx.rowNumber}`))[0] || [];
  const offer = {};
  const fields = ['totalFee', 'optionalFee', 'installment1', 'installment2', 'installment3', 'installment4',
    'pricePrefix', 'pricePostfix', 'amountWords', 'currency', 'currencyLong',
    'deadline5', 'deadline6', 'deadline7', 'deadline8',
    'structuralEngineer', 'mechanicalEngineer', 'electricalEngineer', 'projectDescription',
    'structuralFee', 'structuralOptionalFee', 'mechanicalFee', 'electricalFee', 'fireFee'];
  fields.forEach((key, index) => {offer[key] = String(values[index] || '');});
  const last = (await google.values(`${book}!A2:A`)).length + 1;
  const people = last > 1 ? await google.values(`${book}!BD2:BF${last}`) : [];
  offer.peopleOptions = [0, 1, 2].map(column => Array.from(new Set(
    people.map(row => String(row[column] || '').trim()).filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, 'hu')));
  return offer;
}

async function saveOffer(google, store, ctx, input) {
  if (!input || typeof input !== 'object') throw new Error('Az ajánlati adatok hiányoznak.');
  const fields = ['totalFee', 'optionalFee', 'installment1', 'installment2', 'installment3', 'installment4',
    'pricePrefix', 'pricePostfix', 'amountWords', 'currency', 'currencyLong',
    'deadline5', 'deadline6', 'deadline7', 'deadline8',
    'structuralEngineer', 'mechanicalEngineer', 'electricalEngineer', 'projectDescription',
    'structuralFee', 'structuralOptionalFee', 'mechanicalFee', 'electricalFee', 'fireFee'];
  const data = fields.map(key => {
    const value = String(input[key] == null ? '' : input[key]).trim();
    if (value.length > (key === 'projectDescription' ? 10000 : 1000))
      throw new Error('Túl hosszú ajánlati adat: ' + key);
    return value;
  });
  ['deadline5', 'deadline6', 'deadline7', 'deadline8'].forEach(key => {
    const value = String(input[key] || '').trim();
    if (value && (!/^\d+$/.test(value) || Number(value) > 3650))
      throw new Error('A szakaszhatáridő egész napokban adható meg.');
  });
  if (!String(input.currency || '').trim() || !String(input.currencyLong || '').trim())
    throw new Error('A deviza rövid és hosszú nevét is add meg.');
  await store.withLock('project:' + ctx.uid, async () => {
    await google.update(`'${store.sheetName}'!AO${ctx.rowNumber}:BL${ctx.rowNumber}`, [data]);
    const folder = await getExistingProjectFolder(google, store, ctx);
    if (folder) await documents.syncProjectByUid(google, store, ctx.uid, folder);
  });
  return getDashboardProject(google, store, ctx.uid);
}

async function getDashboardProject(google, store, uid) {
  const ctx = await store.project(uid);
  const folder = await getExistingProjectFolder(google, store, ctx);
  let stage = 'none';
  let folderUrl = '';
  let folderName = '';
  let dataSheetUrl = '';
  let dataSheet = null;
  let dataSheetError = '';
  let programReady = false;
  let planEntries = [];
  if (folder) {
    folderUrl = folder.webViewLink || 'https://drive.google.com/drive/folders/' + folder.id;
    folderName = folder.name;
    const parent = folder.parents?.length ? await google.file(folder.parents[0]) : null;
    const [preparation, started] = await Promise.all([getProjectsParentFolder(google), getStartedProjectsFolder(google)]);
    if (parent) {
      if (parent.name === '_Lezárt' || parent.name === '_Elkészült') stage = 'closed';
      else if (parent.id === started.id) stage = 'started';
      else if (parent.id === preparation.id) stage = 'preparation';
      else stage = 'other';
    }
    try {dataSheet = await projectSheet.findProjectDataSpreadsheet(google, folder.id);}
    catch (error) {dataSheetError = error.message || String(error);}
    if (dataSheet) {
      dataSheetUrl = dataSheet.webViewLink || 'https://docs.google.com/spreadsheets/d/' + dataSheet.id + '/edit';
      await projectSheet.setProjectDashboardLink(google, dataSheet.id, store.baseUrl, ctx.uid);
      const program = await google.valuesIn(dataSheet.id, "'Tervezési program'!B2:B17").catch(() => []);
      programReady = program.length === 16 && program.every((row, index) =>
        String((row || [])[0] || '').trim().startsWith(String.fromCharCode(97 + index) + ')'));
    }
    planEntries = await projectSheet.getProjectPlanEntries(google, folder.id, ctx.uid, await store.getAnswers(ctx.uid));
  }
  const records = await store.getDocumentRecords(ctx.uid);
  const documentsList = Object.keys(domain.DOCUMENT_TEMPLATES).map(type => {
    const config = domain.DOCUMENT_TEMPLATES[type];
    const record = records.find(item => item.type === type);
    return {type, title: config.title, status: record ? record.status : '', url: ''};
  });
  for (const item of documentsList) {
    const record = records.find(rec => rec.type === item.type);
    if (!record) continue;
    try {
      const file = await google.file(record.id);
      item.url = file.webViewLink || 'https://docs.google.com/document/d/' + file.id + '/edit';
    } catch (_) {}
  }
  const issues = await getDashboardIssues(google, store, ctx, folder, dataSheet, documentsList,
    planEntries, programReady, dataSheetError);
  const audio = folder ? await getAudio(google, folder) : [];
  return {
    uid: ctx.uid,
    name: folderName || domain.buildProjectFolderName(ctx.data) || ctx.data.projektCim || ctx.uid,
    address: ctx.data.projektCim || '',
    clientName: [ctx.data.vezeteknev, ctx.data.keresztnev].filter(Boolean).join(' '),
    status: ctx.data.status || '', stage, folderName, folderUrl,
    dataSheetUrl, programReady, planCount: planEntries.length,
    documents: documentsList, issues,
    memo: await store.getMemo(ctx.uid),
    offer: await getDashboardOffer(google, store, ctx),
    startedAt: await store.getStartDate(ctx.uid),
    expectedFiles: await store.getExpectedFiles(ctx.uid),
    audio,
    aiConfigured: !!(await store.getConfig('GEMINI_API_KEY')) || !!store.geminiApiKey,
    email: ctx.data.email || '', phone: ctx.data.telefon || '',
    defaultPostfix: domain.getDefaultRestartPostfix(),
    clientFormUrl: store.clientFormUrl(ctx.uid)
  };
}

async function dashboardListProjects(google, store) {
  const rows = await store.allProjectRows();
  const restarts = await google.sheetRows(store.SHEETS.restarts).catch(() => []);
  const postfixes = {};
  restarts.forEach(row => {postfixes[String(row[0])] = String(row[2] || '');});
  const projects = [];
  for (let start = 0; start < rows.length; start += 8) {
    const batch = await Promise.all(rows.slice(start, start + 8).map(async ({row, rowNumber}) => {
      if (!String(row[0] || '').trim()) return null;
      const uid = String(row[0]).trim().toUpperCase();
      const address = String(row[38] || '').trim();
      const name = address || domain.buildProjectFolderName({
        projekt_varos: row[33], projekt_kozterulet: row[34],
        projekt_tipus: row[35], projekt_hazszam: row[36]
      }) || 'Új projekt';
      const status = String(row[2] || '').trim();
      let archived = false;
      let stage = 'none';
      const folderId = domain.extractDriveId(row[4]);
      if (folderId) {
        try {
          const folder = await google.file(folderId);
          const parent = folder.parents?.length ? await google.file(folder.parents[0]) : null;
          if (parent) {
            archived = ['_Elkészült', '_Lezárt'].indexOf(parent.name) !== -1;
            stage = archived ? 'closed' : parent.name === '_Ajánlatok' ? 'preparation' : 'started';
          }
        } catch (_) {}
      }
      if (domain.isClosedStatus(status)) stage = 'closed';
      return {
        uid,
        name: domain.appendProjectPostfix(name, postfixes[uid]),
        clientName: [row[7], row[8]].filter(Boolean).join(' '),
        status, stage, closed: domain.isClosedStatus(status) || archived, order: rowNumber
      };
    }));
    projects.push(...batch.filter(Boolean));
  }
  return projects.sort((a, b) => b.order - a.order);
}

async function dashboardListFolder(google, store, uid, folderId) {
  const folder = await getExistingProjectFolder(google, store, await store.project(uid));
  if (!folder) return {name: '', folders: [], files: [], missing: true};
  if (folderId && !/^[A-Za-z0-9_-]{10,128}$/.test(folderId)) throw new Error('Érvénytelen mappaazonosító.');
  const target = folderId ? await google.file(folderId) : folder;
  let current = target;
  let inside = false;
  for (let depth = 0; current && depth < 30; depth++) {
    if (current.id === folder.id) {inside = true; break;}
    current = current.parents?.length ? await google.file(current.parents[0]) : null;
  }
  if (!inside) throw new Error('A mappa nem a kiválasztott projekthez tartozik.');
  const children = await google.listChildren(target.id);
  const folders = children.filter(item => item.mimeType === FOLDER_MIME)
    .map(item => ({id: item.id, name: item.name})).sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  const files = children.filter(item => item.mimeType !== FOLDER_MIME)
    .map(item => ({name: item.name, url: item.webViewLink || 'https://drive.google.com/file/d/' + item.id + '/view', mimeType: item.mimeType}))
    .sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  return {id: target.id, name: target.name, folders: folders.slice(0, 300), files: files.slice(0, 300),
    truncated: children.length > 300};
}

async function getAudioFolder(google, projectFolder, create) {
  const internal = (await google.listChildren(projectFolder.id)).find(item => item.mimeType === FOLDER_MIME && item.name === '_Belső');
  if (!internal && !create) return null;
  const parent = internal || await google.ensureFolder(projectFolder.id, '_Belső');
  const audio = (await google.listChildren(parent.id)).find(item => item.mimeType === FOLDER_MIME && item.name === 'Hangjegyzetek');
  return audio || (create ? google.createFolder(parent.id, 'Hangjegyzetek') : null);
}

async function getAudio(google, projectFolder) {
  const folder = await getAudioFolder(google, projectFolder, false);
  if (!folder) return [];
  return (await google.listChildren(folder.id)).map(file => ({
    id: file.id, name: file.name, url: file.webViewLink
  }));
}

async function uploadAudio(google, store, ctx, name, mimeType, base64) {
  name = String(name || '').replace(/[\\/<>:"|?*\x00-\x1f]/g, '_').slice(0, 120);
  mimeType = String(mimeType || '');
  if (!mimeType) {
    const extension = (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
    mimeType = {mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', webm: 'audio/webm', ogg: 'audio/ogg'}[extension] || '';
  }
  if (!/^audio\//.test(mimeType) || !name || String(base64 || '').length > 12 * 1024 * 1024)
    throw new Error('Legfeljebb 8 MB-os hangfájl tölthető fel.');
  const buffer = Buffer.from(String(base64 || ''), 'base64');
  if (buffer.length > 8 * 1024 * 1024) throw new Error('A hangfájl túl nagy.');
  const folder = await getAudioFolder(google, await ensureProjectFolder(google, store, ctx), true);
  const postfix = await store.getRestartPostfix(ctx.uid);
  const file = await google.createFile(domain.appendProjectPostfix(name, postfix), folder.id, mimeType, buffer);
  return {id: file.id, url: file.webViewLink, project: await getDashboardProject(google, store, ctx.uid)};
}

async function dashboardPerform(google, store, uid, action, confirmation, hooks = {}) {
  const state = hooks.getDashboardProject || (value => getDashboardProject(google, store, value));
  const docs = hooks.documents || documents;
  const sheets = hooks.projectSheet || projectSheet;
  const ctx = await store.project(uid);
  action = String(action || '');
  if (['start', 'close'].indexOf(action) !== -1 && confirmation !== action + ':' + ctx.uid)
    throw new Error('A művelet megerősítése hiányzik.');
  return store.withLock('project:' + ctx.uid, async () => {
    let message = '';
    let openedUrl = '';
    if (action === 'folder') {
      const folder = await ensureProjectFolder(google, store, ctx);
      message = 'A projektmappa készen áll.';
      openedUrl = folder.webViewLink;
    } else if (action === 'dataSheet') {
      const spreadsheet = await ensureProjectDataSheet(google, store, ctx, await ensureProjectFolder(google, store, ctx));
      message = 'A tervezési adatlap készen áll.';
      openedUrl = spreadsheet.webViewLink;
    } else if (action.indexOf('document:') === 0) {
      const type = action.slice('document:'.length);
      if (!Object.prototype.hasOwnProperty.call(domain.DOCUMENT_TEMPLATES, type))
        throw new Error('Ismeretlen dokumentumtípus.');
      const folder = await ensureProjectFolder(google, store, ctx);
      if (type === 'muszakiLeiras') {
        const current = await state(ctx.uid);
        if (current.stage !== 'started') throw new Error('A műszaki leírás a projekt indítása után készíthető.');
        const blockers = current.issues.filter(issue => issue.blocking && !issue.resolved);
        if (blockers.length) throw new Error('Előbb javítsd a hiányzó adatokat és fájlokat: ' +
          blockers.map(issue => issue.text).join(' '));
      }
      const result = await docs.generateDocument(google, store, ctx, type, folder);
      message = result.created ? 'A dokumentum létrejött.' : 'A dokumentum frissítve.';
      openedUrl = result.url;
    } else if (action === 'sync') {
      const folder = await getExistingProjectFolder(google, store, ctx);
      if (!folder) throw new Error('A projektmappa nem található.');
      await docs.syncProjectByUid(google, store, ctx.uid, folder);
      message = 'A DRAFT dokumentumok szinkronizálva.';
    } else if (action === 'start') {
      const preparation = await getProjectsParentFolder(google);
      const folder = await getProjectFolderForMove(google,
        await getExistingProjectFolder(google, store, ctx), preparation, 'indításhoz');
      const destination = await getStartedProjectsFolder(google);
      const records = docs.finalizableRecords(await store.getDocumentRecords(ctx.uid));
      if (!records.length) throw new Error('Nincs véglegesíthető dokumentum a _Belső mappában.');
      await assertProjectFolderDestinationAvailable(google, folder, destination);
      const result = await docs.finalizeProjectDocuments(google, store, ctx, folder, records);
      await ensureProjectDataSheet(google, store, ctx, folder);
      for (const type of ['meghatalmazas', 'alairolap']) {
        await docs.generateDocument(google, store, Object.assign({}, ctx, {projectFolder: folder}), type, folder);
      }
      await moveProjectFolder(google, folder, destination);
      await google.update(`'${store.sheetName}'!C${ctx.rowNumber}`, [['AKTÍV']]);
      await store.markStarted(ctx.uid);
      message = 'A projekt elindult; ' + result.finalized + ' dokumentum véglegesítve.';
      openedUrl = folder.webViewLink;
    } else if (action === 'close') {
      const started = await getStartedProjectsFolder(google);
      const folder = await getProjectFolderForMove(google,
        await getExistingProjectFolder(google, store, ctx), started, 'lezáráshoz');
      const current = await state(ctx.uid);
      const missing = current.issues.filter(issue => issue.blocking && !issue.resolved);
      if (missing.length) throw new Error('A lezárás előtt javítandó: ' + missing.map(issue => issue.text).join(' '));
      if (!current.documents.some(doc => doc.type === 'muszakiLeiras' && doc.url))
        throw new Error('A lezáráshoz műszaki leírás szükséges.');
      await docs.finalizeWrittenDocuments(google, store, ctx, folder);
      const archive = await google.ensureFolder(started.id, '_Elkészült');
      await moveProjectFolder(google, folder, archive);
      await google.update(`'${store.sheetName}'!C${ctx.rowNumber}`, [['KÉSZ']]);
      message = 'A projekt elkészült, a dokumentumok véglegesítve.';
      openedUrl = folder.webViewLink;
    } else {
      throw new Error('Ismeretlen projektművelet.');
    }
    return {message, url: openedUrl, project: await state(ctx.uid)};
  });
}

async function copyProjectTree(google, sourceId, destinationId, postfix, fileIds) {
  const children = await google.listChildren(sourceId);
  for (const file of children.filter(item => item.mimeType !== FOLDER_MIME)) {
    const copyName = file.name.toLowerCase() === 'helyiségek.txt' ? file.name : domain.appendProjectPostfix(file.name, postfix);
    const copy = await google.copyFile(file.id, copyName, destinationId);
    fileIds[file.id] = copy.id;
  }
  for (const folder of children.filter(item => item.mimeType === FOLDER_MIME)) {
    const childName = domain.PROJECT_SUBFOLDERS.indexOf(folder.name) !== -1
      ? folder.name : domain.appendProjectPostfix(folder.name, postfix);
    const child = await google.createFolder(destinationId, childName);
    await copyProjectTree(google, folder.id, child.id, postfix, fileIds);
  }
}

async function restartProject(google, store, uid, requestedPostfix, confirmation) {
  const ctx = await store.project(uid);
  if (confirmation !== 'restart:' + ctx.uid) throw new Error('Az újraindítás megerősítése hiányzik.');
  const postfix = domain.validateRestartPostfix(requestedPostfix);
  const source = await getExistingProjectFolder(google, store, ctx);
  if (!source) throw new Error('A lezárt projektmappa nem található.');
  const sourceParent = source.parents?.length ? await google.file(source.parents[0]) : null;
  if (!sourceParent || (sourceParent.name !== '_Elkészült' && sourceParent.name !== '_Lezárt'))
    throw new Error('A forrásprojekt nincs lezárt projektmappában.');
  const targetRoot = await getProjectsParentFolder(google);
  const targetName = domain.appendProjectPostfix(domain.buildProjectFolderName(ctx.data) || source.name, postfix);
  const conflict = (await google.listChildren(targetRoot.id)).find(item => item.mimeType === FOLDER_MIME && item.name === targetName);
  if (conflict) throw new Error('Már van ilyen nevű projekt az ajánlatok között: ' + targetName);
  return store.withLock('project:' + ctx.uid, async () => {
    let newFolder = null;
    let rowAdded = false;
    try {
      const newUid = await store.generateUniqueUid();
      newFolder = await google.createFolder(targetRoot.id, targetName);
      const copiedIds = {};
      await copyProjectTree(google, source.id, newFolder.id, postfix, copiedIds);
      const copiedData = Object.assign({}, ctx.data, {
        uid: newUid, status: 'ELŐKÉSZÍTÉS', projectFolderUrl: '', clientLink: store.clientFormUrl(newUid)
      });
      const rowNumber = await store.appendProjectRow(copiedData, newUid);
      rowAdded = true;
      await setProjectFolderLink(google, rowNumber, newFolder);
      await store.addRestart(newUid, ctx.uid, postfix);
      const oldExpected = await store.getExpectedFiles(ctx.uid);
      if (oldExpected) {
        const updated = oldExpected.split(/\r?\n/).map(path => domain.restartExpectedPath(path, postfix)).join('\n');
        await store.saveExpectedFiles(newUid, updated);
      }
      for (const record of await store.getDocumentRecords(ctx.uid)) {
        const config = domain.DOCUMENT_TEMPLATES[record.type];
        if (!config || !copiedIds[record.id]) continue;
        const newName = domain.buildDocumentFileName(config, copiedData, postfix);
        await google.renameFile(copiedIds[record.id], newName);
        const originalFolder = (await google.listChildren(source.id))
          .find(item => item.mimeType === FOLDER_MIME && item.name === config.targetFolder);
        if (originalFolder) {
          const sourceFile = await google.file(record.id);
          const pdf = (await google.listChildren(originalFolder.id))
            .find(item => item.name === sourceFile.name + '.pdf');
          if (pdf && copiedIds[pdf.id]) await google.renameFile(copiedIds[pdf.id], newName + '.pdf');
        }
        await store.registerDocument(newUid, record.type, copiedIds[record.id]);
      }
      return {uid: newUid, folderUrl: newFolder.webViewLink, postfix};
    } catch (error) {
      if (newFolder && !rowAdded) await google.trashFile(newFolder.id).catch(() => {});
      throw error;
    }
  });
}

module.exports = {
  getProjectsParentFolder, getStartedProjectsFolder, getExistingProjectFolder, ensureProjectFolder,
  ensureProjectSubfolders, setProjectFolderLink, getProjectFolderForMove,
  assertProjectFolderDestinationAvailable, moveProjectFolder, ensureProjectDataSheet,
  getProjectDocumentRecords, getDashboardIssues, projectRelativeFileExists,
  getDashboardOffer, saveOffer, getDashboardProject, dashboardListProjects, dashboardListFolder,
  getAudioFolder, getAudio, uploadAudio, dashboardPerform, copyProjectTree, restartProject
};
