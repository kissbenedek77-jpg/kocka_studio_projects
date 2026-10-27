# Node.js átállás

A projekt teljes egészében Node.js alatt fut. A korábbi Google Apps Script kód (`Kód.js`, `appsscript.json`) és a hozzá tartozó tele­pítés megszűnt; minden funkció a `server/` mappában működik. Az adatok továbbra is a meglévő `Adatok` Google Sheetben (A–AN, 40 oszlop) és a Drive-projektmappákban maradnak.

## Indítás

```bash
npm ci
npm start        # node server/index.cjs
npm test         # node --test tests/*.cjs
npm run check    # élő integráció-ellenőrzés (Railway shell vagy lokális .env)
```

A szerver plain `node:http`, nincs web framework. A `GET /health` végpont `{ok:true}` választ ad.

## Első ellenőrzés élesítés után

A `npm run check` végigpróbálja a beállított hitelesítő adatokat, és soronként kiírja, mi működik:

- kötelező és opcionális változók megléte (hiányzó opcionális csak figyelmeztetés),
- Google Sheets: beolvassa az `Adatok` rekordjait,
- Google Drive: megnyitja a sablonmappát,
- Google Docs: megnyitja az ajánlat sablondokumentumot,
- IMAP: bejelentkezik és megkeresi az elküldött mappát,
- SMTP: `verify()` a megadott kiszolgálón,
- Gemini: kulcs ellenőrzése (env vagy `_ProjektBeállítások`) egy modellistával.

Hibás token esetén magyar magyarázatot ad (pl. `invalid_grant` → futtasd újra: `npm run token`). A script a `.env` fájlt is beolvassa, ha van; Railway alatt a változók közvetlenül a környezetből jönnek. Kilépési kód 1, ha bármelyik ellenőrzés hibás.

## Végpontok

| Útvonal | Leírás |
| --- | --- |
| `GET /health` | Állapotellenőrzés |
| `GET /auth/login`, `GET /auth/callback`, `GET /auth/logout` | Tulajdonosi Google OAuth belépés |
| `GET /dashboard` | Dashboard (csak a tulajdonosi fiókkal) |
| `POST /api/rpc` | Dashboard RPC (`X-Kocka-RPC: 1`, azonos origin) |
| `GET /form?uid=...` | Nyilvános ügyfélűrlap, a `google.script.run` hívást fetch shim helyettesíti |
| `POST /api/form` | Űrlap API (`X-Kocka-Form: 1`): `createNewRecordForWeb`, `saveData`, `getData` |

## Környezeti változók

Kötelező: `BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OWNER_EMAIL`, `SESSION_SECRET` (legalább 32 karakter).

- `OWNER_REFRESH_TOKEN`: a nyilvános `/form` űrlap szerveroldali Google-hozzáférése. Enélkül az űrlap mentése 503-mal jelez. Előállítás: `npm run token` (a Google Cloud OAuth kliensnél add hozzá a `http://127.0.0.1:53682/oauth2callback` átirányítást).
- `SHEET_ID`, `SHEET_NAME`: alapértelmezett `Adatok`.
- `IMAP_*`: elküldött levelek olvasása.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`: levélküldés. Ha nincs megadva, az IMAP-adatokból számolódik.
- `GEMINI_API_KEY`, `GEMINI_MODEL`: AI-kivonat. A dashboardon megadott kulcs a `_ProjektBeállítások` munkalapra kerül és elsőbbséget élvez.

A Google OAuthhoz ezek a scope-ok kellenek: `spreadsheets`, `drive`, `documents`, valamint `openid`/`email`. Az átirányítási URI: `https://SAJAT-DOMAIN/auth/callback`.

## Modulok

| Fájl | Felelősség |
| --- | --- |
| `server/index.cjs` | HTTP szerver, OAuth munkamenet, űrlap és RPC végpontok |
| `server/config.cjs` | Környezeti változók betöltése és ellenőrzése |
| `server/domain.cjs` | Tiszta üzleti logika: oszlopok, validáció, mappanév, méretarány, helyiségek, építményérték, helyőrzők |
| `server/google.cjs` | Sheets/Drive/Docs alacsony szintű kliensek |
| `server/store.cjs` | Rekord- és rejtett munkalap-kezelés, `saveData`, zárolás |
| `server/project-sheet.cjs` | Tervezési adatlap, helyiséglista, tervjegyzék, címlapkép |
| `server/docs.cjs` | Google Docs API: helyőrzők, feltételes blokkok, táblázatok, műszaki leírás |
| `server/documents.cjs` | Dokumentumgenerálás, szinkron, PDF-véglegesítés |
| `server/projects.cjs` | Projektmappák, ellenőrzések, indítás/lezárás/újraindítás, ajánlat, hangjegyzet |
| `server/emails.cjs` | Ajánlat/szerződés/adatbekérő/tervcsomag e-mail, ZIP |
| `server/mailer.cjs` | SMTP-küldés nodemailerrel |
| `server/mail.cjs` | Elküldött levelek olvasása IMAP-on |
| `server/ai.cjs` | Gemini hanganyag-kivonat |
| `server/form.cjs` | Űrlap HTML és API |
| `server/dashboard.cjs` | Dashboard RPC diszpécser |

## Adatmodell

- Az `Adatok` munkalap A–AN oszlopai változatlanok. A sorépítés a `server/domain.cjs` `FIELDS`/`buildRow`/`rowToData` függvényeiben él; oszlopváltoztatásnál itt kell módosítani.
- Az UID továbbra is 32 hex karakter, nagybetűvel, az A oszlopban. `saveData` UID-del csak meglévő rekordot módosít; új rekord UID nélkül jön létre.
- A rejtett munkalapok nevei kompatibilitás miatt változatlanok: `_ProjektMemo`, `_ProjektJegyzetek`, `_ProjektÚjraindítás`, `_ProjektEllenőrzés`, `_ProjektElvártFájlok`, `_ProjektIdővonal`, `_DokumentumIndex`, `_ProjektBeállítások`.

## Drive-életciklus

- `getProjectsParentFolder()` a `TEMPLATE_ROOT_FOLDER_ID` szülőmappája (`_Ajánlatok`).
- `getStartedProjectsFolder()` ennek szülője (munka mappa).
- Indítás: megerősítés után a `_Belső` dokumentumok véglegesítése, majd a projektmappa a munka mappába mozog, státusz `AKTÍV`.
- Lezárás: a `írásos` dokumentumok PDF-véglegesítése, majd mozgatás a munka mappa alatti `_Elkészült` mappába, státusz `KÉSZ`.
- Névütközés esetén a művelet a mozgatás előtt hibát ad, részleges véglegesítés nélkül.

## Ismert korlátok

- Az Apps Script `onEdit` triggerek nem portolhatók; a dokumentumszinkron dashboard/űrlap műveletekből indul.
- A Google Docs API-s táblázat-visszaállítás és a pozicionált címlapkép cseréje közelítő, a sablonok szerkezetétől függ.
- Valós Google/Drive/Docs/IMAP/SMTP integráció csak éles hitelesítő adatokkal ellenőrizhető; a tesztek modell-szintűek.
