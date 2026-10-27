# Projektkontextus – Kocka Studió projektmenedzser (Node.js)

## Cél
Építészeti ügyfelek és projektek nyilvántartása, dokumentumkészítés és ügyfélkommunikáció egy Node.js webalkalmazásban. Az adatok Google Sheetben, a dokumentumok Google Drive-on (Docs-sablonokból) vannak; a szerver a hivatalos Google Workspace API-kat használja. Az ügyféladat-felvételtől a műszaki leírásig, az ajánlattól a szerződésig és a levélküldésig a teljes folyamat ebben az alkalmazásban fut.

## Technológiák és futtatás
- Node.js >= 20, CommonJS. Indítás: `npm start` → `server/index.cjs`; a port a Railway `PORT` változójából jön.
- Frontend: a Node szerver szolgálja ki a statikus fájlokat (`dashboard_v2.html`, `technical.html`, `index.html`, `public/`), nincs külön build-lépés.
- Railway: a gyökérben lévő `Dockerfile` készíti a képet (Node 22 + Ghostscript + veraPDF + Poppler + JDK). A `railway.json` az `npm start` parancsot és a `/health` healthchecket írja elő. Egy replika javasolt; Railway Volume nem kell.
- Tesztek: `npm test` (`node --test --test-concurrency=1 tests/*.cjs`). A tesztek nem hívhatnak élő Google-, postafiók- vagy AI-végpontot; mindent mockolni kell.
- A részletes üzemeltetési és beállítási leírás a `NODE_MIGRATION.md`-ben van; ez a fájl a munkamódot és a követelményeket rögzíti.

## Fontos: nincs Apps Script
- A repó szándékosan **nem tartalmaz** Apps Script részt: nincs `Kód.js`, `appsscript.json`, `.clasp.json`, `imap_bridge`, és nincs `clasp`-munkafolyamat.
- Ne telepíts vissza Apps Script hidat, `google.script.run` hívást vagy a régi web appra mutató hivatkozást. A régi `?view=dashboard&project=UID` típusú linkeket a Node szerver irányítja át.
- A korábbi Apps Script telepek és ügyfél UID-k adatként megmaradnak a Sheetben; a kód nem.

## Adat- és dokumentumforrások
- Fő Sheet `Adatok` munkalapja, A–AN oszlop. Az UID, a státusz és a projektmappa-hivatkozás a meglévő helyén marad.
- Rejtett kiegészítő lapok: `_UgyfelBekuldesek`, `_EmailKuldesek`, `_EmailLetoltesek`, `_EmailMegnyitasok`, valamint a projektenkénti **Műszaki leírás** lap.
- Drive: projektmappák, `_System` (dokumentumsablonok, levélsablonok), `_Marketing` (kampányadatok), `_Belső` (összefoglalók).
- A helyi `_System/` mappa a Drive-sablonok verziózott kiinduló példányait tartalmazza; módosításkor a Drive-példányt is frissíteni kell.

## Fő modulok (`server/`)
- `index.cjs` – HTTP szerver, útvonalak, munkamenet, `/api/rpc` belépési pont, env-ellenőrzés.
- `google.cjs` – Google Sheets/Drive/Docs műveletek, projektfa, PDF-audit, dokumentum-előállítás.
- `quota.cjs` – helyi API-híváskeret (Sheets/Docs/Drive perckorlát); minden új Google-hívás ezen menjen át, és a hívásokat össze kell vonni. Fizetős kvótaemelés nem cél.
- `client_data.cjs`, `client_submission.cjs`, `room_data.cjs`, `technical_*.cjs` – ügyféladatok, helyiségek, műszaki leírás.
- `doc_merge.cjs`, `conditional_docs.cjs`, `plans.cjs`, `phases.cjs`, `cover_image.cjs` – dokumentum- és folyamatlogika.
- `mail.cjs`, `email_*.cjs` – IMAP olvasás, levélküldés (Resend/SMTP), követőkép, letöltési linkek.
- `marketing_*.cjs` – marketingoldal, Gemini/Cloudflare kreatívok, Facebook/Instagram közzététel.
- `pdf_quality.cjs` – PDF/A-2b konverzió és validálás; csak sikeres validálás után kerül a fájl a Drive-ra.
- `local_auth.cjs`, `tracking_credential.cjs` – helyi belépés és titkosított Google-hitelesítő.

