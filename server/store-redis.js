// Хранилище в Upstash Redis через его REST API обычным fetch: у проекта нет npm-зависимостей.
// Ключи с префиксом окружения (production и preview не смешиваются). Запись стола —
// Lua-скрипт «записать, если версия та же», одна команда Redis.
export const CAS_PUT = `local cur = redis.call('GET', KEYS[1])
if cur == false then cur = '' end
if cur ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[5])
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[5])
redis.call('SET', KEYS[3], ARGV[4], 'EX', ARGV[5])
return 1`;
export const UNLOCK = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;
export const MINE_PUSH = `redis.call('LREM', KEYS[1], 0, ARGV[1])
redis.call('LPUSH', KEYS[1], ARGV[1])
redis.call('LTRIM', KEYS[1], 0, 19)
return 1`;

const TABLE_TTL = 90 * 24 * 3600; // законченные и брошенные столы живут 90 дней

/** Клиент Upstash REST: exec(['GET', 'key']) → result. */
export function upstash({ url, token, fetchImpl = fetch }) {
  return async function exec(cmd) {
    const r = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd.map(String)),
    });
    const d = await r.json();
    if (d.error) throw new Error('Redis: ' + d.error);
    return d.result;
  };
}

/** Адрес и ключ Upstash из переменных окружения (интеграция Vercel даёт KV_REST_API_*). */
export function upstashFromEnv(env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? upstash({ url, token }) : null;
}

export function redisStore({ exec, prefix = '' }) {
  const k = (s) => prefix + s;
  const parse = (s) => (s === null || s === undefined ? null : JSON.parse(s));

  return {
    kind: 'redis',

    async getTable(code) {
      const [doc, v] = await exec(['MGET', k(`t:${code}`), k(`v:${code}`)]);
      return doc === null ? null : { doc: JSON.parse(doc), version: Number(v) };
    },
    async getTables(codes) {
      if (!codes.length) return [];
      return (await exec(['MGET', ...codes.map((c) => k(`t:${c}`))])).map(parse);
    },
    async putTable(doc, expected, meta = '') {
      const r = await exec(['EVAL', CAS_PUT, 3, k(`v:${doc.code}`), k(`t:${doc.code}`), k(`m:${doc.code}`),
        expected === null ? '' : String(expected), String(doc.version), JSON.stringify(doc), meta, TABLE_TTL]);
      return Number(r) === 1;
    },
    async poll(code) {
      const [v, m, lock] = await exec(['MGET', k(`v:${code}`), k(`m:${code}`), k(`lock:${code}`)]);
      return v === null ? null : { version: Number(v), meta: m || '', locked: lock !== null };
    },
    async lock(code, token, ttlMs) {
      return (await exec(['SET', k(`lock:${code}`), token, 'NX', 'PX', ttlMs])) === 'OK';
    },
    async unlock(code, token) {
      await exec(['EVAL', UNLOCK, 1, k(`lock:${code}`), token]);
    },

    async addHistory(entry) {
      return (await exec(['SET', k(`hist:${entry.id}`), JSON.stringify(entry), 'NX'])) === 'OK';
    },
    async setCompanyLast(entry) {
      const prev = parse(await exec(['GET', k(`company:${entry.company}`)]));
      if (prev && prev.finishedAt > entry.finishedAt) return;
      await exec(['SET', k(`company:${entry.company}`), JSON.stringify(entry)]);
    },
    async companyLast(company) {
      return parse(await exec(['GET', k(`company:${company}`)]));
    },

    async getUser(id) {
      return parse(await exec(['GET', k(`user:${id}`)]));
    },
    async putUser(user) {
      await exec(['SET', k(`user:${user.id}`), JSON.stringify(user)]);
      await exec(['SADD', k('users'), user.id]);
    },
    async listUsers() {
      const ids = await exec(['SMEMBERS', k('users')]);
      if (!ids.length) return [];
      return (await exec(['MGET', ...ids.map((id) => k(`user:${id}`))])).map(parse).filter(Boolean);
    },
    async userIdByCode(hash) {
      return exec(['GET', k(`code:${hash}`)]);
    },
    async setCode(hash, userId) {
      await exec(['SET', k(`code:${hash}`), userId]);
    },
    async delCode(hash) {
      await exec(['DEL', k(`code:${hash}`)]);
    },

    async addMyTable(userId, code) {
      await exec(['EVAL', MINE_PUSH, 1, k(`mine:${userId}`), code]);
    },
    async myTables(userId) {
      return exec(['LRANGE', k(`mine:${userId}`), 0, 19]);
    },
  };
}
