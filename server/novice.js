// Путь новичка (Денис 13.11, схема одобрена). Кто зарегистрировался сам по ссылке или QR-коду,
// отвечает на вопрос «играли раньше?». Опытному все открыто сразу. Новичку предлагается обучение и
// три партии с ботами: с одним, с двумя, с тремя, от слабого к сильному. Пока путь не пройден,
// нельзя приглашать новых игроков и участвовать в турнирах; играть с людьми вне турниров можно.
//
// Состояние в записи игрока, поле path:
//   { state: 'ask' }                        зарегистрировался, на опрос еще не ответил
//   { state: 'novice', steps: 0..2, learn } новичок, сыграно steps партий пути; learn: 'skip', если обучение пропущено
//   { state: 'done', how, at }              открыто: how 'played' (ответил, что играл), 'steps' (прошел путь), 'admin'
// Без поля path игрок опытный: так у всех, кто был до 13.11, и у тех, кому код выдали вручную.

/** Шаги пути. Настройки ботов взяты со ступеней лестницы (public/js/bot-ladder.js), тест их сверяет. */
export const STEPS = [
  { bots: 1, level: 'learn', title: 'Учу правила', set: { strength: 10, errors: 25, counting: 'none' } },
  { bots: 2, level: 'casual', title: 'Играю иногда', set: { strength: 50, errors: 5, counting: 'none' } },
  { bots: 3, level: 'sure', title: 'Уверенный игрок', set: { strength: 80, errors: 2, counting: 'approx' } },
];

/**
 * Путь не пройден: действуют ограничения новичка. Администратора они не касаются: права ему дал
 * главный администратор, и наполовину закрытый администратор никому не нужен (ревью 13.11).
 */
export const locked = (u) => Boolean(u?.path) && u.path.state !== 'done' && !u.admin;

const stepsOf = (path) => (Number.isInteger(path?.steps) ? Math.min(Math.max(path.steps, 0), STEPS.length - 1) : 0);

/** Что о пути видно в записи игрока снаружи: null у опытного. */
export function publicPath(u) {
  if (!locked(u)) return null;
  return u.path.state === 'novice' ? { state: 'novice', steps: stepsOf(u.path) } : { state: 'ask' };
}

/** Путь после ответа на опрос. */
export const surveyPath = (played, now) => (played ? { state: 'done', how: 'played', at: now } : { state: 'novice', steps: 0 });

/**
 * Путь после сыгранной партии шага n (с единицы) или null, если она не в счет: засчитывается только
 * очередной шаг, поэтому повторный зачет той же партии ничего не меняет.
 */
export function stepPath(path, n, now) {
  if (path?.state !== 'novice' || stepsOf(path) !== n - 1) return null;
  return n >= STEPS.length ? { state: 'done', how: 'steps', at: now } : { ...path, steps: n };
}

/** Путь для страницы: шаги с отметками и код идущей партии очередного шага (table). */
export function pathView(u, table = null) {
  if (!u?.path) return { state: null };
  if (!locked(u)) return { state: 'done' };
  if (u.path.state !== 'novice') return { state: 'ask' };
  const steps = stepsOf(u.path);
  return {
    state: 'novice', steps, learn: u.path.learn === 'skip' ? 'skip' : null, table,
    list: STEPS.map((s, i) => ({ n: i + 1, bots: s.bots, level: s.title, status: i < steps ? 'done' : i === steps ? 'now' : 'locked' })),
  };
}
