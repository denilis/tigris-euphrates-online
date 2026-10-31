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
  const lines = (s) => (s ? s.trim().split('\n').map((x) => JSON.parse(x)) : []);

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
    /** Записать игрока, только если запись не менялась с момента чтения: иначе false. */
    async casUser(before, after) {
      if (alive(`user:${before.id}`) !== JSON.stringify(before)) return false;
      set(`user:${before.id}`, JSON.stringify(after));
      return true;
    },
    async listUsers() {
      return (lists.get('users') || []).map((id) => JSON.parse(alive(`user:${id}`)));
    },
    async userIdByCode(hash) {
      return alive(`code:${hash}`);
    },
    /** Занять код за человеком; false, если код уже чей-то. */
    async claimCode(hash, userId) {
      if (alive(`code:${hash}`) !== null) return false;
      set(`code:${hash}`, userId);
      return true;
    },
    async delCode(hash) {
      kv.delete(`code:${hash}`);
    },

    /** Фото игрока по случайному номеру. */
    async getAvatar(token) {
      const a = alive(`ava:${token}`);
      return a ? JSON.parse(a) : null;
    },
    async setAvatar(token, value) {
      set(`ava:${token}`, JSON.stringify(value));
    },
    async delAvatar(token) {
      kv.delete(`ava:${token}`);
    },

    /** Настройки экрана партии у игрока. */
    async getPrefs(id) {
      const p = alive(`prefs:${id}`);
      return p ? JSON.parse(p) : null;
    },
    async setPrefs(id, value) {
      set(`prefs:${id}`, JSON.stringify(value));
    },

    /** Турниры, кроме встроенного сезона. */
    async putTour(t) {
      set(`tour:${t.id}`, JSON.stringify(t));
      const ids = lists.get('tours') || [];
      if (!ids.includes(t.id)) lists.set('tours', [...ids, t.id]);
    },
    async listTours() {
      return (lists.get('tours') || []).map((id) => JSON.parse(alive(`tour:${id}`)));
    },

    async addMyTable(userId, code) {
      const l = (lists.get(`mine:${userId}`) || []).filter((c) => c !== code);
      lists.set(`mine:${userId}`, [code, ...l].slice(0, 20));
    },
    async myTables(userId) {
      return lists.get(`mine:${userId}`) || [];
    },

    /** Отметка «на сайте» живет ttlMs. */
    async setPresence(id, value, ttlMs) {
      set(`pres:${id}`, JSON.stringify(value), ttlMs);
    },
    /** Отметки людей ids (null, если нет) и письма me; одна команда на все. */
    async readPresence(ids, me) {
      const marks = ids.map((id) => alive(`pres:${id}`)).map((v) => (v === null ? null : JSON.parse(v)));
      return { marks, letters: lines(alive(`inbox:${me}`)) };
    },
    /** Письмо человеку: приглашение или ответ на него. Лежит, пока не ответят или не выйдет срок. */
    async pushInbox(id, value, ttlMs) {
      set(`inbox:${id}`, (alive(`inbox:${id}`) || '') + JSON.stringify(value) + '\n', ttlMs);
    },
    /** Убрать одно письмо. */
    async dropLetter(me, letterId, ttlMs) {
      const rest = lines(alive(`inbox:${me}`)).filter((m) => m.id !== letterId);
      if (rest.length) set(`inbox:${me}`, rest.map((m) => JSON.stringify(m) + '\n').join(''), ttlMs);
      else kv.delete(`inbox:${me}`);
    },
  };
}
