// Личная статистика (схема одобрена Денисом 04.11): расчеты над партиями игрока, которые отдает
// сервер (stats/player). Чистые функции без DOM, их проверяют тесты.
import { dashboard } from './season.js';

/** Вкладки страницы статистики: «Турниры» (#/stats) и «Личная» (#/stats/me). */
export const statsTabs = (on) => `<nav class="stabs"><a href="#/stats" class="${on === 'tour' ? 'on' : ''}">Турниры</a><a href="#/stats/me" class="${on === 'me' ? 'on' : ''}">Личная</a></nav>`;

/** Какие партии смотреть: все, с людьми на сайте, с ботами, BGA. */
export const KINDS = [['all', 'Все'], ['people', 'С людьми'], ['bots', 'С ботами'], ['bga', 'BGA']];

/** Партии периода (даты 2026-10-30 включительно, пустая граница не ограничивает) и вида. */
export const pick = (games, { from = '', to = '', kind = 'all' } = {}) =>
  games.filter((g) => (!from || g.date >= from) && (!to || g.date <= to) && (kind === 'all' || g.kind === kind));

const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

/** Полоса цифр: партий, побед (первое место без дележа), доля побед, среднее место, средний счет. */
export function summary(games) {
  const wins = games.filter((g) => g.win).length;
  return {
    n: games.length, wins, pct: games.length ? Math.round((100 * wins) / games.length) : null,
    place: avg(games.map((g) => g.place)), score: avg(games.map((g) => g.score)),
  };
}

/** «Где играл»: строка на вид партии или турнир, в порядке первой партии. */
export function byGroup(games) {
  const m = new Map();
  for (const g of games) {
    if (!m.has(g.group)) m.set(g.group, []);
    m.get(g.group).push(g);
  }
  return [...m].map(([group, list]) => ({ group, ...summary(list) }));
}

/** Самая длинная серия побед подряд. */
export function winStreak(games) {
  let best = 0, cur = 0;
  for (const g of games) {
    cur = g.win ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

/**
 * Подробности как у турнира из одного игрока: тот же расчет и те же графики, что на вкладке
 * «Турниры». Серия побед своя: деленное первое место ее рвет.
 */
export function details(games) {
  const list = games.map((g) => ({ ...g, score: [g.score], place: [g.place], pts: [0], details: [g.d] }));
  const d = dashboard(list, 1);
  const streak = winStreak(games);
  d.records.streak = streak ? { v: streak, i: 0 } : null;
  return d;
}

/** Откуда очки вместе с сокровищами: [{ key, label, sum, perGame, pct }] по партиям с подробностями. */
export const POINT_SOURCES = [['tile', 'тайлы'], ['building', 'здания'], ['monument', 'монументы'], ['war', 'войны'], ['revolt', 'восстания'], ['tr', 'сокровища']];
export function pointSources(games) {
  const withD = games.filter((g) => g.d);
  const sum = Object.fromEntries(POINT_SOURCES.map(([k]) => [k, 0]));
  for (const g of withD) for (const [k] of POINT_SOURCES) sum[k] += (k === 'tr' ? g.d.tr : g.d.src?.[k]) || 0;
  const total = Object.values(sum).reduce((a, b) => a + b, 0);
  return POINT_SOURCES.map(([key, label]) => ({
    key, label, sum: sum[key], perGame: withD.length ? sum[key] / withD.length : 0, pct: total ? Math.round((100 * sum[key]) / total) : 0,
  }));
}

/** Сколько раз каждый цвет был слабейшим (он и решает итог); при равенстве считаются все равные. */
export function weakest(games) {
  const n = [0, 0, 0, 0];
  let games4 = 0;
  for (const g of games) {
    const c = g.d?.c;
    if (!Array.isArray(c) || c.length !== 4) continue;
    games4++;
    const min = Math.min(...c);
    c.forEach((v, i) => { if (v === min) n[i]++; });
  }
  return { n, games: games4 };
}

/** Динамика по месяцам: [{ month: '2026-10', n, score, pct }]. */
export function monthly(games) {
  const m = new Map();
  for (const g of games) {
    const k = g.date.slice(0, 7);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(g);
  }
  return [...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, list]) => {
    const s = summary(list);
    return { month, n: s.n, score: s.score, pct: s.pct };
  });
}

/** Рекорды, которых нет у турнира: больше всего очков за войны и больше всего монументов в партии. */
export function extraRecords(games) {
  let war = null, mon = null;
  for (const g of games) {
    const w = g.d?.src?.war || 0, m = g.d?.mon || 0;
    if (w && (!war || w > war.v)) war = { v: w, g };
    if (m && (!mon || m > mon.v)) mon = { v: m, g };
  }
  return { war, mon };
}

/** Число с одним знаком после запятой: 1,9. */
export const one = (x) => (x == null ? '-' : x.toFixed(1).replace('.', ','));

// --- сравнение с соперниками (схема одобрена Денисом 04.11): только по тем же партиям

const wonOf = (a) => a[0] + a[2]; // войны и восстания: [атака выиграна, проиграна, защита выиграна, проиграна]
const foughtOf = (a) => a[0] + a[1] + a[2] + a[3];
const pctOf = (won, fought) => (fought ? (100 * won) / fought : null);
const rivalKey = (s) => (s.kind === 'bot' ? 'bots' : (s.name || '').trim().toLowerCase());

