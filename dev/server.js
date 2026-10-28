// Локальный сервер для разработки: отдаёт public/ и передаёт /api/* в тот же
// обработчик, что работает на Vercel (api/index.js), как это делает rewrite из vercel.json.
//   node dev/server.js [порт]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from '../api/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const port = Number(process.argv[2] || process.env.PORT || 3000);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

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
}).listen(port, () => console.log(`Тигр и Евфрат: http://localhost:${port}`));
