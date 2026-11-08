'use strict';

// A szerver saját naplója (ez az, ami a Railway deploy logban is látszik).
// A dashboard alsó sávja ezt jeleníti meg, ezért a bejegyzéseket egy rövid
// gyűrűpufferben tartjuk, és az újakat sorszám (id) alapján lehet lekérni.
//
// A naplózás nem tartalmazhat személyes adatot, jelszót, API-kulcsot vagy
// tokent. A biztonság kedvéért a gyakori titokformákat még itt kimaszkoljuk.

const MAX_ENTRIES = 500;
const MAX_TEXT = 2000;

const entries = [];
let sequence = 0;
let installed = false;

const MASKS = [
  [/AIza[0-9A-Za-z_-]{20,}/g, 'AIza***'],
  [/(Bearer\s+)\S+/gi, '$1***'],
  [/((?:api[_-]?key|token|secret|password|passwd)\s*[:=]\s*)\S+/gi, '$1***']
];

function mask(value) {
  let text = String(value);
  for (const [pattern, replacement] of MASKS) text = text.replace(pattern, replacement);
  return text;
}

function record(level, text) {
  const value = mask(text).replace(/\r/g,'').trimEnd();
  if (!value.trim()) return null;
  sequence += 1;
  const entry = {
    id: sequence,
    time: Date.now(),
    level: level === 'error' ? 'error' : (level === 'warning' ? 'warning' : 'info'),
    text: value.slice(0, MAX_TEXT)
  };
  entries.push(entry);
  while (entries.length > MAX_ENTRIES) entries.shift();
  return entry;
}

// A folyamat szabványos kimenetének és hibakimenetének figyelése. A write
// eredeti viselkedését (és a különböző hívási formákat) megtartjuk.
function install(streams) {
  if (installed) return;
  installed = true;
  const targets = streams || [[process.stdout,'info'],[process.stderr,'error']];
  for (const [stream, level] of targets) {
    if (!stream || typeof stream.write !== 'function') continue;
    const original = stream.write;
    stream.write = function write(chunk, encoding, callback) {
      try {
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        record(level, text);
      } catch (_) { /* a naplózás hibája ne szakítsa meg a kimenetet */ }
      return original.apply(this, arguments);
    };
  }
}

// A megadott sorszám utáni bejegyzések. A cursor a legutolsó visszaadott id.
function read(afterId, limit) {
  const cursor = Number(afterId) > 0 ? Number(afterId) : 0;
  const max = Math.min(Math.max(Number(limit) || 100, 1), 300);
  const fresh = entries.filter(entry => entry.id > cursor).slice(-max);
  return {
    entries: fresh,
    cursor: fresh.length ? fresh[fresh.length-1].id : cursor,
    total: entries.length
  };
}

function reset() {
  entries.length = 0;
  sequence = 0;
}

module.exports = {install, record, read, reset, MAX_ENTRIES};
