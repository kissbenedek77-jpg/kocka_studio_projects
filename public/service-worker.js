'use strict';

// Navigation stays network-first. Project data, API responses and login pages are never cached.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#3e3e3e"><title>Nincs kapcsolat · Kocka Stúdió</title><style>body{font:18px/1.5 system-ui,sans-serif;background:#3e3e3e;color:#fff;min-height:100vh;display:grid;place-items:center;margin:0;padding:24px}main{max-width:440px}a{color:#a7ddbc}</style><main><h1>Nincs internetkapcsolat</h1><p>A projektadatok megnyitásához csatlakozz az internethez, majd próbáld újra.</p><a href="/dashboard">Újrapróbálás</a></main></html>',
    {status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"}}
  )));
});
