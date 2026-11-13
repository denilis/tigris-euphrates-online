// Рейтинг игроков: Эло для партий на нескольких человек, боты не в счет (13.11.2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratings, ratedGames, ratingOf, RATING_START, RATING_K } from '../server/rating.js';
import { whoIs } from '../server/people.js';
import { BGA_GAMES } from '../server/season-bga.js';

const game = (at, ...seats) => ({ at, seats: seats.map(([id, place]) => ({ id, place })) });

test('двое равных: победитель получает половину K, проигравший столько же теряет', () => {
  const r = ratings([game(1, ['a', 1], ['b', 2])]);
  assert.equal(r.get('a').rating, RATING_START + RATING_K / 2);
  assert.equal(r.get('b').rating, RATING_START - RATING_K / 2);
  assert.deepEqual([r.get('a').games, r.get('b').games], [1, 1]);
  assert.equal(r.get('a').last, RATING_K / 2);
});

test('сумма рейтингов не меняется, сколько бы людей ни играло', () => {
  const r = ratings([
    game(1, ['a', 1], ['b', 2], ['c', 3]),
    game(2, ['a', 2], ['b', 1], ['c', 3], ['d', 4]),
    game(3, ['c', 1], ['d', 1]),
  ]);
  const sum = [...r.values()].reduce((a, x) => a + x.rating, 0);
  assert.ok(Math.abs(sum - 4 * RATING_START) < 1e-9, `сумма ${sum}`);
});

test('четверо равных: первый +16, последний -16, середина около нуля', () => {
  const r = ratings([game(1, ['a', 1], ['b', 2], ['c', 3], ['d', 4])]);
  assert.ok(Math.abs(r.get('a').rating - (RATING_START + 16)) < 1e-9);
  assert.ok(Math.abs(r.get('d').rating - (RATING_START - 16)) < 1e-9);
  assert.ok(Math.abs(r.get('b').rating - (RATING_START + 16 / 3)) < 1e-9);
  assert.ok(Math.abs(r.get('c').rating - (RATING_START - 16 / 3)) < 1e-9);
});

test('дележ места: равные игроки остаются при своем', () => {
  const r = ratings([game(1, ['a', 1], ['b', 1])]);
  assert.equal(r.get('a').rating, RATING_START);
  assert.equal(r.get('b').rating, RATING_START);
});

test('победа над сильным дает больше, чем победа над слабым', () => {
  const warm = [game(1, ['s', 1], ['w', 2]), game(2, ['s', 1], ['w', 2]), game(3, ['s', 1], ['w', 2])];
  const overStrong = ratings([...warm, game(4, ['n', 1], ['s', 2])]).get('n').rating;
  const overWeak = ratings([...warm, game(4, ['n', 1], ['w', 2])]).get('n').rating;
  assert.ok(overStrong > overWeak, `${overStrong} и ${overWeak}`);
});

test('партии считаются по времени, а не по порядку в списке', () => {
  const a = ratings([game(2, ['a', 1], ['b', 2]), game(1, ['a', 2], ['b', 1])]);
  const b = ratings([game(1, ['a', 2], ['b', 1]), game(2, ['a', 1], ['b', 2])]);
  assert.equal(a.get('a').rating, b.get('a').rating);
  assert.ok(a.get('a').last > 0, 'последней была победа');
});

test('партия с одним человеком или без мест рейтинг не меняет', () => {
  const r = ratings([game(1, ['a', 1]), { at: 2, seats: [{ id: 'a', place: 1 }, { id: null, place: 2 }] }]);
  assert.equal(r.get('a'), undefined);
});

const HUMAN = (userId, name, place) => ({ kind: 'human', userId, name, place });
const BOT = (place) => ({ kind: 'bot', userId: null, name: 'Бот', place });
const USERS = [{ id: 'u1', name: 'Денис' }, { id: 'u2', name: 'Влад' }, { id: 'u3', name: 'Андрей' }, { id: 'u4', name: 'Соня' }];

