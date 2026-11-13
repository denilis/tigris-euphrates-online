// Список «Коды игроков» (просьба Дениса 05.11): поиск по имени, сортировка по дате добавления,
// имени, числу партий и последней партии, отозванные скрыты, пока их не попросят, у администратора
// отбор по пригласившему. Своя строка всегда первая. Без DOM: проверяет test/admin-list.test.js.

export const USER_SORTS = [['created', 'По дате добавления'], ['name', 'По имени'], ['games', 'По числу партий'], ['last', 'По последней партии']];

const DIR = { created: -1, name: 1, games: -1, last: -1 };
/** С какого направления начинается сортировка: имена по алфавиту, остальное от больших к меньшим. */
export const defaultDir = (key) => DIR[key] ?? -1;

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/ё/g, 'е');
const VALUE = {
  created: (u) => u.createdAt ?? 0,
  name: (u) => norm(u.name),
  games: (u) => u.games || 0,
  last: (u) => u.lastGameAt ?? 0,
};

/** Кого показать и в каком порядке. by: имя пригласившего или пусто (все). */
export function pickUsers(users, { q = '', sort = 'created', dir = defaultDir(sort), revoked = false, by = '' } = {}) {
  const want = norm(q);
  const val = VALUE[sort] || VALUE.created;
  return users
    .filter((u) => (revoked || !u.revoked || u.self) && (!want || norm(u.name).includes(want)) && (!by || u.invitedBy === by))
    .sort((a, b) => {
      if (Boolean(a.self) !== Boolean(b.self)) return a.self ? -1 : 1;
      const x = val(a), y = val(b);
      const c = typeof x === 'string' ? x.localeCompare(y, 'ru') : x - y;
      return c * dir || norm(a.name).localeCompare(norm(b.name), 'ru');
    });
}

/**
 * Что можно сделать со строкой игрока (13.11). viewer: кто смотрит, { admin, main }. Правила те же,
 * что на сервере (adminUsers в server/routes.js): себя и главного не трогают, администратора меняет
 * только главный. code: «Новый код» (и игрок своему приглашенному); revoke, photo: только
 * администратор и только у действующего кода; open: новичку открыть доступ; profile: имя ведет
 * в профиль игрока (чужой профиль видит администратор, свой видит каждый).
 */
export function userActions(u, { admin = false, main = false } = {}) {
  const may = !u.self && !u.main && (main || !u.admin);
  const live = may && admin && !u.revoked;
  return { code: may, revoke: live, open: live && Boolean(u.path), photo: live, profile: admin || Boolean(u.self) };
}

/** Пригласившие для отбора у администратора, по алфавиту. */
export const inviters = (users) => [...new Set(users.map((u) => u.invitedBy).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));

const two = (n) => String(n).padStart(2, '0');
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Дата коротко: сегодня, вчера, 03.11 в этом году, 28.12.2025 раньше; пусто как «-». */
export function dayText(ms, now = Date.now()) {
  if (ms == null) return '-';
  const d = new Date(ms), n = new Date(now);
  const days = Math.round((dayStart(n) - dayStart(d)) / 86400000);
  if (days === 0) return 'сегодня';
  if (days === 1) return 'вчера';
  const dm = `${two(d.getDate())}.${two(d.getMonth() + 1)}`;
  return d.getFullYear() === n.getFullYear() ? dm : `${dm}.${d.getFullYear()}`;
}

/** Полная дата для колонки «Добавлен». */
export const dateText = (ms) => (ms == null ? '-' : (() => { const d = new Date(ms); return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()}`; })());
