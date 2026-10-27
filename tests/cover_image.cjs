'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../server/domain.cjs');
const projectSheet = require('../server/project-sheet.cjs');

function image(name, mimeType = 'image/jpeg', modifiedTime = '2026-09-28T12:00:00Z') {
  return {id: name, name, mimeType, modifiedTime};
}

function fakeGoogle(files) {
  return {
    async listChildren(id) {
      if (id === 'project') {
        return [{id: 'render', name: 'Render', mimeType: 'application/vnd.google-apps.folder'}];
      }
      return files;
    }
  };
}

test('A legfrissebb Render képcsomag 1. képe lesz a címlap', async () => {
  const files = [
    image('a_1 - Photo.jpg'),
    image('b_1 - Photo.jpg'),
    image('b_2 - Photo.jpg'),
    image('b11.lsf', 'video/x-la-asf'),
    image('d_1 - Photo.jpg'),
    image('d_2 - Photo.jpg')
  ];
  const cover = await projectSheet.getLatestRenderCoverFile(fakeGoogle(files), 'project');
  assert.equal(cover.name, 'd_1 - Photo.jpg');
});

test('Hiányzó 1. számú kép és nem kép fájlok kezelése', async () => {
  await assert.rejects(
    () => projectSheet.getLatestRenderCoverFile(fakeGoogle([image('a_1 - Photo.jpg'), image('b_2 - Photo.jpg')]), 'project'),
    /hiányzik az 1\. számú kép/);
  const none = await projectSheet.getLatestRenderCoverFile(fakeGoogle([image('notes.txt', 'text/plain')]), 'project');
  assert.equal(none, null);
});

test('A csomagsorrend a betűjelzésből számolódik', () => {
  assert.ok(domain.renderPackageOrder('d') > domain.renderPackageOrder('b'));
  assert.ok(domain.renderPackageOrder('b') > domain.renderPackageOrder('a'));
});
