// Подробности партий для статистики турнира (этап 2 пакета 04.11): журнал сайта и логи BGA
// в одном формате, разовый досчет старых партий сайта, расчеты дашборда.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { gameDetails } from '../game/details.js';
import { historyEntry } from '../game/table.js';
import { BGA_DETAILS } from '../server/season-bga-details.js';
import { BGA_GAMES } from '../server/season-bga.js';
import { seasonGames, siteGame } from '../server/stats.js';
import { detailsOnce } from '../server/keep.js';
import { memoryStore } from '../server/store-memory.js';
import { redisStore } from '../server/store-redis.js';
import { fakeUpstash } from './fake-upstash.js';
import { dashboard, streaks, winShare } from '../public/js/season.js';
import { started, playOut } from './support.js';

const sum = (a) => a.reduce((x, y) => x + y, 0);
const srcSum = (d) => d.src.tile + d.src.building + d.src.monument + d.src.war + d.src.revolt;

test('подробности по журналу: очки по источникам сходятся с очками по цветам, бои сходятся', () => {
  for (const seed of [41, 42, 43, 44, 45, 46]) {
    const t = started(seed);
    playOut(t, seed);
    const det = gameDetails(t.game.log, t.game.result);
    const wars = t.game.log.filter((e) => e.ev === 'war').length, revolts = t.game.log.filter((e) => e.ev === 'revolt').length;
    for (const r of t.game.result.seats) {
      const d = det[r.seatId];
      assert.deepEqual(d.c, r.score);
      assert.equal(d.tr, r.treasures);
      assert.equal(srcSum(d), sum(r.score), `стол ${seed}, место ${r.seatId}: источники = цвета`);
    }
    const all = Object.values(det);
    assert.equal(sum(all.map((d) => d.war[0] + d.war[1])), wars, 'атак столько, сколько войн');
    assert.equal(sum(all.map((d) => d.war[2] + d.war[3])), wars, 'защит столько же');
    assert.equal(sum(all.map((d) => d.revolt[0] + d.revolt[1])), revolts);
    assert.equal(sum(all.map((d) => d.war[0])), sum(all.map((d) => d.war[3])), 'победа нападающего = поражение защитника');
    assert.equal(sum(all.map((d) => d.war[1])), sum(all.map((d) => d.war[2])), 'поражение нападающего = победа защитника');
  }
});

test('подробности пишутся в историю в конце партии и идут в строку турнира по порядку турнира', () => {
  const t = started(47);
  playOut(t, 47);
  const e = historyEntry(t);
  assert.ok(e.seats.every((s) => s.d && s.d.c.length === 4));
  const g = siteGame(e);
  // порядок турнира: Денис, Влад, Андрей; за столом Денис, Андрей, Влад
  const byName = (n) => e.seats.find((s) => s.name === n).d;
  assert.deepEqual(g.details, [byName('Денис'), byName('Влад'), byName('Андрей')]);
});

test('BGA: подробности у 57 из 60 партий сезона, без логов только три партии 23.10', () => {
  const missing = BGA_GAMES.map((x) => String(x[1])).filter((id) => !BGA_DETAILS[id]);
  assert.deepEqual(missing, ['936400311', '936427001', '936446186']);
  for (const [table, ps] of Object.entries(BGA_DETAILS)) {
    assert.equal(ps.length, 3, table);
    for (const d of ps) assert.equal(srcSum(d), sum(d.c), `${table}: источники = цвета`);
    assert.equal(sum(ps.map((d) => d.war[0] + d.war[1])), sum(ps.map((d) => d.war[2] + d.war[3])), `${table}: атаки = защиты`);
  }
  const games = seasonGames([]);
  assert.equal(games.filter((g) => g.details).length, 57);
});

