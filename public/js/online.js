// Кто на сайте: расчеты без DOM, их проверяют тесты.

const SEEN_MS = 20 * 1000; // на виду: новости доходят за это время
const QUIET_MS = 60 * 1000; // в партии и на скрытой вкладке приглашения ждать незачем так часто
const HIDDEN_LIMIT_MS = 30 * 60 * 1000; // забытая вкладка не должна съедать лимит базы

/** Через сколько следующий пульс; null, если вкладка скрыта слишком давно. hiddenMs: null, пока вкладка на виду. */
export function beatDelay({ hiddenMs, busy }) {
  if (hiddenMs != null) return hiddenMs >= HIDDEN_LIMIT_MS ? null : QUIET_MS;
  return busy ? QUIET_MS : SEEN_MS;
}

/** Кто появился по сравнению с прошлым пульсом; первый пульс никого не объявляет. */
export function arrivals(prev, next) {
  if (!prev) return [];
  const had = new Set(prev.map((p) => p.id));
  return next.filter((p) => !had.has(p.id));
}

/** Приглашения, на которые на этом устройстве еще не ответили. */
export const pendingInvites = (inbox, handled) => inbox.filter((m) => m.kind === 'invite' && !handled.has(m.id));

// чат Telegram свой у этой компании, у других игроков будут свои. Список на сервере тот же, их сверяет тест
export const CHAT_PEOPLE = ['денис', 'андрей', 'влад'];
const inChat = (name) => CHAT_PEOPLE.includes(String(name).trim().toLowerCase());

/**
 * Кнопка «Позвать в чат»: зовет свой, за столом только свои и есть кого звать. Свой ли стол, решает
 * сервер (view.chat, 13.11): имя можно сменить, и по именам за столом это уже не узнать. Сверка по
 * именам осталась для вида без этого поля.
 */
export function chatAllowed(view, myName) {
  const people = view.seats.filter((s) => s.kind === 'human');
  const ours = typeof view.chat === 'boolean' ? view.chat : inChat(myName) && people.every((s) => !s.taken || inChat(s.name));
  return ours && people.some((s) => s.id !== view.me);
}

/** Подсказка после приглашения: chat null значит, что этот стол к чату не относится. */
export function chatNote(chat) {
  if (chat === null) return 'Игроки за столом';
  return chat ? 'Игроки за столом, сообщение ушло в чат' : 'Игроки за столом, в чат сообщение не ушло';
}

/**
 * «Назад» из лобби (Денис 06.11): 'back' — на прошлую страницу сайта. Если прошлой страницы нет
 * (стол открыт по ссылке снаружи), это ссылка-приглашение или этот же стол, то в «Мои столы».
 */
export function backFrom(prev, code) {
  if (prev == null || prev.startsWith('#/join/') || prev === `#/t/${code}` || prev.startsWith(`#/t/${code}/`)) return '#/tables';
  return 'back';
}

/**
 * «Назад» и «×» на страницах-карточках (Денис 06.11). На каких страницах: правила, обучение,
 * статистика, профиль, мои столы, новая игра, коды игроков, просмотр партии. У лобби свои
 * кнопки, у партии и урока своя навигация, на стартовом экране кнопок нет.
 */
export const NAV_PAGES = /^(rules|learn|stats|stats\/me|stats\/p\/[a-z0-9-]+|p\/[a-z0-9-]+|me|tables|new|admin|t\/[A-Za-z0-9]+\/replay(\/\d+)?)$/;

/** «Назад» со страницы: 'back' — на прошлую страницу сайта, иначе (открыли по ссылке) на стартовый экран. */
export function pageBack(prev, cur) {
  if (prev == null || prev === cur || prev.startsWith('#/join/')) return '#/';
  return 'back';
}

/** Вопрос перед удалением стола: кроме себя называем всех людей за ним. */
export function deleteQuestion(t, myName) {
  const others = t.seats.filter((s) => s.kind === 'human' && s.name && s.name !== myName).map((s) => s.name);
  return `Удалить стол ${t.title || t.code}?${others.length ? ` За столом: ${others.join(', ')}.` : ''} Вернуть его можно в течение 90 дней из журнала удалений.`;
}

/** Кого можно позвать за стол: себя и сидящих нет, кто на сайте выше. online: null, пока пульса не было. */
export function pickList(people, view, online, me = null) {
  const seated = new Set(view.seats.map((s) => s.name));
  const mark = new Map((online || []).map((p) => [p.id, p.busy]));
  const rank = (p) => (!mark.has(p.id) ? 2 : mark.get(p.id) ? 1 : 0);
  return people
    .filter((p) => p.id !== me && !seated.has(p.name))
    .map((p) => ({ ...p, note: !mark.has(p.id) ? '' : mark.get(p.id) ? 'в партии' : 'на сайте' }))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ru'));
}

/** Номер первого свободного места для человека или null. */
export function freeSeat(view) {
  return view.seats.find((s) => s.kind === 'human' && !s.taken)?.id ?? null;
}
