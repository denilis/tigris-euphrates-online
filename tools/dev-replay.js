// Доиграть партию до конца и положить стол в локальный сервер (dev/server.js, путь /__dev/table):
// проверить просмотр партии и его аналитику руками. Тайлы кладутся кучнее, чтобы строились монументы.
//   node tools/dev-replay.js [порт] [код] [зерно]
import { createTable, sit, start, submit, submitSeat, botDue } from '../game/table.js';
import { stateFromJSON } from '../game/serialize.js';
import { legalMoves } from '../game/vendor/engine/engine.js';
import { makeRng } from '../game/vendor/engine/rng.js';

const [port = 3017, code = 'RPL001', seedArg = 1] = process.argv.slice(2);
const seed = +seedArg;
const users = [{ userId: 'dev-denis', name: 'Денис' }, { userId: 'dev-andrey', name: 'Андрей' }, { userId: 'dev-vlad', name: 'Влад' }];
const t = createTable({ code, host: users[0], now: Date.now() });
sit(t, users[1], 1, 0);
sit(t, users[2], 2, 0);
start(t, users[0].userId, { rng: makeRng(seed), now: Date.now() });
const r = makeRng(seed + 7), draw = makeRng(seed + 9);
for (let k = 0; k < 6000 && t.status === 'playing'; k++) {
  const s = stateFromJSON(t.game.state);
  const seat = t.seats.find((x) => x.id === t.game.order[s.toMove]);
  const legal = legalMoves(s);
  // монумент строим всегда, тайлы чаще рядом с тем же цветом
  const mon = legal.filter((m) => m.type === 'monument');
  const same = legal.filter((m) => m.type === 'tile' && [m.pos - 1, m.pos + 1, m.pos - 16, m.pos + 16].some((j) => j >= 0 && j < 176 && s.tile[j] === m.color));
  const pool = mon.length ? mon : same.length && r() < 0.8 ? same : legal.filter((m) => !['discard', 'pass', 'catastrophe', 'withdraw'].includes(m.type));
  const m = (pool.length ? pool : legal)[Math.floor(r() * (pool.length || legal.length))];
  if (botDue(t) !== null) submitSeat(t, seat.id, m, { rng: draw, now: Date.now() });
  else submit(t, seat.userId, { version: t.version, index: legal.indexOf(m) }, { rng: draw, now: Date.now() });
}
const res = await fetch(`http://localhost:${port}/__dev/table`, { method: 'POST', body: JSON.stringify(t) });
console.log(`стол ${code}: ${t.status}, действий ${t.game.rec?.moves.length}; сервер ${res.status}`);
