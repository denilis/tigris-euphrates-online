// Все маршруты API. Без привязки к Vercel и Node HTTP: call({ method, path, query, body, token })
// → { status, body }. Функция Vercel (api/index.js) и локальный сервер (dev/server.js) — тонкие
// переходники. Запись стола атомарна по версии: два хода в один стол не портят партию.
import { randomBytes } from 'node:crypto';
import { readSession, signSession, normalizeCode, codeHash, newCode, newTableCode } from './auth.js';
import {
  createTable, sit, leave, setHero, setOptions, setSeatCount, setSeatKind, setBot, moveSeat,
  start, submit, rematch, close, historyEntry, botDue, seatOfUser, TableError, undo, confirmDue, autoConfirm,
} from '../game/table.js';
import { viewFor } from '../game/view.js';
import { botStep } from '../game/bots.js';
import { companyKey } from '../game/order.js';
import { ENGINE } from '../game/vendor/version.js';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const http = (status, code, message) => {
  throw new HttpError(status, code, message);
};

const ADMIN_ID = 'u-admin';
const LOCK_MS = 30000;
// метка стола для опроса: решает бот или ждет окно подтверждения (c<срок>), которое
// завершит любой клиент через bot-tick, когда срок выйдет
const meta = (t) => (botDue(t) !== null ? 'bot' : t.status === 'playing' && t.game?.confirmBy ? `c${t.game.confirmBy}` : '');
const due = (m, at) => m === 'bot' || (m[0] === 'c' && at >= Number(m.slice(1)));
const publicUser = (u) => ({ id: u.id, name: u.name, admin: Boolean(u.admin) });
const int = (v) => (Number.isInteger(Number(v)) ? Number(v) : 0);

