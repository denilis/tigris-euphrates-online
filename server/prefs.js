// Настройки экрана партии за игроком. Сервер хранит только известные поля в понятных границах:
// то же, что public/js/layout-core.js, клиентский код на сервер не подключается.
const BLOCKS = ['players', 'stock', 'now', 'log'];
const SIDE_MIN = 250, SIDE_MAX = 520;

export function cleanPrefs(v) {
  const out = { side: 0, left: false, handSide: false, order: BLOCKS, shut: [] };
  if (!v || typeof v !== 'object') return out;
  if (Number.isInteger(v.side) && v.side >= SIDE_MIN && v.side <= SIDE_MAX) out.side = v.side;
  out.left = v.left === true;
  out.handSide = v.handSide === true;
  if (Array.isArray(v.order) && v.order.length === BLOCKS.length && BLOCKS.every((b) => v.order.includes(b))) out.order = v.order;
  if (Array.isArray(v.shut)) out.shut = BLOCKS.filter((b) => v.shut.includes(b));
  return out;
}
