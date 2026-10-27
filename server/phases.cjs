'use strict';

// MARK: Projekt szakaszok állapota (folyamatjelző)
// Az 1–4. szakasz az ajánlat deadline5–8 mezőiből kapja a hosszát (nap).
// Az 1. szakasz a projekt indításakor kezdődik, a többit külön gombbal lehet indítani.
const PHASE_COUNT = 4;

// A `_ProjektSzakasz` lap soraihoz (UID, Szakasz, Kezdés, Kész) tartozó állapot.
function projectPhases(rows, uid) {
  const wanted = String(uid || '').trim().toUpperCase();
  const found = new Map();
  const secondRounds = [];
  for (const row of rows || []) {
    if (String(row?.[0] ?? '').trim().toUpperCase() !== wanted) continue;
    const index = Number(row?.[1]);
    if (Number.isInteger(index) && index >= 1 && index <= PHASE_COUNT) {
      const state = {szakasz:index, kezdes:String(row?.[2] ?? ''), kesz:String(row?.[3] ?? '')};
      found.set(index, state);
      if (index === 2 && state.kezdes) secondRounds.push(state);
    }
  }
  return Array.from({length:PHASE_COUNT},(_,i) => ({szakasz:i+1,
    kezdes:found.get(i+1)?.kezdes || '', kesz:found.get(i+1)?.kesz || '',
    ...(i === 1 ? {rounds:secondRounds.map((round,index) => ({
      kezdes:round.kezdes, kesz:round.kesz,
      ...(index + 1 < secondRounds.length ? {restartedAt:secondRounds[index+1].kezdes} : {})
    }))} : {})}));
}

function phaseByNumber(phases, szakasz) {
  return (phases || []).find(item => item.szakasz === szakasz) || {szakasz, kezdes:'', kesz:''};
}

function isStarted(phases, szakasz, projectStarted) {
  return szakasz === 1 ? Boolean(projectStarted) : Boolean(phaseByNumber(phases, szakasz).kezdes);
}

function isDone(phases, szakasz) {
  return Boolean(phaseByNumber(phases, szakasz).kesz);
}

// A kért szakaszművelet új állapota. Hibát dob, ha a művelet nem engedélyezett.
function phaseChange(action, szakasz, state, stamp) {
  const {started, exists, phases} = state;
  if (action === 'done') {
    if (!exists) throw new Error('Ez a szakasz az ajánlatban nincs megadva.');
    if (!isStarted(phases, szakasz, started)) throw new Error('A szakasz még nem indult el.');
    if (isDone(phases, szakasz)) throw new Error('A szakasz már elkészült.');
    return {kezdes:phaseByNumber(phases, szakasz).kezdes, kesz:stamp};
  }
  if (action === 'start') {
    if (szakasz === 1) throw new Error('Az 1. szakasz a projekt indításakor kezdődik.');
    if (!exists) throw new Error('Ez a szakasz az ajánlatban nincs megadva.');
    if (isStarted(phases, szakasz, started)) throw new Error('A szakasz már elindult.');
    if (!isDone(phases, szakasz - 1)) throw new Error('Előbb zárd le az előző szakaszt.');
    return {kezdes:stamp, kesz:''};
  }
  if (action === 'restart') {
    if (szakasz !== 2) throw new Error('Újraindítás csak a 2. szakasznál értelmezett.');
    if (!exists) throw new Error('Ez a szakasz az ajánlatban nincs megadva.');
    if (!isStarted(phases, szakasz, started)) throw new Error('A szakasz még nem indult el.');
    if (isStarted(phases, 3, false)) throw new Error('A 2. szakasz a 3. szakasz indítása után már nem indítható újra.');
    return {kezdes:stamp, kesz:''};
  }
  throw new Error('Ismeretlen szakaszművelet.');
}

module.exports = {PHASE_COUNT, projectPhases, phaseByNumber, isStarted, isDone, phaseChange};
