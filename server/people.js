// Кто есть кто по имени. Имя игрок может сменить (13.11.2026), а к именам привязаны сезон BGA, герои
// компании, чат Telegram и старые партии без номера игрока. Поэтому игрок помнит прежние имена (was),
// и любое из них ведет к нему. Прежнее имя за ним закреплено: другой игрок взять его не может.

/**
 * Имя в принятом виде: без невидимых и пустых знаков, без надстрочных знаков, с одиночными пробелами.
 * Так «Денис» с невидимым знаком внутри или с пустым знаком на конце не отличается от «Денис».
 */
export const normName = (raw) => String(raw ?? '').normalize('NFKC')
  .replace(/[\p{Cf}\p{M}ᅟᅠㅤﾠ⠀]/gu, '')
  .replace(/[\s\p{Cc}]+/gu, ' ')
  .trim();

/** Ключ имени для сравнения: принятый вид нижним регистром. */
export const nameKey = (name) => normName(name).toLowerCase();

/** Все имена игрока ключами: нынешнее и прежние. */
export const namesOf = (u) => [nameKey(u?.name), ...(u?.was || []).map(nameKey)];

/**
 * Справочник по списку игроков:
 *   idOf(name) — чей это номер по нынешнему или прежнему имени, иначе null;
 *   owner(seat) — чье место: по userId, у старых записей по имени;
 *   label(seat) — нынешнее имя человека на месте, если он известен, иначе имя с места;
 *   nameOfId(id) — нынешнее имя по номеру.
 */
export function whoIs(users) {
  const byId = new Map(users.map((u) => [u.id, u]));
  const index = new Map();
  for (const u of users) index.set(nameKey(u.name), u.id);
  // нынешнее имя сильнее чужого прежнего (такого не бывает, имена закреплены, но порядок явный)
  for (const u of users) for (const k of (u.was || []).map(nameKey)) if (!index.has(k)) index.set(k, u.id);
  const idOf = (name) => index.get(nameKey(name)) || null;
  const owner = (seat) => seat.userId || idOf(seat.name);
  const nameOfId = (id) => byId.get(id)?.name || null;
  const label = (seat) => (seat.kind === 'bot' ? seat.name : nameOfId(owner(seat)) || seat.name);
  return { idOf, owner, label, nameOfId, byId };
}
