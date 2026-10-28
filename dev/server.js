// Локальный сервер для разработки: отдаёт public/ и передаёт /api/* в тот же обработчик,
// что работает на Vercel (как rewrite из vercel.json). Хранилище в памяти: всё живёт,
// пока работает сервер.
//   node dev/server.js [порт]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHandler } from '../api/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const port = Number(process.argv[2] || process.env.PORT || 3000);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

// локальные значения, если не заданы снаружи (на Vercel задаются в настройках проекта)
const env = {
  SESSION_SECRET: 'dev-secret', CODE_PEPPER: 'dev-pepper', ADMIN_CODE: 'DEVA-DMNN-2345', ADMIN_NAME: 'Денис',
  ...process.env,
};
const handler = makeHandler(env);

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
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
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('Не найдено');
  }
}).listen(port, () => console.log(`Тигр и Евфрат: http://localhost:${port}  (код админа ${env.ADMIN_CODE})`));
