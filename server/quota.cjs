'use strict';

// Szándékosan a Google által közzétett felhasználói és napi határ alatt marad.
// A keret egy Node-folyamatra vonatkozik; a telepítés egy példányt használjon.
const LIMITS = Object.freeze({
  sheetsRead: {windowMs:60000, limit:45},
  sheetsWrite: {windowMs:60000, limit:45},
  docsRead: {windowMs:60000, limit:240},
  docsWrite: {windowMs:60000, limit:45},
  driveMinute: {windowMs:60000, limit:30000},
  driveDay: {windowMs:86400000, limit:100000}
});

function createQuotaGuard(limits = LIMITS, now = Date.now) {
  const history = new Map();
  function reserveMany(buckets, cost) {
    if (!Number.isSafeInteger(cost) || cost < 1) throw new Error('Érvénytelen API-kvóta kérés.');
    const time = now();
    const pending = buckets.map(bucket => {
      const rule = limits[bucket];
      if (!rule) throw new Error('Érvénytelen API-kvóta kérés.');
      const entries = (history.get(bucket) || []).filter(item => time - item.at < rule.windowMs);
      const used = entries.reduce((total, item) => total + item.cost, 0);
      if (used + cost > rule.limit) {
        const error = new Error('A Google API biztonsági híváskerete átmenetileg betelt. Próbáld újra később.');
        error.status = 429;
        throw error;
      }
      return [bucket, entries];
    });
    pending.forEach(([bucket, entries]) => {
      entries.push({at:time,cost});
      history.set(bucket, entries);
    });
  }
  function reserve(bucket, cost = 1) {reserveMany([bucket], cost);}
  async function run(kind, cost, call) {
    reserveMany(kind === 'drive' ? ['driveMinute','driveDay'] : [kind], cost);
    return call();
  }
  return {reserve, run};
}

const googleQuota = createQuotaGuard();
module.exports = {LIMITS, createQuotaGuard, googleQuota};
