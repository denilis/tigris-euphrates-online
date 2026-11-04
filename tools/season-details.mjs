// Подробности партий BGA сезона для статистики турнира (этап 2, 04.11): из логов выгрузки BGA
// в tigris-bot (data/bga/tigris_games_part*.json, разбор sim/bga_logs.js) собирает
// server/season-bga-details.js в формате game/details.js. Партий без логов (три партии 23.10)
// в файле нет: на странице они идут без подробностей.
//   node tools/season-details.mjs <папка tigris-bot>
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { BGA_GAMES } from '../server/season-bga.js';

const bot = process.argv[2];
if (!bot) throw new Error('укажите папку tigris-bot');
const { loadTables } = await import(pathToFileURL(path.join(bot, 'sim', 'bga_stats.js')).href);
const tables = new Map(loadTables(path.join(bot, 'data', 'bga')).map((t) => [String(t.id), t]));

// порядок игроков как в season-bga.js: Денис, Влад, Андрей
const NICKS = ['Goloden', 'transportnoy', 'astrelkov'];
const sum = (a) => (a || []).reduce((x, y) => x + y, 0);

const out = {};
for (const [, table] of BGA_GAMES) {
  const t = tables.get(String(table));
  if (!t || !t.stats) continue;
  const ids = NICKS.map((n) => t.players.find((p) => p.name === n)?.id);
  if (ids.some((id) => id == null)) continue;
  const big = Object.fromEntries(ids.map((id) => [String(id), 0]));
  for (const e of t.events || []) {
    if (e.type !== 'war' && e.type !== 'revolt') continue;
    if (e.attBoard != null) big[e.att] = Math.max(big[e.att] ?? 0, e.attBoard + (e.attN || 0));
    if (e.defBoard != null) big[e.def] = Math.max(big[e.def] ?? 0, e.defBoard + (e.defN || 0));
  }
  out[table] = ids.map((id) => {
    const s = t.stats[id];
    if (!s?.final || !s.points) return null;
    return {
      c: s.final.slice(0, 4), tr: s.final[4] ?? 0,
      src: { tile: sum(s.points.tile), building: sum(s.points.building), monument: sum(s.points.monument), war: sum(s.points.war), revolt: sum(s.points.revolt) },
      war: [s.warsWon, s.warsAttacked - s.warsWon, s.warsDefendedWon, s.warsDefended - s.warsDefendedWon],
      revolt: [s.revoltsWon, s.revoltsStarted - s.revoltsWon, s.revoltsDefendedWon, s.revoltsDefended - s.revoltsDefendedWon],
      mon: s.monuments, cat: s.catastrophes, big: big[String(id)] ?? 0,
    };
  });
  if (out[table].some((x) => !x)) delete out[table];
}

const lines = Object.entries(out).map(([table, ps]) => `  '${table}': ${JSON.stringify(ps)},`);
writeFileSync(new URL('../server/season-bga-details.js', import.meta.url), `// Подробности партий BGA сезона: собрано tools/season-details.mjs из логов выгрузки BGA (tigris-bot).
// Формат игрока как в game/details.js, порядок Денис, Влад, Андрей. Партий без логов здесь нет.
export const BGA_DETAILS = {
${lines.join('\n')}
};
`);
console.log('партий с подробностями', Object.keys(out).length, 'из', BGA_GAMES.length);
console.log('без подробностей', BGA_GAMES.map((g) => String(g[1])).filter((id) => !out[id]).join(', '));
