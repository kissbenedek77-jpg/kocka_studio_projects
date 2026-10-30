'use strict';

// A Gemini szövegmodellek hívása egy helyen: egységes modellnév-ellenőrzés,
// egyértelmű hibaüzenet és automatikus visszaesés a bevált alapmodellre, ha a
// beállított modell ehhez a kulcshoz vagy API-verzióhoz nem érhető el (HTTP 404).
// A Google 2025-ös modelljei (például gemini-2.5-flash) új projekteknél már nem
// indíthatók, ezért a régi Railway-beállítás ne némítsa el a szövegezést.

const DEFAULT_TEXT_MODEL = 'gemini-3.5-flash-lite';
const MODEL_PATTERN = /^[A-Za-z0-9._-]{3,80}$/;
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';

function modelName(value, fallback = DEFAULT_TEXT_MODEL) {
  const text = String(value || '').trim();
  return text || fallback;
}

function assertModelName(model) {
  if (!MODEL_PATTERN.test(model))
    throw new Error('Érvénytelen Gemini modellnév: „'+model+'”. Csak betű, szám, pont, '+
      'kötőjel és aláhúzás használható, 3–80 karakter között (például '+DEFAULT_TEXT_MODEL+').');
  return model;
}

async function providerMessage(response) {
  try {
    const data = await response.json();
    return String(data?.error?.message || '').replace(/\s+/g,' ').trim().slice(0,300);
  } catch {
    return '';
  }
}

function failureText({model, status, detail, attempted = []}, setting) {
  const models = attempted.length > 1
    ? 'a(z) „'+attempted[0]+'” és a tartalék „'+attempted[1]+'” modell sem érhető el'
    : 'a(z) „'+model+'” modell nem érhető el';
  let message;
  if (status === 404) {
    message = models+' ehhez az API-kulcshoz (HTTP 404). '+
      'Állítsd a(z) '+setting+' beállítást „'+DEFAULT_TEXT_MODEL+'” értékre a Railway '+
      'Variables között, vagy válassz a Google AI Studio-ban elérhető modellt';
  } else if (status === 402) {
    message = 'a Google AI Studio projekt egyenlege vagy számlázása miatt a(z) „'+model+'” '+
      'modell nem használható (HTTP 402)';
  } else if (status === 400) {
    message = 'a(z) „'+model+'” modell kérése érvénytelen (HTTP 400)';
  } else if (status === 401 || status === 403) {
    message = 'a(z) „'+model+'” modell hívása nem engedélyezett (HTTP '+status+'). '+
      'Ellenőrizd a GEMINI_API_KEY értékét és a kulcs projektjének Gemini API-hozzáférését';
  } else if (status === 429) {
    message = 'a szolgáltatás HTTP 429 hibát adott (átmeneti túlterhelés vagy elfogyott kvóta)';
  } else {
    message = 'a szolgáltatás HTTP '+status+' hibát adott';
  }
  return detail ? message+'. Google: '+detail : message+'.';
}

// A payload a Gemini generateContent kéréstörzse (contents, generationConfig).
async function generateContent({apiKey, model, payload, setting = 'GEMINI_TECHNICAL_MODEL',
  fetchImpl = fetch, timeoutMs = 60000}) {
  const configured = assertModelName(modelName(model));
  // Csak modellhiány (404) esetén próbáljuk újra az alapmodellel; más hibát
  // (kvóta, jogosultság, túlterhelés) nem ismétlünk, mert az pazarlás lenne.
  const attempts = configured === DEFAULT_TEXT_MODEL
    ? [configured] : [configured, DEFAULT_TEXT_MODEL];
  let failure = null;
  for (const name of attempts) {
    let response;
    try {
      response = await fetchImpl(BASE_URL+name+':generateContent',{
        method:'POST',
        headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
        signal:AbortSignal.timeout(timeoutMs),
        body:JSON.stringify(payload)
      });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw error;
      throw Object.assign(new Error('a szolgáltatás nem érhető el'),{status:502});
    }
    if (response.ok) return {data:await response.json(),model:name};
    failure = {status:Number(response.status)||502,detail:await providerMessage(response),
      model:name,attempted:attempts};
    if (failure.status !== 404) break;
  }
  throw Object.assign(new Error(failureText(failure,setting)),
    {status:failure.status === 429 ? 429 : 502, model:failure.model});
}

module.exports = {DEFAULT_TEXT_MODEL,modelName,assertModelName,failureText,generateContent};
