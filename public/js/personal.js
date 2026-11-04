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
