// Фильтры «Моих столов» (просьба Дениса 06.11, схема одобрена): период по дате последнего хода,
// турнирные или обычные партии, сколько игроков за столом, с кем, порядок. Без DOM, проверяют тесты.

export const DEFAULT_FILTER = { period: 'all', from: '', to: '', kind: 'all', n: 'all', who: '', order: 'new' };
const CHOICES = {
  period: ['all', 'today', 'week', 'month', 'custom'],
  kind: ['all', 'tour', 'casual'],
  n: ['all', '2', '3', '4'],
  order: ['new', 'old'],
};
const DAY = 86400000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Выбор из браузера: что не подошло, по умолчанию. */
export function cleanFilter(raw) {
  const f = { ...DEFAULT_FILTER };
  if (!raw || typeof raw !== 'object') return f;
  for (const [k, list] of Object.entries(CHOICES)) if (list.includes(raw[k])) f[k] = raw[k];
  for (const k of ['from', 'to']) if (DATE.test(raw[k] || '')) f[k] = raw[k];
  if (typeof raw.who === 'string') f.who = raw.who.slice(0, 40);
  return f;
}

/** Границы периода [с, до) в мс; неделя и месяц считаются с начала дня 7 и 30 дней назад. */
export function periodRange(f, now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const today = d.getTime();
  if (f.period === 'today') return [today, Infinity];
  if (f.period === 'week') return [today - 6 * DAY, Infinity];
  if (f.period === 'month') return [today - 29 * DAY, Infinity];
  if (f.period === 'custom') {
    const from = f.from ? new Date(`${f.from}T00:00:00`).getTime() : -Infinity;
    const to = f.to ? new Date(`${f.to}T00:00:00`).getTime() + DAY : Infinity;
    return [from, to];
  }
  return [-Infinity, Infinity];
}

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();

/** Столы по фильтру, по дате последнего хода: сначала новые или старые. */
export function filterTables(list, f, now = Date.now()) {
  const [a, b] = periodRange(f, now);
  const q = norm(f.who);
  const out = list.filter((t) => {
    const at = t.updatedAt ?? 0;
    if (at < a || at >= b) return false;
    if (f.kind === 'tour' && !t.tour) return false;
    if (f.kind === 'casual' && t.tour) return false;
    if (f.n !== 'all' && t.seats.length !== Number(f.n)) return false;
    if (q && !t.seats.some((s) => norm(s.name).includes(q))) return false;
    return true;
  });
  const dir = f.order === 'old' ? 1 : -1;
  return out.sort((x, y) => dir * ((x.updatedAt ?? 0) - (y.updatedAt ?? 0)));
}

/** Имена для подсказки «С кем»: люди из моих партий, кроме меня, по алфавиту. */
export function whoNames(list, myName) {
  const names = new Set();
  for (const t of list) for (const s of t.seats) if (s.kind === 'human' && s.name && s.name !== myName) names.add(s.name);
  return [...names].sort((a, b) => a.localeCompare(b, 'ru'));
}

export const PEOPLE_WORD = { 2: 'вдвоем', 3: 'втроем', 4: 'вчетвером' };
