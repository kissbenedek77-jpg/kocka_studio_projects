'use strict';

// A „Tervezési adatok” szöveges blokkjának sorszintű igazítása. A sablon
// statikus sorai közül a hiányzó övezeti adatot nem hagyjuk üresen:
//   - „Max. pinceszinti beépíthetőség:” sor: ha nincs igazolt érték, kimarad;
//   - „Szintterületi mutató:” sor: ha nincs előírás, „nincs előírás” szerepel.
// A függvény tiszta: a dokumentum kiolvasott szerkezetéből és a
// behelyettesítendő értékekből számolja a Google Docs batchUpdate kéréseit.

const GAP = '[KIEGÉSZÍTENDŐ:';
const FLOOR_AREA = /^Szintterületi mutató:/i;
const BASEMENT = /^Max\.?\s*pinceszinti beépíthetőség:/i;
const VALUE_HEADING = /^Építményérték számítása\b/i;
const VALUE_SOURCE = /^Jogszabályi alap és számítási módszer:/i;
const FLOOR_AREA_LABEL = 'Szintterületi mutató:';
const VALUE_HEADING_LABEL = 'Építményérték számítása';
const NO_RULE = ' nincs előírás';

function paragraphText(item) {
  return (item.paragraph?.elements || []).map(part => part.textRun?.content || '').join('');
}

function hasValue(value) {
  const text = String(value ?? '').trim();
  return Boolean(text) && !text.includes(GAP);
}

function requestIndex(request) {
  return request.deleteContentRange?.range.startIndex ??
    request.insertText?.location.index ?? 0;
}

// Az építményérték fejezetcíme a jogszabályt is tartalmazza, a külön
// „Jogszabályi alap és számítási módszer” sor pedig elmarad.
function valueHeading(values = {}) {
  const regulation = String(values['EPITMENYERTEK:jogszabaly_es_modszer'] || '').trim();
  if (!regulation) return VALUE_HEADING_LABEL;
  const suffix = /szerint\s*$/i.test(regulation) ? '' : ' szerint';
  return VALUE_HEADING_LABEL+' ('+regulation+suffix+')';
}

function technicalLineRequests(document, values = {}) {
  const requests = [];
  const heading = valueHeading(values);
  for (const item of document?.body?.content || []) {
    if (!item.paragraph) continue;
    const text = paragraphText(item).replace(/\r?\n$/,'');
    const start = Number.isInteger(item.startIndex) ? item.startIndex
      : item.paragraph.elements?.[0]?.startIndex;
    const end = Number.isInteger(item.endIndex) ? item.endIndex : null;
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    if (BASEMENT.test(text)) {
      if (!hasValue(values['OVEZET:max_pinceszinti_beepites']))
        requests.push({deleteContentRange:{range:{startIndex:start,endIndex:end}}});
      continue;
    }
    if (VALUE_SOURCE.test(text)) {
      requests.push({deleteContentRange:{range:{startIndex:start,endIndex:end}}});
      continue;
    }
    if (VALUE_HEADING.test(text)) {
      if (text.trim() !== heading) {
        requests.push({deleteContentRange:{range:{startIndex:start,endIndex:end - 1}}});
        requests.push({insertText:{location:{index:start},text:heading}});
      }
      continue;
    }
    if (FLOOR_AREA.test(text) &&
        !hasValue(values['TERVEZESI_ADATOK:Munkalap1!B7'])) {
      // A címke utáni részt (az üres értéket és a „m²/m²” utótagot) cseréljük.
      const labelEnd = start + FLOOR_AREA_LABEL.length;
      if (end - 1 > labelEnd) {
        requests.push({deleteContentRange:{range:{startIndex:labelEnd,endIndex:end - 1}}});
        requests.push({insertText:{location:{index:labelEnd},text:NO_RULE}});
      }
    }
  }
  // A dokumentum végéről visszafelé haladunk, hogy a törlés és a beszúrás ne
  // tolja el a későbbi indexeket. Az azonos helyen álló törlés megelőzi a
  // beszúrást (stabil rendezés).
  return requests.sort((a,b) => requestIndex(b) - requestIndex(a));
}

module.exports = {technicalLineRequests,hasValue,valueHeading};
