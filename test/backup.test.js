// Резервная копия базы (15.11): выгрузка частями, восстановление в пустую базу один в один,
// адрес только для главного администратора.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redisStore } from '../server/store-redis.js';
import { memoryStore } from '../server/store-memory.js';
import { dumpPage, restoreCommands, backupFile, BACKUP_FORMAT } from '../server/backup.js';
import { createApp } from '../server/routes.js';
import { fakeUpstash } from './fake-upstash.js';

const PREFIX = 'production:';

async function filled() {
  const f = fakeUpstash();
  const s = redisStore({ exec: f.exec, prefix: PREFIX });
  await s.putUser({ id: 'u1', name: 'Петя', admin: false, revoked: false });
  await s.putUser({ id: 'u2', name: 'Вася', admin: false, revoked: false });
  await s.addHistory({ id: 'g1', title: 'партия', finishedAt: 5, seats: [] });
  await s.putTour({ id: 't-1', name: 'Кубок', players: ['Петя', 'Вася'] });
  await s.addMyTable('u1', 'ABCDEF');
  await s.addJoinItem('u1', { id: 'j1', at: 1 });
  await s.logTable({ code: 'ABCDEF', kind: 'delete' }, 50);
  await s.setAvatar('tok1', { type: 'image/webp', data: 'x'.repeat(5000) });
  await s.putTable({ code: 'ABCDEF', status: 'over', seats: [] }, null, 'meta');
  await s.touchHere('ABCDEF', 'u1', 1, 60_000); // присутствие: в копию не идет
  await s.setPresence('u1', { at: 1 }, 60_000); // присутствие на сайте: тоже
  await f.exec(['SET', 'preview:user:zz', '{}']); // другое окружение: в копию не идет
  return { f, s };
}

async function allPages(f, opts = {}) {
  const pages = [];
  let cursor = '0';
  do {
    const p = await dumpPage({ exec: f.exec, pipeline: f.exec.pipeline, prefix: PREFIX, cursor, ...opts });
    pages.push(p);
    cursor = p.cursor;
  } while (cursor !== '0');
  return pages;
}

test('копия частями и восстановление в пустую базу: данные те же', async () => {
  const { f, s } = await filled();
  const pages = await allPages(f, { maxBytes: 300, count: 2 });
  assert.ok(pages.length > 2, `частей ${pages.length}: предел работает`);
  const file = backupFile(pages, { at: 0, site: 'test' });
  assert.equal(file.format, BACKUP_FORMAT);
  assert.ok(file.keys.every((r) => !r.k.startsWith(PREFIX)), 'ключи без приставки');
  assert.ok(!file.keys.some((r) => r.k.startsWith('here:') || r.k.startsWith('pres:')), 'присутствие не копируется');
  assert.ok(!file.keys.some((r) => r.k.includes('zz')), 'чужое окружение не копируется');
  assert.equal(new Set(file.keys.map((r) => r.k)).size, file.keys.length, 'без повторов');
  assert.deepEqual(new Set(file.keys.map((r) => r.t)), new Set(['string', 'set', 'list', 'hash']));
  assert.equal(file.count.user, 2);

  const g = fakeUpstash();
  await g.exec.pipeline(restoreCommands(JSON.parse(JSON.stringify(file)).keys, PREFIX));
  const r = redisStore({ exec: g.exec, prefix: PREFIX });
  const byId = (a) => [...a].sort((x, y) => x.id.localeCompare(y.id));
  assert.deepEqual(byId(await r.listUsers()), byId(await s.listUsers()));
  assert.deepEqual(await r.listHistory(), await s.listHistory());
  assert.deepEqual(await r.listTours(), await s.listTours());
  assert.deepEqual(await r.myTables('u1'), await s.myTables('u1'));
  assert.deepEqual(await r.joinItems('u1'), await s.joinItems('u1'));
  assert.deepEqual(await r.tableLog(50), await s.tableLog(50));
  assert.deepEqual(await r.getAvatar('tok1'), await s.getAvatar('tok1'));
  assert.deepEqual(await r.getTable('ABCDEF'), await s.getTable('ABCDEF'));
});

test('срок хранения переносится, бессрочное остается бессрочным', async () => {
  const f = fakeUpstash();
  await f.exec(['SET', `${PREFIX}t:AAAAAA`, '{}']);
  await f.exec(['PEXPIRE', `${PREFIX}t:AAAAAA`, 90_000]);
  await f.exec(['SET', `${PREFIX}hist:g1`, '{}']);
  const [page] = await allPages(f);
  const t = page.keys.find((x) => x.k === 't:AAAAAA'), h = page.keys.find((x) => x.k === 'hist:g1');
  assert.ok(t.ttl > 0 && t.ttl <= 90_000);
  assert.equal(h.ttl, undefined);
  const cmds = restoreCommands(page.keys, PREFIX);
  assert.ok(cmds.some((c) => c[0] === 'PEXPIRE' && c[1] === `${PREFIX}t:AAAAAA`));
  assert.ok(!cmds.some((c) => c[0] === 'PEXPIRE' && c[1] === `${PREFIX}hist:g1`));
  assert.throws(() => restoreCommands([{ k: 'x', t: 'zset', v: [] }]), /неизвестный тип/);
});

test('адрес копии: только главный администратор, метка части проверяется', async () => {
  const f = fakeUpstash();
  const store = redisStore({ exec: f.exec, prefix: PREFIX });
  let clock = 1_800_000_000_000;
  const app = createApp({ store, env: { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345', ADMIN_NAME: 'Денис' }, now: () => clock++ });
  const req = (method, path, opts = {}) => app.call({ method, path, ...opts });
  const denis = (await req('POST', 'activate', { body: { code: 'ADMN-TEST-2345' } })).body;
  const mk = async (name, admin) => {
    const r = await req('POST', 'admin/users', { body: { name, admin }, token: denis.token });
    return (await req('POST', 'activate', { body: { code: r.body.code } })).body;
  };
  const helper = await mk('Помощник', true), petya = await mk('Петя', false);

  const ok = await req('GET', 'admin/backup', { token: denis.token, query: {} });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.store, 'redis');
  assert.ok(ok.body.keys.some((r) => r.k === 'user:u-admin'));
  let cursor = ok.body.cursor, n = 1;
  while (cursor !== '0') {
    const p = await req('GET', 'admin/backup', { token: denis.token, query: { cursor } });
    cursor = p.body.cursor;
    if (++n > 50) assert.fail('копия не кончается');
  }
  assert.equal((await req('GET', 'admin/backup', { token: helper.token })).status, 403, 'другой администратор');
  assert.equal((await req('GET', 'admin/backup', { token: petya.token })).status, 403);
  assert.equal((await req('GET', 'admin/backup')).status, 401);
  assert.equal((await req('GET', 'admin/backup', { token: denis.token, query: { cursor: '1;DEL' } })).status, 400);
});

test('локальный сервер в памяти тоже отдает копию одной частью', async () => {
  const s = memoryStore();
  await s.putUser({ id: 'u1', name: 'Петя' });
  await s.addMyTable('u1', 'ABCDEF');
  const p = await s.dump();
  assert.equal(p.done, true);
  assert.ok(p.keys.some((r) => r.k === 'user:u1' && r.t === 'string'));
  assert.doesNotThrow(() => restoreCommands(p.keys));
});
