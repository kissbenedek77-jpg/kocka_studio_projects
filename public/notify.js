'use strict';
// Közös értesítéskezelő. Minden oldal ezen keresztül jelzi a státuszt, a hibát
// és a sikert; a megjelenítést a message-center végzi (ha elérhető), különben a
// page helyi status eleme.
//
// Használat:
//   const notify = Notify.create({key:'oldal-status', fallbackId:'status'});
//   notify.status('Mentve.', 'success');
//   notify.detail('Külön figyelmeztetés.', 'warning');
//   notify.beginRun();
//   notify.clear();

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Notify = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  function create(options) {
    const cfg = options || {};
    const key = cfg.key || 'page-status';
    const fallbackId = cfg.fallbackId || 'status';

    function center() {
      return root.KsMessages && typeof root.KsMessages.notice === 'function'
        ? root.KsMessages : null;
    }

    function fallback(text, kind) {
      const node = root.document && root.document.getElementById
        ? root.document.getElementById(fallbackId) : null;
      if (!node) return;
      if (typeof cfg.onFallback === 'function') return cfg.onFallback(node, text, kind);
      node.className = kind ? 'notice ' + kind : '';
      node.textContent = text || '';
    }

    // A fő státuszüzenet: kulcsolt, ezért az új üzenet lecseréli az előzőt.
    function status(text, kind, extra) {
      const opts = extra || {};
      const messages = center();
      if (messages) {
        const useKey = Object.prototype.hasOwnProperty.call(opts, 'key') ? opts.key : key;
        return messages.notice(text, kind, {key: useKey, links: opts.links, sticky: opts.sticky});
      }
      fallback(text, kind);
    }

    // Külön sor, amely nem írja felül a státuszt (például figyelmeztetés).
    function detail(text, kind) {
      const messages = center();
      if (messages) return messages.notice(text, kind, {key: null});
      fallback(text, kind);
    }

    function beginRun() {
      const messages = center();
      if (messages && typeof messages.beginRun === 'function') messages.beginRun();
    }

    function clear() {
      const messages = center();
      if (messages) return messages.notice('', '', {key});
      fallback('', '');
    }

    return {status, detail, beginRun, clear, key};
  }

  return {create};
});
