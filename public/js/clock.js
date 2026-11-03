// Часы партии на клиенте: таймер решающего и время каждого игрока по данным сервера
// (view.game.clock), без DOM, чтобы проверять тестами.

/** 0:23, -0:07; округляем от нуля: в начале хода ровно 0:30, через полсекунды после конца -0:01. */
export function fmt(ms) {
  const neg = ms < 0;
  const sec = Math.ceil(Math.abs(ms) / 1000);
  return `${neg ? '-' : ''}${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
export const fmtTotal = (ms) => {
  const sec = Math.floor(ms / 1000), h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60;
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec % 60).padStart(2, '0')}`;
};

/**
 * Время сейчас: сколько осталось решающему, сколько у каждого всего и сверх. live = false —
 * партия кончилась или ее завершил организатор: время игроков стоит, таймера хода нет.
 */
export function clockNow(g, at = Date.now()) {
  const c = g.clock;
  if (!c) return null;
  const live = !g.over && !g.stopped && !g.paused && g.toMove != null; // на паузе часы стоят
  const now = at + (c.skew || 0);
  const confirm = g.phase === 'confirm';
  const run = !live || confirm ? 0 : Math.max(0, now - c.at);
  const active = g.toMove === g.cur;
  const before = active ? c.turnUsed : 0;
  const liveOver = Math.max(0, before + run - c.turnMs) - Math.max(0, before - c.turnMs);
  return {
    live,
    left: c.turnMs - before - run,
    confirmLeft: confirm && c.confirmBy ? c.confirmBy - now : null,
    used: (seat) => (c.used[seat] || 0) + (seat === g.toMove ? run : 0),
    over: (seat) => (c.over[seat] || 0) + (seat === g.toMove ? liveOver : 0),
  };
}
