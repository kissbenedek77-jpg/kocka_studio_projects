'use strict';
const domain = require('./domain.cjs');
const docs = require('./docs.cjs');
const projectSheet = require('./project-sheet.cjs');

async function findGeneratedDocument(google, folderId, name) {
  const children = await google.listChildren(folderId);
  return children.find(item => item.name === name && item.mimeType === 'application/vnd.google-apps.document') || null;
}

async function technicalContext(google, store, projectFolder, data) {
  const spreadsheet = await projectSheet.prepareTechnicalProjectSheet(google, projectFolder, store.baseUrl, data.uid);
  const values = await projectSheet.getTechnicalSheetReplacements(google, spreadsheet.id);
  const extras = await store.getAdditionalMergeFields(data.uid, (await store.project(data.uid)).rowNumber);
  await projectSheet.getTechnicalProgramLines(google, spreadsheet.id,
    Object.assign({}, domain.getDocumentReplacements(data, extras), values));
  return {spreadsheet, values};
}

async function syncDocument(google, store, docId, type, data, templateId, additionalValues = {}) {
  await docs.fillDocument(google, store, docId, templateId, data, additionalValues);
}

async function generateDocument(google, store, ctx, type, projectFolder) {
  const template = domain.DOCUMENT_TEMPLATES[type];
  if (!template) throw new Error('Ismeretlen dokumentumtípus: ' + type);
  const data = ctx.data;
  const technical = type === 'muszakiLeiras'
    ? await technicalContext(google, store, projectFolder, data) : null;
  const target = await google.ensureFolder(projectFolder.id, template.targetFolder);
  const postfix = await store.getRestartPostfix(data.uid);
  const name = domain.buildDocumentFileName(template, data, postfix);
  const existing = await findGeneratedDocument(google, target.id, name);
  if (existing) {
    const record = (await store.getDocumentRecords(data.uid)).find(item => item.type === type);
    await store.registerDocument(data.uid, type, existing.id);
    if (!record || record.status !== 'FINAL') {
      await syncDocument(google, store, existing.id, type, data, template.templateId, technical?.values);
      if (technical) await docs.refreshTechnicalDescription(google, store, existing.id, projectFolder, data, technical.spreadsheet);
    }
    return {created: false, file: existing, url: existing.webViewLink};
  }
  const file = await google.copyFile(template.templateId, name, target.id);
  await syncDocument(google, store, file.id, type, data, template.templateId, technical?.values);
  await store.registerDocument(data.uid, type, file.id);
  if (technical) await docs.refreshTechnicalDescription(google, store, file.id, projectFolder, data, technical.spreadsheet);
  return {created: true, file, url: file.webViewLink};
}

async function ensureAllProjectDocuments(google, store, ctx, projectFolder) {
  const technical = await technicalContext(google, store, projectFolder, ctx.data);
  let created = 0;
  let existing = 0;
  for (const [type, template] of Object.entries(domain.DOCUMENT_TEMPLATES)) {
    const target = await google.ensureFolder(projectFolder.id, template.targetFolder);
    const postfix = await store.getRestartPostfix(ctx.data.uid);
    const name = domain.buildDocumentFileName(template, ctx.data, postfix);
    const record = (await store.getDocumentRecords(ctx.data.uid)).find(item => item.type === type);
    let file = null;
    if (record) {
      try {file = await google.file(record.id);} catch (_) {}
    }
    if (record && record.status === 'FINAL' && !file)
      throw new Error('A véglegesített dokumentum nem található: ' + template.title);
    if (!file) file = await findGeneratedDocument(google, target.id, name);
    if (file) {
      await store.registerDocument(ctx.data.uid, type, file.id);
      if (!record || record.status !== 'FINAL') {
        await syncDocument(google, store, file.id, type, ctx.data, template.templateId,
          type === 'muszakiLeiras' ? technical.values : null);
        if (type === 'muszakiLeiras')
          await docs.refreshTechnicalDescription(google, store, file.id, projectFolder, ctx.data, technical.spreadsheet);
      }
      existing++;
    } else {
      file = await google.copyFile(template.templateId, name, target.id);
      await syncDocument(google, store, file.id, type, ctx.data, template.templateId,
        type === 'muszakiLeiras' ? technical.values : null);
      await store.registerDocument(ctx.data.uid, type, file.id);
      if (type === 'muszakiLeiras')
        await docs.refreshTechnicalDescription(google, store, file.id, projectFolder, ctx.data, technical.spreadsheet);
      created++;
    }
  }
  return {created, existing};
}

