// Единственная функция Vercel: все запросы /api/* приходят сюда (rewrite в vercel.json,
// путь в параметре route) и уходят в server/routes.js. Без Upstash работает только
// локально (хранилище в памяти): на Vercel память функции не переживает вызовы.
import { createApp } from '../server/routes.js';
import { memoryStore } from '../server/store-memory.js';
import { redisStore, upstashFromEnv } from '../server/store-redis.js';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

// Игре хватает сотен байт; больше только мусор или попытка раздуть стол
const MAX_BODY = 32 * 1024;
class TooBig extends Error {}

async function readBody(req) {
  // Vercel сам разбирает JSON в req.body; локальный сервер отдаёт поток
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new TooBig();
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

/** Обработчик с заданным окружением (тесты подставляют своё). */
export function makeHandler(env, store) {
  const exec = upstashFromEnv(env);
  const onVercel = Boolean(env.VERCEL_ENV);
  const app = createApp({
    store: store || (exec ? redisStore({ exec, prefix: `${env.VERCEL_ENV || 'local'}:` }) : memoryStore()),
    env,
  });
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const route = url.searchParams.get('route') ?? url.pathname.replace(/^\/api\/?/, '');
    url.searchParams.delete('route');
    if (onVercel && !exec && !store && route !== 'ping') {
      return send(res, 503, { error: 'no-db', message: 'База не подключена: добавьте Upstash Redis в проект Vercel' });
    }
    let body = {};
    if (req.method === 'POST') {
      const tooBig = () => send(res, 413, { error: 'too-big', message: 'Слишком большой запрос' });
      if (Number(req.headers['content-length']) > MAX_BODY) return tooBig();
      try {
        body = await readBody(req);
      } catch (e) {
        return e instanceof TooBig ? tooBig() : send(res, 400, { error: 'bad-json', message: 'Неверный запрос' });
      }
    }
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    // Vercel сам ставит адрес клиента в эти заголовки; первый в списке — клиент
    const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const r = await app.call({ method: req.method, path: route, query: Object.fromEntries(url.searchParams), body, token, ip });
    send(res, r.status, r.body);
  };
}

let handler = null;
export default function vercelHandler(req, res) {
  handler ??= makeHandler(process.env);
  return handler(req, res);
}
