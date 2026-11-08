// Ход бота за столом. Один шаг: вид бота (только то, что видел бы человек на его месте),
// решение по кускам (не блокирует другие запросы в том же процессе Vercel), проверка хода
// как у человека, при сбое безопасный ход. Цикл «пока решает бот» и запись в базу —
// в серверном слое.
import { makeView, publicRemoved } from './vendor/bot/belief.js';
import { decideAsync } from './vendor/bot/bot.js';
import { stateFromJSON } from './serialize.js';
import { cryptoRng } from './random.js';
import { botDue, submitSeat, stopRunaway } from './table.js';
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
 * decide подменяется в тестах. Стол из одних ботов со слишком длинной партией вместо хода
 * закрывается (stopRunaway), ответ тогда { seatId, stopped: 'long' }.
 */
export async function botStep(t, { rng = cryptoRng(), botRng = Math.random, now = Date.now(), timeCap = DEFAULT_TIME_CAP, decide = decideAsync, pace = null, clock = null } = {}) {
  const seatId = botDue(t);
  if (seatId === null) return null;
  if (stopRunaway(t, now)) {
    console.warn(`[bots] стол ${t.code} без людей остановлен: партия длиннее предела ходов`);
    return { seatId, stopped: 'long' };
  }
  if (pace) {
    // Бот «думает» (просьба Дениса 06.11: за ходом бота можно проследить): ход решается сразу,
    // а показывается через pace.min..pace.max мс от момента, когда очередь дошла до бота
    // (t.updatedAt). Сколько ждать, задает api/index.js (08.11: 1,5-1,8 с, чтобы досмотреть ход).
    const key = `${t.game.log.length}:${seatId}`;
    const plan = t.game.botPlan;
    if (plan?.key === key) {
      if (now < plan.at) return { seatId, waiting: true, at: plan.at };
      delete t.game.botPlan;
      try {
        submitSeat(t, seatId, plan.move, { rng, now });
        return { seatId, move: plan.move, text: plan.text, ms: plan.ms, fallback: false };
      } catch {
        // позиция все же изменилась: решаем заново ниже, без новой паузы
      }
    } else {
      const res = await think(t, seatId, { botRng, timeCap, decide });
      const at = (Number.isFinite(t.updatedAt) ? t.updatedAt : now) + pace.min + Math.floor(botRng() * (pace.max - pace.min + 1));
      // бот мог думать дольше паузы: сверяемся с часами после раздумий, а не до них
      const after = clock ? clock() : now;
      t.game.botPlan = { key, move: res.move, text: res.text, ms: res.ms, at };
      if (after < at) return { seatId, waiting: true, planned: true, at };
      delete t.game.botPlan;
      try {
        submitSeat(t, seatId, res.move, { rng, now: after });
        return { seatId, move: res.move, text: res.text, ms: res.ms, fallback: res.fallback };
      } catch {
        // ход не прошел проверку: ниже обычный путь с безопасным ходом
      }
    }
  }
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

/** Решение бота без хода (для паузы «бот думает»): допустимый ход или безопасный, если решение не годится. */
async function think(t, seatId, { botRng, timeCap, decide }) {
  const seat = t.seats.find((x) => x.id === seatId);
  const settings = { ...seat.bot };
  settings.timeMs = Math.min(timeCap, 400 + 7000 * ((settings.strength ?? 50) / 100));
  try {
    const res = await decide(botView(t, seatId, settings.counting || 'none', botRng), settings, botRng, (f) => setImmediate(f));
    return { move: res.move, text: res.text, ms: res.ms, fallback: false }; // допустимость проверит submitSeat
  } catch {
    return { move: safeMove(stateFromJSON(t.game.state)), text: 'безопасный ход', ms: 0, fallback: true };
  }
}