## Környezeti változók
- Kötelező indításhoz: `BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OWNER_EMAIL`, `SESSION_SECRET` (legalább 32 karakter).
- Nyilvános űrlaphoz és levelezéshez: `GOOGLE_TRACKING_CREDENTIAL` vagy `GOOGLE_SERVICE_ACCOUNT_JSON`.
- Levélküldés: `EMAIL_PROVIDER=resend` + `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (ajánlott, Railway Free/Hobby alatt SMTP tiltott), vagy `EMAIL_PROVIDER=smtp` + `SMTP_*`.
- Levelezési panel: `IMAP_HOST`, `IMAP_PORT=993`, `IMAP_USER`, `IMAP_PASSWORD`, szükség esetén `IMAP_SENT_FOLDER`.
- Helyi belépés: `LOCAL_LOGIN_USERNAME`, `LOCAL_LOGIN_PASSWORD_HASH` (hash: `node scripts/create_local_password_hash.cjs`).
- AI és marketing: `GEMINI_API_KEY` (+ `GEMINI_TECHNICAL_MODEL`, `GEMINI_MARKETING_MODEL`), `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN`, `MARKETING_FOLDER_ID`, `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`.
- Egyéb: `SHEET_ID`, `TEMPLATE_ROOT_FOLDER_ID`, `SYSTEM_FOLDER_ID`, `PROJECT_DATA_TEMPLATE_ID` (van alapértékük), `CLIENT_SUBMISSION_EMAIL=1`, `LEGACY_PUBLIC_ORIGIN`.
- A teljes lista a `.env.example`-ben van. A `SESSION_SECRET` cseréje érvényteleníti a korábban küldött letöltési linkeket.

## Belépés
- Tulajdonosi Google OAuth: `/auth/google` → `/auth/callback`, 12 órás munkamenet.
- Helyi belépés: `/auth/login` → `/auth/local`, 30 napos titkosított, `HttpOnly`, `Secure`, `SameSite=Lax` süti; próbálkozás-korlát címenként.
- Az OAuth átirányítás pontosan `BASE_URL/auth/callback`. Ha a Google consent screen „Testing” állapotban van, a frissítési token 7 nap után lejárhat, és új `GOOGLE_TRACKING_CREDENTIAL` kell.

## Már egyeztetett ügyféladat-kezelési követelmények
- Minden ügyfél egyedi azonosítót (UID) kap. Az első beküldés után a bejegyzés módosítható.
- A lakóhely, a tervezési helyszín és az értesítési cím külön adatcsoport. Az összeállított cím megjelenhet csak olvasható formában.
- Telefonszám-formátum: `+36-xx/xxx-xxxx`. A születési év négy számjegy. Az állampolgársághoz kapcsolódó adóazonosító mező feltételes.
- A projekt típusa választható. A GDPR-tájékoztató modálban jelenik meg, elfogadó jelölőnégyzettel.
- Az űrlap mezőinek ellenőrzése elhagyáskor történik; a felület mobilon is használható.
- Az ügyfélállapot és az űrlapra mutató hivatkozás a táblázat C–D oszlopában szerepel. Az „Új ügyfél” indítás a dashboardról és közvetlen linkkel is működik.
- Az ügyfélbeküldés ténye, a hiányos mezők és a megtekintés ideje a `_UgyfelBekuldesek` lapon van; a dashboard jelzi az új vagy hiányos beküldést. A tulajdonosi értesítő e-mail külön kapcsolható (`CLIENT_SUBMISSION_EMAIL=1`).

## Műszaki leírás követelményei
1. A `/technical?uid=UID` űrlap a projekt **Műszaki leírás** lapjára ment, és mobilon is használható. A mezőket a tényleges sablon és a projektadatok határozzák meg.
2. Hiányzó adatot nem szabad kitalálni. A számok, mértékegységek és a terv szerinti állapot pontosan, a forrásra visszavezethetően kerüljön a szövegbe.
3. Az AI-szövegtervezet csak a kitöltött, tényszerű prózamezőkből dolgozik, és csak ellenőrző előnézetbe kerül; mentés és Docs-frissítés külön művelet. A szakmai jóváhagyás a tervező feladata.
4. A jóváhagyott szöveg a műszaki leírás megfelelő szakaszába kerül; a dokumentum többi részét meg kell őrizni. A DRAFT „ELLENŐRIZENDŐ” jelöléseit a véglegesítés elutasítja.
5. Övezeti adat (beépítettség, építménymagasság, zöldfelületi és szintterületi mutató) csak az adott ingatlanra hatályos, ellenőrizhető HÉSZ/szabályozási terv alapján, forrás-URL-lel, ellenőrzési dátummal és „Ellenőrizve” állapottal kerülhet be. Bizonytalanság esetén kézi ellenőrzés kell; a rendszer nem kutatja fel automatikusan az övezeti előírásokat.
6. A „Magyaratád 531” csak példaként hangzott el: nem igazolt övezeti adat és nem alapértelmezett helyszín.

## Dokumentumok, PDF, levelek
- Az ajánlat, szerződés, meghatalmazás, aláírólap és műszaki leírás Google Docs-másolatként készül; a DRAFT névvel jelölt tartományokon keresztül szinkronizálható.
- PDF-et csak sikeres PDF/A-2b validálás után ment a rendszer. A tanúsítványos digitális aláírással ellátott PDF-et nem alakítja át, mert az érvénytelenítené az aláírást.
- A levelek HTML-sablonjai a Drive `_System` mappájában vannak; a szerver küldés előtt tisztítja a HTML-t. A dokumentumletöltés egyedi, lejáró hivatkozáson megy, a megnyitásokat követőkép rögzíti.
- A küldött levél MIME-másolata IMAP-on az **Elküldött** mappába kerül. Ha a küldés sikerül, de a mentés nem, a felület figyelmeztet; ellenőrzés nélkül nem szabad újraküldeni.

## Fejlesztési munkamód
- Kódváltoztatás előtt nézd át az érintett modult, a Sheet-oszlopokat és a sablont; utána jelöld, mi van ténylegesen kész.
- A már működő ügyféladat-folyamatot és UID-kat őrizd meg. Ne rendezd át a meglévő Sheet-oszlopokat vagy a kitöltött adatokat.
- Új Google-hívásnál használd a `quota.cjs` keretét, és lehetőség szerint vonj össze olvasásokat.
- A személyes adatokat, jelszavakat, API-kulcsokat és tokeneket ne írd naplóba, forrásfájlba vagy tesztbe. A `.env`, `keys`, `.clasprc.json`, szolgáltatásfiók-JSON és IMAP-jelszó nem kerülhet verziókezelésbe.
- Éles telepítés előtt helyben futtasd az `npm test`-et, majd a tesztprojekten ellenőrizd az űrlap beküldését, a meglévő rekord módosítását, a mobilos megjelenést, a dokumentumba illesztést és a levélküldést.
- A `/health` végpontnak `{"ok":true}` választ kell adnia; ez a Railway healthcheck alapja.

## Amit még a projektből kell megállapítani
- A tényleges Sheet-azonosító, munkalapnevek és a végleges oszlopkiosztás ellenőrzése éles adaton.
- Az élő Google OAuth-kliens, a Drive-mappák és a sablonok aktuális állapota.
- A Railway-szolgáltatás tényleges domainje, a beállított változók és a legutóbbi telepítés eredménye.
