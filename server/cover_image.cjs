'use strict';

// MARK: Render címlapkép kiválasztása és a Docs API képcsere előkészítése
// Az Apps Script refreshTechnicalCoverImage_ logikájának Node-megfelelője.
// A Docs API nem tud új elhelyezett (lebegő) képet létrehozni, ezért a meglévő
// címlapkép-objektumot cseréljük le (replaceImage), így a méret és az elrendezés
// változatlan marad.

const IMAGE_MIME = /^image\/(?:jpeg|png|gif)$/i;
const NAME_PATTERN = /^([a-z]+)[_\s-]+(\d+)(?=\D|$)/i;

// A rendercsomag nevéből (pl. „d”) képzett rendezési érték, a betűk 1..26 helyiértékével.
function renderPackageOrder(label) {
  return String(label || '').toLowerCase().split('').reduce(
    (value, letter) => value * 26 + letter.charCodeAt(0) - 96, 0);
}

function timeOf(value) {
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : 0;
}

// A legfrissebb rendercsomag 1. számú képe a Render mappa fájljai közül.
// Kép nélkül null; ha a legfrissebb csomagból hiányzik az 1. kép, hibát jelez.
function latestRenderCoverFile(files) {
  const images = [];
  for (const file of files || []) {
    if (!IMAGE_MIME.test(String(file?.mimeType || ''))) continue;
    const match = String(file?.name || '').match(NAME_PATTERN);
    if (!match) continue;
    images.push({file, packageOrder: renderPackageOrder(match[1]), number: Number(match[2])});
  }
  if (!images.length) return null;
  const latestOrder = Math.max(...images.map(item => item.packageOrder));
  const covers = images.filter(item =>
    item.packageOrder === latestOrder && item.number === 1);
  if (!covers.length)
    throw new Error('A legfrissebb Render képcsomagból hiányzik az 1. számú kép.');
  covers.sort((a, b) => (timeOf(b.file.modifiedTime) - timeOf(a.file.modifiedTime)) ||
    String(a.file.name).localeCompare(String(b.file.name), 'hu'));
  return covers[0].file;
}

// A Docs API dokumentumában a legnagyobb elhelyezett képobjektum (a címlapkép).
// Visszaadja az objektum azonosítóját, és a korábbi méretet pontban.
function coverImageObject(document) {
  let best = null;
  for (const [objectId, object] of Object.entries(document?.positionedObjects || {})) {
    const embedded = object?.positionedObjectProperties?.embeddedObject;
    if (!embedded?.imageProperties) continue;
    const size = embedded.size || {};
    const width = Number(size.width?.magnitude || 0);
    const height = Number(size.height?.magnitude || 0);
    const area = width * height;
    if (!best || area > best.area) best = {objectId, width, height, area};
  }
  if (!best)
    throw new Error('A műszaki leírás címlapján nincs lecserélhető elhelyezett kép.');
  return best;
}

// A Drive-fájl közvetlen letöltési címe a Docs API számára.
// A Docs API a képet szerveroldalon, hitelesítés nélkül tölti le, ezért a fájlnak
// a kérés pillanatában nyilvánosan olvashatónak kell lennie (lásd refreshTechnicalCoverImage).
function publicImageUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
}

// A Docs API képcsere kérése: a meglévő képobjektumot cseréli, a helyét és méretét megtartva.
function coverImageRequest(objectId, uri) {
  return {replaceImage:{imageObjectId:objectId, uri, imageReplaceMethod:'CENTER_CROP'}};
}

module.exports = {IMAGE_MIME, NAME_PATTERN, renderPackageOrder, latestRenderCoverFile,
  coverImageObject, publicImageUrl, coverImageRequest};
