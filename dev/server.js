// Локальный сервер для разработки: отдаёт public/ и передаёт /api/* в тот же обработчик,
// что работает на Vercel (как rewrite из vercel.json). Хранилище в памяти: всё живёт,
// пока работает сервер.
//   node dev/server.js [порт]
//   node dev/server.js [порт] --backup <файл копии> — сайт на копии базы с прода (15.11): проверка
//   восстановления и разбор на настоящих данных. Вход кодом админа ниже, коды игроков не подойдут.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHandler } from '../api/index.js';
import { memoryStore } from '../server/store-memory.js';
import { redisStore } from '../server/store-redis.js';
import { restoreCommands } from '../server/backup.js';
import { fakeUpstash } from '../test/fake-upstash.js';
import { botDue } from '../game/table.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const port = Number(process.argv[2] || process.env.PORT || 3000);
const backupAt = process.argv.indexOf('--backup');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

// локальные значения, если не заданы снаружи (на Vercel задаются в настройках проекта)
const env = {
  SESSION_SECRET: 'dev-secret', CODE_PEPPER: 'dev-pepper', ADMIN_CODE: 'DEVA-DMNN-2345', ADMIN_NAME: 'Денис',
  ...process.env,
};
const store = backupAt > 0 ? await fromBackup(process.argv[backupAt + 1]) : memoryStore();

/** База из файла копии: Redis в памяти (тот же, что в тестах), записи с приставкой production:. */
async function fromBackup(file) {
  const dump = JSON.parse(await readFile(file, 'utf8'));
  const f = fakeUpstash();
  await f.exec.pipeline(restoreCommands(dump.keys, 'production:'));
  console.log(`Копия от ${dump.at}: записей ${dump.total}`, dump.count);
  return redisStore({ exec: f.exec, prefix: 'production:' });
}
const handler = makeHandler(env, store);

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  // только для разработки: положить готовый стол (tools/dev-position.js), на Vercel этого пути нет
  if (url.pathname === '/__dev/table' && req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const t = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    await store.putTable(t, null, botDue(t) !== null ? 'bot' : '');
    for (const s of t.seats) if (s.kind === 'human' && s.userId) await store.addMyTable(s.userId, t.code);
    res.statusCode = 200;
    return res.end('ok');
  }
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    url.searchParams.set('route', url.pathname.replace(/^\/api\/?/, ''));
    req.url = '/api/index' + url.search;
    try {
      return await handler(req, res);
    } catch (e) {
      res.statusCode = 500;
      return res.end(String(e.stack || e));
    }
  }
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.join(pub, rel);
  if (!file.startsWith(pub)) { res.statusCode = 403; return res.end(); }
  try {
    const body = await readFile(file);
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache'); // правки модулей видны сразу, без жесткой перезагрузки
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('Не найдено');
  }
}).listen(port, () => console.log(`Тигр и Евфрат: http://localhost:${port}  (код админа ${env.ADMIN_CODE})`));
