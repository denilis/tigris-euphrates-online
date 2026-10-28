// Замер процессорного времени бота за партию (для лимита Vercel Hobby: 4 часа CPU в месяц).
// Три «человека» ходят случайно, бот думает с потолком времени, как на сервере.
//   node tools/bot-cpu.js [игр] [сила] [потолок, мс]
import { createTable, sit, setHero, setBot, start, submit, botDue } from '../game/table.js';
import { botStep } from '../game/bots.js';
import { stateFromJSON } from '../game/serialize.js';
import { legalMoves } from '../game/vendor/engine/engine.js';
import { makeRng } from '../game/vendor/engine/rng.js';

const [games = 3, strength = 70, cap = 3000] = process.argv.slice(2).map(Number);
const users = [{ userId: 'a', name: 'А' }, { userId: 'b', name: 'Б' }, { userId: 'c', name: 'В' }];
const all = [];
for (let g = 0; g < games; g++) {
  const t = createTable({ code: 'CPU' + g, host: users[0], now: 0 });
  sit(t, users[1], 1, 0);
  sit(t, users[2], 2, 0);
  ['lion', 'bull', 'bow'].forEach((h, i) => setHero(t, users[i].userId, i, h, 0));
  setBot(t, 'a', 3, { strength, counting: 'none', errors: 0 }, 0);
  start(t, 'a', { rng: makeRng(g + 1), now: 0 });
  const r = makeRng(g + 100), draw = makeRng(g + 200);
  let botMs = 0, botSteps = 0, worst = 0;
  const t0 = performance.now();
  while (t.status === 'playing') {
    if (botDue(t) !== null) {
      const c0 = process.cpuUsage();
      await botStep(t, { rng: draw, botRng: makeRng(botSteps + 1), now: 0, timeCap: cap });
      const c = process.cpuUsage(c0);
      const ms = (c.user + c.system) / 1000;
      botMs += ms; botSteps++; worst = Math.max(worst, ms);
    } else {
      const s = stateFromJSON(t.game.state);
      const seatId = t.game.order[s.toMove];
      const legal = legalMoves(s);
      submit(t, users[seatId].userId, { version: t.version, index: Math.floor(r() * legal.length) }, { rng: draw, now: 0 });
    }
  }
  all.push(botMs);
  console.log(`партия ${g + 1}: решений бота ${botSteps}, CPU бота ${(botMs / 1000).toFixed(1)} с, худшее решение ${(worst / 1000).toFixed(2)} с, всего ${((performance.now() - t0) / 1000).toFixed(1)} с`);
}
const avg = all.reduce((a, b) => a + b, 0) / all.length / 1000;
console.log(`в среднем CPU бота за партию ${avg.toFixed(1)} с; 4 часа Hobby хватит примерно на ${Math.floor(4 * 3600 / avg)} партий в месяц`);
