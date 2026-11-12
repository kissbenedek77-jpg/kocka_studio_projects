'use strict';
// Közös fejlécmenü viselkedés: mobilon hamburger gomb nyitja a menüt, asztali
// nézetben a linkek változatlanul egymás mellett látszanak. A menü tartalmát nem
// írja át, csak egy panelbe csomagolja és kiegészíti a gombbal.

(function () {
  function setup(nav) {
    if (!nav || nav.dataset.menuReady === '1') return;
    nav.dataset.menuReady = '1';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ks-app-menu-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Menü megnyitása');
    toggle.innerHTML = '<span></span><span></span><span></span>';
    const panel = document.createElement('div');
    panel.className = 'ks-app-menu-panel';
    panel.id = 'ks-menu-' + Math.random().toString(36).slice(2, 8);
    toggle.setAttribute('aria-controls', panel.id);
    while (nav.firstChild) panel.appendChild(nav.firstChild);
    nav.append(toggle, panel);

    function setOpen(open) {
      nav.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Menü bezárása' : 'Menü megnyitása');
    }
    toggle.addEventListener('click', event => {
      event.stopPropagation();
      setOpen(!nav.classList.contains('open'));
    });
    panel.addEventListener('click', event => {
      if (event.target.closest && event.target.closest('a')) setOpen(false);
    });
    document.addEventListener('click', event => {
      if (nav.classList.contains('open') && !nav.contains(event.target)) setOpen(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && nav.classList.contains('open')) {
        setOpen(false);
        toggle.focus();
      }
    });
  }

  function init() {
    document.querySelectorAll('.ks-app-menu').forEach(setup);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
