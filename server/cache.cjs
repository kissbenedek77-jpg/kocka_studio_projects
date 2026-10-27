'use strict';

function createRequestCache(now = Date.now) {
  const entries = new Map();
  function get(key, ttlMs, load) {
    const current = entries.get(key);
    if (current && current.expires > now()) return current.promise;
    const promise = Promise.resolve().then(load);
    entries.set(key, {expires:now() + ttlMs, promise});
    promise.catch(() => {if (entries.get(key)?.promise === promise) entries.delete(key);});
    return promise;
  }
  function clear(prefix) {
    for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
  }
  return {get, clear};
}

const googleCache = createRequestCache();
module.exports = {createRequestCache, googleCache};
