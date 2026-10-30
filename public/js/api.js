// Запросы к серверу и наблюдение за столом. Сессия хранится в браузере; в режиме
// разработки (?dev=1 на localhost) — на вкладку, чтобы в одном браузере сидели трое.
import { pollDelay } from './poll.js';

const DEV = new URLSearchParams(location.search).has('dev') && ['localhost', '127.0.0.1'].includes(location.hostname);
const box = DEV ? sessionStorage : localStorage;
const KEY = 'tigris.session';

export const session = {
  get() {
    try { return JSON.parse(box.getItem(KEY)); } catch { return null; }
  },
  set(v) {
    try { box.setItem(KEY, JSON.stringify(v)); } catch { /* приватный режим: живём без памяти */ }
  },
  clear() {
    try { box.removeItem(KEY); } catch { /* нечего чистить */ }
  },
};

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(method, path, body) {
  const s = session.get();
  let r;
  try {
    r = await fetch('/api/' + path, {
      method,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(s?.token ? { Authorization: 'Bearer ' + s.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Нет связи с сервером');
  }
  let d = null;
  try { d = await r.json(); } catch { /* пустой ответ */ }
  if (!r.ok) {
    if (r.status === 401 && path !== 'activate') {
      session.clear();
      window.dispatchEvent(new Event('tigris:logout'));
    }
    throw new ApiError(r.status, d?.error, d?.message || 'Ошибка сервера');
  }
  return d;
}

/**
 * Наблюдение за столом: опрос версии (темп по состоянию стола, см. poll.js; на скрытой
 * вкладке реже), при изменении докачка вида с хвостом журнала; если решает бот и замка нет,
 * просим сервер сделать ход бота.
 */
export function watchTable(code, onView, onError) {
  let view = null, version = -1, stopped = false, timer = null, ticking = false, busy = false;

  const merge = (v, appendLog) => {
    if (appendLog && view?.game && v.game) v.game.log = [...view.game.log, ...v.game.log];
    // часы сервера против своих: таймеры считаем по серверу
    if (v.game?.clock?.now) v.game.clock.skew = v.game.clock.now - Date.now();
    view = v;
    version = v.version;
    onView(v);
  };

  async function fetchView(full = false) {
    const from = !full && view?.game ? view.game.log.length : 0;
    const v = await api('GET', `tables/${code}${from ? `?logFrom=${from}` : ''}`);
    // журнал разошёлся (стол пересоздан, пропуск или отмена хода): берём целиком
    if (from && v.game && (v.game.logTotal !== from + v.game.log.length || (v.game.logEpoch || 0) !== (view.game.logEpoch || 0))) return fetchView(true);
    merge(v, Boolean(from));
  }

  async function tick() {
    if (stopped || busy) return schedule();
    busy = true;
    try {
      const p = await api('GET', `tables/${code}/poll`);
      if (p.version !== version) await fetchView();
      if (p.botDue && !p.locked && !ticking) {
        ticking = true;
        api('POST', `tables/${code}/bot-tick`).catch(() => {}).finally(() => { ticking = false; });
      }
    } catch (e) {
      onError?.(e);
    } finally {
      busy = false;
      schedule();
    }
  }

  function schedule() {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(tick, pollDelay(view, document.hidden));
  }

  const onVis = () => { if (!document.hidden) { clearTimeout(timer); tick(); } };
  document.addEventListener('visibilitychange', onVis);
  fetchView(true).catch((e) => onError?.(e)).finally(schedule);

  return {
    /** Принять вид из ответа на действие (журнал в нём полный). */
    apply(v) {
      merge(v, false);
      if (!busy) schedule(); // после своего хода темп опроса другой (бот, чужой ход)
    },
    refresh() { return fetchView(true).catch((e) => onError?.(e)); },
    stop() {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    },
    get view() { return view; },
  };
}
