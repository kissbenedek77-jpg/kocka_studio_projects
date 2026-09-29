# Node.js / Railway átállás

Az új Node.js szerver tulajdonosi Google-belépéssel megnyitja a meglévő dashboardot. A projektlistát a jelenlegi `Adatok` munkalapról olvassa, a mappákat a Drive API-n keresztül böngészi, az elküldött leveleket pedig közvetlenül IMAP-on kérdezi le. A korábbi Apps Script űrlapra mutató `/form` útvonal megtartja a meglévő UID-s hivatkozásokat.

**Ez jelenleg olvasási előnézet.** A dokumentumgenerálás, ügyféladat-mentés, ajánlat- és memo-szinkron, projektindítás, lezárás és levélküldés még a meglévő Apps Scriptben működik. A Node szerver ezekre 501-es választ ad, nem végez hiányos adatírást. A dashboardban látható fájl- és dokumentumellenőrzés sem teljes még. Az Apps Script telepítését az átállás végéig meg kell tartani.

## Telepítési előkészítés

1. A meglévő `kocka_studio_projects` GitHub-tárban csak a `.gitignore` által engedett fájlok legyenek. A `.env`, `.clasprc.json`, IMAP-jelszó és OAuth-kulcs nem kerülhet a tárba.
2. Railway-en készíts GitHub-forrású Node.js szolgáltatást. A `npm ci` és `npm start` parancsok a gyökérmappából működnek; a szerver a Railway `PORT` változóját használja. Az egész alkalmazásnak nincs szüksége Railway Storage-ra, amíg minden tartós adat Google Sheetben/Drive-on vagy IMAP-on marad.
3. Google Cloud Console-ban engedélyezd a Sheets és Drive API-t, és hozz létre **Web application** típusú OAuth-klienst. Az átirányítási URI pontosan `https://SAJAT-DOMAIN/auth/callback` legyen. A belépő Google-fióknak hozzá kell férnie a jelenlegi Sheetshez és projektmappákhoz. A Google OAuth hozzájárulási képernyő beállítása is szükséges.
4. Railway Variables alatt add meg a `.env.example` változóit. `SESSION_SECRET` legyen véletlen, legalább 32 karakteres érték. Az `IMAP_USER` és `IMAP_PASSWORD` titkos változó; a korábban chatben megadott IMAP-jelszót érdemes lecserélni, mielőtt ide beállítod.
5. A Railway publikus HTTPS-címét írd a `BASE_URL` változóba, és ugyanazt az OAuth átirányítási URI-ban is. Bejelentkezéskor a Google-től kapott hozzáférés a 12 órás, titkosított, HttpOnly cookie-ban marad.
6. A `LEGACY_FORM_URL` legyen a jelenleg működő Apps Script `/exec` címe. A projektadatlapokon lévő dashboardlinkek átállítása csak a Node-műveletek teljes tesztje után javasolt.

Helyi ellenőrzés: `npm ci`, majd `npm test`. A `GET /health` endpoint a futó szerver alapellenőrzése. Valós Sheet, Drive és IMAP integráció csak megadott titkokkal és Google-belépéssel próbálható.

## Hátralevő átültetés

- Ügyfélűrlap Node API-ja a jelenlegi UID- és oszlopkezeléssel, változtatás utáni dokumentumszinkronnal.
- Dashboard írási műveletei, ajánlati adatok, memo, elvárt fájlok, státuszok és újraindítás.
- Google Docs sablonkitöltés, műszaki leírás, helyiséglista, tervjegyzék, PDF-csomag és a projekt életciklusának véglegesítése.
- E-mail küldés, hangfájl/AI kivonat, teljes fájl- és ellentmondásellenőrzés.
- Integrációs próba tesztprojekten, majd fokozatos linkátállítás és a régi telepítés megszüntetése.