async function syncProjectByUid(google, store, uid, projectFolder) {
  const data = (await store.project(uid)).data;
  const records = await store.getDocumentRecords(uid);
  let technical = null;
  for (const record of records) {
    if (record.status !== 'DRAFT') continue;
    if (record.type === 'muszakiLeiras') {
      if (!projectFolder) throw new Error('A műszaki leírás tervjegyzékéhez nincs projektmappa.');
      technical = await technicalContext(google, store, projectFolder, data);
      await syncDocument(google, store, record.id, record.type, data,
        domain.DOCUMENT_TEMPLATES[record.type]?.templateId, technical.values);
      await docs.refreshTechnicalDescription(google, store, record.id, projectFolder, data, technical.spreadsheet);
    } else {
      await syncDocument(google, store, record.id, record.type, data,
        domain.DOCUMENT_TEMPLATES[record.type]?.templateId);
    }
    await store.touchDocument(record);
  }
}

async function exportPdfToFolder(google, docId, folderId, name) {
  const buffer = await google.exportPdf(docId);
  const existing = (await google.listChildren(folderId)).filter(item => item.name === name);
  for (const file of existing) await google.trashFile(file.id);
  return google.createFile(name, folderId, 'application/pdf', buffer);
}

async function finalizeProjectDocuments(google, store, ctx, projectFolder, records) {
  for (const record of records) {
    if (record.status !== 'FINAL') {
      await syncDocument(google, store, record.id, record.type, ctx.data,
        domain.DOCUMENT_TEMPLATES[record.type]?.templateId);
    }
  }
  const internal = await google.ensureFolder(projectFolder.id, '_Belső');
  let finalized = 0;
  let pdfCreated = 0;
  let pdfUpdated = 0;
  for (const record of records) {
    const source = await google.file(record.id);
    const pdfName = source.name.replace(/\.+\s*$/, '') + '.pdf';
    const existed = (await google.listChildren(internal.id)).some(item => item.name === pdfName);
    await exportPdfToFolder(google, record.id, internal.id, pdfName);
    if (existed) pdfUpdated++; else pdfCreated++;
    await store.setDocumentStatus(record, 'FINAL');
    finalized++;
  }
  return {finalized, pdfCreated, pdfUpdated};
}

async function finalizeWrittenDocuments(google, store, ctx, projectFolder) {
  const records = (await store.getDocumentRecords(ctx.data.uid)).filter(record =>
    domain.DOCUMENT_TEMPLATES[record.type]?.targetFolder === 'írásos');
  const written = await google.ensureFolder(projectFolder.id, 'írásos');
  let technical = null;
  for (const record of records) {
    if (record.status === 'FINAL') continue;
    if (record.type === 'muszakiLeiras') {
      technical = technical || await technicalContext(google, store, projectFolder, ctx.data);
      await syncDocument(google, store, record.id, record.type, ctx.data,
        domain.DOCUMENT_TEMPLATES[record.type].templateId, technical.values);
      await docs.refreshTechnicalDescription(google, store, record.id, projectFolder, ctx.data, technical.spreadsheet);
    } else {
      await syncDocument(google, store, record.id, record.type, ctx.data,
        domain.DOCUMENT_TEMPLATES[record.type].templateId);
    }
    const file = await google.file(record.id);
    const pdfName = file.name.replace(/\.+\s*$/, '') + '.pdf';
    await exportPdfToFolder(google, record.id, written.id, pdfName);
    await store.setDocumentStatus(record, 'FINAL');
  }
}

function finalizableRecords(records) {
  return records.filter(record => domain.DOCUMENT_TEMPLATES[record.type]?.targetFolder === '_Belső');
}

module.exports = {
  findGeneratedDocument, technicalContext, syncDocument, generateDocument,
  ensureAllProjectDocuments, syncProjectByUid, exportPdfToFolder,
  finalizeProjectDocuments, finalizeWrittenDocuments, finalizableRecords
};