/**
 * Строки «Вы и соперники»: key, label, kind (num: разница в очках, pct: в процентных пунктах,
 * per: в процентах от соперника), good (1: больше лучше, 0: без оценки).
 */
export const RIVAL_ROWS = [
  ['score', 'Средний счет', 'num', 1],
  ['war', 'Войны выиграно', 'pct', 1],
  ['revolt', 'Восстания выиграно', 'pct', 1],
  ['mon', 'Монументы', 'per', 1],
  ['cat', 'Катастрофы', 'per', 0],
  ['tr', 'Сокровища', 'per', 1],
  ['tile', 'Очки за тайлы', 'per', 1],
  ['building', 'Очки за здания', 'per', 1],
  ['monument', 'Очки за монументы', 'per', 1],
  ['warPts', 'Очки за войны', 'per', 1],
  ['revoltPts', 'Очки за восстания', 'per', 1],
];

function tally() {
  return { n: 0, score: 0, war: [0, 0], revolt: [0, 0], mon: 0, cat: 0, tr: 0, tile: 0, building: 0, monument: 0, warPts: 0, revoltPts: 0 };
}
function addTo(t, score, d) {
  t.n++;
  t.score += score;
  t.war[0] += wonOf(d.war);
  t.war[1] += foughtOf(d.war);
  t.revolt[0] += wonOf(d.revolt);
  t.revolt[1] += foughtOf(d.revolt);
  t.mon += d.mon || 0;
  t.cat += d.cat || 0;
  t.tr += d.tr || 0;
  for (const k of ['tile', 'building', 'monument']) t[k] += d.src?.[k] || 0;
  t.warPts += d.src?.war || 0;
  t.revoltPts += d.src?.revolt || 0;
}
const valueOf = (t, key, kind) => (kind === 'pct' ? pctOf(t[key][0], t[key][1]) : t.n ? t[key] / t.n : null);

/**
 * «Вы и соперники»: игрок за партию против среднего соперника в тех же партиях. Берутся партии,
 * где есть свои подробности и подробности хотя бы одного соперника; соперник без подробностей
 * не считается. { games, seats, rows: [{ key, label, kind, good, me, opp, won, fought }] }.
 */
export function vsRivals(games) {
  const mine = tally(), opp = tally();
  for (const g of games) {
    const rivals = (g.seats || []).filter((s) => !s.self && s.d);
    if (!g.d || !rivals.length) continue;
    addTo(mine, g.score, g.d);
    for (const s of rivals) addTo(opp, s.score, s.d);
  }
  if (!mine.n) return { games: 0, seats: 0, rows: [] };
  const rows = RIVAL_ROWS.map(([key, label, kind, good]) => ({
    key, label, kind, good, me: valueOf(mine, key, kind), opp: valueOf(opp, key, kind),
    ...(kind === 'pct' ? { won: mine[key][0], fought: mine[key][1] } : {}),
  }));
  return { games: mine.n, seats: opp.n, rows };
}

/**
 * «Против каждого соперника»: люди по имени, боты одной строкой в конце. games — партий вместе,
 * meets — встреч (у ботов за одним столом их бывает несколько), above и below — сколько раз игрок
 * был выше и ниже (равные места не считаются). Монументы и войны по партиям, где подробности у обоих.
 */
export function perRival(games) {
  const m = new Map();
  games.forEach((g, gi) => {
    for (const s of g.seats || []) {
      if (s.self) continue;
      const key = rivalKey(s);
      if (!m.has(key)) {
        m.set(key, { key, name: s.kind === 'bot' ? 'Боты (все)' : (s.name || 'Игрок').trim(), bot: s.kind === 'bot', last: -1, lastD: -1,
          games: 0, meets: 0, above: 0, below: 0, my: tally(), his: tally(), myScore: 0, hisScore: 0, dGames: 0 });
      }
      const r = m.get(key);
      if (r.last !== gi) { // свои цифры в партии считаются один раз, даже если ботов за столом несколько
        r.last = gi;
        r.games++;
        r.myScore += g.score;
      }
      r.meets++;
      r.hisScore += s.score;
      if (g.place < s.place) r.above++;
      else if (g.place > s.place) r.below++;
      if (g.d && s.d) {
        if (r.lastD !== gi) {
          r.lastD = gi;
          r.dGames++;
          addTo(r.my, g.score, g.d);
        }
        addTo(r.his, s.score, s.d);
      }
    }
  });
  return [...m.values()]
    .sort((a, b) => a.bot - b.bot || b.games - a.games)
    .map((r) => ({
      key: r.key, name: r.name, bot: r.bot, games: r.games, meets: r.meets, above: r.above, below: r.below, dGames: r.dGames,
      myScore: r.myScore / r.games, hisScore: r.hisScore / r.meets,
      myMon: r.my.n ? r.my.mon / r.my.n : null, hisMon: r.his.n ? r.his.mon / r.his.n : null,
      myWar: pctOf(r.my.war[0], r.my.war[1]), hisWar: pctOf(r.his.war[0], r.his.war[1]),
    }));
}