for (const [name, make] of Object.entries({ 'память': () => memoryStore(), 'Upstash': () => redisStore({ exec: fakeUpstash().exec, prefix: 'p:' }) })) {
  test(`${name}: один раз досчитать подробности старых партий сайта по журналу стола`, async () => {
    const st = make();
    const t = started(48);
    playOut(t, 48);
    assert.ok(await st.putTable(t, null));
    const e = historyEntry(t);
    await st.addHistory({ ...e, seats: e.seats.map(({ d, ...s }) => s) }); // так ее записал прежний код
    assert.equal(await detailsOnce(st), 1);
    const [after] = await st.listHistory();
    assert.deepEqual(after.seats.map((s) => s.d), e.seats.map((s) => s.d));
    assert.equal(await detailsOnce(st), 0, 'второй раз ничего не делает');
  });
}

test('дашборд сезона: 57 партий с подробностями, бои, награды, рекорды', () => {
  const games = seasonGames([]);
  const d = dashboard(games, 3);
  assert.equal(d.count, 57);
  assert.equal(d.total, 60);
  // у троих вместе атак столько же, сколько защит
  assert.equal(sum(d.players.map((p) => p.war[0] + p.war[1])), sum(d.players.map((p) => p.war[2] + p.war[3])));
  assert.deepEqual(d.awards.map((a) => a.title), ['Полководец', 'Строитель', 'Мятежник', 'Разрушитель', 'Казначей', 'Серия']);
  // медаль у каждой награды (06.11): ключ есть и файл картинки лежит на месте
  for (const a of d.awards) assert.ok(existsSync(new URL(`../public/img/awards/${a.key}.webp`, import.meta.url)), a.key);
  for (const a of d.awards) assert.ok(a.winners.length >= 1 && a.value > 0, a.title);
  assert.equal(d.records.colors.length, 4);
  assert.ok(d.records.colors.every((r) => r && r.v > 0 && r.g.date));
  assert.equal(d.records.score.v, Math.max(...games.flatMap((g) => g.score)));
});

test('дашборд: без подробностей пусто, ничья в награде у обоих', () => {
  assert.equal(dashboard([{ date: '2026-01-01', score: [1, 2], place: [2, 1], pts: [2, 4], details: null }], 2).count, 0);
  const d0 = { c: [5, 5, 5, 5], tr: 1, src: { tile: 20, building: 0, monument: 0, war: 0, revolt: 0 }, war: [1, 0, 0, 0], revolt: [0, 0, 0, 0], mon: 1, cat: 0, big: 4 };
  const g = { date: '2026-01-01', score: [5, 5], place: [1, 1], pts: [2, 2], details: [d0, d0] };
  const d = dashboard([g], 2);
  assert.deepEqual(d.awards[0].winners, [0, 1], 'поровну побед в войнах');
  assert.deepEqual(d.awards[3].winners, [], 'катастроф не было: награды нет');
});

test('серия: только чистые первые места подряд, деленное первое рвет серию', () => {
  const g = (place) => ({ place });
  assert.deepEqual(streaks([g([1, 2]), g([1, 2]), g([1, 1]), g([1, 2]), g([2, 1])], 2), [2, 1]);
});

test('доля побед: «из скольких» и процент', () => {
  assert.deepEqual(winShare([3, 1, 2, 4]), { won: 5, fought: 10, pct: 50 });
  assert.deepEqual(winShare([0, 0, 0, 0]), { won: 0, fought: 0, pct: null });
});

test('итог без очков по цветам (старые партии): подробностей нет, история и реванш не падают', () => {
  assert.deepEqual(gameDetails([], { seats: [{ seatId: 0, place: 1, vector: [] }] }), {});
  assert.deepEqual(gameDetails([], null), {});
  const t = started(49);
  playOut(t, 49);
  t.game.result.seats.forEach((s) => delete s.score);
  const e = historyEntry(t);
  assert.ok(e.seats.every((s) => s.d === undefined));
  assert.deepEqual(siteGame(e).details, [null, null, null]);
});
