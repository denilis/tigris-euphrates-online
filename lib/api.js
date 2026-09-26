'use strict';
// Game API: one JSON request per player action. Stateless between requests — the room lives in the
// store, so any number of serverless instances can serve the same game.
const crypto = require('crypto');
const TE = require('../shared/engine');
const R = require('./rooms');
const { ApiError } = R;

const DEFAULTS = {
  onlineMs: 40 * 1000,            // a seat that has not polled for this long is shown offline…
  skipAfterMs: 75 * 1000,         // …and after this long its turn or decision can be skipped
  createLimit: 10,                // rooms one IP address may create…
  createWindowMs: 10 * 60 * 1000, // …within this window
  maxAttempts: 5,                 // retries when another request saved the room first
  cacheRooms: 200,                // rooms kept in instance memory to avoid re-reading them
  cleanupEveryMs: 10 * 60 * 1000  // abandoned rooms are purged at most this often per instance
};

const gone = msg => new ApiError(msg, 404, { gone: true });
const stale = () => new ApiError('Пока вы думали, в партии что-то изменилось — посмотрите ещё раз', 409, { stale: true });

function createApi({ store, notify, config, rng, log, ipKey, now }) {
  const cfg = Object.assign({}, DEFAULTS, config);
  const clock = now || Date.now;
  const logger = log || console;
  const announce = notify || (async () => {});
  const ipSecret = ipKey || crypto.randomBytes(32);
  const cache = new Map(); // code -> { rev, room }; Map order doubles as LRU order
  let lastCleanup = 0;

  function remember(code, rev, room) {
    cache.delete(code);
    cache.set(code, { rev, room });
    if (cache.size > cfg.cacheRooms) cache.delete(cache.keys().next().value);
  }

  // Keyed hash, so the database never holds raw IP addresses.
  function creatorOf(ip) {
    return ip ? crypto.createHmac('sha256', ipSecret).update(ip).digest('hex').slice(0, 32) : null;
  }

  function auth(p) {
    const code = R.normCode(p.code);
    const token = R.normToken(p.token);
    if (!code || !token) throw gone('Сессия устарела — войдите в комнату заново');
    return { code, tokenHash: R.hashToken(token) };
  }

  const revOf = p => (Number.isSafeInteger(p.rev) ? p.rev : undefined);

  // The room and who is around. The room data crosses the network only when this instance's cached
  // copy is out of date. Also records that the seat with tokenHash is online.
  async function load(code, tokenHash) {
    const cached = cache.get(code);
    const r = await store.sync(code, tokenHash, cached ? cached.rev : 0);
    if (!r) {
      cache.delete(code);
      return null;
    }
    let rev = r.rev, room = r.data;
    if (!room) {
      if (cached && cached.rev === rev) room = cached.room;
      else {
        // The cache is ahead of the store: the code now belongs to a new room. Read it afresh.
        const again = await store.sync(code, null, 0);
        if (!again || !again.data) {
          cache.delete(code);
          return null;
        }
        rev = again.rev;
        room = again.data;
      }
    }
    remember(code, rev, room);
    return { rev, room, seen: r.seen, now: r.now };
  }

  // Reads, changes and saves a room; when another request saved it in between, starts over.
  // change(room, seat, cur) returns the new room: the same object for "no change", null to delete it.
  async function mutate(code, tokenHash, opts, change) {
    for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
      const cur = await load(code, tokenHash);
      if (!cur) throw gone('Комната не найдена');
      const seat = R.seatOf(cur.room, tokenHash);
      if (opts.seated !== false && seat < 0) throw gone('Вы больше не в этой комнате');
      if (opts.rev !== undefined && opts.rev !== cur.rev) throw stale();
      const next = change(cur.room, seat, cur);
      if (next === cur.room) return { cur, room: cur.room, rev: cur.rev, seat };
      if (next === null) {
        if (await store.remove(code, cur.rev)) {
          cache.delete(code);
          return { cur, room: null, rev: null, seat };
        }
        continue;
      }
      const touch = opts.touch !== undefined ? opts.touch : seat >= 0 ? tokenHash : null;
      const rev = await store.save(code, cur.rev, next, R.phaseOf(next), touch);
      if (rev === null) continue;
      remember(code, rev, next);
      await announce(code, rev);
      const seen = Object.assign({}, cur.seen);
      if (touch) seen[touch] = cur.now;
      return { cur: Object.assign({}, cur, { seen }), room: next, rev, seat };
    }
    throw new ApiError('Слишком много одновременных ходов — попробуйте ещё раз', 503);
  }

  // What one seat may see. `unchanged` skips the view when the page already has this revision.
  function snapshot(room, seat, rev, seen, now, unchanged) {
    const body = {
      ok: true,
      rev,
      now,
      onlineMs: cfg.onlineMs,
      skipAfterMs: cfg.skipAfterMs,
      room: R.publicRoom(room, seat, seen, now, cfg.onlineMs)
    };
    if (unchanged) body.unchanged = true;
    else body.view = room.game ? TE.getView(room.game, seat) : null;
    return body;
  }

  const reply = out => snapshot(out.room, out.seat, out.rev, out.cur.seen, out.cur.now);

  async function cleanup() {
    lastCleanup = clock();
    return store.cleanup();
  }

  const ops = {
    async create(p, meta) {
      if (clock() - lastCleanup > cfg.cleanupEveryMs) {
        try { await cleanup(); } catch (e) { logger.warn('cleanup failed:', e.message); }
      }
      const token = R.newToken(), tokenHash = R.hashToken(token);
      const creator = creatorOf(meta.ip);
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = R.newCode();
        const room = R.createRoom({ code, name: p.name, maxPlayers: p.maxPlayers, tokenHash });
        const res = await store.create(code, room, tokenHash, creator, cfg.createLimit, cfg.createWindowMs);
        if (res === 'limited') throw new ApiError('С вашего адреса создано слишком много комнат — подождите несколько минут', 429);
        if (res === 'duplicate') continue;
        if (res !== 'ok') throw new Error(`unexpected te_create result: ${res}`);
        remember(code, 1, room);
        const t = clock();
        return Object.assign(snapshot(room, 0, 1, { [tokenHash]: t }, t), { code, token });
      }
      throw new Error('no free room code after 8 attempts');
    },

    async join(p) {
      const code = R.normCode(p.code);
      if (!code) throw new ApiError('Неверный код комнаты');
      const token = R.newToken(), tokenHash = R.hashToken(token);
      const out = await mutate(code, null, { seated: false, touch: tokenHash }, room => R.addSeat(room, p.name, tokenHash));
      out.seat = R.seatOf(out.room, tokenHash);
      return Object.assign(reply(out), { code, token });
    },

    // Brings a page up to date. Pages call it every few seconds, which also keeps their seat online.
    async sync(p) {
      const { code, tokenHash } = auth(p);
      const cur = await load(code, tokenHash);
      if (!cur) throw gone('Комната не найдена');
      const seat = R.seatOf(cur.room, tokenHash);
      if (seat < 0) throw gone('Вы больше не в этой комнате');
      return snapshot(cur.room, seat, cur.rev, cur.seen, cur.now, p.since === cur.rev);
    },

    // In the lobby the seat is freed; in a game it is kept for a return and shown offline at once.
    async leave(p) {
      const { code, tokenHash } = auth(p);
      const out = await mutate(code, tokenHash, { touch: null }, (room, seat) => (room.game ? room : R.removeSeat(room, seat)));
      if (out.room && out.room.game) await store.away(code, tokenHash, cfg.onlineMs);
      return { ok: true };
    },

    async dynasty(p) {
      const { code, tokenHash } = auth(p);
      return reply(await mutate(code, tokenHash, {}, (room, seat) => R.setDynasty(room, seat, p.dynasty)));
    },

    async start(p) {
      const { code, tokenHash } = auth(p);
      return reply(await mutate(code, tokenHash, {}, (room, seat) => R.startGame(room, seat, rng)));
    },

    async action(p) {
      const { code, tokenHash } = auth(p);
      const action = p.action;
      if (!action || typeof action !== 'object' || Array.isArray(action)) throw new ApiError('Некорректное действие');
      return reply(await mutate(code, tokenHash, { rev: revOf(p) }, (room, seat) => R.applyAction(room, seat, action, logger)));
    },

    async skip(p) {
      const { code, tokenHash } = auth(p);
      return reply(await mutate(code, tokenHash, { rev: revOf(p) }, (room, seat, cur) => R.skipAwaited(room, cur.seen, cur.now, cfg, logger)));
    },

    async rematch(p) {
      const { code, tokenHash } = auth(p);
      return reply(await mutate(code, tokenHash, { rev: revOf(p) }, room => R.rematch(room, rng)));
    }
  };

  async function handle(body, meta) {
    const op = body && typeof body === 'object' && !Array.isArray(body) && typeof body.op === 'string' ? body.op : '';
    try {
      if (!Object.prototype.hasOwnProperty.call(ops, op)) throw new ApiError('Неизвестный запрос');
      return { status: 200, body: await ops[op](body, meta || {}) };
    } catch (e) {
      if (e instanceof ApiError) return { status: e.status, body: Object.assign({ ok: false, error: e.message }, e.flags) };
      logger.error(`[api:${op}]`, e);
      return { status: 500, body: { ok: false, error: 'Ошибка сервера, попробуйте ещё раз' } };
    }
  }

  return { handle, cleanup, ping: () => store.ping(), store, config: cfg };
}

module.exports = { createApi, DEFAULTS };
