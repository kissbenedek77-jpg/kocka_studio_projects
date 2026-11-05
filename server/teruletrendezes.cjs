'use strict';

// A 2018. évi CXXXIX. törvény (Magyarország és egyes kiemelt térségeinek
// területrendezési tervéről) szerinti nyilatkozat csak a kiemelt térségek
// településein jelenik meg. A lista a jogszabály területi hatálya szerinti
// településeket tartalmazza; a zárójelben megadott alternatív nevek is
// elfogadottak.
const SETTLEMENTS = [
  // Budapest
  'Budapest',
  // Pest vármegyei települések
  'Biatorbágy', 'Budajenő', 'Budakalász', 'Budakeszi', 'Budaörs', 'Bugyi', 'Csobánka',
  'Csomád', 'Csömör', 'Dabas', 'Délegyháza', 'Diósd', 'Dunabogdány', 'Dunaharaszti',
  'Dunakeszi', 'Dunamocs', 'Dunavarsány', 'Ecser', 'Erdőkertes', 'Érd', 'Fót',
  'Galgahévíz', 'Göd', 'Gödöllő', 'Gyál', 'Gyömrő', 'Halásztelek', 'Inárcs', 'Isaszeg',
  'Kerepes', 'Kismaros', 'Kisnémedi', 'Kistarcsa', 'Leányfalu', 'Maglód', 'Majosháza',
  'Mogyoród', 'Monor', 'Nagykáta', 'Nagymaros', 'Nagykovácsi', 'Ócsa', 'Őrbottyán',
  'Páty', 'Pécel', 'Pilisborosjenő', 'Piliscsaba', 'Pilisjászfalu', 'Pilisszántó',
  'Pilisszentkereszt', 'Pilisszentlászló', 'Pilisvörösvár', 'Pomáz', 'Pusztazámor',
  'Rad', 'Rád', 'Solymár', 'Szada', 'Százhalombatta', 'Szentendre', 'Szigethalom',
  'Szigetmonostor', 'Szigetszentmárton', 'Szigetszentmiklós', 'Szigetújfalu', 'Sződ',
  'Sződlidget', 'Tahitótfalu', 'Taksony', 'Tárnok', 'Telki', 'Tök', 'Tököl',
  'Törökbálint', 'Újhartyán', 'Üllő', 'Üröm', 'Vác', 'Vácrátót', 'Valkó', 'Vecsés',
  'Veresegyház', 'Visegrád', 'Zsámbék',
  // Balaton és környéke
  'Ádánd', 'Andocs', 'Balatonberény', 'Balatonboglár', 'Balatonendréd', 'Balatonfenyves',
  'Balatonföldvár', 'Balatonkeresztúr', 'Balatonlelle', 'Balatonmáriafürdő',
  'Balatonőszöd', 'Balatonszabadi', 'Balatonszárszó', 'Balatonszemes',
  'Balatonszentgyörgy', 'Balatonújlak', 'Bábonymegyer', 'Bedegkér', 'Bálványos',
  'Bonnya', 'Buzsák', 'Fenyvesvölgy', 'Fonyód', 'Gamás', 'Karád', 'Kereki', 'Kéthely',
  'Kőröshegy', 'Látrány', 'Lengyeltóti', 'Lulla', 'Marcali', 'Mernye', 'Nagycsepely',
  'Ordacsehi', 'Pusztaszemes', 'Plattensee', 'Siáj', 'Siófok', 'Som', 'Somogybabod',
  'Somogydöröcske', 'Somogyegres', 'Somogymeggyes', 'Szántód', 'Szólád', 'Szőlősgyörök',
  'Tab', 'Torvaj', 'Táska', 'Teleki', 'Visz', 'Zamárdi', 'Zala', 'Zics',
  'Ábrahámhegy', 'Alsóörs', 'Aszófő', 'Badacsonytomaj', 'Badacsonytördemic',
  'Balatonakali', 'Balatonakarattya', 'Balatonalmádi', 'Balatoncsicsó',
  'Balatonfőkajár', 'Balatonfüred', 'Balatonfűzfő', 'Balatongyörök', 'Balatonhenye',
  'Balatonkenese', 'Balatonrendes', 'Balatonszepezd', 'Balatonszőlős', 'Balatonudvari',
  'Barnag', 'Bazsi', 'Bodorfa', 'Borzavár', 'Csopak', 'Dörgicse', 'Gyulakeszi',
  'Hegyesd', 'Hegymagas', 'Hidegkút', 'Kapolcs', 'Káptalantóti', 'Kékkút', 'Kővágóörs',
  'Köveskál', 'Lesencefalu', 'Lesencetomaj', 'Litér', 'Lovas', 'Mindszentkálla',
  'Monostorapáti', 'Monoszló', 'Nagyvázsony', 'Nemesgulács', 'Nemesvita', 'Óbudavár',
  'Örvényes', 'Paloznak', 'Pula', 'Raposka', 'Révfülöp', 'Salföld', 'Sáska', 'Sümeg',
  'Sümegprága', 'Szentantalfa', 'Szentjakabfa', 'Szigliget', 'Tagyon', 'Tapolca',
  'Tihany', 'Tótvázsony', 'Uzsa', 'Vászoly', 'Vigántpetend', 'Vilonya', 'Vöröstó',
  'Zánka', 'Bókaháza', 'Cserszegtomaj', 'Dióskál', 'Egeraracsa', 'Esztergályhorváti',
  'Felsőpáhok', 'Garabonc', 'Gyenesdiás', 'Hévíz', 'Karmacs', 'Keszthely', 'Nagyrada',
  'Rezi', 'Sármellék', 'Szentgyörgyvár', 'Vállus', 'Vonyarcvashegy', 'Zalabér',
  'Zalakaros', 'Zalakomár', 'Zalaszabar', 'Zalasantó', 'Zalavár'
];

const SENTENCE = /Nyilatkozom továbbá, hogy a tervezett épület megfelel a 2018\. évi CXXXIX\. törvény[^\n]*előírásainak\.\s*/g;

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/\s+/g,' ').trim();
}

const NORMALIZED = new Set(SETTLEMENTS.map(normalize));

function isKiemeltTerseg(settlement) {
  return NORMALIZED.has(normalize(settlement));
}

// A nyilatkozat szövegéből elhagyja a területrendezési törvényre vonatkozó
// bekezdést, ha a projekt települése nem kiemelt térségi település.
function teruletrendezesiNyilatkozat(text, settlement) {
  const value = String(text || '');
  if (!value.includes('2018. évi CXXXIX')) return value;
  if (isKiemeltTerseg(settlement)) return value;
  return value.replace(SENTENCE,'').replace(/\n{3,}/g,'\n\n').trim();
}

module.exports = {SETTLEMENTS,isKiemeltTerseg,teruletrendezesiNyilatkozat};
