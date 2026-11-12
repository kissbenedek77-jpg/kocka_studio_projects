'use strict';
// Közös AI-sáv: a képernyő alján rögzített, összecsukható chat. A célmezőt a
// felhasználó fókuszálással vagy a listából választja; a javaslat a mezőnél
// jelenik meg, felülírás vagy kiegészítés választással.
//
// Használat:
//   const chat = AiComposer.create({root, pageLabel, request, onStatus});
//   chat.register({id,label,group,input,apply});
//   chat.setTarget(id); chat.refresh();
//
// A request({instruction,current,label,page,history}) a szerverhívást végzi, és
// {reply,text} választ ad. A showSuggestion opcionális: ha meg van adva, a
// javaslat megjelenítését a hívó oldal végzi.

(function (root) {
  const STYLE = `
    #chat.ks-ai-composer{position:fixed;left:50%;transform:translateX(-50%);bottom:0;
      width:min(1060px,100%);margin:0;padding:0;z-index:20;display:flex;flex-direction:column;
      max-height:min(34vh,260px);border:1px solid var(--ks-line,#d7dad4);border-bottom:0;
      border-radius:10px 10px 0 0;box-shadow:0 -8px 22px rgba(16,27,22,.16);
      background:#fff;color:var(--ks-ink,#26312e);font:14px/1.45 Arial,sans-serif}
    #chat.ks-ai-composer[hidden]{display:none}
    #chat .chat-head{display:flex;align-items:center;gap:.6rem;padding:.4rem .75rem;
      background:var(--ks-dark,#3e3e3e);color:#fff;flex:none;border-radius:9px 9px 0 0}
    #chat .chat-head h2{font-size:.75rem;margin:0;flex:none;color:#fff;
      text-transform:uppercase;letter-spacing:.1em}
    #chat .chat-target{margin:0;flex:1 1 auto;min-width:0;font-size:.8rem;color:#d9ded8;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #chat .chat-target-row{display:flex;align-items:center;gap:.45rem;margin:.15rem 0 .45rem;flex:none}
    #chat .chat-target-row label{font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;
      color:var(--ks-muted,#627069);font-weight:700;flex:none}
    #chat .chat-target-row select{flex:1 1 auto;width:auto;min-width:0;min-height:2rem;
      padding:.25rem .45rem;font-size:.85rem;border:1px solid #bbc3bb;border-radius:3px;
      background:#fff;color:var(--ks-ink,#26312e)}
    #chat .chat-target-row select:focus{outline:2px solid var(--ks-gold,#a88952);outline-offset:1px}
    #chat .chat-quick{display:flex;gap:.3rem;flex-wrap:wrap;margin:0 0 .45rem}
    #chat .chat-quick button{padding:.25rem .6rem;font-size:.78rem;min-height:1.8rem;
      border-radius:999px;border:1px solid var(--ks-line,#d7dad4);background:#fff;color:var(--ks-ink,#26312e);cursor:pointer}
    #chat .chat-quick button:hover{background:#f5f2eb;border-color:#c9b98f}
    #chat .chat-quick button:last-child{margin-left:auto}
    #chatToggle{padding:.2rem .55rem;font-size:.9rem;min-height:1.8rem;flex:none;line-height:1;
      border:1px solid rgba(255,255,255,.32);border-radius:5px;background:transparent;
      color:#fff;cursor:pointer}
    #chatToggle:hover{background:rgba(255,255,255,.12)}
    #chat .chat-body{padding:.5rem .75rem .6rem;overflow:auto;min-height:0;flex:1 1 auto;
      background:#fff}
    #chat.collapsed .chat-body{display:none}
    #chat .chat-log{max-height:6.5rem;overflow:auto;gap:.3rem;margin:.1rem 0 .45rem}
    #chat .chat-log p{padding:.4rem .6rem;font-size:.84rem;line-height:1.4;
      background:var(--ks-soft,#f7f8f4);border-radius:6px;margin:0;white-space:pre-wrap;color:var(--ks-ink,#26312e)}
    #chat .chat-log p.me{background:#f5f2eb;border-left:3px solid var(--ks-gold,#a88952)}
    #chat .chat-input-row{display:flex;gap:.45rem;align-items:flex-end;min-width:0}
    #chat textarea{flex:1 1 auto;width:auto;min-width:0;min-height:2.2rem;max-height:5.5rem;
      resize:none;padding:.5rem .6rem;font:inherit;font-size:.9rem;line-height:1.35;
      border:1px solid #bbc3bb;border-radius:3px;background:#fff;color:var(--ks-ink,#26312e)}
    #chat textarea:focus{outline:2px solid var(--ks-gold,#a88952);outline-offset:1px}
    #chat .chat-input-row button{padding:.5rem 1rem;min-height:2.2rem;font-size:.88rem;flex:none;
      border:1px solid var(--ks-ink,#26312e);border-radius:3px;background:var(--ks-ink,#26312e);color:#fff;font-weight:700;cursor:pointer}
    #chat .chat-input-row button:hover{background:#111d19}
    #chat .chat-input-row button:disabled{opacity:.48;cursor:default}
    /* A kiválasztott mező kiemelése minden oldalon. */
    .active-input{outline:3px solid var(--ks-gold,#a88952) !important;outline-offset:1px;
      box-shadow:0 0 0 4px rgba(168,137,82,.16) !important}
    .ai-suggestion{background:#fffaf0;border:1px solid #c9b98f;border-radius:6px;
      padding:.55rem .65rem;margin:.5rem 0;display:grid;gap:.45rem;color:var(--ks-ink,#26312e);
      font:14px/1.45 Arial,sans-serif}
    .ai-suggestion-title{font-size:.78rem;font-weight:700;color:#8f7748}
    .ai-suggestion textarea{width:100%;min-height:4.5rem;border:1px solid #bbc3bb;
      border-radius:3px;padding:.5rem .6rem;font:inherit;font-size:.9rem;resize:vertical;
      background:#fff;color:var(--ks-ink,#26312e)}
    .ai-suggestion textarea:focus{outline:2px solid var(--ks-gold,#a88952);outline-offset:1px}
    .ai-suggestion-actions{display:flex;gap:.5rem;flex-wrap:wrap}
    .ai-suggestion-actions button{padding:.4rem .85rem;font-size:.85rem;min-height:2.1rem;
      border:1px solid var(--ks-ink,#26312e);border-radius:3px;background:var(--ks-ink,#26312e);color:#fff;
      font-weight:700;cursor:pointer}
    .ai-suggestion-actions button.secondary{background:#fff;color:var(--ks-ink,#26312e)}
    .ai-suggestion .ai-checks{display:flex;gap:1rem;flex-wrap:wrap;font-size:.82rem;color:var(--ks-ink,#26312e)}
    .ai-suggestion .ai-checks label{display:inline-flex;align-items:center;gap:.3rem}
  `;

  function el(doc, tag, cls, text) {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function addClass(node, name) {
    if (!node) return;
    if (node.classList && node.classList.add) node.classList.add(name);
    else if (!(' ' + (node.className || '') + ' ').includes(' ' + name + ' '))
      node.className = ((node.className || '') + ' ' + name).trim();
  }

  function removeClass(node, name) {
    if (!node) return;
    if (node.classList && node.classList.remove) node.classList.remove(name);
    else node.className = (' ' + (node.className || '') + ' ')
      .replace(' ' + name + ' ', ' ').trim();
  }

  function toggleClass(node, name, on) {
    if (!node) return;
    if (node.classList && typeof node.classList.toggle === 'function')
      return node.classList.toggle(name, on);
    const has = (' ' + (node.className || '') + ' ').includes(' ' + name + ' ');
    const next = on === undefined ? !has : Boolean(on);
    if (next) addClass(node, name);
    else removeClass(node, name);
    return next;
  }

  function hasClass(node, name) {
    return Boolean(node) && (' ' + (node.className || '') + ' ').includes(' ' + name + ' ');
  }

  function create(options) {
    const cfg = options || {};
    const doc = root.document;
    const host = typeof cfg.root === 'string' ? doc.querySelector(cfg.root) : cfg.root;
    if (!host) throw new Error('Az AI-sáv helye nem található.');
    const pageLabel = String(cfg.pageLabel || '');
    const targets = new Map();
    let activeId = '';
    let pinned = false;
    let history = [];
    let styleNode = doc.getElementById('ks-ai-composer-style');
    if (!styleNode) {
      styleNode = doc.createElement('style');
      styleNode.id = 'ks-ai-composer-style';
      styleNode.textContent = STYLE;
      if (doc.head && doc.head.appendChild) doc.head.appendChild(styleNode);
    }

    addClass(host,'ks-ai-composer');
    host.replaceChildren();

    const head = el(doc, 'div', 'chat-head');
    const title = el(doc, 'h2', '', 'AI');
    title.id = 'chatTitle';
    const targetLabel = el(doc, 'p', 'chat-target', 'Nincs célmező – válassz a listából');
    targetLabel.id = 'chatTarget';
    const toggle = el(doc, 'button', 'secondary', '–');
    toggle.id = 'chatToggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-controls', 'chatBody');
    toggle.setAttribute('aria-label', 'Összecsukás');
    head.append(title, targetLabel, toggle);

    const body = el(doc, 'div', 'chat-body');
    body.id = 'chatBody';
    const targetRow = el(doc, 'div', 'chat-target-row');
    const selectLabel = el(doc, 'label', '', 'Célmező');
    selectLabel.htmlFor = 'chatTargetSelect';
    const select = el(doc, 'select');
    select.id = 'chatTargetSelect';
    select.setAttribute('aria-label', 'A chat célmezője');
    targetRow.append(selectLabel, select);
    const log = el(doc, 'div', 'chat-log');
    log.id = 'chatLog';
    log.setAttribute('aria-live', 'polite');
    const quick = el(doc, 'div', 'chat-quick');
    quick.id = 'chatQuick';
    const inputRow = el(doc, 'div', 'chat-input-row');
    const message = el(doc, 'textarea');
    message.id = 'chatMessage';
    message.rows = 1;
    message.maxLength = 2000;
    message.placeholder = cfg.placeholder || 'Írd le, mit fogalmazzon meg az AI…';
    const send = el(doc, 'button', '', 'Küldés');
    send.id = 'chatSend';
    send.type = 'button';
    inputRow.append(message, send);
    body.append(targetRow, log, quick, inputRow);
    host.append(head, body);

    const quickPrompts = Array.isArray(cfg.quickPrompts) && cfg.quickPrompts.length
      ? cfg.quickPrompts
      : [
        ['Fogalmazd újra', 'Fogalmazd újra szakmailag igényesen, a tartalmat megtartva.'],
        ['Rövidítsd', 'Rövidítsd a szöveget a lényeg megtartásával.'],
        ['Javítsd a hibákat', 'Javítsd a helyesírási, nyelvtani és szakmai pontatlanságokat; a tényadatokat ne változtasd.'],
        ['Egészítsd ki', 'Egészítsd ki a szöveget a rendelkezésre álló tényadatokkal; a hiányzó adat helyére hiányjelölés kerüljön.']
      ];
    for (const [label, prompt] of quickPrompts) {
      const chip = el(doc, 'button', 'secondary', label);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        message.value = prompt;
        message.focus();
        try { message.setSelectionRange(message.value.length, message.value.length); } catch (_) {}
      });
      quick.append(chip);
    }

    function status(text, kind) {
      if (typeof cfg.onStatus === 'function') cfg.onStatus(text, kind);
    }

    function chatHeight() {
      if (!host || host.hidden) return 0;
      const rect = host.getBoundingClientRect ? host.getBoundingClientRect() : null;
      return Math.round((rect && rect.height) || host.offsetHeight || 0);
    }
    function setHeight() {
      const rootStyle = doc.documentElement && doc.documentElement.style;
      if (rootStyle && rootStyle.setProperty) rootStyle.setProperty('--chat-height', chatHeight() + 'px');
    }

    function labelOf(target) {
      return String(target && (target.label || target.id) || '').replace(/\s+/g, ' ').trim();
    }

    function updateLabel() {
      const target = targets.get(activeId);
      targetLabel.textContent = target ? 'Mező: „' + labelOf(target) + '”' : 'Nincs célmező – válassz a listából';
      if (target && select.value !== activeId) select.value = activeId;
      select.disabled = targets.size === 0;
    }

    function setActive(id, pin) {
      if (pin) pinned = true;
      const next = targets.get(id);
      const previous = targets.get(activeId);
      if (previous && previous !== next) removeClass(previous.input,'active-input');
      activeId = next ? id : '';
      if (next) addClass(next.input,'active-input');
      updateLabel();
    }

    function refreshSelect() {
      const previous = activeId;
      select.replaceChildren();
      const placeholder = el(doc, 'option', '', 'Válassz célmezőt…');
      placeholder.value = '';
      select.append(placeholder);
      const groups = new Map();
      for (const target of targets.values()) {
        const name = target.group || 'Mezők';
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(target);
      }
      for (const [name, items] of groups) {
        const group = el(doc, 'optgroup');
        group.label = name;
        for (const item of items) {
          const option = el(doc, 'option', '', labelOf(item).slice(0, 90));
          option.value = item.id;
          group.append(option);
        }
        select.append(group);
      }
      select.value = previous || '';
      updateLabel();
    }

    function register(target) {
      if (!target || !target.id || !target.input) return;
      targets.set(target.id, target);
      target.input.dataset.chatTarget = target.id;
      refreshSelect();
      // A mező csak a render után kerül a DOM-ba, ezért a látható mező
      // kiválasztását a következő képkockára halasztjuk.
      if (typeof root.requestAnimationFrame === 'function')
        root.requestAnimationFrame(() => { syncPosition(); pickVisible(); });
      else { syncPosition(); pickVisible(); }
      setHeight();
      return target;
    }

    function clear() {
      const previous = targets.get(activeId);
      if (previous) removeClass(previous.input,'active-input');
      targets.clear();
      activeId = '';
      pinned = false;
      refreshSelect();
      setHeight();
    }

    function unregister(prefix) {
      for (const [id, target] of [...targets]) {
        if (!prefix || id === prefix || id.startsWith(prefix + '#') ||
            id.startsWith(prefix + '/')) {
          removeClass(target.input,'active-input');
          delete target.input.dataset.chatTarget;
          targets.delete(id);
        }
      }
      if (!targets.has(activeId)) activeId = '';
      refreshSelect();
      setHeight();
    }

    function focusTarget(id) {
      const target = targets.get(id);
      if (!target) return;
      setActive(id, true);
      let node = target.input.parentNode;
      while (node && node !== doc.body) {
        if (node.tagName === 'DETAILS') { node.open = true; break; }
        node = node.parentNode;
      }
      if (target.input.scrollIntoView) target.input.scrollIntoView({behavior: 'smooth', block: 'center'});
      if (target.input.focus) target.input.focus();
    }

    function pickVisible() {
      if (pinned && activeId) return;
      const list = [...targets.values()].map(target => target.input);
      if (!list.length) { setActive(''); return; }
      const limit = (root.innerHeight || 0) - chatHeight() - 8;
      let chosen = null;
      for (const input of list) {
        const rect = input.getBoundingClientRect ? input.getBoundingClientRect() : null;
        if (!rect || !rect.height) continue;
        if (rect.bottom <= 24 || rect.top >= limit) continue;
        chosen = input;
        break;
      }
      if (!chosen && list[0]) chosen = list[0];
      if (chosen && chosen.dataset) setActive(chosen.dataset.chatTarget);
    }

    function appendLog(text, me) {
      const line = el(doc, 'p', me ? 'me' : '', text);
      log.append(line);
      log.scrollTop = log.scrollHeight;
    }

    function defaultSuggestion(target, text) {
      const input = target.input;
      const hostNode = (input.closest && input.closest('.field')) || input.parentNode;
      const box = el(doc, 'div', 'ai-suggestion');
      const title = el(doc, 'div', 'ai-suggestion-title', 'AI-javaslat – ellenőrizd, majd illeszd be:');
      const area = el(doc, 'textarea');
      area.value = text;
      area.rows = 4;
      area.setAttribute('aria-label', 'AI-javaslat');
      const checks = el(doc, 'div', 'ai-checks');
      const overwriteLabel = el(doc, 'label');
      const overwrite = el(doc, 'input');
      overwrite.type = 'checkbox';
      overwrite.checked = true;
      overwriteLabel.append(overwrite, doc.createTextNode(' Felülírás'));
      const appendLabel = el(doc, 'label');
      const append = el(doc, 'input');
      append.type = 'checkbox';
      appendLabel.append(append, doc.createTextNode(' Kiegészítés'));
      checks.append(overwriteLabel, appendLabel);
      overwrite.addEventListener('change', () => { if (overwrite.checked) append.checked = false; });
      append.addEventListener('change', () => { if (append.checked) overwrite.checked = false; });
      const actions = el(doc, 'div', 'ai-suggestion-actions');
      const apply = el(doc, 'button', '', 'Beillesztés');
      apply.type = 'button';
      const cancel = el(doc, 'button', 'secondary', 'Mégse');
      cancel.type = 'button';
      actions.append(apply, cancel);
      box.append(title, area, checks, actions);
      if (hostNode && hostNode.parentNode) hostNode.parentNode.insertBefore(box, hostNode.nextSibling);
      else input.parentNode.insertBefore(box, input.nextSibling);

      cancel.addEventListener('click', () => box.remove());
      apply.addEventListener('click', () => {
        const value = area.value.trim();
        if (!value) { status('A javaslat üres.', 'error'); return; }
        const current = String(input.value || '').trim();
        const next = append.checked && current ? current + '\n\n' + value : value;
        if (typeof target.apply === 'function') target.apply(next);
        else {
          input.value = next;
          if (input.dispatchEvent) input.dispatchEvent(new Event('input', {bubbles: true}));
        }
        box.remove();
        status('A javaslat bekerült a mezőbe. Ellenőrizd, majd mentsd.', 'success');
      });
    }

    async function sendMessage() {
      const text = message.value.trim();
      if (!text) { status('Írj be egy mondatot az AI-nak.', 'error'); return; }
      const target = targets.get(activeId);
      if (!target) { status('Válassz célmezőt a lista felett, vagy kattints a kívánt mezőbe.', 'error'); return; }
      if (typeof cfg.request !== 'function') { status('Az AI-szolgáltatás nincs beállítva.', 'error'); return; }
      const current = String(target.input.value || target.input.placeholder || '');
      const previous = history.slice(-6);
      message.value = '';
      send.disabled = true;
      appendLog(text, true);
      status('Az AI fogalmaz…');
      try {
        const result = await cfg.request({instruction: text, current, label: labelOf(target),
          page: pageLabel, history: previous});
        history.push({role: 'user', text});
        history.push({role: 'assistant', text: result.reply || 'Javaslat készült.'});
        if (history.length > 16) history.splice(0, history.length - 16);
        appendLog(result.reply || 'A javaslat elkészült.');
        if (result.text) {
          if (typeof cfg.showSuggestion === 'function')
            cfg.showSuggestion({target, text: result.text, reply: result.reply});
          else defaultSuggestion(target, result.text);
        } else if (result.filtered) {
          status('Az AI javaslatát a tartalmi ellenőrzés nem engedte be (kitalált jogszabályi hivatkozás, '+
            'hiányjelölés vagy hibás célmező). Pontosítsd a kérést.', 'warning');
        } else if (!result.handled) {
          status('Az AI válaszolt, de nem módosított szöveget. Ha szöveget is szeretnél, pontosítsd a kérést.', 'info');
        }
      } catch (error) {
        status(error.message || String(error), 'error');
      } finally {
        send.disabled = false;
      }
    }

    toggle.addEventListener('click', () => {
      const collapsed = toggleClass(host,'collapsed');
      toggle.textContent = collapsed ? '+' : '–';
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', collapsed ? 'Kinyitás' : 'Összecsukás');
      setHeight();
    });
    select.addEventListener('change', () => focusTarget(select.value));
    send.addEventListener('click', sendMessage);
    message.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        sendMessage();
      }
    });
    if (doc.addEventListener) doc.addEventListener('focusin', event => {
      const node = event && event.target;
      if (!node || !node.dataset || !node.dataset.chatTarget) return;
      if (targets.has(node.dataset.chatTarget)) setActive(node.dataset.chatTarget,true);
    });
    // A sáv a tartalmi oszlop (main) pozíciójához és szélességéhez igazodik.
    // A layout oldalanként változó, ezért minden mérésnél újraolvassuk.
    function syncPosition() {
      const selector = cfg.alignTo || 'main';
      const target = doc.querySelector ? doc.querySelector(selector) : null;
      const rect = target && target.getBoundingClientRect ? target.getBoundingClientRect() : null;
      const width = rect ? Number(rect.width) || 0 : 0;
      if (!host.style) return;
      if (width > 0) {
        host.style.left = Math.round(rect.left) + 'px';
        host.style.width = Math.round(width) + 'px';
        host.style.transform = 'none';
      } else {
        host.style.left = '';
        host.style.width = '';
        host.style.transform = '';
      }
    }
    const schedule = () => {
      const run = () => { syncPosition(); pickVisible(); setHeight(); };
      if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(run);
      else run();
    };
    if (root.addEventListener) {
      root.addEventListener('scroll', schedule, {passive: true});
      root.addEventListener('resize', () => { setHeight(); schedule(); });
    }
    if (typeof root.ResizeObserver === 'function') {
      new root.ResizeObserver(() => setHeight()).observe(host);
      const column = doc.querySelector ? doc.querySelector(cfg.alignTo || 'main') : null;
      if (column) new root.ResizeObserver(syncPosition).observe(column);
      if (doc.body) new root.ResizeObserver(syncPosition).observe(doc.body);
    }

    syncPosition();
    setHeight();
    pickVisible();

    return {
      register, clear, unregister, refresh: refreshSelect, setTarget: setActive,
      activeId: () => activeId, getTarget: id => targets.get(id),
      targets: () => [...targets.values()], focusTarget,
      refreshSelection: () => { syncPosition(); pickVisible(); setHeight(); },
      log: appendLog,
      setRootHidden: hidden => { host.hidden = hidden; syncPosition(); setHeight(); },
      element: host
    };
  }

  root.AiComposer = {create};
})(typeof window !== 'undefined' ? window : globalThis);
