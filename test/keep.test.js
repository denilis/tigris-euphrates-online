// Законченные партии хранятся бессрочно (решение Дениса 03.11), статистика ведет на стол.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../server/store-memory.js';
import { redisStore } from '../server/store-redis.js';
import { keepFinishedOnce } from '../server/keep.js';
import { historyEntry } from '../game/table.js';
import { siteGame } from '../server/stats.js';
import { fakeUpstash } from './fake-upstash.js';
import { started, playOut } from './support.js';

const TABLE_TTL = 90 * 24 * 3600;

test('Upstash: законченный стол пишется без срока, лобби и идущая партия со сроком 90 дней', async () => {
  const fake = fakeUpstash();
  const st = redisStore({ exec: fake.exec, prefix: 'p:' });
  const t = started(31);
  assert.ok(await st.putTable(t, null));
  assert.equal(fake.expiry.get('p:t:' + t.code), TABLE_TTL, 'идущая партия живет 90 дней');
  const was = t.version;
  playOut(t, 31);
  assert.equal(t.status, 'over');
  assert.ok(await st.putTable(t, was));
  for (const key of ['t', 'v', 'm']) assert.equal(fake.expiry.has(`p:${key}:${t.code}`), false, `${key}: законченная партия без срока`);
});

test('код стола в истории и в строке статистики', () => {
  const t = started(32);
  playOut(t, 32);
  const e = historyEntry(t);
  assert.equal(e.code, t.code);
  assert.equal(siteGame(e).code, t.code);
});

for (const [name, make] of Object.entries({ 'память': () => ({ st: memoryStore() }), 'Upstash': () => { const fake = fakeUpstash(); return { fake, st: redisStore({ exec: fake.exec, prefix: 'p:' }) }; } })) {
  test(`${name}: один раз снять срок с уже законченных столов и дописать код в их историю`, async () => {
    const { st, fake } = make();
    const over = started(33);
    playOut(over, 33);
    const lobbyLike = { ...started(34), code: 'TEST02' }; // у тестовых столов один код, второму нужен свой
    // так их записал прежний код: со сроком, история без кода
    assert.ok(await st.putTable(over, null));
    assert.ok(await st.putTable(lobbyLike, null));
    const { code, ...old } = historyEntry(over);
    await st.addHistory(old);
    for (const k of ['t', 'v', 'm']) fake?.expiry.set(`p:${k}:${over.code}`, TABLE_TTL);

    assert.equal(await keepFinishedOnce(st), 1);
    const hist = (await st.listHistory()).find((h) => h.id === over.game.id);
    assert.equal(hist.code, over.code);
    if (fake) {
      assert.equal(fake.expiry.has('p:t:' + over.code), false, 'срок снят');
      assert.equal(fake.expiry.get('p:t:' + lobbyLike.code), TABLE_TTL, 'идущей партии срок оставлен');
    }
    assert.equal(await keepFinishedOnce(st), 0, 'второй раз ничего не делает');
  });
}