test('партии для рейтинга: сезон BGA целиком, с сайта только партии с двумя людьми и больше, без ботов', () => {
  const history = [
    { finishedAt: Date.UTC(2026, 10, 1), seats: [HUMAN('u1', 'Денис', 2), BOT(1), BOT(3)] }, // один человек: не в счет
    { finishedAt: Date.UTC(2026, 10, 2), seats: [HUMAN('u1', 'Денис', 3), BOT(1), HUMAN('u4', 'Соня', 2)] },
  ];
  const games = ratedGames(history, whoIs(USERS));
  assert.equal(games.length, BGA_GAMES.length + 1);
  assert.deepEqual(games.at(-1).seats, [{ id: 'u1', place: 3 }, { id: 'u4', place: 2 }]);
  assert.deepEqual(games[0].seats.map((s) => s.id), ['u1', 'u2', 'u3']);
});

test('игрок сменил имя: партии BGA и старые партии без номера остаются за ним', () => {
  const users = [{ id: 'u1', name: 'Den', was: ['денис'] }, ...USERS.slice(1)];
  const history = [{ finishedAt: Date.UTC(2026, 10, 2), seats: [{ kind: 'human', userId: null, name: 'Денис', place: 1 }, HUMAN('u4', 'Соня', 2)] }];
  const games = ratedGames(history, whoIs(users));
  assert.equal(games[0].seats[0].id, 'u1');
  assert.equal(games.at(-1).seats[0].id, 'u1');
});

test('имя из сезона без учетной записи: соперникам партия идет, в таблицу мест он не попадает', () => {
  const who = whoIs([{ id: 'u1', name: 'Денис' }]);
  const table = ratings(ratedGames([], who));
  assert.ok(table.get('name:влад').games > 0);
  const mine = ratingOf('u1', table);
  assert.equal(mine.of, 1);
  assert.equal(mine.rank, 1);
  assert.equal(mine.games, BGA_GAMES.length);
});

test('строка профиля: место среди игроков, равные делят место, без партий с людьми рейтинга нет', () => {
  const table = ratings([game(1, ['a', 1], ['b', 2], ['c', 3]), game(2, ['d', 1], ['e', 1])]);
  assert.deepEqual(ratingOf('a', table), { value: 1516, games: 1, last: 16, rank: 1, of: 5 });
  assert.equal(ratingOf('c', table).rank, 5);
  assert.equal(ratingOf('d', table).rank, 2);
  assert.equal(ratingOf('e', table).rank, 2);
  assert.equal(ratingOf('nobody', table), null);
});

test('партия, снятая с зачета, и место без имени и номера рейтинг не меняют', () => {
  const who = whoIs(USERS);
  const off = { finishedAt: Date.UTC(2026, 10, 3), tour: 'none', seats: [HUMAN('u1', 'Денис', 1), HUMAN('u4', 'Соня', 2)] };
  assert.equal(ratedGames([off], who).length, BGA_GAMES.length);
  const blank = { finishedAt: Date.UTC(2026, 10, 3), seats: [HUMAN('u1', 'Денис', 1), { kind: 'human', userId: null, name: '', place: 2 }, { kind: 'human', userId: null, name: null, place: 3 }] };
  const games = ratedGames([blank], who);
  assert.deepEqual(games.at(-1).seats.map((x) => x.id), ['u1', null, null]);
  const before = ratings(ratedGames([], who)).get('u1').rating;
  assert.equal(ratings(games).get('u1').rating, before, 'соперников с именем нет: партия не в счет');
});

test('в таблице мест только те, кого показывают: отозванные места не занимают', () => {
  const table = ratings([game(1, ['a', 1], ['b', 2], ['c', 3])]);
  assert.equal(ratingOf('c', table).rank, 3);
  const mine = ratingOf('c', table, (id) => id !== 'a');
  assert.deepEqual([mine.rank, mine.of], [2, 2]);
  assert.equal(ratingOf('a', table, () => false).of, 1, 'сам игрок в своей таблице есть всегда');
});
