// Переходник функции Vercel: путь из параметра route, тело запроса, токен из заголовка,
// и отказ работать на Vercel без базы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { makeHandler } from '../api/index.js';
import { memoryStore } from '../server/store-memory.js';

const ENV = { SESSION_SECRET: 's', CODE_PEPPER: 'p', ADMIN_CODE: 'ADMN-TEST-2345' };

function fakeReq(method, url, { body, parsed, token, headers } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(req, { method, url, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
  if (parsed !== undefined) req.body = parsed;
  return req;
}
function fakeRes() {
  const r = { statusCode: 0, headers: {}, out: '' };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.end = (s) => { r.out = s || ''; };
  return r;
}
async function call(handler, method, url, opts) {
  const res = fakeRes();
  await handler(fakeReq(method, url, opts), res);
  return { status: res.statusCode, body: JSON.parse(res.out), type: res.headers['content-type'] };
}

test('путь из route, тело потоком и разобранное, токен из заголовка', async () => {
  const h = makeHandler(ENV, memoryStore());
  const ping = await call(h, 'GET', '/api/index?route=ping');
  assert.equal(ping.status, 200);
  assert.equal(ping.type, 'application/json; charset=utf-8');
  const a = await call(h, 'POST', '/api/index?route=activate', { body: JSON.stringify({ code: 'ADMN-TEST-2345' }) });
  assert.equal(a.status, 200);
  const b = await call(h, 'POST', '/api/index?route=activate', { parsed: { code: 'ADMN-TEST-2345' } });
  assert.equal(b.status, 200);
  assert.equal((await call(h, 'GET', '/api/index?route=me', { token: a.body.token })).body.admin, true);
  assert.equal((await call(h, 'GET', '/api/index?route=me')).status, 401);
  assert.equal((await call(h, 'POST', '/api/index?route=activate', { body: '{не json' })).status, 400);
  const t = await call(h, 'POST', '/api/index?route=tables', { token: a.body.token, body: '' });
  assert.equal(t.status, 200);
  const v = await call(h, 'GET', `/api/index?route=tables/${t.body.code}&logFrom=0`, { token: a.body.token });
  assert.equal(v.body.code, t.body.code);
});

test('слишком большое тело запроса отклоняется: по заголовку и по потоку', async () => {
  const h = makeHandler(ENV, memoryStore());
  const a = await call(h, 'POST', '/api/index?route=activate', { body: JSON.stringify({ code: 'ADMN-TEST-2345' }) });
  const big = JSON.stringify({ action: 'options', options: { constructor: 'x'.repeat(40 * 1024) } });
  const byHeader = await call(h, 'POST', '/api/index?route=tables', { token: a.body.token, parsed: {}, headers: { 'content-length': String(big.length) } });
  assert.equal(byHeader.status, 413);
  const byStream = await call(h, 'POST', '/api/index?route=tables', { token: a.body.token, body: big });
  assert.equal(byStream.status, 413);
  assert.equal(byStream.body.error, 'too-big');
  const ok = await call(h, 'POST', '/api/index?route=tables', { token: a.body.token, body: JSON.stringify({ x: 'y'.repeat(1000) }) });
  assert.equal(ok.status, 200, 'обычное тело проходит');
});

test('адрес клиента берется из заголовков Vercel и считается в лимите входа', async () => {
  const h = makeHandler(ENV, memoryStore());
  const bad = (ip) => call(h, 'POST', '/api/index?route=activate', { body: JSON.stringify({ code: 'ZZZZ-ZZZZ-ZZZZ' }), headers: { 'x-real-ip': ip } });
  for (let k = 0; k < 20; k++) assert.equal((await bad('9.9.9.9')).status, 401);
  assert.equal((await bad('9.9.9.9')).status, 429);
  assert.equal((await bad('8.8.8.8')).status, 401, 'другой адрес считается отдельно');
  const viaList = (ip) => call(h, 'POST', '/api/index?route=activate', { body: JSON.stringify({ code: 'ZZZZ-ZZZZ-ZZZZ' }), headers: { 'x-forwarded-for': ip } });
  for (let k = 0; k < 20; k++) await viaList('7.7.7.7, 10.0.0.1');
  assert.equal((await viaList('7.7.7.7')).status, 429, 'в списке берется первый адрес');
});

test('на Vercel без базы отвечает только ping', async () => {
  const h = makeHandler({ ...ENV, VERCEL_ENV: 'production' });
  assert.equal((await call(h, 'GET', '/api/index?route=ping')).status, 200);
  const r = await call(h, 'POST', '/api/index?route=activate', { body: '{}' });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'no-db');
});
