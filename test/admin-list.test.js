// Список «Коды игроков» (Денис 05.11): поиск, сортировки, отозванные, отбор по пригласившему.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickUsers, inviters, dayText, dateText, defaultDir, USER_SORTS } from '../public/js/admin-list.js';

const U = [
  { name: 'Денис', self: true, createdAt: 100, games: 87, lastGameAt: 900, invitedBy: null },
  { name: 'Андрей', createdAt: 300, games: 41, lastGameAt: 800, invitedBy: 'Денис' },
  { name: 'Влад', createdAt: 200, games: 33, lastGameAt: null, invitedBy: 'Денис', revoked: true },
  { name: 'Ёжик', createdAt: 400, games: 0, lastGameAt: null, invitedBy: 'Андрей' },
];
const names = (l) => l.map((u) => u.name);

test('своя строка первая, отозванные скрыты, пока их не попросят', () => {
  assert.deepEqual(names(pickUsers(U)), ['Денис', 'Ёжик', 'Андрей'], 'по дате добавления, новые сверху');
  assert.deepEqual(names(pickUsers(U, { revoked: true })), ['Денис', 'Ёжик', 'Андрей', 'Влад']);
  assert.deepEqual(names(pickUsers([{ ...U[0], revoked: true }])), ['Денис'], 'себя видно всегда');
});

test('сортировки и направление', () => {
  assert.deepEqual(USER_SORTS.map(([k]) => k), ['created', 'name', 'games', 'last']);
  assert.deepEqual(names(pickUsers(U, { sort: 'name', revoked: true })), ['Денис', 'Андрей', 'Влад', 'Ёжик']);
  assert.deepEqual(names(pickUsers(U, { sort: 'games', revoked: true })), ['Денис', 'Андрей', 'Влад', 'Ёжик']);
  assert.deepEqual(names(pickUsers(U, { sort: 'games', dir: 1, revoked: true })), ['Денис', 'Ёжик', 'Влад', 'Андрей']);
  assert.deepEqual(names(pickUsers(U, { sort: 'last', revoked: true })), ['Денис', 'Андрей', 'Влад', 'Ёжик'], 'без партий внизу, между собой по имени');
  assert.equal(defaultDir('name'), 1);
  assert.equal(defaultDir('games'), -1);
});

test('поиск по части имени без учета регистра и ё, отбор по пригласившему', () => {
  assert.deepEqual(names(pickUsers(U, { q: 'ан' })), ['Андрей']);
  assert.deepEqual(names(pickUsers(U, { q: 'ЕЖ' })), ['Ёжик']);
  assert.deepEqual(names(pickUsers(U, { by: 'Денис', revoked: true })), ['Андрей', 'Влад']);
  assert.deepEqual(inviters(U), ['Андрей', 'Денис']);
});

test('даты коротко', () => {
  const now = new Date(2026, 10, 5, 15).getTime();
  assert.equal(dayText(new Date(2026, 10, 5, 1).getTime(), now), 'сегодня');
  assert.equal(dayText(new Date(2026, 10, 4, 23).getTime(), now), 'вчера');
  assert.equal(dayText(new Date(2026, 10, 3).getTime(), now), '03.11');
  assert.equal(dayText(new Date(2025, 11, 28).getTime(), now), '28.12.2025');
  assert.equal(dayText(null, now), '-');
  assert.equal(dateText(new Date(2026, 9, 2).getTime()), '02.10.2026');
});
