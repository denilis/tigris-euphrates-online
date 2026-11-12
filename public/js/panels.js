// Панель экрана партии: ширина, сторона, порядок и сворачивание блоков. Настройки сразу видны
// (браузер помнит их за игроком) и сохраняются на сервере, чтобы вид был один на всех компьютерах.
import { api, session } from './api.js';
import { BLOCKS, PANEL_SCALES, PANEL_HIDE, cleanLayout, clampSide, moveBlock, dropIndex, toggled } from './layout-core.js';

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
  // (--sidemin ставит fitSide: панель не уже содержимого, ширину по умолчанию это тоже касается)
  else app.style.removeProperty('--side');
  app.classList.toggle('sideleft', cur.left);
  app.classList.toggle('handside', cur.handSide);
  // настройка панели (12.11): текст мельче всей панелью, лишнее в карточках игроков спрятано
  if (cur.scale !== 100) app.style.setProperty('--sidezoom', String(cur.scale / 100));
  else app.style.removeProperty('--sidezoom');
  for (const h of PANEL_HIDE) app.classList.toggle('p-no' + h, cur.hide.includes(h));
  BLOCKS.forEach((id) => {
    const el = block(id);
    el.style.order = cur.order.indexOf(id);
    // блок решений раскрывается сам: свернутый он спрятал бы кнопки хода; «Запас» на время выбора
    // монумента (08.11): монумент выбирают в нем
    el.classList.toggle('shut', cur.shut.includes(id) && !(id === 'now' && nowOpen) && !(id === 'stock' && stockOpen));
  });
  root.querySelector('#gSideMove').textContent = cur.left ? 'Панель справа' : 'Панель слева';
  root.querySelector('#gHandMove').textContent = cur.handSide ? 'Рука под картой' : 'Рука сбоку';
  fitSide();
}

/**
 * Панель не уже своего содержимого (Денис 12.11): счет игрока уходил за край, имя бота наезжало на
 * «в руке». Каждый раскрытый блок копируется невидимо с шириной по содержимому (min-content: самое
 * длинное слово, строка, которая не переносится), самая широкая копия плюс поля блока и полоса
 * прокрутки дает --sidemin. Ширина панели в CSS: max(--side, --sidemin). На телефоне панель во всю
 * ширину, там не нужно.
 */
let need = 0, gutter = 0;
export function fitSide() {
  const app = root?.querySelector('#game'), side = root?.querySelector('#gSide');
  if (!app || !side) return;
  if (innerWidth <= 900) {
    need = 0;
    app.style.removeProperty('--sidemin');
    return;
  }
  let w = 0;
  const sr = side.getBoundingClientRect();
  // журнал не меряем: строки в нем переносятся, а копировать сотни записей на каждую перерисовку дорого
  for (const sec of side.querySelectorAll('section[data-block]:not([data-block="log"])')) {
    const bb = sec.querySelector('.bbody');
    if (!bb || sec.classList.contains('shut') || !bb.firstElementChild && !bb.textContent.trim()) continue;
    const probe = bb.cloneNode(true);
    probe.removeAttribute('id');
    probe.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
    probe.setAttribute('aria-hidden', 'true');
    probe.classList.add('sizeprobe'); // в копии столбцы карточек по содержимому (app.css)
    probe.style.cssText = 'position:absolute;left:0;top:0;width:min-content;visibility:hidden;pointer-events:none';
    sec.appendChild(probe);
    const pad = sec.getBoundingClientRect().width - bb.getBoundingClientRect().width;
    w = Math.max(w, probe.getBoundingClientRect().width + pad);
    probe.remove();
  }
  // рамка и полоса прокрутки панели. Полоса появляется и пропадает от высоты содержимого, а та
  // от ширины: место под полосу запоминается самым большим, иначе ширина качалась бы туда-обратно
  const cs = getComputedStyle(side);
  const border = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  gutter = Math.max(gutter, side.offsetWidth - side.clientWidth - border);
  w += (border + gutter) * (sr.width / (side.offsetWidth || 1));
  const px = Math.ceil(w);
  if (px === need && app.style.getPropertyValue('--sidemin')) return;
  need = px;
  app.style.setProperty('--sidemin', need + 'px');
}

/** Меню «Настроить» в строке «Игроки» (Денис 12.11): размер текста панели и что показывать. */
function sideMenuHtml() {
  const scale = PANEL_SCALES.map((v, i) => `<button data-pscale="${v}" class="${cur.scale === v ? 'on' : ''}" aria-pressed="${cur.scale === v}">${['Обычный', 'Мельче', 'Мелкий'][i]}</button>`).join('');
  const row = (h, label) => `<div class="sfxrow"><button class="sw" role="switch" data-phide="${h}" aria-checked="${!cur.hide.includes(h)}"><i></i>${label}</button></div>`;
  return '<div class="sfxhead"><b>Настройка панели</b><button class="sfxclose" data-ps="close" aria-label="Закрыть">&times;</button></div>'
    + `<div class="sfxgroup">Размер текста</div><span class="seg psseg" role="group" aria-label="Размер текста панели">${scale}</span>`
    + '<div class="sfxgroup">В карточках игроков</div>'
    + row('avatars', 'Портреты') + row('leaders', 'Лидеры: на поле и в руке') + row('time', 'Время партии')
    + '<p class="pshint">Свои лидеры видны и внизу, в руке. Ширину панели меняет полоска между картой и панелью, но уже, чем нужно надписям, панель не станет.</p>'
    + '<div class="sfxfoot"><button class="btn" data-ps="reset">Как было</button></div>';
}

function bindSideMenu() {
  const btn = root.querySelector('#gSideSet'), menu = root.querySelector('#gSideMenu');
  if (!btn || !menu) return;
  const close = () => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    removeEventListener('pointerdown', outside, true);
    removeEventListener('keydown', onKey, true);
  };
  const outside = (e) => { if (!menu.contains(e.target) && !btn.contains(e.target)) close(); };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
    btn.focus();
  };
  const place = () => {
    const r = btn.getBoundingClientRect(), w = Math.min(300, innerWidth - 24);
    Object.assign(menu.style, { width: `${w}px`, top: `${r.bottom + 6}px`, left: `${Math.max(12, Math.min(r.right - w, innerWidth - w - 12))}px`, maxHeight: `${innerHeight - r.bottom - 18}px` });
  };
  const fill = () => { menu.innerHTML = sideMenuHtml(); };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!menu.hidden) return close();
    fill();
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    place();
    addEventListener('pointerdown', outside, true);
    addEventListener('keydown', onKey, true);
  });
  menu.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.ps === 'close') return close();
    if (t.dataset.ps === 'reset') change({ scale: 100, hide: [] });
    else if (t.dataset.pscale) change({ scale: +t.dataset.pscale });
    else if (t.dataset.phide) {
      const h = t.dataset.phide;
      change({ hide: cur.hide.includes(h) ? cur.hide.filter((x) => x !== h) : PANEL_HIDE.filter((x) => x === h || cur.hide.includes(x)) });
    } else return;
    fill();
    place();
  });
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
      w = clampSide(w + (cur.left ? err : -err), innerWidth, need);
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
    if (!head || e.target.closest('.fold, .bset')) return;
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
  bindSideMenu();
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