export function createApp({ store, env = {}, now = () => Date.now(), botOptions = {} }) {
  const secret = env.SESSION_SECRET, pepper = env.CODE_PEPPER;
  const adminCode = normalizeCode(env.ADMIN_CODE || '');
  const botBudget = Number(env.BOT_BUDGET_MS) || 20000;

  // --- вход

  async function auth(token, { light = false } = {}) {
    if (!secret || !pepper) http(500, 'not-configured', 'Сервер не настроен: нет SESSION_SECRET или CODE_PEPPER');
    const s = readSession(token, secret);
    if (!s) http(401, 'no-session', 'Нужен код активации');
    if (light) return { id: s.userId };
    const u = await store.getUser(s.userId);
    if (!u || u.revoked) http(401, 'revoked', 'Код отозван, попросите новый у Дениса');
    return u;
  }
  const needAdmin = (u) => u.admin || http(403, 'not-admin', 'Это может сделать только Денис');

  async function activate(body) {
    if (!secret || !pepper) http(500, 'not-configured', 'Сервер не настроен');
    const code = normalizeCode(body.code);
    if (!code) http(401, 'bad-code', 'Код не подошёл');
    let user;
    if (adminCode && code === adminCode) {
      user = await store.getUser(ADMIN_ID);
      if (!user) {
        user = { id: ADMIN_ID, name: env.ADMIN_NAME || 'Денис', admin: true, revoked: false, createdAt: now() };
        await store.putUser(user);
      }
    } else {
      const id = await store.userIdByCode(codeHash(code, pepper));
      user = id && (await store.getUser(id));
      if (!user || user.revoked) http(401, 'bad-code', 'Код не подошёл');
    }
    return { token: signSession(user.id, secret, now()), user: publicUser(user) };
  }

  async function adminUsers(method, rest, body, u) {
    needAdmin(u);
    if (method === 'GET' && !rest.length) {
      return (await store.listUsers()).map((x) => ({ ...publicUser(x), revoked: Boolean(x.revoked), createdAt: x.createdAt }));
    }
    if (method === 'POST' && !rest.length) {
      const name = String(body.name || '').trim();
      if (!name || name.length > 30) http(400, 'bad-name', 'Имя от 1 до 30 знаков');
      const id = 'u-' + randomBytes(6).toString('hex');
      const code = newCode();
      const hash = codeHash(code, pepper);
      await store.setCode(hash, id);
      const user = { id, name, admin: false, revoked: false, codeHash: hash, createdAt: now() };
      await store.putUser(user);
      return { user: publicUser(user), code };
    }
    const [id, op] = rest;
    const user = await store.getUser(id);
    if (!user || user.admin) http(404, 'no-user', 'Нет такого игрока');
    if (method === 'POST' && op === 'revoke') {
      if (user.codeHash) await store.delCode(user.codeHash);
      await store.putUser({ ...user, revoked: true, codeHash: null });
      return { ok: true };
    }
    if (method === 'POST' && op === 'code') {
      if (user.codeHash) await store.delCode(user.codeHash);
      const code = newCode();
      const hash = codeHash(code, pepper);
      await store.setCode(hash, id);
      await store.putUser({ ...user, revoked: false, codeHash: hash });
      return { code };
    }
    http(404, 'no-route', 'Нет такого адреса');
  }

  // --- столы

  async function load(code) {
    const cur = await store.getTable(code);
    if (!cur) http(404, 'no-table', 'Нет такого стола');
    return cur;
  }

  /** Итог законченной партии в историю: один раз, повтор безопасен. */
  async function ensureHistory(t, version) {
    if (t.status !== 'over' || t.game.historySaved) return;
    const e = historyEntry(t);
    await store.addHistory(e);
    await store.setCompanyLast(e);
    t.game.historySaved = true;
    t.version = version + 1;
    if (!(await store.putTable(t, version, meta(t)))) t.version = version; // не вышло: допишет следующий запрос
  }

  async function newTable(u) {
    for (let k = 0; k < 5; k++) {
      const t = createTable({ code: newTableCode(), host: { userId: u.id, name: u.name }, now: now() });
      if (await store.putTable(t, null, meta(t))) {
        await store.addMyTable(u.id, t.code);
        return { code: t.code, view: viewFor(t, u.id, { now: now() }) };
      }
    }
    http(500, 'no-code', 'Не удалось подобрать код стола');
  }

  async function myTables(u) {
    const codes = await store.myTables(u.id);
    const docs = await store.getTables(codes);
    return docs.filter(Boolean).map((t) => ({
      code: t.code, status: t.status, updatedAt: t.updatedAt, next: t.next || null,
      me: seatOfUser(t, u.id)?.id ?? null,
      toMove: t.game?.toMove ?? null,
      seats: t.seats.map((s) => ({ id: s.id, kind: s.kind, name: s.name, hero: s.hero })),
    }));
  }

  const ACTIONS = {
    sit: (t, u, b) => sit(t, { userId: u.id, name: u.name }, b.seat, now()),
    leave: (t, u) => leave(t, u.id, now()),
    hero: (t, u, b) => setHero(t, u.id, b.seat, b.hero, now()),
    options: (t, u, b) => setOptions(t, u.id, b.options || {}, now()),
    seatCount: (t, u, b) => setSeatCount(t, u.id, b.n, now()),
    seatKind: (t, u, b) => setSeatKind(t, u.id, b.seat, b.kind, now()),
    bot: (t, u, b) => setBot(t, u.id, b.seat, b.settings || {}, now()),
    moveSeat: (t, u, b) => moveSeat(t, u.id, b.seat, b.to, now()),
    move: (t, u, b) => submit(t, u.id, { version: b.version, index: b.index }, { now: now() }),
    undo: (t, u, b) => undo(t, u.id, { version: b.version }, { now: now() }),
    close: (t, u) => close(t, u.id, now()),
    async start(t, u) {
      const humans = t.seats.filter((s) => s.kind === 'human').map((s) => s.userId);
      const last = t.options.order === 'loser' && humans.every(Boolean) ? await store.companyLast(companyKey(humans)) : null;
      start(t, u.id, { last, now: now() });
    },
    async rematch(t, u) {
      if (t.next) return;
      let code;
      for (let k = 0; k < 5 && !code; k++) {
        const c = newTableCode();
        if (!(await store.getTable(c))) code = c;
      }
      if (!code) http(500, 'no-code', 'Не удалось подобрать код стола');
      const { created } = rematch(t, u.id, { code, now: now() });
      if (!(await store.putTable(created, null, meta(created)))) http(409, 'stale', 'Реванш уже создан, обновите');
      for (const s of created.seats) if (s.kind === 'human') await store.addMyTable(s.userId, created.code);
    },
  };

  async function act(code, u, body) {
    const { doc: t, version } = await load(code);
    const fn = ACTIONS[body.action];
    if (!fn) http(400, 'bad-action', 'Неизвестное действие');
    await fn(t, u, body);
    if (!(await store.putTable(t, version, meta(t)))) http(409, 'stale', 'Стол уже изменился, обновите');
    if (body.action === 'sit') await store.addMyTable(u.id, code);
    if (t.status === 'over') await ensureHistory(t, t.version);
    return viewFor(t, u.id, { now: now() });
  }

  /**
   * Ходы ботов, пока решает бот и есть время, и завершение хода, у которого вышло окно
   * подтверждения; замок не даёт двум вызовам думать за одного бота.
   */
  async function botTick(code) {
    await load(code);
    const token = randomBytes(12).toString('hex');
    if (!(await store.lock(code, token, LOCK_MS))) return { moved: 0, locked: true };
    let moved = 0;
    const t0 = now();
    try {
      while (now() - t0 < botBudget) {
        const cur = await store.getTable(code);
        if (!cur) break;
        if (confirmDue(cur.doc, now())) autoConfirm(cur.doc, { now: now() });
        else if (botDue(cur.doc) !== null) await botStep(cur.doc, { now: now(), ...botOptions });
        else break;
        if (!(await store.putTable(cur.doc, cur.version, meta(cur.doc)))) break;
        moved++;
        if (cur.doc.status === 'over') await ensureHistory(cur.doc, cur.doc.version);
      }
    } finally {
      await store.unlock(code, token);
    }
    const p = await store.poll(code);
    return { moved, locked: false, botDue: due(p?.meta || '', now()), version: p?.version ?? null };
  }

  // --- маршрутизация

  async function dispatch({ method, path, query, body, token }) {
    const seg = String(path || '').split('/').filter(Boolean);
    const [head, ...rest] = seg;
    if (method === 'GET' && head === 'ping') {
      return { ok: true, env: env.VERCEL_ENV || 'local', region: env.VERCEL_REGION || null, engine: ENGINE.commit.slice(0, 7), store: store.kind };
    }
    if (method === 'POST' && head === 'activate') return activate(body);
    if (head === 'tables' && rest.length === 2 && rest[1] === 'poll' && method === 'GET') {
      await auth(token, { light: true });
      const p = await store.poll(rest[0]);
      if (!p) http(404, 'no-table', 'Нет такого стола');
      return { version: p.version, botDue: due(p.meta, now()), locked: p.locked };
    }
    const u = await auth(token);
    if (method === 'GET' && head === 'me') return publicUser(u);
    if (head === 'admin' && rest[0] === 'users') return adminUsers(method, rest.slice(1), body, u);
    if (head === 'tables') {
      if (!rest.length && method === 'POST') return newTable(u);
      if (!rest.length && method === 'GET') return myTables(u);
      const [code, op] = rest;
      if (!op && method === 'GET') {
        const { doc, version } = await load(code);
        if (doc.status === 'over') await ensureHistory(doc, version);
        return viewFor(doc, u.id, { logFrom: int(query.logFrom), now: now() });
      }
      if (!op && method === 'POST') return act(code, u, body);
      if (op === 'bot-tick' && method === 'POST') return botTick(code);
    }
    http(404, 'no-route', 'Нет такого адреса');
  }

  async function call({ method = 'GET', path = '', query = {}, body = {}, token = null } = {}) {
    try {
      return { status: 200, body: await dispatch({ method, path, query: query || {}, body: body || {}, token }) };
    } catch (e) {
      if (e instanceof HttpError || e instanceof TableError) return { status: e.status, body: { error: e.code, message: e.message } };
      console.error(e);
      return { status: 500, body: { error: 'server', message: 'Ошибка сервера' } };
    }
  }

  return { call };
}
