// Увеличение поля на телефоне и планшете (15.11, дорожная карта п.6, схема одобрена Денисом):
// двумя пальцами увеличить и двигать (1x-2,5x), одним пальцем ход и прокрутка страницы как раньше,
// кнопки «−» и «+» в углу поля. Меняется viewBox поля, а не CSS: нажатия по клеткам (.cell-hit)
// и полеты фишек (cellScreen через getScreenCTM) попадают куда надо без пересчета.
// На большом поле 19x13 клетка на телефоне около 19 px, отсюда задача.

export const ZMIN = 1, ZMAX = 2.5, ZSTEP = 1.5;

/** Вид в границах поля: z от ZMIN до ZMAX, окно не выходит за края. base = { w, h } поля. */
export function clampView(v, base) {
  const z = Math.min(ZMAX, Math.max(ZMIN, v.z));
  const w = base.w / z, h = base.h / z;
  return { z, x: Math.min(base.w - w, Math.max(0, v.x)), y: Math.min(base.h - h, Math.max(0, v.y)) };
}

/** Кнопки: новый масштаб z с тем же центром окна. */
export function zoomCenter(v, base, z) {
  const cx = v.x + base.w / v.z / 2, cy = v.y + base.h / v.z / 2;
  return clampView({ z, x: cx - base.w / z / 2, y: cy - base.h / z / 2 }, base);
}

/**
 * Щипок: в начале жеста запомнили вид v0 и точку поля p0 под серединой пальцев. Сейчас пальцы
 * разошлись в scale раз, а середина стоит в доле (fx, fy) ширины и высоты поля на экране:
 * точка p0 остается под пальцами, так жест и увеличивает, и двигает.
 */
export function pinchView(v0, p0, base, scale, fx, fy) {
  const z = Math.min(ZMAX, Math.max(ZMIN, v0.z * scale));
  return clampView({ z, x: p0.x - fx * (base.w / z), y: p0.y - fy * (base.h / z) }, base);
}

export const viewBoxOf = (v, base) => `${+v.x.toFixed(2)} ${+v.y.toFixed(2)} ${+(base.w / v.z).toFixed(2)} ${+(base.h / v.z).toFixed(2)}`;

const ICON = (d) => `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="${d}" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>`;
export const ZOOM_HTML = `<div class="zoomctl" role="group" aria-label="Масштаб поля"><button type="button" class="zbtn" data-zoom="-1" aria-label="Уменьшить поле" title="Уменьшить поле">${ICON('M5 10h10')}</button><button type="button" class="zbtn" data-zoom="1" aria-label="Увеличить поле" title="Увеличить поле. Двигать двумя пальцами">${ICON('M5 10h10M10 5v10')}</button></div>`;

/**
 * Подключить к полю svg внутри wrap. Возвращает apply(): звать после каждой отрисовки поля,
 * renderBoard ставит полный viewBox при смене карты или вида поля.
 */
export function mountZoom(svg, wrap) {
  wrap.insertAdjacentHTML('beforeend', ZOOM_HTML);
  const ctl = wrap.querySelector('.zoomctl');
  let v = { z: 1, x: 0, y: 0 }, base = null, full = '';
  const readBase = () => {
    // полный viewBox ставит renderBoard: «0 0 w h»; пока вид увеличен, помним его отдельно
    const vb = svg.getAttribute('viewBox');
    if (!vb) return null;
    const [, , w, h] = vb.split(/\s+/).map(Number);
    if (vb !== full && svg.dataset.zoomed !== vb) { base = { w, h }; full = vb; v = { z: 1, x: 0, y: 0 }; }
    return base;
  };
  const paint = () => {
    if (!readBase()) return;
    const vb = v.z > 1 ? viewBoxOf(v, base) : full;
    if (svg.getAttribute('viewBox') !== vb) svg.setAttribute('viewBox', vb);
    svg.dataset.zoomed = v.z > 1 ? vb : '';
    ctl.classList.toggle('on', v.z > 1);
    ctl.querySelector('[data-zoom="-1"]').disabled = v.z <= ZMIN;
    ctl.querySelector('[data-zoom="1"]').disabled = v.z >= ZMAX;
  };
  ctl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-zoom]');
    if (!b || !readBase()) return;
    v = zoomCenter(v, base, b.dataset.zoom === '1' ? v.z * ZSTEP : v.z / ZSTEP);
    if (v.z < 1.01) v = { z: 1, x: 0, y: 0 };
    paint();
  });

  // два пальца: щипок и сдвиг. Один палец не трогаем: ход и прокрутка страницы как раньше
  let g = null, quietUntil = 0;
  const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
  svg.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2 || !readBase()) return;
    if (e.cancelable) e.preventDefault();
    const r = svg.getBoundingClientRect(), m = mid(e.touches);
    const fx = (m.x - r.left) / r.width, fy = (m.y - r.top) / r.height;
    g = { v0: { ...v }, d0: dist(e.touches), p0: { x: v.x + fx * (base.w / v.z), y: v.y + fy * (base.h / v.z) } };
  }, { passive: false });
  svg.addEventListener('touchmove', (e) => {
    if (!g || e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault();
    const r = svg.getBoundingClientRect(), m = mid(e.touches);
    v = pinchView(g.v0, g.p0, base, dist(e.touches) / g.d0, (m.x - r.left) / r.width, (m.y - r.top) / r.height);
    if (v.z < 1.01) v = { z: 1, x: 0, y: 0 };
    paint();
  }, { passive: false });
  const end = (e) => {
    if (!g || e.touches.length >= 2) return;
    g = null;
    quietUntil = Date.now() + 400; // отпущенный палец щипка не должен стать ходом
  };
  svg.addEventListener('touchend', end);
  svg.addEventListener('touchcancel', end);
  svg.addEventListener('click', (e) => { if (Date.now() < quietUntil) e.stopPropagation(); }, true);
  return paint;
}
