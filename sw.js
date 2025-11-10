
const CACHE = 'incanto-ops-plus-v4';
const ASSETS = [
  './','./index.html','./style.css','./app.js','./manifest.webmanifest',
  './config.js','./sync.js','./portal.html','./portal.js',
  './icons/incanto_180.png','./icons/incanto_192.png','./icons/incanto_512.png','./icons/incanto.svg',
];
self.addEventListener('install', e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e=>{ e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e=>{ const u=new URL(e.request.url); if(u.origin===location.origin){ e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))); } });
