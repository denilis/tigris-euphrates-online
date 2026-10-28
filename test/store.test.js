// Один договор для хранилища в памяти и для Upstash (через поддельный REST-сервер,
// который исполняет команды так же, как Redis).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from '../server/store-memory.js';
import { redisStore } from '../server/store-redis.js';
import { fakeUpstash } from './fake-upstash.js';

const stores = {
  'память': () => memoryStore(),
  'Upstash': () => redisStore({ exec: fakeUpstash().exec, prefix: 'test:' }),
};

for (const [name, make] of Object.entries(stores)) {
  test(`${name}: стол пишется только при той же версии`, async () => {
    const st = make();
    const doc = { code: 'ABC123', version: 0, x: 1 };
    assert.equal(await st.putTable(doc, null, 'bot'), true);
    assert.equal(await st.putTable(doc, null), false, 'второй стол с тем же кодом');
    assert.deepEqual(await st.getTable('ABC123'), { doc, version: 0 });
    assert.deepEqual(await st.poll('ABC123'), { version: 0, meta: 'bot', locked: false });
    const d1 = { ...doc, version: 1, x: 2 };
    assert.equal(await st.putTable(d1, 0, ''), true);
    assert.equal(await st.putTable({ ...doc, version: 1, x: 3 }, 0), false, 'устаревшая версия');
    assert.equal((await st.getTable('ABC123')).doc.x, 2);
    assert.equal(await st.getTable('NOPE00'), null);
    assert.equal(await st.poll('NOPE00'), null);
    assert.deepEqual(await st.getTables(['ABC123', 'NOPE00']), [d1, null]);
  });

  test(`${name}: замок берётся один раз и снимается только своим токеном`, async () => {
    const st = make();
    await st.putTable({ code: 'L00001', version: 0 }, null);
    assert.equal(await st.lock('L00001', 'a', 30000), true);
    assert.equal(await st.lock('L00001', 'b', 30000), false);
    assert.equal((await st.poll('L00001')).locked, true);
    await st.unlock('L00001', 'b');
    assert.equal((await st.poll('L00001')).locked, true, 'чужой токен не снимает');
    await st.unlock('L00001', 'a');
    assert.equal(await st.lock('L00001', 'b', 30000), true);
  });

  test(`${name}: история пишется один раз, у компании последняя партия`, async () => {
    const st = make();
    const e1 = { id: 'g1', company: 'a|b', finishedAt: 10 };
    assert.equal(await st.addHistory(e1), true);
    assert.equal(await st.addHistory({ ...e1, finishedAt: 99 }), false);
    await st.setCompanyLast(e1);
    await st.setCompanyLast({ id: 'g0', company: 'a|b', finishedAt: 5 });
    assert.equal((await st.companyLast('a|b')).id, 'g1', 'старая партия не перетирает новую');
    assert.equal(await st.companyLast('x|y'), null);
  });

  test(`${name}: люди, коды, мои столы`, async () => {
    const st = make();
    await st.putUser({ id: 'u1', name: 'Андрей' });
    await st.putUser({ id: 'u2', name: 'Влад' });
    await st.putUser({ id: 'u1', name: 'Андрей', revoked: true });
    assert.equal((await st.getUser('u1')).revoked, true);
    assert.deepEqual((await st.listUsers()).map((u) => u.id).sort(), ['u1', 'u2']);
    await st.setCode('h1', 'u1');
    assert.equal(await st.userIdByCode('h1'), 'u1');
    await st.delCode('h1');
    assert.equal(await st.userIdByCode('h1'), null);
    for (const c of ['A', 'B', 'A', 'C']) await st.addMyTable('u1', c);
    assert.deepEqual(await st.myTables('u1'), ['C', 'A', 'B']);
    assert.deepEqual(await st.myTables('u9'), []);
  });
}

// Поддельный Upstash исполняет логику скриптов на JS, сам Lua проверяется на настоящем
// Upstash (план, фаза 5). Здесь сторожим, что проверки в тексте скриптов на месте.
test('Upstash: в Lua-скриптах есть сравнение версии и токена замка', async () => {
  const { CAS_PUT, UNLOCK } = await import('../server/store-redis.js');
  assert.match(CAS_PUT, /if cur ~= ARGV\[1\] then return 0 end/);
  assert.ok(CAS_PUT.indexOf('return 0') < CAS_PUT.indexOf("redis.call('SET'"), 'проверка версии до записи');
  assert.match(UNLOCK, /if redis\.call\('GET', KEYS\[1\]\) == ARGV\[1\] then return redis\.call\('DEL', KEYS\[1\]\) end/);
});

test('Upstash: опрос стола — одна команда Redis', async () => {
  const fake = fakeUpstash();
  const st = redisStore({ exec: fake.exec });
  await st.putTable({ code: 'P00001', version: 0 }, null);
  fake.commands.length = 0;
  await st.poll('P00001');
  assert.deepEqual(fake.commands, ['MGET']);
});
