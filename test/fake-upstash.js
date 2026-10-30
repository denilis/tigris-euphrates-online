// Поддельный Upstash для тестов: принимает тело запроса как настоящий REST API и
// исполняет команды так же, как Redis (включая наши Lua-скрипты).
import assert from 'node:assert/strict';
import { upstash, CAS_PUT, UNLOCK, MINE_PUSH, RATE_HIT } from '../server/store-redis.js';

/** Поддельный Upstash: принимает тело запроса как настоящий и отвечает { result }. */
export function fakeUpstash() {
  const kv = new Map(), sets = new Map(), lists = new Map();
  const commands = [];
  const run = (cmd) => {
    const [name, ...a] = cmd;
    commands.push(name);
    switch (name) {
      case 'GET': return kv.has(a[0]) ? kv.get(a[0]) : null;
      case 'MGET': return a.map((x) => (kv.has(x) ? kv.get(x) : null));
      case 'SET': {
        const nx = a.includes('NX');
        if (nx && kv.has(a[0])) return null;
        kv.set(a[0], a[1]);
        return 'OK';
      }
      case 'DEL': return a.reduce((n, key) => n + (kv.delete(key) ? 1 : 0), 0);
      case 'SADD': { const s = sets.get(a[0]) || new Set(); s.add(a[1]); sets.set(a[0], s); return 1; }
      case 'SMEMBERS': return [...(sets.get(a[0]) || [])];
      case 'LRANGE': return (lists.get(a[0]) || []).slice(Number(a[1]), Number(a[2]) + 1);
      case 'EVAL': {
        const [script, , ...rest] = a;
        if (script === CAS_PUT) {
          const [kv1, kt, km, expected, ver, doc, meta] = rest;
          if ((kv.get(kv1) ?? '') !== expected) return 0;
          kv.set(kt, doc); kv.set(kv1, ver); kv.set(km, meta);
          return 1;
        }
        if (script === UNLOCK) {
          if (kv.get(rest[0]) === rest[1]) { kv.delete(rest[0]); return 1; }
          return 0;
        }
        if (script === RATE_HIT) {
          const n = Number(kv.get(rest[0]) ?? 0) + 1;
          kv.set(rest[0], String(n));
          return n;
        }
        if (script === MINE_PUSH) {
          const l = (lists.get(rest[0]) || []).filter((x) => x !== rest[1]);
          lists.set(rest[0], [rest[1], ...l].slice(0, 20));
          return 1;
        }
        throw new Error('неизвестный скрипт');
      }
      default: throw new Error('неизвестная команда ' + name);
    }
  };
  const fetchImpl = async (url, { body, headers }) => {
    assert.equal(headers.Authorization, 'Bearer tok');
    const cmd = JSON.parse(body);
    for (const x of cmd) assert.equal(typeof x, 'string', 'все аргументы строками');
    return { ok: true, status: 200, json: async () => ({ result: run(cmd) }) };
  };
  return { exec: upstash({ url: 'https://fake', token: 'tok', fetchImpl }), commands };
}
