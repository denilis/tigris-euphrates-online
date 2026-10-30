// Хранилище в памяти процесса: тесты и локальный сервер. Тот же договор, что у Redis
// (server/store-redis.js): документы хранятся строками JSON, запись стола — сравнение версии.
export function memoryStore() {
  const kv = new Map(); // ключ → { value, until }
  const lists = new Map();
  const alive = (k) => {
    const e = kv.get(k);
    if (e && e.until && e.until < Date.now()) kv.delete(k);
    return kv.get(k)?.value ?? null;
  };
  const set = (k, value, ttlMs) => kv.set(k, { value, until: ttlMs ? Date.now() + ttlMs : 0 });

  return {
    kind: 'memory',

    async getTable(code) {
      const doc = alive(`t:${code}`), v = alive(`v:${code}`);
      return doc === null ? null : { doc: JSON.parse(doc), version: Number(v) };
    },
    async getTables(codes) {
      return codes.map((c) => alive(`t:${c}`)).map((d) => (d === null ? null : JSON.parse(d)));
    },
    /** Записать стол, если его версия в базе равна expected (null — стола ещё нет). */
    async putTable(doc, expected, meta = '') {
      const cur = alive(`v:${doc.code}`);
      if ((cur ?? '') !== (expected === null ? '' : String(expected))) return false;
      set(`t:${doc.code}`, JSON.stringify(doc));
      set(`v:${doc.code}`, String(doc.version));
      set(`m:${doc.code}`, meta);
      return true;
    },
    async poll(code) {
      const v = alive(`v:${code}`);
      if (v === null) return null;
      return { version: Number(v), meta: alive(`m:${code}`) || '', locked: alive(`lock:${code}`) !== null };
    },
    async lock(code, token, ttlMs) {
      if (alive(`lock:${code}`) !== null) return false;
      set(`lock:${code}`, token, ttlMs);
      return true;
    },
    async unlock(code, token) {
      if (alive(`lock:${code}`) === token) kv.delete(`lock:${code}`);
    },

    async delTable(code) {
      for (const p of ['t', 'v', 'm', 'lock']) kv.delete(`${p}:${code}`);
    },

    /** Счётчик попыток: сколько раз ключ назвали за окно ttlMs (окно открывается первым обращением). */
    async hit(key, ttlMs) {
      const e = kv.get(`rl:${key}`);
      const live = e && e.until >= Date.now() ? e : null;
      const n = (live ? Number(live.value) : 0) + 1;
      kv.set(`rl:${key}`, { value: String(n), until: live ? live.until : Date.now() + ttlMs });
      return n;
    },

    /** Запись истории один раз (повтор ничего не меняет); возвращает true при первой записи. */
    async addHistory(entry) {
      if (alive(`hist:${entry.id}`) !== null) return false;
      set(`hist:${entry.id}`, JSON.stringify(entry));
      lists.set('hist', [...(lists.get('hist') || []), entry.id]);
      return true;
    },
    /** Все записанные партии в любом порядке. */
    async listHistory() {
      return (lists.get('hist') || []).map((id) => JSON.parse(alive(`hist:${id}`)));
    },
    async setCompanyLast(entry) {
      const prev = alive(`company:${entry.company}`);
      if (prev && JSON.parse(prev).finishedAt > entry.finishedAt) return;
      set(`company:${entry.company}`, JSON.stringify(entry));
    },
    async companyLast(company) {
      const e = alive(`company:${company}`);
      return e ? JSON.parse(e) : null;
    },

    async getUser(id) {
      const u = alive(`user:${id}`);
      return u ? JSON.parse(u) : null;
    },
    async putUser(user) {
      set(`user:${user.id}`, JSON.stringify(user));
      const ids = lists.get('users') || [];
      if (!ids.includes(user.id)) lists.set('users', [...ids, user.id]);
    },
    async listUsers() {
      return (lists.get('users') || []).map((id) => JSON.parse(alive(`user:${id}`)));
    },
    async userIdByCode(hash) {
      return alive(`code:${hash}`);
    },
    async setCode(hash, userId) {
      set(`code:${hash}`, userId);
    },
    async delCode(hash) {
      kv.delete(`code:${hash}`);
    },

    async addMyTable(userId, code) {
      const l = (lists.get(`mine:${userId}`) || []).filter((c) => c !== code);
      lists.set(`mine:${userId}`, [code, ...l].slice(0, 20));
    },
    async myTables(userId) {
      return lists.get(`mine:${userId}`) || [];
    },
  };
}
