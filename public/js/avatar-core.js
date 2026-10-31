// Фото игрока: расчеты без DOM.

/** Квадрат по центру кадра: откуда и какого размера вырезать из картинки w на h. */
export function squareCrop(w, h) {
  const s = Math.min(w, h);
  return { sx: (w - s) / 2, sy: (h - s) / 2, s };
}
