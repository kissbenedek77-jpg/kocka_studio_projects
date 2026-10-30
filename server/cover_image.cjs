'use strict';

// MARK: Render címlapkép kiválasztása és a Docs API képcsere előkészítése
// Az Apps Script refreshTechnicalCoverImage_ logikájának Node-megfelelője.
// A Docs API nem tud új elhelyezett (lebegő) képet létrehozni, ezért a meglévő
// címlapkép-objektumot cseréljük le (replaceImage), így a méret és az elrendezés
// változatlan marad.

const IMAGE_MIME = /^image\/(?:jpeg|png|gif|webp)$/i;
// A rendercsomag fájlneve: betűjel + sorszám, tetszőleges elválasztóval
// („b_1 - Photo.jpg”, „b1.jpg”, „b-01.png”, „B 12 – Photo.jpg”).
const NAME_PATTERN = /^([a-z]+)[\s_.#-]*(\d+)\b/i;

// A rendercsomag nevéből (pl. „d”) képzett rendezési érték, a betűk 1..26 helyiértékével.
function renderPackageOrder(label) {
  return String(label || '').toLowerCase().split('').reduce(
    (value, letter) => value * 26 + letter.charCodeAt(0) - 96, 0);
}

function timeOf(value) {
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : 0;
}

// A legutolsó rendercsomag legkisebb sorszámú képe a Render mappa fájljai közül
// (a,b,c → c; a csoporton belül c_1). Kép nélkül null.
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
  const covers = images.filter(item => item.packageOrder === latestOrder);
  covers.sort((a, b) => (a.number - b.number) ||
    (timeOf(b.file.modifiedTime) - timeOf(a.file.modifiedTime)) ||
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
