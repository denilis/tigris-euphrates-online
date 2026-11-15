// Уведомления «Ваш ход» в профиле (15.11, дорожная карта п.10, схема одобрена Денисом): включить на
// этом устройстве, проверить, выключить. Подписку хранит сервер (POST me/push), показывает public/sw.js.
import { api } from './api.js';

export const pushSupported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;

const keyBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const registration = () => navigator.serviceWorker.getRegistration('/');

/** Состояние на этом устройстве: unsupported | denied | on | off. */
export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Включить: разрешение браузера, служба уведомлений, подписка на ключ сервера, подписка на сервер. */
export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Браузер запретил уведомления для этого сайта' : 'Разрешение не дано');
  const { key } = await api('GET', 'push/key');
  await navigator.serviceWorker.register('/sw.js');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // подписка на старый ключ сервера не подойдет: подписываемся заново
  if (sub && sub.options?.applicationServerKey && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== key) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await api('POST', 'me/push', { subscription: sub.toJSON() });
}

export async function disablePush() {
  const sub = await (await registration())?.pushManager.getSubscription();
  if (!sub) return;
  await api('POST', 'me/push/off', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

export const testPush = () => api('POST', 'me/push/test');

/** Строка настроек по состоянию. */
export function pushHTML(state) {
  if (state === 'unsupported') return '<span class="muted small">Этот браузер не умеет уведомления.</span>';
  if (state === 'denied') return '<span class="muted small">Запрещены в настройках браузера для этого сайта.</span>';
  if (state === 'on') return '<span class="small">Включены на этом устройстве</span><button class="btn sm" type="button" data-push="test">Проверить</button><button class="btn sm" type="button" data-push="off">Выключить</button>';
  return '<button class="btn primary sm" type="button" data-push="on">Включить на этом устройстве</button>';
}

/** Блок внутри root: #pushBox и #pushErr. */
export async function bindPush(root) {
  const box = root.querySelector('#pushBox'), err = root.querySelector('#pushErr');
  if (!box) return;
  const paint = async () => { box.innerHTML = pushHTML(await pushState().catch(() => 'unsupported')); };
  await paint();
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-push]');
    if (!b) return;
    b.disabled = true;
    err.textContent = '';
    try {
      if (b.dataset.push === 'on') await enablePush();
      else if (b.dataset.push === 'off') await disablePush();
      else {
        const r = await testPush();
        err.textContent = r.sent ? 'Проверочное уведомление отправлено.' : 'Не дошло: включите уведомления заново.';
      }
    } catch (x) {
      err.textContent = x.message || 'Не получилось, попробуйте еще раз.';
    }
    await paint();
  });
}
