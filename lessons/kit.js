// Сборка уроков: позиция и шаги разыгрываются настоящим столом и движком, на выходе кадры,
// которые клиент рисует обычным экраном партии. Движок в браузер не отдается и базы не нужно.
// Ошибка в уроке (недопустимый ход, неверное утверждение о результате) падает здесь.
import { createTable, setSeatCount, sit, start, submitSeat } from '../game/table.js';
import { viewFor } from '../game/view.js';
import { stateFromJSON, stateToJSON } from '../game/serialize.js';
import { createState, legalMoves, validate } from '../game/vendor/engine/engine.js';
import { BOARDS } from '../game/vendor/engine/boards.js';
import { makeRng } from '../game/vendor/engine/rng.js';

const W = 16;
export const ME = 0, RIVAL = 1;
const COLOR = { r: 0, b: 1, g: 2, k: 3 };
const USERS = [{ userId: 'student', name: 'Ученик' }, { userId: 'rival', name: 'Соперник' }];
const RULES = { englishSupport: true, buildings: false, wonder: false }; // варианты для стола и для движка одни

/** Клетка по подписи на поле: 'G4' это столбец G, строка 4. */
export function at(name) {
  const x = name.charCodeAt(0) - 65, y = Number(name.slice(1)) - 1;
  if (x < 0 || x >= W || !(y >= 0 && y < 11)) throw new Error(`нет клетки ${name}`);
  return y * W + x;
}

const counts = (letters) => {
  const out = [0, 0, 0, 0];
  for (const ch of letters) out[COLOR[ch]]++;
  return out;
};

/** Рука урока: тайлы берутся из мешка и возвращаются в него, счет тайлов партии не меняется. */
function setHand(s, p, letters) {
  const pl = s.players[p], want = counts(letters);
  for (let c = 0; c < 4; c++) {
    s.bag[c] += pl.hand[c] - want[c];
    if (s.bag[c] < 0) throw new Error('в мешке нет таких тайлов');
    pl.hand[c] = want[c];
  }
}

function position(setup) {
  const s = createState({ layout: BOARDS.advanced, numPlayers: 2, cfg: { ...RULES, confirmTurn: false } });
  for (const [ch, cells] of Object.entries(setup.tiles || {})) {
    for (const name of cells) {
      const i = at(name);
      if (s.tile[i] >= 0 || s.leader[i] >= 0) throw new Error(`клетка ${name} занята`);
      s.tile[i] = COLOR[ch];
      s.bag[COLOR[ch]]--;
    }
  }
  [setup.leaders?.me, setup.leaders?.rival].forEach((set, p) => {
    for (const [ch, name] of Object.entries(set || {})) {
      const i = at(name);
      s.leader[i] = p * 4 + COLOR[ch];
      s.players[p].leaders[COLOR[ch]] = i;
    }
  });
  [setup.score?.me, setup.score?.rival].forEach((v, p) => { if (v) s.players[p].score = [...v]; });
  setHand(s, ME, setup.hand.me);
  setHand(s, RIVAL, setup.hand.rival);
  const errs = validate(s);
  if (errs.length) throw new Error('позиция: ' + errs.join('; '));
  return s;
}

function table(id, setup) {
  const t = createTable({ code: `UROK0${id}`, title: `Урок ${id}`, host: USERS[0], now: 0 });
  // уроки пока с прежними тайлами (Денис 04.11: плитки сначала в партиях)
  Object.assign(t.options, { ...RULES, board: 'advanced', openScore: true, confirmSeconds: 0, order: 'custom', tiles: 'classic' });
  setSeatCount(t, USERS[0].userId, 2, 0);
  sit(t, USERS[1], 1, 0);
  t.seats[0].hero = 'lion';
  t.seats[1].hero = 'bull';
  start(t, USERS[0].userId, { rng: makeRng(id), now: 0 });
  const s = position(setup);
  // позиция урока своя, а не из зерна: записи партии нет, добор идет от rng урока, как до 04.11
  Object.assign(t.game, { order: [ME, RIVAL], state: stateToJSON(s), toMove: ME, clock: null, rec: undefined });
  return t;
}

