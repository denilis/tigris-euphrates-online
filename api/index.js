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
// картинка итога в чат (этап 4, 04.11) весит сотни килобайт: больше можно только этому адресу;
// сам сервер пропускает до 2,5 МБ картинки (server/photo.js), Vercel принимает до 4,5 МБ
const MAX_PHOTO_BODY = 3600 * 1024;
const PHOTO_ROUTE = /^tables\/[A-Za-z0-9]{6}\/photo$/;
export const bodyLimit = (route) => (PHOTO_ROUTE.test(route) ? MAX_PHOTO_BODY : MAX_BODY);
class TooBig extends Error {}

async function readBody(req, limit) {
  // Vercel сам разбирает JSON в req.body; локальный сервер отдаёт поток
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new TooBig();
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

/**
 * Ключ адреса для лимита попыток. IPv6 считаем по сети /64: у одного клиента их миллиарды,
 * и смена хвоста адреса не должна давать новый счётчик. IPv4 внутри IPv6 приводится к IPv4.
 */
export function ipKey(ip) {
  if (!ip.includes(':')) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return groups.slice(0, 4).map((g) => g.toLowerCase().padStart(4, '0')).join(':') + '::/64';
}

/** Обработчик с заданным окружением (тесты подставляют своё). */
export function makeHandler(env, store) {
  const exec = upstashFromEnv(env);
  const onVercel = Boolean(env.VERCEL_ENV);
  const app = createApp({
    store: store || (exec ? redisStore({ exec, prefix: `${env.VERCEL_ENV || 'local'}:` }) : memoryStore()),
    env,
    // промежуток между действиями бота (06.11 было 2-4 с «на раздумья»; 08.11 Денис: не замедлять
    // бота, а показывать ход): 1,5-1,8 с, ровно чтобы досмотреть, как садится тайл (TRAIL_LAND_MS
    // 1500); расчет от паузы не зависит; BOT_PACE=off — ходит сразу
    botPace: env.BOT_PACE === 'off' ? null : { min: 1500, max: 1800 },
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
      const limit = bodyLimit(route);
      if (Number(req.headers['content-length']) > limit) return tooBig();
      try {
        body = await readBody(req, limit);
        // платформа может разобрать тело сама и без Content-Length: размер сверяем и после разбора
        if (JSON.stringify(body).length > limit) return tooBig();
      } catch (e) {
        return e instanceof TooBig ? tooBig() : send(res, 400, { error: 'bad-json', message: 'Неверный запрос' });
      }
    }
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    // Vercel сам ставит адрес клиента в эти заголовки; первый в списке — клиент
    const ip = ipKey(String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim());
    const r = await app.call({ method: req.method, path: route, query: Object.fromEntries(url.searchParams), body, token, ip });
    if (r.body?.file) {
      // <img> не шлет токен, поэтому фото открывается без входа, по случайному номеру.
      // Номер меняется с каждым новым фото, так что картинка может лежать в браузере вечно
      res.statusCode = 200;
      res.setHeader('Content-Type', r.body.file.type);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(Buffer.from(r.body.file.data, 'base64'));
      return;
    }
    send(res, r.status, r.body);
  };
}

let handler = null;
export default function vercelHandler(req, res) {
  handler ??= makeHandler(process.env);
  return handler(req, res);
}
