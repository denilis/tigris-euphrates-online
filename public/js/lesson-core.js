// Логика урока без DOM: кадр шага, проверка хода ученика, надписи, память о пройденных уроках.

export const LAST_LESSON = 8;
const DONE_KEY = 'tigris.lessons';

/** Вид стола на шаге k: общая часть урока и кадр шага. */
export const stepView = (lesson, k) => ({ ...lesson.base, version: k, game: lesson.steps[k].game });

const fits = (want, move) => Object.entries(want).every(([k, v]) => JSON.stringify(move[k]) === JSON.stringify(v));

/** Ход ученика: null, если это нужный ход, иначе что ему сказать. */
export function judgeMove(step, move) {
  if (step.by !== 'me') return 'Сейчас ход не нужен, нажмите «Дальше».';
  if (fits(step.move, move)) return null;
  const known = step.wrong.find((w) => fits(w.move, move));
  return known ? known.say : `По правилам так можно, но у этого шага другая цель. ${step.say}`;
}

export function nextLabel(lesson, k, mode) {
  if (k === lesson.steps.length - 1) return lesson.id < LAST_LESSON ? 'Следующий урок' : 'К списку уроков';
  return mode === 'play' && lesson.steps[k].by === 'me' ? 'Сделать за меня' : 'Дальше';
}

export function handHint(step, mode) {
  if (step.by !== 'me') return 'Нажмите «Дальше» на панели урока.';
  if (mode !== 'play') return 'Режим просмотра: ход сделает урок, нажмите «Дальше».';
  return step.cells.length || step.pick ? 'Ваш ход: нужное подсвечено.' : 'Ваш ход: что сделать, написано на панели урока.';
}

/** Номера пройденных уроков. box() отдает хранилище: сам доступ к нему может бросить ошибку. */
export function loadDone(box) {
  try {
    const list = JSON.parse(box().getItem(DONE_KEY));
    return new Set(Array.isArray(list) ? list : []);
  } catch { return new Set(); }
}

export function saveDone(box, id) {
  const done = loadDone(box).add(id);
  try { box().setItem(DONE_KEY, JSON.stringify([...done])); } catch { /* приватный режим: живем без памяти */ }
}