/** Ход из записи урока в ход движка: цвета буквами, клетки подписями, монумент парой цветов. */
function resolve(raw, s) {
  const m = { ...raw };
  if (typeof m.color === 'string') m.color = COLOR[m.color];
  for (const key of ['pos', 'tl', 'center']) if (typeof m[key] === 'string') m[key] = at(m[key]);
  if (m.pair) {
    const [a, b] = [...m.pair].map((ch) => COLOR[ch]).sort();
    m.id = s.monuments.find((x) => [x.c1, x.c2].sort().join() === [a, b].join()).id;
    delete m.pair;
  }
  if (typeof m.counts === 'string') m.counts = counts(m.counts);
  return m;
}

const fits = (want, m) => Object.entries(want).every(([k, v]) => JSON.stringify(m[k]) === JSON.stringify(v));

/** Что подсветить: клетки хода и что взять из руки. */
function highlight(m) {
  const cells = m.tl != null ? [m.tl, m.tl + 1, m.tl + W, m.tl + W + 1] : m.pos != null ? [m.pos] : m.center != null ? [m.center] : [];
  const kind = { tile: 'tile', leader: 'leader', catastrophe: 'cat' }[m.type];
  return { cells, pick: kind ? { kind, color: m.color ?? null } : null };
}

/**
 * Кадры урока. Шаг: без хода, me (ход ученика) или rival (ход соперника). onMove(s, seat, move, k)
 * зовется перед каждым ходом урока: tools/check-lessons.mjs так оценивает ходы ботом.
 */
export function buildLesson({ id, title, goal, minutes, setup, steps }, { onMove = null } = {}) {
  const t = table(id, setup);
  const rng = makeRng(100 + id);
  const out = [];
  for (const [k, step] of steps.entries()) {
    const where = `урок ${id}, шаг ${k + 1}`;
    if (step.hand) {
      const s = stateFromJSON(t.game.state);
      if (step.hand.me) setHand(s, ME, step.hand.me);
      if (step.hand.rival) setHand(s, RIVAL, step.hand.rival);
      t.game.state = stateToJSON(s);
    }
    const s = stateFromJSON(t.game.state);
    const v = viewFor(t, USERS[0].userId);
    const by = step.me ? 'me' : step.rival ? 'rival' : null;
    const seat = by === 'rival' ? RIVAL : ME;
    if (by && s.toMove !== seat) throw new Error(`${where}: решает другой игрок`);
    const row = { by, title: step.title, say: step.say, why: step.why ?? null, alt: step.alt ?? null };
    if (by) {
      const want = resolve(step.me || step.rival, s);
      const move = legalMoves(s).find((m) => fits(want, m));
      if (!move) throw new Error(`${where}: ход недопустим: ${JSON.stringify(want)}`);
      row.move = move;
      Object.assign(row, highlight(move));
      if (by === 'rival') row.pick = null; // клетка соперника видна, а рука ученика в его ходе не нужна
      row.wrong = (step.wrong || []).map((w) => ({ move: resolve(w.move, s), say: w.say }));
      for (const w of row.wrong) {
        if (!legalMoves(s).some((m) => fits(w.move, m))) throw new Error(`${where}: объяснение к недопустимому ходу ${JSON.stringify(w.move)}`);
        if (fits(w.move, move)) throw new Error(`${where}: объяснение накрывает нужный ход`);
      }
    }
    if (by) onMove?.(s, seat, row.move, k);
    row.game = { ...v.game, canUndo: false };
    if (by !== 'me') Object.assign(row.game, { legal: null, preview: null });
    out.push(row);
    if (by) {
      submitSeat(t, seat, row.move, { rng, now: 0 });
      const after = stateFromJSON(t.game.state);
      const errs = validate(after);
      if (errs.length) throw new Error(`${where}: ${errs.join('; ')}`);
      try { step.after?.(after); } catch (e) { throw new Error(`${where}: ${e.message}`); }
    }
    if (step.check) {
      try { step.check(s); } catch (e) { throw new Error(`${where}: ${e.message}`); }
    }
  }
  const { game: _skip, ...base } = viewFor(t, USERS[0].userId);
  return { id, title, goal, minutes, base: { ...base, isHost: false, version: 0 }, steps: out };
}
