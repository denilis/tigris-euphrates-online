'use strict';
// Node (req, res) handlers shared by the Vercel functions in api/ and dev-server.js.
const crypto = require('crypto');

const BODY_LIMIT = 16 * 1024;

class BadRequest extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 400;
  }
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function parseJson(text) {
  if (Buffer.byteLength(text) > BODY_LIMIT) throw new BadRequest('Слишком большой запрос', 413);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new BadRequest('Некорректный JSON');
  }
}

// Vercel may hand over an already parsed body (object, string or Buffer); a plain Node server gives a stream.
async function readJson(req) {
  let body;
  try {
    body = req.body;
  } catch (e) {
    throw new BadRequest('Некорректный JSON'); // Vercel's lazy parser throws on malformed JSON
  }
  if (body !== undefined && body !== null) {
    if (Buffer.isBuffer(body)) return parseJson(body.toString('utf8'));
    if (typeof body === 'string') return parseJson(body);
    if (JSON.stringify(body).length > BODY_LIMIT) throw new BadRequest('Слишком большой запрос', 413);
    return body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new BadRequest('Слишком большой запрос', 413);
    chunks.push(chunk);
  }
  return size ? parseJson(Buffer.concat(chunks).toString('utf8')) : {};
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  const first = typeof fwd === 'string' ? fwd.split(',')[0].trim() : '';
  return first || req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || '';
}

function notConfigured(rt, res) {
  sendJson(res, 503, { ok: false, error: rt.error });
}

// POST /api/game — every player request.
async function game(rt, req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'Нужен POST-запрос' });
  }
  if (rt.error) return notConfigured(rt, res);
  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return sendJson(res, e.status || 400, { ok: false, error: e instanceof BadRequest ? e.message : 'Некорректный запрос' });
  }
  const out = await rt.api.handle(body, { ip: clientIp(req) });
  sendJson(res, out.status, out.body);
}

// GET /api/config — what the page needs to subscribe to Realtime (the publishable key is public by design).
function config(rt, req, res) {
  if (rt.error) return notConfigured(rt, res);
  sendJson(res, 200, rt.publicConfig);
}

// GET /api/health — deployment check: which store is used and whether the database answers.
async function health(rt, req, res) {
  if (rt.error) return sendJson(res, 503, { ok: false, store: rt.storeKind, error: rt.error });
  const started = Date.now();
  try {
    await rt.api.ping();
    sendJson(res, 200, { ok: true, store: rt.storeKind, realtime: !!rt.publicConfig.realtime, dbMs: Date.now() - started });
  } catch (e) {
    console.error('[health]', e);
    sendJson(res, 503, {
      ok: false,
      store: rt.storeKind,
      realtime: !!rt.publicConfig.realtime,
      error: 'База данных не отвечает или миграция не применена'
    });
  }
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// GET /api/cron — daily purge of abandoned rooms (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`).
async function cron(rt, req, res) {
  if (rt.error) return notConfigured(rt, res);
  if (rt.cronSecret && !safeEqual(req.headers.authorization || '', `Bearer ${rt.cronSecret}`)) {
    return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  }
  try {
    const deleted = await rt.api.cleanup();
    sendJson(res, 200, { ok: true, deleted });
  } catch (e) {
    console.error('[cron]', e);
    sendJson(res, 500, { ok: false, error: 'cleanup failed' });
  }
}

module.exports = { game, config, health, cron, readJson, clientIp, sendJson, BODY_LIMIT };
