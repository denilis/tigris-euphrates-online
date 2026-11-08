// Панель экрана партии: ширина, сторона, порядок и сворачивание блоков. Настройки сразу видны
// (браузер помнит их за игроком) и сохраняются на сервере, чтобы вид был один на всех компьютерах.
import { api, session } from './api.js';
import { BLOCKS, cleanLayout, clampSide, moveBlock, dropIndex, toggled } from './layout-core.js';

const KEY = 'tigris.layout.';
const UNSAVED = 'tigris.layout.unsaved'; // сервер еще не получил последнюю правку
const SAVE_MS = 600;

let cur = cleanLayout(null), root = null, uid = null, timer = null, nowOpen = false, stockOpen = false, touched = false, synced = false;

const block = (id) => root.querySelector(`[data-block="${id}"]`);

function remembered(id) {
  try { return JSON.parse(localStorage.getItem(KEY + id)); } catch { return null; }
}

function remember() {
  try { localStorage.setItem(KEY + uid, JSON.stringify(cur)); } catch { /* приватный режим: живем без памяти */ }
}

function markUnsaved(on) {
  try {
    if (on) localStorage.setItem(UNSAVED, uid);
    else localStorage.removeItem(UNSAVED);
  } catch { /* приватный режим */ }
}

function isUnsaved() {
  try { return localStorage.getItem(UNSAVED) === uid; } catch { return false; }
}

const push = () => api('POST', 'prefs', cur).then(() => markUnsaved(false)).catch(() => {});

function apply() {
  const app = root?.querySelector('#game');
  if (!app) return;
  if (cur.side) app.style.setProperty('--side', clampSide(cur.side, innerWidth) + 'px');
  else app.style.removeProperty('--side');
  app.classList.toggle('sideleft', cur.left);
  app.classList.toggle('handside', cur.handSide);
  BLOCKS.forEach((id) => {
    const el = block(id);
    el.style.order = cur.order.indexOf(id);
    // блок решений раскрывается сам: свернутый он спрятал бы кнопки хода; «Запас» на время выбора
    // монумента (08.11): монумент выбирают в нем
    el.classList.toggle('shut', cur.shut.includes(id) && !(id === 'now' && nowOpen) && !(id === 'stock' && stockOpen));
  });
  root.querySelector('#gSideMove').textContent = cur.left ? 'Панель справа' : 'Панель слева';
  root.querySelector('#gHandMove').textContent = cur.handSide ? 'Рука под картой' : 'Рука сбоку';
}

function change(patch) {
  cur = { ...cur, ...patch };
  touched = true;
  apply();
  if (!uid) return; // гость в уроке: вид только на экране, сервер ответил бы 401 и выкинул на вход
  remember();
  markUnsaved(true);
  clearTimeout(timer);
  timer = setTimeout(push, SAVE_MS);
}

/** Тянуть полоску между картой и панелью. Двойной щелчок возвращает ширину по умолчанию. */
function bindSizer(sizer) {
  const app = root.querySelector('#game'), side = root.querySelector('#gSide');
  sizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sizer.setPointerCapture(e.pointerId);
    let w = side.getBoundingClientRect().width, moved = false;
    const move = (ev) => {
      moved = true;
      const s = side.getBoundingClientRect(), r = sizer.getBoundingClientRect();
      const gap = cur.left ? s.left : innerWidth - s.right;
      // карта с панелью стоят по центру: при запасе по бокам полоска идет вдвое медленнее панели
      const err = (ev.clientX - (r.left + r.width / 2)) * (gap > 1 ? 2 : 1);
      w = clampSide(w + (cur.left ? err : -err), innerWidth);
      app.style.setProperty('--side', w + 'px');
    };
    const up = () => {
      sizer.removeEventListener('pointermove', move);
      sizer.removeEventListener('pointerup', up);
      sizer.removeEventListener('pointercancel', up);
      if (moved) change({ side: w });
    };
    sizer.addEventListener('pointermove', move);
    sizer.addEventListener('pointerup', up);
    sizer.addEventListener('pointercancel', up);
  });
  sizer.addEventListener('dblclick', () => change({ side: 0 }));
}

/** Перетащить блок панели за заголовок, стрелка в заголовке сворачивает блок. */
function bindBlocks(sideEl) {
  sideEl.addEventListener('click', (e) => {
    const fold = e.target.closest('.fold');
    if (fold) change({ shut: toggled(cur.shut, fold.closest('[data-block]').dataset.block) });
  });
  sideEl.addEventListener('pointerdown', (e) => {
    const head = e.target.closest('.blockhead');
    if (!head || e.target.closest('.fold')) return;
    const sec = head.parentElement, id = sec.dataset.block;
    const was = cur.order.join();
    e.preventDefault();
    head.setPointerCapture(e.pointerId);
    sec.classList.add('moving');
    const move = (ev) => {
      const mids = cur.order.filter((b) => b !== id).map((b) => {
        const r = block(b).getBoundingClientRect();
        return r.top + r.height / 2;
      });
      const order = moveBlock(cur.order, id, dropIndex(mids, ev.clientY));
      if (order.join() === cur.order.join()) return;
      cur = { ...cur, order };
      apply();
    };
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
      sec.classList.remove('moving');
      if (cur.order.join() !== was) change({});
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  });
}

/** Подключить настройки к только что нарисованному экрану партии. */
export function initPanels(el) {
  root = el;
  const id = session.get()?.user?.id ?? null;
  if (id !== uid) {
    uid = id;
    cur = cleanLayout(remembered(id));
    touched = false;
    synced = false;
  }
  apply();
  bindSizer(root.querySelector('#gSizer'));
  bindBlocks(root.querySelector('#gSide'));
  root.querySelector('#gSideMove').addEventListener('click', () => change({ left: !cur.left }));
  root.querySelector('#gHandMove').addEventListener('click', () => change({ handSide: !cur.handSide }));
  root.querySelector('#gLayoutReset').addEventListener('click', () => change(cleanLayout(null)));
  if (synced || !id) return;
  synced = true;
  if (isUnsaved()) {
    push(); // прошлая правка не дошла до сервера: новее она, а не копия на сервере
    return;
  }
  api('GET', 'prefs').then((v) => {
    if (touched || !v?.order) return;
    cur = cleanLayout(v);
    remember();
    apply();
  }).catch(() => {});
}

/** «Запас» раскрыт, пока игрок выбирает монумент (08.11). */
export function holdStockOpen(open) {
  if (open === stockOpen) return;
  stockOpen = open;
  apply();
}

/** Блок решений раскрыт, пока игрок должен что-то решить. */
export function holdNowOpen(open) {
  if (open === nowOpen) return;
  nowOpen = open;
  apply();
}
