'use strict';
const projects = require('./projects.cjs');
const emails = require('./emails.cjs');
const ai = require('./ai.cjs');

function validRecipient(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));
}

// MARK: A dashboard RPC műveletek egységes átirányítása a Node modulokra
function createDashboard({google, store, mail, mailer, config}) {
  const methods = {
    async dashboardListProjects() {
      return projects.dashboardListProjects(google, store);
    },

    async getDashboardProject(uid) {
      return projects.getDashboardProject(google, store, uid);
    },

    async dashboardListFolder(uid, folderId) {
      return projects.dashboardListFolder(google, store, uid, folderId);
    },

    async dashboardSaveMemo(uid, memo) {
      const ctx = await store.project(uid);
      return store.withLock('project:' + ctx.uid, () => store.saveMemo(ctx.uid, memo));
    },

    async dashboardAddNote(uid, note) {
      const ctx = await store.project(uid);
      return store.addNote(ctx.uid, note);
    },

    async dashboardSetStartDate(uid, dateText) {
      const ctx = await store.project(uid);
      const state = await projects.getDashboardProject(google, store, ctx.uid);
      if (state.stage !== 'started' && state.stage !== 'closed')
        throw new Error('Indítási dátum csak elindított projektnél adható meg.');
      await store.withLock('project:' + ctx.uid, () => store.setStartDate(ctx.uid, String(dateText || '')));
      return projects.getDashboardProject(google, store, ctx.uid);
    },

    async dashboardSaveOffer(uid, input) {
      const ctx = await store.project(uid);
      return projects.saveOffer(google, store, ctx, input);
    },

    async dashboardSaveExpectedFiles(uid, paths) {
      const ctx = await store.project(uid);
      await store.withLock('project:' + ctx.uid, () => store.saveExpectedFiles(ctx.uid, paths));
      return projects.getDashboardProject(google, store, ctx.uid);
    },

    async dashboardAnswerCheck(uid, code, answer) {
      const ctx = await store.project(uid);
      code = String(code || '');
      answer = String(answer || '').trim();
      const current = await projects.getDashboardProject(google, store, ctx.uid);
      const issue = current.issues.filter(item => item.code === code)[0];
      if (!issue || !issue.answerable) throw new Error('Ez az ellenőrzési pont nem válaszolható meg itt.');
      if (!answer || answer.length > 3000) throw new Error('A válasz 1–3000 karakter lehet.');
      if (code.indexOf('scale:') === 0 && !/^M=1:\d+(?:,\s*1:\d+)*$/.test(answer))
        throw new Error('A méretarány formátuma például M=1:50 vagy M=1:500, 1:200.');
      await store.saveAnswer(ctx.uid, code, answer);
      return projects.getDashboardProject(google, store, ctx.uid);
    },

    async dashboardSendEmail(uid, kind, confirmation) {
      return emails.sendProjectEmail(google, store, mailer, uid, kind, confirmation);
    },

    async dashboardUploadAudio(uid, name, mimeType, base64) {
      const ctx = await store.project(uid);
      return store.withLock('project:' + ctx.uid,
        () => projects.uploadAudio(google, store, ctx, name, mimeType, base64));
    },

    async dashboardSummarizeAudio(uid, fileId) {
      return ai.summarizeAudio(google, store, config, uid, fileId);
    },

    async dashboardConfigureAi(apiKey) {
      return ai.configureAi(store, apiKey);
    },

    async dashboardPerform(uid, action, confirmation) {
      return projects.dashboardPerform(google, store, uid, action, confirmation);
    },

    async dashboardRestartProject(uid, requestedPostfix, confirmation) {
      return projects.restartProject(google, store, uid, requestedPostfix, confirmation);
    },

    async dashboardListSentMail(uid) {
      const {data} = await store.project(uid);
      const recipient = String(data.email || '').trim().toLowerCase();
      if (!validRecipient(recipient)) return {configured: true, missingRecipient: true, messages: []};
      return mail.list(recipient);
    },

    async dashboardGetSentMail(uid, messageId) {
      const {data} = await store.project(uid);
      const recipient = String(data.email || '').trim().toLowerCase();
      if (!validRecipient(recipient)) throw new Error('A projekthez nincs érvényes e-mail-cím.');
      return mail.get(recipient, messageId);
    }
  };

  async function call(name, args) {
    if (!Object.prototype.hasOwnProperty.call(methods, name))
      throw new Error('Ismeretlen dashboard művelet: ' + name);
    return methods[name](...(Array.isArray(args) ? args : []));
  }

  return {methods, call};
}

module.exports = {createDashboard};
