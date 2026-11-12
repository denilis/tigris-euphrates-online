// Новый бот против сохранённой старой версии, с метриками стиля игры.
//
//   node sim/versus.js --games 20 --players 4 --variants --baseline <папка со старыми bot/ и engine/>
//                      [--new "strength=50,errors=5,style=denis"] [--old "strength=50,errors=5"] [--seed 1]
//                      [--board standard|advanced|both] [--styles <файл стилей другого прогона>]
//
// --board: настоящие поля BGA (both — по очереди); без него синтетическое поле тестов.
//
// Места чередуются: в каждой партии новые и старые сидят через одного, и
// порядок сдвигается от партии к партии, чтобы первый ход не давал перевеса.
// Без --baseline обе стороны играют текущим ботом (проверка самой метрики).

import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { playGame } from './arena.js';
import { makeCollector } from './metrics.js';
import { decide } from '../bot/bot.js';
import { makeView } from '../bot/belief.js';
import { BOARDS } from '../engine/boards.js';
import { testLayout } from '../test/helpers.js';
import { useTrained } from '../bot/styles.js';

function parseSeat(str) {
  const o = {};
  for (const kv of (str || '').split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    o[k] = isNaN(+v) ? v : +v;
  }
  return o;
}

function parseArgs(argv) {
  const a = { games: 10, players: 4, seed: 1, cfg: {}, baseline: null, board: null, neu: { strength: 50, errors: 5 }, old: { strength: 50, errors: 5 } };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--games') a.games = +argv[++i];
    else if (k === '--players') a.players = +argv[++i];
    else if (k === '--seed') a.seed = +argv[++i];
    else if (k === '--variants') a.cfg = { englishSupport: true, buildings: true, wonder: true };
    else if (k === '--baseline') a.baseline = argv[++i];
    else if (k === '--new') a.neu = parseSeat(argv[++i]);
    else if (k === '--old') a.old = parseSeat(argv[++i]);
    else if (k === '--board') a.board = argv[++i];
    else if (k === '--styles') a.styles = argv[++i];
  }
  return a;
}

export async function runVersus(a) {
  // --styles <файл>: стили другого прогона обучения вместо bot/styles_data.js
  if (a.styles) useTrained((await import(pathToFileURL(resolve(a.styles)).href)).TRAINED);
  let oldDecide = decide;
  let oldView = makeView;
  if (a.baseline) {
    const dir = resolve(a.baseline);
    oldDecide = (await import(pathToFileURL(join(dir, 'bot', 'bot.js')).href)).decide;
    oldView = (await import(pathToFileURL(join(dir, 'bot', 'belief.js')).href)).makeView;
  }
  let labels = [];
  const col = makeCollector((p) => labels[p]);
  const t0 = Date.now();
  for (let g = 0; g < a.games; g++) {
    labels = Array.from({ length: a.players }, (_, i) => ((i + g) % 2 === 0 ? 'new' : 'old'));
    const seats = labels.map((l) => (l === 'new'
      ? { ...a.neu, decide, makeView }
      : { ...a.old, decide: oldDecide, makeView: oldView }));
    const board = a.board === 'both' ? (g % 2 ? 'advanced' : 'standard') : a.board;
    const layout = board ? BOARDS[board] : testLayout();
    const r = playGame({ seats, seed: a.seed + g, cfg: a.cfg, layout, onDecision: col.onDecision, onEvent: col.onEvent });
    col.endGame(r.ranking, r.vectors);
    if (a.log) a.log(`игра ${g + 1}/${a.games}: победил ${labels[r.ranking[0]]} (место ${r.ranking[0] + 1}), мин. ${r.vectors.map((v) => v[0]).join('/')}`);
  }
  return { rows: col.table(), seconds: Math.round((Date.now() - t0) / 1000) };
}

if (process.argv[1] && process.argv[1].endsWith('versus.js')) {
  const a = parseArgs(process.argv);
  a.log = (line) => console.log(line);
  const { rows, seconds } = await runVersus(a);
  console.log('');
  console.table(rows);
  console.log(`время: ${seconds} с`);
}
