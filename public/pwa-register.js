'use strict';
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', {scope:'/'}).catch(() => {
      // The site remains usable in the browser when installation is unavailable.
    });
  });
}
