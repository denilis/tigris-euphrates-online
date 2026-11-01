// Найти позицию, где решение фазы phase принимает человек, и положить стол в локальный
// сервер (dev/server.js, путь /__dev/table). Для ручной проверки редких решений: монумент,
// очко за чудо, выбор войны.
//   node tools/dev-position.js <phase> <userId Дениса> <userId Андрея> <userId Влада> [порт] [префикс кода]
// Стол с таким кодом уже есть — сервер его не заменит: возьмите другой префикс.
import { createTable, sit, start, submit, submitSeat, botDue } from '../game/table.js';
import { stateFromJSON } from '../game/serialize.js';
import { legalMoves } from '../game/vendor/engine/engine.js';
import { makeRng } from '../game/vendor/engine/rng.js';

const [phase = 'monument', u0, u1, u2, port = 3017, prefix = 'DEV'] = process.argv.slice(2);
const users = [{ userId: u0, name: 'Денис' }, { userId: u1, name: 'Андрей' }, { userId: u2, name: 'Влад' }];

for (let seed = 1; seed <= 2000; seed++) {
  const code = prefix + String(seed).padStart(3, '0').slice(-3);
  const t = createTable({ code, host: users[0], now: Date.now() });
  sit(t, users[1], 1, 0);
  sit(t, users[2], 2, 0); // герои свои: стол ставит их сам
  start(t, users[0].userId, { rng: makeRng(seed), now: Date.now() });
  const r = makeRng(seed + 7), draw = makeRng(seed + 9);
  for (let k = 0; k < 3000 && t.status === 'playing'; k++) {
    const s = stateFromJSON(t.game.state);
    const seat = t.seats.find((x) => x.id === t.game.order[s.toMove]);
    if (s.phase === phase && seat.kind === 'human') {
      const res = await fetch(`http://localhost:${port}/__dev/table`, { method: 'POST', body: JSON.stringify(t) });
      console.log(`партия ${seed}, ход ${s.turn}: решает ${seat.name}; стол ${code}: ${res.status}`);
      process.exit(0);
    }
    // тайлы кладём кучнее: чаще рядом с тайлом того же цвета, чтобы складывались квадраты
    const legal = legalMoves(s);
    const same = legal.filter((m) => m.type === 'tile' && [m.pos - 1, m.pos + 1, m.pos - 16, m.pos + 16].some((j) => j >= 0 && j < 176 && s.tile[j] === m.color));
    const pool = same.length && r() < 0.8 ? same : legal.filter((m) => !['discard', 'pass', 'catastrophe', 'withdraw'].includes(m.type));
    const m = (pool.length ? pool : legal)[Math.floor(r() * (pool.length || legal.length))];
    if (botDue(t) !== null) submitSeat(t, seat.id, m, { rng: draw, now: Date.now() });
    else submit(t, seat.userId, { version: t.version, index: legal.indexOf(m) }, { rng: draw, now: Date.now() });
  }
}
console.log('не нашлось');
