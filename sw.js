const CACHE = 'to-doudou-v7';
const ASSETS = [
    './',
    './index.html',
    './css/app.css',
    './js/app.js',
    './js/store.js',
    './js/dates.js',
    './js/vault.js',
    './js/ics.js',
    './js/aisles.js',
    './manifest.webmanifest',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png',
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) {
        return;
    }
    event.respondWith(
        caches.open(CACHE).then(async cache => {
            const cached = await cache.match(event.request, { ignoreSearch: true });
            const network = fetch(event.request, { cache: 'no-cache' })
                .then(response => {
                    if (response.ok) {
                        cache.put(event.request, response.clone());
                    }
                    return response;
                })
                .catch(() => cached);
            return cached || network;
        }),
    );
});
