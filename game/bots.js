// Ход бота за столом. Один шаг: вид бота (только то, что видел бы человек на его месте),
// решение по кускам (не блокирует другие запросы в том же процессе Vercel), проверка хода
// как у человека, при сбое безопасный ход. Цикл «пока решает бот» и запись в базу —
// в серверном слое.
import { makeView, publicRemoved } from './vendor/bot/belief.js';
import { decideAsync } from './vendor/bot/bot.js';
import { stateFromJSON } from './serialize.js';
import { cryptoRng } from './random.js';
import { botDue, submitSeat } from './table.js';
import { safeMove } from './safeMove.js';

// Потолок раздумий на действие: на Hobby 4 часа CPU в месяц. Бот на силе 100 по замерам
// думает около 2 с над первым действием в начале партии, так что 3 с почти не режут силу.
export const DEFAULT_TIME_CAP = 3000;

/**
 * Позиция глазами бота. makeView прячет чужие руки, сбросы и мешок, но оставляет сырой
 * removed с чужими сбросами; бот его не читает, а мы всё равно оставляем только известное
 * боту: публично ушедшее плюс свои сбросы.
 */
export function botView(t, seatId, counting, rng) {
  const s = stateFromJSON(t.game.state);
  const p = t.game.order.indexOf(seatId);
  const view = makeView(s, p, counting, rng);
  const own = s.players[p].discarded;
  view.state.removed = publicRemoved(s).map((v, c) => v + own[c]);
  // окно подтверждения хода только для людей: бот считает ходы вперед без него
  view.state.cfg = { ...view.state.cfg, confirmTurn: false };
  return view;
}

/**
 * Сделать один ход бота, если сейчас решает бот; иначе null.
 * rng — добор тайлов (на сервере криптостойкий), botRng — случайность самого бота.
 * decide подменяется в тестах.
 */
export async function botStep(t, { rng = cryptoRng(), botRng = Math.random, now = Date.now(), timeCap = DEFAULT_TIME_CAP, decide = decideAsync } = {}) {
  const seatId = botDue(t);
  if (seatId === null) return null;
  const seat = t.seats.find((x) => x.id === seatId);
  const settings = { ...seat.bot };
  const st = (settings.strength ?? 50) / 100;
  settings.timeMs = Math.min(timeCap, 400 + 7000 * st);

  let res = null, error = null;
  try {
    res = await decide(botView(t, seatId, settings.counting || 'none', botRng), settings, botRng, (f) => setImmediate(f));
    submitSeat(t, seatId, res.move, { rng, now });
    return { seatId, move: res.move, text: res.text, ms: res.ms, fallback: false };
  } catch (e) {
    error = String(e && e.message || e);
  }
  // решение не годится: безопасный ход за бота, партия не встаёт
  const move = safeMove(stateFromJSON(t.game.state));
  submitSeat(t, seatId, move, { rng, now });
  return { seatId, move, text: 'безопасный ход', ms: res?.ms ?? 0, fallback: true, error };
}
