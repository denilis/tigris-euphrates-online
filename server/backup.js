// Резервная копия базы (15.11, дорожная карта п.3): сезон, профили, рейтинг и история партий живут
// только в Upstash. Главный администратор скачивает базу частями через GET /api/admin/backup
// (у функции Vercel ответ до 4,5 МБ), сайт склеивает части в один файл. Восстановление: те же
// записи командами Redis (restoreCommands), проверка на копии: node dev/server.js 3017 --backup <файл>.

/** Формат файла копии. Меняется только вместе с restoreCommands. */
export const BACKUP_FORMAT = 1;

// ключи, которые живут секунды или минуты: присутствие, замки, счетчики попыток. В копии не нужны
const SKIP = /^(here:|lock:|rl:|presence:)/;

/**
 * Одна часть копии. exec: команда Upstash, pipeline: пачка команд одним запросом (upstash().pipeline).
 * prefix: приставка окружения ('production:'), в файл ключи идут без нее. cursor: где остановился SCAN.
 * Набирает записи, пока не наберется maxBytes; одна пачка SCAN не больше count ключей, поэтому
 * часть не уходит далеко за предел даже на больших столах (35-40 КБ) и фото.
 */
export async function dumpPage({ exec, pipeline, prefix = '', cursor = '0', maxBytes = 2_000_000, count = 10 }) {
  const keys = [];
  let bytes = 0, next = String(cursor);
  do {
    const [c, found] = await exec(['SCAN', next, 'MATCH', `${prefix}*`, 'COUNT', count]);
    next = String(c);
    const mine = found.filter((key) => !SKIP.test(key.slice(prefix.length)));
    if (!mine.length) continue;
    const meta = await pipeline(mine.flatMap((key) => [['TYPE', key], ['PTTL', key]]));
    const types = mine.map((_, i) => meta[2 * i]), ttls = mine.map((_, i) => Number(meta[2 * i + 1]));
    const read = { string: (key) => ['GET', key], list: (key) => ['LRANGE', key, 0, -1], set: (key) => ['SMEMBERS', key], hash: (key) => ['HGETALL', key] };
    const want = mine.map((key, i) => (read[types[i]] ? read[types[i]](key) : null));
    const vals = await pipeline(want.filter(Boolean));
    let j = 0;
    mine.forEach((key, i) => {
      if (!want[i]) return; // ключ успел исчезнуть (type none) или незнакомого типа
      let v = vals[j++];
      if (v === null) return;
      if (types[i] === 'hash' && Array.isArray(v)) v = Object.fromEntries(v.flatMap((x, n) => (n % 2 ? [] : [[x, v[n + 1]]])));
      const row = { k: key.slice(prefix.length), t: types[i], v };
      if (ttls[i] > 0) row.ttl = ttls[i];
      keys.push(row);
      bytes += key.length + JSON.stringify(v).length;
    });
  } while (next !== '0' && bytes < maxBytes);
  return { cursor: next, done: next === '0', keys };
}

/** Команды Redis, которые вернут записи копии под приставкой prefix. Старое значение ключа стирается. */
export function restoreCommands(rows, prefix = '') {
  const out = [];
  for (const { k, t, v, ttl } of rows) {
    const key = prefix + k;
    out.push(['DEL', key]);
    if (t === 'string') out.push(['SET', key, v]);
    else if (t === 'list' && v.length) out.push(['RPUSH', key, ...v]);
    else if (t === 'set' && v.length) out.push(['SADD', key, ...v]);
    else if (t === 'hash' && Object.keys(v).length) out.push(['HSET', key, ...Object.entries(v).flat()]);
    else if (!['list', 'set', 'hash'].includes(t)) throw new Error(`неизвестный тип ${t} у ${k}`);
    if (ttl > 0) out.push(['PEXPIRE', key, ttl]);
  }
  return out;
}

/** Склеить части в файл копии. */
export function backupFile(pages, { at = Date.now(), site = '' } = {}) {
  const keys = pages.flatMap((p) => p.keys);
  const count = {};
  for (const { k } of keys) {
    const kind = k.includes(':') ? k.slice(0, k.indexOf(':')) : k;
    count[kind] = (count[kind] || 0) + 1;
  }
  return { format: BACKUP_FORMAT, site, at: new Date(at).toISOString(), total: keys.length, count, keys };
}
