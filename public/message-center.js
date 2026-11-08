'use strict';
// Kocka Stúdió – egységes üzenetközpont.
//
// Minden hiba, figyelmeztetés és megjegyzés ide kerül. Két megjelenés van:
//   - a dashboardon: középen fent, a belső oszlop szélességében, felfelé
//     csukódó, sticky sáv. Összecsukva helyet foglal és letolja a többi sticky
//     elemet; kinyitva a tartalom fölé lóg;
//   - a többi oldalon: jobb széli fül és lebegő panel.
//
// A sorok egyenként törölhetők, a teljes lista kiüríthető. Egy új művelet
// indításakor (beginRun) a korábbi, már nem érvényes üzenetek automatikusan
// eltűnnek; a sticky üzenetek maradnak.
//
// A fájl kétféleképpen használható:
//   - böngészőben: <script src="/assets/message-center.js"></script>, ekkor
//     felépíti a felületet és a window.KsMessages API-t biztosítja;
//   - Node-tesztben: require('./message-center.js'), ekkor csak a tárolót adja,
//     DOM nélkül.

(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  if (root) root.KsMessages = api.createBrowserApi(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const LEVELS = ['info', 'success', 'warning', 'error', 'note'];
  const MAX_MESSAGES = 200;
  // Az összecsukott dashboard-sáv magassága. A sticky elemek ettől tolódnak
  // lejjebb (--ks-msgbar-height).
  const BAR_HEIGHT = '46px';

  function normalizeLevel(level) {
    if (level === true) return 'error';
    if (level === false || level == null) return 'info';
    const value = String(level).trim().toLowerCase();
    if (!value) return 'info';
    if (value === 'warn' || value === 'figyelmeztetes' || value === 'figyelmeztetés') return 'warning';
    if (value === 'danger' || value === 'hiba') return 'error';
    if (value === 'ok' || value === 'siker') return 'success';
    if (value === 'note' || value === 'megjegyzes' || value === 'megjegyzés') return 'note';
    return LEVELS.includes(value) ? value : 'info';
  }

  // A tároló a felülettől független: ez tesztelhető és több panel is
  // feliratkozhat rá.
  function createMessageStore(options) {
    const settings = options || {};
    const limit = Number(settings.max) > 0 ? Number(settings.max) : MAX_MESSAGES;
    const now = typeof settings.now === 'function' ? settings.now : () => Date.now();
    const items = [];
    const listeners = new Set();
    let sequence = 0;

    function emit() {
      for (const listener of Array.from(listeners)) {
        try { listener(items.slice()); } catch (_) { /* egy hibás előfizető ne állítsa meg a többit */ }
      }
    }

    function indexOfKey(key) {
      for (let index = 0; index < items.length; index += 1)
        if (items[index].key === key) return index;
      return -1;
    }

    function removeByKey(key) {
      const index = indexOfKey(key);
      if (index < 0) return false;
      items.splice(index, 1);
      emit();
      return true;
    }

    function notice(text, level, opts) {
      const settings2 = opts || {};
      const value = String(text == null ? '' : text).trim();
      const target = normalizeLevel(level);
      const key = settings2.key ? String(settings2.key) : null;
      // Üres szöveg a kulcsolt státusz törlését jelenti (notice('')).
      if (!value) {
        if (key) removeByKey(key);
        return null;
      }
      const sticky = Boolean(settings2.sticky);
      const scope = settings2.scope ? String(settings2.scope) : 'run';
      const links = Array.isArray(settings2.links) ? settings2.links.filter(Boolean) : [];

      if (key) {
        const index = indexOfKey(key);
        if (index >= 0) {
          const existing = items[index];
          if (existing.text === value && existing.level === target) {
            existing.time = now();
            existing.count += 1;
            if (links.length) existing.links = links;
            emit();
            return existing;
          }
          existing.text = value;
          existing.level = target;
          existing.time = now();
          existing.count = 1;
          existing.links = links;
          existing.sticky = sticky;
          emit();
          return existing;
        }
      }

      const last = items[items.length - 1];
      if (!key && last && last.text === value && last.level === target && !last.key) {
        last.time = now();
        last.count += 1;
        if (links.length) last.links = links;
        emit();
        return last;
      }

      sequence += 1;
      const item = {
        id: 'ks-msg-' + sequence,
        text: value,
        level: target,
        key,
        scope,
        sticky,
        time: now(),
        count: 1,
        links
      };
      items.push(item);
      while (items.length > limit) items.shift();
      emit();
      return item;
    }

    // Új művelet indítása: a korábbi, már nem érvényes üzenetek eltűnnek.
    // A sticky üzenetek (például lejárt Google-hozzáférés) megmaradnak.
    function beginRun() {
      if (!items.some(item => !item.sticky)) return;
      const keep = items.filter(item => item.sticky);
      items.length = 0;
      for (const item of keep) items.push(item);
      emit();
    }

    function remove(id) {
      const index = items.findIndex(item => item.id === id);
      if (index < 0) return false;
      items.splice(index, 1);
      emit();
      return true;
    }

    function clear() {
      if (!items.length) return;
      items.length = 0;
      emit();
    }

    function list() { return items.slice(); }

    function counts() {
      const result = {total: items.length, error: 0, warning: 0, info: 0, success: 0, note: 0};
      for (const item of items) {
        if (Object.prototype.hasOwnProperty.call(result, item.level) && item.level !== 'total')
          result[item.level] += 1;
        else result.info += 1;
      }
      return result;
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      try { listener(items.slice()); } catch (_) { /* az első kirajzolás hibája nem végzetes */ }
      return () => listeners.delete(listener);
    }

    return {notice, beginRun, remove, removeByKey, clear, list, counts, subscribe};
  }

  const SVG = {
    bubble: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    minimize: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M10 4h4M7 7l1 13h8l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    dot: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    alert: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 7v7M12 17.2v.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 10.5V17M12 6.8v.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  const LEVEL_ICON = {error: SVG.alert, warning: SVG.alert, success: SVG.check, note: SVG.dot, info: SVG.info};
  const LEVEL_LABEL = {error: 'Hiba', warning: 'Figyelmeztetés', success: 'Siker', note: 'Megjegyzés', info: 'Tájékoztatás'};
  const STATE_KEY = 'ks-messages-panel';

  const STYLE = [
    '.ks-msg-launcher{position:fixed;right:10px;top:42%;z-index:25;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:52px;min-height:56px;padding:6px 4px;border:1px solid rgba(255,255,255,.18);border-radius:10px 0 0 10px;background:#3e3e3e;color:#fff;box-shadow:-4px 6px 18px rgba(16,27,22,.22);cursor:pointer;font:inherit;line-height:1}',
    '.ks-msg-launcher:hover{background:#2f2f2f}',
    '.ks-msg-launcher:focus-visible{outline:3px solid #b79a69;outline-offset:2px}',
    '.ks-msg-launcher .ks-msg-launcher-icon{display:block;width:22px;height:22px}',
    '.ks-msg-launcher .ks-msg-launcher-label{font-size:9px;letter-spacing:.04em;text-transform:uppercase;color:#d9ded8;white-space:nowrap}',
    '.ks-msg-badge{position:absolute;top:-6px;left:-6px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#4f8562;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.28)}',
    '.ks-msg-badge.warning{background:#a9782a}.ks-msg-badge.error{background:#a6372f}.ks-msg-badge.empty{display:none}',
    '.ks-msg-panel{position:fixed;right:12px;top:50%;transform:translateY(-50%);z-index:26;display:flex;flex-direction:column;width:min(430px,calc(100vw - 24px));max-height:min(72vh,560px);border:1px solid #d7dad4;border-radius:10px;background:#fff;box-shadow:0 20px 60px rgba(16,27,22,.26);overflow:hidden;font:14px/1.45 Arial,sans-serif;color:#26312e}',
    '.ks-msg-panel[hidden]{display:none!important}',
    '.ks-msg-head{display:flex;align-items:center;gap:8px;padding:9px 10px 9px 14px;background:#3e3e3e;color:#fff}',
    '.ks-msg-title{flex:1;min-width:0;display:flex;align-items:baseline;gap:7px;border:0;background:none;color:inherit;font:inherit;font-weight:700;text-align:left;padding:0;cursor:default}',
    '.ks-msg-panel.minimized .ks-msg-title{cursor:pointer}',
    '.ks-msg-title small{font-weight:400;font-size:12px;color:#c9d0c8}',
    '.ks-msg-actions{display:flex;align-items:center;gap:2px;flex:0 0 auto}',
    '.ks-msg-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:5px;background:transparent;color:#f2f4f1;cursor:pointer}',
    '.ks-msg-btn:hover{background:rgba(255,255,255,.14)}.ks-msg-btn:focus-visible{outline:2px solid #b79a69;outline-offset:1px}',
    '.ks-msg-btn svg{width:17px;height:17px}',
    '.ks-msg-btn[hidden]{display:none!important}',
    '.ks-msg-body{overflow:auto;overscroll-behavior:contain;background:#fff}',
    '.ks-msg-panel.minimized .ks-msg-body{display:none}',
    '.ks-msg-list{list-style:none;margin:0;padding:0}',
    '.ks-msg-item{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:8px;align-items:start;padding:10px 8px 10px 11px;border-bottom:1px solid #eef0ec;border-left:3px solid #287b82;background:#fff}',
    '.ks-msg-item:last-child{border-bottom:0}',
    '.ks-msg-item.error{border-left-color:#a6372f;background:#fff7f6}',
    '.ks-msg-item.warning{border-left-color:#a9782a;background:#fffaf0}',
    '.ks-msg-item.success{border-left-color:#4f8562;background:#f4faf5}',
    '.ks-msg-item.note{border-left-color:#8b8b7d;background:#f8f8f4}',
    '.ks-msg-icon{display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;color:#fff;background:#287b82}',
    '.ks-msg-item.error .ks-msg-icon{background:#a6372f}.ks-msg-item.warning .ks-msg-icon{background:#a9782a}.ks-msg-item.success .ks-msg-icon{background:#4f8562}.ks-msg-item.note .ks-msg-icon{background:#8b8b7d}',
    '.ks-msg-icon svg{width:14px;height:14px}',
    '.ks-msg-text{min-width:0;overflow-wrap:anywhere;white-space:pre-wrap;font-size:13px;line-height:1.45}',
    '.ks-msg-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:3px;color:#627069;font-size:11px;line-height:1.3}',
    '.ks-msg-text .ks-msg-links{display:flex;flex-wrap:wrap;gap:10px;margin-top:5px}',
    '.ks-msg-text .ks-msg-links a{color:#287b82;font-weight:700}',
    '.ks-msg-remove{width:26px;height:26px;padding:0;border:0;border-radius:4px;background:transparent;color:#627069;cursor:pointer;font:inherit;line-height:1}',
    '.ks-msg-remove:hover{background:#eef0ec;color:#26312e}',
    '.ks-msg-remove:focus-visible{outline:2px solid #4f8562;outline-offset:1px}',
    '.ks-msg-remove svg{width:15px;height:15px}',
    '.ks-msg-empty{padding:22px 16px;color:#627069;font-size:13px;text-align:center}',
    // A dashboard felső sávja: a belső (munkaterületi) oszlop szélességében,
    // középen. Összecsukva helyet foglal, kinyitva a tartalom fölé lóg.
    '.ks-msgbar{position:sticky;top:0;z-index:15;width:100%;margin:0 auto;border:1px solid #d7dad4;border-radius:0 0 10px 10px;background:#fff;box-shadow:0 8px 22px rgba(16,27,22,.14);font:14px/1.45 Arial,sans-serif;color:#26312e}',
    '.ks-msgbar[hidden]{display:none!important}',
    '.ks-msgbar-head{display:flex;align-items:center;gap:8px;width:100%;min-height:44px;padding:7px 12px;border:0;background:#3e3e3e;color:#fff;font:inherit;text-align:left;cursor:pointer}',
    '.ks-msgbar-head:hover{background:#2f2f2f}',
    '.ks-msgbar-head:focus-visible{outline:3px solid #b79a69;outline-offset:-3px}',
    '.ks-msgbar-icon{display:flex;flex:none;width:20px;height:20px}',
    '.ks-msgbar-icon svg{width:20px;height:20px}',
    '.ks-msgbar-title{flex:none;font-weight:700}',
    '.ks-msgbar-count{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:#4f8562;color:#fff;font-size:11px;font-weight:700}',
    '.ks-msgbar[data-level=warning] .ks-msgbar-count{background:#a9782a}',
    '.ks-msgbar[data-level=error] .ks-msgbar-count{background:#a6372f}',
    '.ks-msgbar-latest{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#d9ded8;font-size:13px}',
    '.ks-msgbar-chevron{display:flex;flex:none;width:20px;height:20px;transition:transform .18s}',
    '.ks-msgbar[data-state=open] .ks-msgbar-chevron{transform:rotate(180deg)}',
    '.ks-msgbar-chevron svg{width:20px;height:20px}',
    '.ks-msgbar-body{position:absolute;left:-1px;right:-1px;top:100%;display:block;max-height:0;opacity:0;overflow:auto;pointer-events:none;visibility:hidden;background:#fff;border:0 solid #d7dad4;border-radius:0 0 10px 10px;box-shadow:0 18px 40px rgba(16,27,22,.2);transition:max-height .2s ease,opacity .15s ease}',
    '.ks-msgbar[data-state=open] .ks-msgbar-body{max-height:min(50vh,420px);opacity:1;pointer-events:auto;visibility:visible;border-width:0 1px 1px}',
    '@media(prefers-reduced-motion:reduce){.ks-msgbar-body{transition:none}}',
    '.ks-msgbar-foot{display:flex;justify-content:flex-end;padding:7px 10px;border-top:1px solid #eef0ec;background:#fafbf9}',
    '.ks-msgbar-clear{min-height:32px;padding:5px 12px;border:0;border-radius:5px;background:transparent;color:#7d241e;font:inherit;font-size:13px;font-weight:700;cursor:pointer}',
    '.ks-msgbar-clear:hover{background:#fff2f0}',
    '.ks-msgbar-clear:focus-visible{outline:2px solid #4f8562;outline-offset:1px}',
    '@media(min-width:1100px){.ks-msgbar{width:calc(100% - 582px)}}',
    '@media(min-width:851px) and (max-width:1099.98px){.ks-msgbar{width:calc(100% - 236px)}}',
    '@media(max-width:700px){',
    '.ks-msg-launcher{top:auto;bottom:calc(84px + var(--chat-height,0px) + env(safe-area-inset-bottom));right:0;width:46px;min-height:48px}',
    '.ks-msg-panel{top:0;right:0;left:0;transform:none;width:auto;max-height:min(70vh,520px);border-radius:0 0 12px 12px;border-width:0 0 1px}',
    '.ks-msgbar{border-radius:0 0 8px 8px}',
    '.ks-msgbar[data-state=open] .ks-msgbar-body{max-height:min(60vh,380px)}',
    '}'
  ].join('');

  // Az üzenetsorok közös kirajzolása: a felső sáv és a lebegő panel ugyanazt
  // használja.
  function renderRows(doc, list, empty, items, store) {
    const counts = store.counts();
    list.replaceChildren();
    empty.hidden = counts.total > 0;
    if (!counts.total) return;
    const fragment = doc.createDocumentFragment();
    for (const item of items) {
      const row = doc.createElement('li');
      row.className = 'ks-msg-item ' + item.level;
      row.dataset.level = item.level;

      const icon = doc.createElement('span');
      icon.className = 'ks-msg-icon';
      icon.innerHTML = LEVEL_ICON[item.level] || SVG.info;
      icon.title = LEVEL_LABEL[item.level] || '';

      const text = doc.createElement('div');
      text.className = 'ks-msg-text';
      const bodyText = doc.createElement('span');
      bodyText.textContent = item.text;
      text.append(bodyText);
      if (item.links.length) {
        const links = doc.createElement('span');
        links.className = 'ks-msg-links';
        for (const link of item.links) {
          const anchor = doc.createElement('a');
          anchor.href = String(link.href || '#');
          anchor.textContent = String(link.label || link.href || 'Megnyitás');
          if (link.target) {
            anchor.target = String(link.target);
            anchor.rel = 'noopener noreferrer';
          }
          links.append(anchor);
        }
        text.append(links);
      }

      const meta = doc.createElement('div');
      meta.className = 'ks-msg-meta';
      const stamp = doc.createElement('span');
      stamp.textContent = timeText(item.time);
      meta.append(stamp);
      if (item.count > 1) {
        const repeat = doc.createElement('span');
        repeat.textContent = '×' + item.count;
        meta.append(repeat);
      }
      if (item.sticky) {
        const pinned = doc.createElement('span');
        pinned.textContent = 'rögzített';
        meta.append(pinned);
      }
      text.append(meta);

      const removeButton = doc.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'ks-msg-remove';
      removeButton.title = 'Üzenet törlése';
      removeButton.setAttribute('aria-label', 'Üzenet törlése');
      removeButton.innerHTML = SVG.close;
      removeButton.addEventListener('click', () => store.remove(item.id));

      row.append(icon, text, removeButton);
      fragment.append(row);
    }
    list.append(fragment);
  }

  function timeText(time) {
    const date = new Date(time);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    try {
      return sameDay
        ? date.toLocaleTimeString('hu-HU', {hour: '2-digit', minute: '2-digit'})
        : date.toLocaleDateString('hu-HU', {month: '2-digit', day: '2-digit'}) + ' ' +
          date.toLocaleTimeString('hu-HU', {hour: '2-digit', minute: '2-digit'});
    } catch (_) {
      return '';
    }
  }

  function severityLevel(counts) {
    if (counts.error) return 'error';
    if (counts.warning) return 'warning';
    return 'info';
  }

  function focusQuietly(element) {
    try { element.focus({preventScroll: true}); }
    catch (_) { try { element.focus(); } catch (__) { /* nem fókuszálható */ } }
  }

  // A dashboard felső üzenetsávja.
  function mountTopbar(doc, root, store) {
    const host = (doc.querySelector && doc.querySelector('main.shell')) || doc.body;
    const rootStyle = doc.documentElement && doc.documentElement.style;

    const bar = doc.createElement('div');
    bar.className = 'ks-msgbar';
    bar.dataset.state = 'collapsed';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Üzenetek');
    bar.hidden = true;

    const head = doc.createElement('button');
    head.type = 'button';
    head.className = 'ks-msgbar-head';
    head.setAttribute('aria-expanded', 'false');
    const icon = doc.createElement('span');
    icon.className = 'ks-msgbar-icon';
    icon.innerHTML = SVG.bubble;
    const title = doc.createElement('span');
    title.className = 'ks-msgbar-title';
    title.textContent = 'Üzenetek';
    const count = doc.createElement('span');
    count.className = 'ks-msgbar-count';
    const latest = doc.createElement('span');
    latest.className = 'ks-msgbar-latest';
    latest.setAttribute('aria-live', 'polite');
    const chevron = doc.createElement('span');
    chevron.className = 'ks-msgbar-chevron';
    chevron.innerHTML = SVG.chevron;
    head.append(icon, title, count, latest, chevron);

    const body = doc.createElement('div');
    body.className = 'ks-msgbar-body';
    const list = doc.createElement('ul');
    list.className = 'ks-msg-list';
    list.setAttribute('aria-live', 'polite');
    const empty = doc.createElement('p');
    empty.className = 'ks-msg-empty';
    empty.textContent = 'Nincs megjeleníthető üzenet.';
    const foot = doc.createElement('div');
    foot.className = 'ks-msgbar-foot';
    const clearButton = doc.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'ks-msgbar-clear';
    clearButton.textContent = 'Összes törlése';
    foot.append(clearButton);
    body.append(list, empty, foot);
    bar.append(head, body);

    if (host.firstChild && host.insertBefore) host.insertBefore(bar, host.firstChild);
    else host.append(bar);

    // A sticky elemek (projektválasztó, idővonal) ettől a magasságtól tolódnak
    // lejjebb. Kinyitva 0, mert a nyitott sáv a tartalom fölé lóg.
    function setStickyOffset(value) {
      if (rootStyle && rootStyle.setProperty) rootStyle.setProperty('--ks-msgbar-height', value);
    }

    // A sáv a munkaterület (belső oszlop) szélességét veszi fel. A CSS ad egy
    // tartalék szélességet, a mérés pedig pontosan a középső oszlophoz igazít.
    function syncWidth() {
      const main = doc.querySelector && doc.querySelector('.workspace-main');
      const rect = main && main.getBoundingClientRect ? main.getBoundingClientRect() : null;
      const width = rect ? Number(rect.width) || 0 : 0;
      if (bar.style) bar.style.width = width > 0 ? Math.round(width) + 'px' : '';
    }
    if (root.addEventListener !== undefined)
      root.addEventListener('resize', syncWidth);
    if (typeof root.ResizeObserver === 'function' && doc.body)
      new root.ResizeObserver(syncWidth).observe(doc.body);

    function setState(next) {
      bar.dataset.state = next === 'open' ? 'open' : 'collapsed';
      apply();
    }

    function apply() {
      syncWidth();
      const counts = store.counts();
      const active = counts.total > 0;
      const open = bar.dataset.state === 'open';
      bar.hidden = !active;
      if (!active) {
        bar.dataset.state = 'collapsed';
        setStickyOffset('0px');
        return;
      }
      setStickyOffset(open ? '0px' : BAR_HEIGHT);
      head.setAttribute('aria-expanded', String(open));
      head.setAttribute('title', open ? 'Üzenetek összecsukása' : 'Üzenetek kinyitása');
    }

    function render(items) {
      const counts = store.counts();
      count.textContent = counts.total ? String(counts.total) : '0';
      bar.dataset.level = severityLevel(counts);
      const newest = items[items.length - 1];
      latest.textContent = newest ? newest.text : '';
      latest.title = newest ? newest.text : '';
      clearButton.hidden = counts.total === 0;
      renderRows(doc, list, empty, items, store);
      apply();
    }

    head.addEventListener('click', () => {
      setState(bar.dataset.state === 'open' ? 'collapsed' : 'open');
      if (bar.dataset.state === 'open') focusQuietly(head);
    });
    clearButton.addEventListener('click', () => store.clear());
    bar.addEventListener('keydown', event => {
      if (event.key === 'Escape' && bar.dataset.state === 'open') {
        event.stopPropagation();
        setState('collapsed');
        focusQuietly(head);
      }
    });

    store.subscribe(render);
    setStickyOffset('0px');
    return {
      variant: 'topbar',
      setState,
      getState: () => bar.dataset.state,
      element: bar
    };
  }

  // A többi oldal lebegő panelje (jobb széli füllel).
  function mountDock(doc, root, store) {
    const launcher = doc.createElement('button');
    launcher.type = 'button';
    launcher.className = 'ks-msg-launcher';
    launcher.setAttribute('aria-label', 'Üzenetek megnyitása');
    launcher.innerHTML = SVG.bubble;
    const launcherLabel = doc.createElement('span');
    launcherLabel.className = 'ks-msg-launcher-label';
    launcherLabel.textContent = 'Üzenetek';
    launcher.append(launcherLabel);
    const badge = doc.createElement('span');
    badge.className = 'ks-msg-badge empty';
    badge.setAttribute('aria-hidden', 'true');
    launcher.appendChild(badge);

    const panel = doc.createElement('section');
    panel.className = 'ks-msg-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Üzenetek');
    panel.setAttribute('tabindex', '-1');

    const head = doc.createElement('div');
    head.className = 'ks-msg-head';
    const title = doc.createElement('button');
    title.type = 'button';
    title.className = 'ks-msg-title';
    title.append('Üzenetek ');
    const titleCount = doc.createElement('small');
    title.append(titleCount);
    const actions = doc.createElement('div');
    actions.className = 'ks-msg-actions';
    const clearButton = doc.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'ks-msg-btn';
    clearButton.title = 'Összes üzenet törlése';
    clearButton.setAttribute('aria-label', 'Összes üzenet törlése');
    clearButton.innerHTML = SVG.trash;
    const minimizeButton = doc.createElement('button');
    minimizeButton.type = 'button';
    minimizeButton.className = 'ks-msg-btn';
    minimizeButton.title = 'Minimalizálás';
    minimizeButton.setAttribute('aria-label', 'Minimalizálás');
    minimizeButton.innerHTML = SVG.minimize;
    const closeButton = doc.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'ks-msg-btn';
    closeButton.title = 'Bezárás';
    closeButton.setAttribute('aria-label', 'Bezárás');
    closeButton.innerHTML = SVG.close;
    actions.append(clearButton, minimizeButton, closeButton);

    const body = doc.createElement('div');
    body.className = 'ks-msg-body';
    const list = doc.createElement('ul');
    list.className = 'ks-msg-list';
    list.setAttribute('aria-live', 'polite');
    const empty = doc.createElement('p');
    empty.className = 'ks-msg-empty';
    empty.textContent = 'Nincs megjeleníthető üzenet.';
    body.append(list, empty);
    head.append(title, actions);
    panel.append(head, body);
    doc.body.append(launcher, panel);

    let state = 'closed';
    let applied = false;
    let seenTop = null;
    try {
      const saved = root.sessionStorage && root.sessionStorage.getItem(STATE_KEY);
      if (saved === 'open' || saved === 'minimized' || saved === 'closed') state = saved;
    } catch (_) { /* privát mód */ }

    function setState(next, options2) {
      state = next;
      try {
        if (root.sessionStorage) root.sessionStorage.setItem(STATE_KEY, state);
      } catch (_) { /* privát mód */ }
      applyState(options2);
    }

    function applyState(options2) {
      const open = state === 'open' || state === 'minimized';
      panel.hidden = !open;
      panel.classList.toggle('minimized', state === 'minimized');
      launcher.hidden = open;
      title.setAttribute('aria-expanded', String(open));
      minimizeButton.hidden = state === 'minimized';
      if (open) title.setAttribute('aria-label', state === 'minimized' ? 'Üzenetek kinyitása' : 'Üzenetek');
      else title.removeAttribute('aria-label');
      if (!applied) { applied = true; return; }
      if (options2 && options2.focus === false) return;
      if (state === 'closed') focusQuietly(launcher);
      else focusQuietly(panel);
    }

    function severityClass(counts) {
      if (counts.error) return 'error';
      if (counts.warning) return 'warning';
      return counts.total ? 'active' : 'empty';
    }

    function render(items) {
      const counts = store.counts();
      badge.textContent = counts.total ? String(counts.total) : '';
      badge.className = 'ks-msg-badge ' + severityClass(counts);
      launcher.setAttribute('aria-label',
        counts.total ? 'Üzenetek megnyitása (' + counts.total + ')' : 'Üzenetek megnyitása');
      titleCount.textContent = counts.total ? '(' + counts.total + ')' : '(0)';
      clearButton.hidden = counts.total === 0;

      // Új hiba érkezésekor a panel magától kinyílik, hogy a hiba ne maradjon
      // észrevétlen; a felhasználó utána bezárhatja vagy minimalizálhatja.
      const top = items[items.length - 1];
      if (top && top.id !== seenTop) {
        seenTop = top.id;
        if (top.level === 'error' && state === 'closed') setState('open', {focus: false});
      }

      renderRows(doc, list, empty, items, store);
    }

    launcher.addEventListener('click', () => setState('open'));
    minimizeButton.addEventListener('click', () => setState('minimized'));
    closeButton.addEventListener('click', () => setState('closed'));
    clearButton.addEventListener('click', () => store.clear());
    title.addEventListener('click', () => {
      if (state === 'minimized') setState('open');
    });
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setState('closed');
      }
    });

    applyState();
    store.subscribe(render);
    return {
      variant: 'dock',
      setState,
      getState: () => state,
      element: panel
    };
  }

  function createBrowserApi(root) {
    const doc = root.document;
    const store = createMessageStore();
    let ui = null;

    function mount() {
      if (!doc || !doc.body || ui) return;
      const style = doc.createElement('style');
      style.id = 'ks-message-center-style';
      style.textContent = STYLE;
      doc.head.appendChild(style);

      // A dashboardon a felső sáv, minden más oldalon a jobb széli fül.
      const page = doc.body.dataset ? String(doc.body.dataset.ksPage || '') : '';
      ui = page === 'dashboard' ? mountTopbar(doc, root, store) : mountDock(doc, root, store);
    }

    const api = {
      notice: (text, level, opts) => store.notice(text, level, opts),
      beginRun: () => store.beginRun(),
      remove: id => store.remove(id),
      removeByKey: key => store.removeByKey(key),
      clear: () => store.clear(),
      list: () => store.list(),
      counts: () => store.counts(),
      open: () => {
        mount();
        if (!ui) return;
        if (ui.variant === 'topbar') ui.setState('open');
        else ui.setState('open');
      },
      close: () => {
        mount();
        if (!ui) return;
        ui.setState(ui.variant === 'topbar' ? 'collapsed' : 'closed');
      },
      minimize: () => {
        mount();
        if (!ui) return;
        ui.setState(ui.variant === 'topbar' ? 'collapsed' : 'minimized');
      },
      toggle: () => {
        mount();
        if (!ui) return;
        if (ui.variant === 'topbar') ui.setState(ui.getState() === 'open' ? 'collapsed' : 'open');
        else ui.setState(ui.element.hidden ? 'open' : 'closed');
      }
    };

    if (doc) {
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount, {once: true});
      else mount();
    }
    return api;
  }

  return {createMessageStore, createBrowserApi, normalizeLevel, LEVELS};
});
