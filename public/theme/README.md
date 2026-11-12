# Kocka Stúdió – egységes téma csomag

A teljes tulajdonosi felület (dashboard, marketing, műszaki leírás, weboldal-kezelő,
belépés, ajánlatkérő) egyetlen Bootstrap 5 témát használ.

## Fájlok

| Fájl | Szerep |
| --- | --- |
| `public/theme/ks-theme.css` | Az egyetlen stíluslap: brand tokenek, Bootstrap 5.3 változók, komponensek (gomb, űrlap, kártya, értesítés, jelvény, táblázat, modál), a régi osztályok (`.button`, `.panel`, `.notice`, `.field`) aliasingja, valamint a korábbi `ks-design.css` és oldalspecifikus szabályok. |

A külön `ks-design.css` megszűnt; minden oldal a Bootstrapet és ezt az egy témát tölti be.

## Betöltési sorrend

A `server/index.cjs` `nodePage()` függvénye minden oldalra ebben a sorrendben
illeszti be:

1. `bootstrap.min.css`
2. Font Awesome
3. az oldal saját `<style>` blokkja
4. `ks-design.css`
5. `theme/ks-theme.css`

A téma utolsóként töltődik be, ezért a brand színeket és a komponensek
megjelenését egységesen érvényesíti. Az oldalak saját változóit
(`--ink`, `--muted`, `--line`, `--gold`, `--dark`, `--mint`, `--soft`) a téma
felülírja a közös értékekkel, így a meglévő egyedi osztályok is egységesek
lesznek.

## Brand tokenek

| Token | Érték | Használat |
| --- | --- | --- |
| `--ks-dark` | `#3e3e3e` | fejléc, sötét gombok |
| `--ks-ink` | `#26312e` | szöveg, elsődleges gomb |
| `--ks-muted` | `#627069` | másodlagos szöveg |
| `--ks-line` | `#d7dad4` | keretek |
| `--ks-gold` | `#a88952` | kiemelés, fókusz, aktív mező |
| `--ks-mint` | `#77c59e` | márka-zöld |
| `--ks-bg` | `#eeeee9` | oldalháttér |
| `--ks-surface` | `#ffffff` | kártyák |
| `--ks-danger` | `#a6372f` | hiba |
| `--ks-success` | `#4f8562` | siker |
| `--ks-warning` | `#a9782a` | figyelmeztetés |

A Bootstrap változói (`--bs-body-*`, `--bs-border-*`, `--bs-focus-ring-color`,
`--bs-btn-*`, `--bs-card-*`, `--bs-navbar-*`, `--bs-table-*`) a tokenekből
származnak.

## Használat

Új komponensnél a Bootstrap osztályokat használd (`btn btn-primary`,
`form-control`, `card`, `alert`, `badge`, `table`). A régi `.button`,
`.panel`, `.notice`, `.field` osztályok továbbra is működnek, mert a téma
azokat is a brand megjelenésre képezi.

A futásidőben injektált modulok (`ai-composer.js`, `message-center.js`)
színei `var(--ks-*, fallback)` formában hivatkoznak a tokenekre, ezért a
téma módosításával azok is egységesen változnak.
