const VERSION = 'cardsapp-v2';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/utils.js',
  './js/templates.js',
  './js/cardfaces.js',
  './js/crypto.js',
  './js/db.js',
  './js/auth.js',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './cardfaces/abc-1.jpg', './cardfaces/abc-2.jpg', './cardfaces/abc-3.jpg',
  './cardfaces/boc-1.jpg', './cardfaces/boc-2.jpg', './cardfaces/boc-3.jpg',
  './cardfaces/bocom-1.jpg', './cardfaces/bocom-2.jpg', './cardfaces/bocom-3.jpg',
  './cardfaces/ccb-1.jpg', './cardfaces/ccb-2.jpg', './cardfaces/ccb-3.jpg',
  './cardfaces/cgb-1.jpg', './cardfaces/cgb-2.jpg', './cardfaces/cgb-3.jpg',
  './cardfaces/cib-1.jpg', './cardfaces/cib-2.jpg', './cardfaces/cib-3.jpg',
  './cardfaces/citic-1.jpg', './cardfaces/citic-2.jpg', './cardfaces/citic-3.jpg',
  './cardfaces/cmb-1.jpg', './cardfaces/cmb-2.jpg', './cardfaces/cmb-3.jpg',
  './cardfaces/cmbc-1.jpg', './cardfaces/czb-1.jpg',
  './cardfaces/hxb-1.jpg', './cardfaces/hzb-1.jpg',
  './cardfaces/icbc-1.jpg', './cardfaces/icbc-2.jpg', './cardfaces/icbc-3.jpg',
  './cardfaces/nbcb-1.jpg',
  './cardfaces/pab-1.jpg', './cardfaces/pab-2.jpg', './cardfaces/pab-3.jpg',
  './cardfaces/psbc-1.jpg', './cardfaces/psbc-2.jpg', './cardfaces/psbc-3.jpg',
  './cardfaces/spdb-1.jpg', './cardfaces/spdb-2.jpg', './cardfaces/spdb-3.jpg',
  './cardfaces/webank-1.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => null);

      if (cached) {
        network.then(() => {});
        return cached;
      }
      return network.then((res) => {
        if (res) return res;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
