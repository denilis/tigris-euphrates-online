// Настройки экрана партии: чистые функции без DOM, их проверяют тесты.
// side 0 значит «ширина по умолчанию», left ставит панель слева от карты, handSide переносит
// руку из-под карты в свободное поле сбоку (просьба Дениса 03.11): карта растет в высоту.
// scale и hide (Денис 12.11, кнопка «Настроить» в строке «Игроки»): размер текста панели в процентах
// и что не показывать в карточках игроков, чтобы панель занимала меньше места.

export const BLOCKS = ['players', 'stock', 'now', 'log'];
// SIDE_MIN 180 (12.11, было 250): уже содержимого панель все равно не станет, см. need в clampSide
export const SIDE_MIN = 180, SIDE_MAX = 520;
export const PANEL_SCALES = [100, 90, 80];
export const PANEL_HIDE = ['avatars', 'leaders', 'time'];

/** Настройки из браузера или с сервера: все, что не подошло, заменяется значением по умолчанию. */
export function cleanLayout(v) {
  const out = { side: 0, left: false, handSide: false, order: [...BLOCKS], shut: [], scale: 100, hide: [] };
  if (!v || typeof v !== 'object') return out;
  if (Number.isInteger(v.side) && v.side >= SIDE_MIN && v.side <= SIDE_MAX) out.side = v.side;
  out.left = v.left === true;
  out.handSide = v.handSide === true;
  if (Array.isArray(v.order) && v.order.length === BLOCKS.length && BLOCKS.every((b) => v.order.includes(b))) out.order = [...v.order];
  if (Array.isArray(v.shut)) out.shut = BLOCKS.filter((b) => v.shut.includes(b));
  if (PANEL_SCALES.includes(v.scale)) out.scale = v.scale;
  if (Array.isArray(v.hide)) out.hide = PANEL_HIDE.filter((h) => v.hide.includes(h));
  return out;
}

/**
 * Ширина панели в границах; на узком окне карте остается не меньше 500 пикселей. need: сколько
 * нужно содержимому панели (Денис 12.11: «не должна быть уже, чем вмещаются все элементы»), ниже
 * этого панель не сужается, даже если карте станет меньше 500.
 */
export const clampSide = (px, screen = Infinity, need = 0) =>
  Math.round(Math.max(SIDE_MIN, need, Math.min(px, SIDE_MAX, screen - 500)));

/** Порядок блоков, если блок id встал на место index среди остальных. */
export function moveBlock(order, id, index) {
  const rest = order.filter((b) => b !== id);
  rest.splice(index, 0, id);
  return rest;
}

/** Место блока по указателю: сколько середин других блоков осталось выше него. */
export const dropIndex = (mids, y) => mids.filter((m) => m < y).length;

/** Свернуть или развернуть блок. */
export const toggled = (shut, id) => (shut.includes(id) ? shut.filter((b) => b !== id) : [...shut, id]);

/** Подпись кнопки организатора: с ботами это сдача, с людьми завершение партии для всех. */
export const stopLabel = (seats, me) => (seats.some((s) => s.kind === 'human' && s.id !== me) ? 'Завершить партию' : 'Сдаться');
