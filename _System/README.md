# E-mail sablonok

A négy HTML-fájlt a Google Drive `_System` mappájába kell feltölteni, amely a
`_Template` mappa mellett van. A Node alkalmazás a Drive-ban található fájlokat
olvassa; a helyi példányok a verziózott kiinduló sablonok.

Támogatott helyőrzők: `{{PROJECT_NAME}}`, `{{FORM_URL}}`, `{{DOWNLOAD_URL}}`.
A letöltőgomb és a szöveges link külön törölhető a levélszerkesztőben, és a
szerkesztő gombjaival újra beszúrható. A Drive-ban végzett sablonmódosítások
legfeljebb egy perc múlva jelennek meg a következő előnézetben.

A négy levél a Kocka Studio Projects grafit–zöld arculatát követi. Felső
brandfejléc helyett szerkeszthető, törölhető és újra beszúrható lábléc/aláírás
van bennük. A levélben soron belüli stílusokat használunk a levelezőprogramok
miatt; a webes `--ks-*` CSS-változók ide nem kerülnek át.

A sablonok HTML-töredékek: a szerver adja hozzá a `html` és `body` elemeket.
Egyszerű címsorok, bekezdések, listák, linkek és korlátozott inline stílusok
használhatók. A szerver a scripteket, eseménykezelő attribútumokat és nem
engedélyezett HTML/CSS elemeket eltávolítja küldés előtt.
