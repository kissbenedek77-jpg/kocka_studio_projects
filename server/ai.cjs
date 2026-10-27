'use strict';
const {getExistingProjectFolder, getAudioFolder, getDashboardProject} = require('./projects.cjs');

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';
const SUMMARY_PROMPT =
  'Készíts magyar nyelvű, tömör projektjegyzetet a hangfelvételből. ' +
  'Csak az elhangzott tényeket és döntéseket írd le. A bizonytalan részeket jelöld kérdésként. ' +
  'Ne találj ki adatokat. Szerkezet: tények, döntések, nyitott kérdések.';

async function resolveApiKey(store, config) {
  return String(await store.getConfig('GEMINI_API_KEY') || config.geminiApiKey || '').trim();
}

async function isConfigured(store, config) {
  return Boolean(await resolveApiKey(store, config));
}

async function configureAi(store, apiKey) {
  apiKey = String(apiKey || '').trim();
  if (!/^[A-Za-z0-9._-]{20,300}$/.test(apiKey)) throw new Error('Érvénytelen Gemini API-kulcs.');
  await store.setConfig('GEMINI_API_KEY', apiKey);
  return true;
}

// MARK: Hangjegyzet AI-kivonata a Gemini API-val
async function summarizeAudio(google, store, config, uid, fileId) {
  const key = await resolveApiKey(store, config);
  if (!key) throw new Error('A Gemini API-kulcs még nincs beállítva.');
  const ctx = await store.project(uid);
  const folder = await getExistingProjectFolder(google, store, ctx);
  const audioFolder = folder && await getAudioFolder(google, folder, false);
  if (!audioFolder) throw new Error('A projektben nincs hangjegyzet.');
  const file = (await google.listChildren(audioFolder.id)).find(item => item.id === String(fileId));
  if (!file) throw new Error('A hangfájl nem ehhez a projekthez tartozik.');
  const buffer = await google.downloadFile(file.id);
  if (buffer.length > 8 * 1024 * 1024) throw new Error('A hangfájl túl nagy az AI-kivonathoz.');
  const model = String(await store.getConfig('GEMINI_AUDIO_MODEL') || config.geminiModel || 'gemini-2.5-flash');
  const payload = {contents: [{parts: [
    {text: SUMMARY_PROMPT},
    {inline_data: {mime_type: file.mimeType || 'audio/mpeg', data: buffer.toString('base64')}}
  ]}]};
  const response = await fetch(GEMINI_ENDPOINT + encodeURIComponent(model) + ':generateContent', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'x-goog-api-key': key},
    body: JSON.stringify(payload)
  });
  if (response.status !== 200)
    throw new Error('Az AI-kivonat nem készült el (HTTP ' + response.status + ').');
  const result = await response.json();
  const parts = result?.candidates?.[0]?.content?.parts || [];
  const summary = parts.map(part => part.text || '').join('\n').trim();
  if (!summary) throw new Error('Az AI nem adott szöveges kivonatot.');
  if (summary.length > 9000) throw new Error('Az AI-kivonat túl hosszú a jegyzetmezőhöz.');
  return {summary: '[AI-kivonat – ' + file.name + ']\n' + summary};
}

function audioProject(google, store, uid) {
  return getDashboardProject(google, store, uid);
}

module.exports = {summarizeAudio, configureAi, isConfigured, resolveApiKey, audioProject};
