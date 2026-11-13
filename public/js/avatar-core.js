// Фото игрока: расчеты без DOM.
//
// Кадр (13.11, окно кадрирования): { cx, cy, s } в точках картинки: центр квадрата и его сторона.
// В аватар идет этот квадрат, на сайте он показывается кругом. Самый широкий кадр берет всю короткую
// сторону фото, пустых краев не бывает; ближе можно подойти в CROP_ZOOM_MAX раз.

/** Квадрат по центру кадра: откуда и какого размера вырезать из картинки w на h. */
export function squareCrop(w, h) {
  const s = Math.min(w, h);
  return { sx: (w - s) / 2, sy: (h - s) / 2, s };
}

export const CROP_ZOOM_MAX = 5;
const CROP_MIN_SIDE = 48; // ближе не подходим: из меньшего куска аватар получится мутным

/** Самый широкий кадр: вся короткая сторона, по центру. С него окно начинает. */
export function fullCrop(w, h) {
  return { cx: w / 2, cy: h / 2, s: Math.min(w, h) };
}

/** Пределы стороны кадра: max самый широкий, min самый близкий. У крошечной картинки они равны. */
export function cropLimits(w, h) {
  const max = Math.min(w, h);
  return { max, min: Math.min(max, Math.max(max / CROP_ZOOM_MAX, CROP_MIN_SIDE)) };
}

const between = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Кадр в пределах масштаба и целиком внутри картинки. Сломанные числа (NaN) дают самый широкий кадр. */
export function clampCrop(c, w, h) {
  if (![c?.cx, c?.cy, c?.s].every(Number.isFinite)) return fullCrop(w, h);
  const { min, max } = cropLimits(w, h);
  const s = between(c.s, min, max);
  return { cx: between(c.cx, s / 2, w - s / 2), cy: between(c.cy, s / 2, h - s / 2), s };
}

/** Фото потянули на dx, dy точек экрана; view: сторона кадра на экране. Кадр едет по картинке навстречу. */
export function panCrop(c, dx, dy, view, w, h) {
  const k = c.s / view;
  return clampCrop({ cx: c.cx - dx * k, cy: c.cy - dy * k, s: c.s }, w, h);
}

/**
 * Масштаб в factor раз (больше единицы: ближе). px, py: где курсор или середина щипка, в точках
 * экрана от центра кадра: точка картинки под ним остается на месте.
 */
export function zoomCrop(c, factor, px, py, view, w, h) {
  const { min, max } = cropLimits(w, h);
  const s = between(c.s / factor, min, max);
  const shift = (c.s - s) / view;
  return clampCrop({ cx: c.cx + px * shift, cy: c.cy + py * shift, s }, w, h);
}

/** Положение ползунка от 0 (самый широкий кадр) до 1 (самый близкий). Шкала логарифмическая. */
export function sliderOf(c, w, h) {
  const { min, max } = cropLimits(w, h);
  return max > min ? between(Math.log(max / c.s) / Math.log(max / min), 0, 1) : 0;
}

/** Кадр для положения ползунка t: центр прежний, пока позволяют края. */
export function cropAtSlider(c, t, w, h) {
  const { min, max } = cropLimits(w, h);
  return clampCrop({ cx: c.cx, cy: c.cy, s: max * (min / max) ** between(Number(t) || 0, 0, 1) }, w, h);
}

/** Откуда вырезать кадр: { sx, sy, s } для drawImage. */
export const cropRect = (c) => ({ sx: c.cx - c.s / 2, sy: c.cy - c.s / 2, s: c.s });
