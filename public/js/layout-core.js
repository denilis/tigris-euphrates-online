// Настройки экрана партии: чистые функции без DOM, их проверяют тесты.
// side 0 значит «ширина по умолчанию», left ставит панель слева от карты, handSide переносит
// руку из-под карты в свободное поле сбоку (просьба Дениса 03.11): карта растет в высоту.

export const BLOCKS = ['players', 'stock', 'now', 'log'];
export const SIDE_MIN = 250, SIDE_MAX = 520;

/** Настройки из браузера или с сервера: все, что не подошло, заменяется значением по умолчанию. */
export function cleanLayout(v) {
  const out = { side: 0, left: false, handSide: false, order: [...BLOCKS], shut: [] };
  if (!v || typeof v !== 'object') return out;
  if (Number.isInteger(v.side) && v.side >= SIDE_MIN && v.side <= SIDE_MAX) out.side = v.side;
  out.left = v.left === true;
  out.handSide = v.handSide === true;
  if (Array.isArray(v.order) && v.order.length === BLOCKS.length && BLOCKS.every((b) => v.order.includes(b))) out.order = [...v.order];
  if (Array.isArray(v.shut)) out.shut = BLOCKS.filter((b) => v.shut.includes(b));
  return out;
}

/** Ширина панели в границах; на узком окне карте остается не меньше 500 пикселей. */
export const clampSide = (px, screen = Infinity) => Math.round(Math.max(SIDE_MIN, Math.min(px, SIDE_MAX, screen - 500)));

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
