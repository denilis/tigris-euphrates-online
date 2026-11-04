// Позиции для макета реки: середина партии на обычном и продвинутом поле, вид игрока как у клиента.
//   node specs/2026-11-04-река/make-position.mjs
import { writeFileSync } from 'node:fs';
import { createTable, sit, setOptions, start, submit, submitSeat, botDue } from '../../game/table.js';
import { viewFor } from '../../game/view.js';
import { stateFromJSON } from '../../game/serialize.js';
import { legalMoves } from '../../game/vendor/engine/engine.js';
import { makeRng } from '../../game/vendor/engine/rng.js';

const users = [{ userId: 'd', name: 'Денис' }, { userId: 'a', name: 'Андрей' }, { userId: 'v', name: 'Влад' }];

function position(board, seed, turns) {
  const t = createTable({ code: 'RIVER' + seed, host: users[0], now: 0 });
  sit(t, users[1], 1, 0);
  sit(t, users[2], 2, 0);
  setOptions(t, 'd', { board }, 0);
  start(t, 'd', { rng: makeRng(seed), now: 0 });
  const r = makeRng(seed + 7), draw = makeRng(seed + 9);
  for (let k = 0; k < 3000 && t.status === 'playing'; k++) {
    const s = stateFromJSON(t.game.state);
    if (s.phase === 'action' && s.turn >= turns) break;
    const seat = t.seats.find((x) => x.id === t.game.order[s.toMove]);
    // тайлы кучнее, как в tools/dev-position.js: так на поле складываются царства и монументы
    const legal = legalMoves(s);
    const same = legal.filter((m) => m.type === 'tile' && [m.pos - 1, m.pos + 1, m.pos - 16, m.pos + 16].some((j) => j >= 0 && j < 176 && s.tile[j] === m.color));
    const pool = same.length && r() < 0.8 ? same : legal.filter((m) => !['discard', 'pass', 'catastrophe', 'withdraw'].includes(m.type));
    const m = (pool.length ? pool : legal)[Math.floor(r() * (pool.length || legal.length))];
    if (botDue(t) !== null) submitSeat(t, seat.id, m, { rng: draw, now: 0 });
    else submit(t, seat.userId, { version: t.version, index: legal.indexOf(m) }, { rng: draw, now: 0 });
  }
  const v = viewFor(t, 'd', { now: 0 });
  return { seats: v.seats.map((s) => ({ id: s.id, hero: s.hero })), game: v.game };
}

const out = { advanced: position('advanced', 11, 26), standard: position('standard', 5, 26) };
writeFileSync(new URL('./position.json', import.meta.url), JSON.stringify(out));
for (const [k, p] of Object.entries(out)) console.log(k, 'ход', p.game.turn, 'тайлов', p.game.board.tile.filter((x) => x >= 0).length);
