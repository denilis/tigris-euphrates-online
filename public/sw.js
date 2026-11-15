// Служба уведомлений «Ваш ход» (15.11, дорожная карта п.10). Только уведомление и нажатие на него:
// страницы и файлы не кэширует, сайт грузится из сети, как и без нее.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let d = {};
    try { d = e.data ? e.data.json() : {}; } catch { /* пустое уведомление: общий текст */ }
    // вкладка с сайтом открыта и перед глазами: ход и так видно по рамке и звуку
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (d.tag !== 'push-test' && wins.some((w) => w.focused && w.visibilityState === 'visible')) return;
    await self.registration.showNotification(d.title || 'Тигр и Евфрат', {
      body: d.body || 'Ваш ход',
      tag: d.tag || 'turn',
      renotify: true,
      icon: '/img/app/icon-192.png',
      badge: '/img/app/icon-192.png',
      data: { url: d.url || '/' },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find((x) => new URL(x.url).origin === self.location.origin);
    if (w) {
      await w.focus();
      try { await w.navigate(url); } catch { w.postMessage({ open: url }); }
      return;
    }
    await self.clients.openWindow(url);
  })());
});
