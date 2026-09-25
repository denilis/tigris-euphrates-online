'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const TE = require('./shared/engine');

// ─── CONFIG ────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  skipAfterMs: 45 * 1000,       // an offline player's decision can be skipped after this
  idleRoomMs: 30 * 60 * 1000,   // rooms with nobody connected are removed after this
  sweepMs: 60 * 1000,
  maxRooms: 500,
  rateWindowMs: 5000,
  rateMax: 60                   // socket events per window
};

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-Z0-9]{6}$/;
const TOKEN_RE = /^[a-f0-9]{32}$/;
const NAME_MAX = 20;

// ─── HELPERS ───────────────────────────────────────────────────────────────────

function cleanName(value, fallback) {
  const s = (typeof value === 'string' ? value : '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  return s || fallback;
}

function uniqueName(name, seats) {
  const taken = new Set(seats.map(s => s.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let k = 2; ; k++) {
    const candidate = `${name.slice(0, NAME_MAX - 3)} ${k}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

const cryptoRng = () => crypto.randomInt(0, 0x100000000) / 0x100000000;

// ─── APP ───────────────────────────────────────────────────────────────────────

function createApp(options) {
  const cfg = Object.assign({}, DEFAULTS, options);
  const rooms = new Map(); // code -> room

  const app = express();
  app.disable('x-powered-by');
  app.get('/engine.js', (req, res) => res.sendFile(path.join(__dirname, 'shared', 'engine.js')));
  app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.size }));
  app.use(express.static(path.join(__dirname, 'public')));

  const server = http.createServer(app);
  const io = new Server(server, {
    maxHttpBufferSize: 32 * 1024,
    // Same-origin by default; set CORS_ORIGIN (comma-separated) to host the client elsewhere.
    cors: process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(',').map(s => s.trim()) } : undefined
  });

  // ─── ROOMS ───────────────────────────────────────────────────────────────────

  function genCode() {
    let code;
    do {
      code = Array.from({ length: 6 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
    } while (rooms.has(code));
    return code;
  }

  function newSeat(name, dynasty, socketId) {
    return { token: crypto.randomBytes(16).toString('hex'), name, dynasty, socketId, offlineSince: null };
  }

  function freeDynasty(room) {
    return TE.DYNASTIES.find(d => !room.seats.some(s => s.dynasty === d));
  }

  function publicRoom(room, you) {
    return {
      code: room.code,
      maxPlayers: room.maxPlayers,
      host: room.host,
      you,
      started: !!room.game,
      seats: room.seats.map(s => ({
        name: s.name, dynasty: s.dynasty, online: !!s.socketId, offlineSince: s.offlineSince
      }))
    };
  }

  function sendState(room) {
    room.seats.forEach((seat, i) => {
      if (!seat.socketId) return;
      io.to(seat.socketId).emit('state', {
        room: publicRoom(room, i),
        view: room.game ? TE.getView(room.game, i) : null,
        skipAfterMs: cfg.skipAfterMs,
        now: Date.now()
      });
    });
  }

  function touch(room) { room.lastActivity = Date.now(); }

  function removeRoom(room) {
    rooms.delete(room.code);
  }

  // Lobby seats vanish on leave; in-game seats stay so the player can come back.
  function releaseSeat(room, seatIndex) {
    const seat = room.seats[seatIndex];
    if (!seat) return;
    if (room.game) {
      seat.socketId = null;
      seat.offlineSince = Date.now();
    } else {
      room.seats.splice(seatIndex, 1);
      if (room.host === seatIndex) room.host = 0;
      else if (room.host > seatIndex) room.host--;
    }
    if (!room.seats.length || (!room.game && !room.seats.some(s => s.socketId))) removeRoom(room);
    else sendState(room);
  }

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (!room.seats.some(s => s.socketId) && now - room.lastActivity > cfg.idleRoomMs) removeRoom(room);
    }
  }, cfg.sweepMs);
  sweeper.unref();

  // ─── SOCKETS ─────────────────────────────────────────────────────────────────

  io.on('connection', socket => {
    let binding = null; // { room, token }
    const rate = { start: Date.now(), count: 0 };

    function seatIndex() {
      if (!binding) return -1;
      return binding.room.seats.findIndex(s => s.token === binding.token);
    }

    function bind(room, seat) {
      binding = { room, token: seat.token };
      seat.socketId = socket.id;
      seat.offlineSince = null;
      touch(room);
    }

    function unbind() {
      if (!binding) return;
      const { room } = binding;
      const i = seatIndex();
      binding = null;
      if (i >= 0 && room.seats[i].socketId === socket.id && rooms.get(room.code) === room) releaseSeat(room, i);
    }

    function on(event, handler) {
      socket.on(event, (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        const now = Date.now();
        if (now - rate.start > cfg.rateWindowMs) { rate.start = now; rate.count = 0; }
        if (++rate.count > cfg.rateMax) return reply({ ok: false, error: 'Слишком много запросов, подождите' });
        try {
          handler(payload && typeof payload === 'object' ? payload : {}, reply);
        } catch (e) {
          console.error(`[${event}]`, e);
          reply({ ok: false, error: 'Ошибка сервера' });
        }
      });
    }

    function requireRoom(reply) {
      const i = seatIndex();
      if (i < 0 || rooms.get(binding.room.code) !== binding.room) {
        binding = null;
        reply({ ok: false, error: 'Вы не в комнате' });
        return null;
      }
      touch(binding.room);
      return { room: binding.room, seat: i };
    }

    on('room:create', (p, reply) => {
      if (rooms.size >= cfg.maxRooms) return reply({ ok: false, error: 'Сервер перегружен, попробуйте позже' });
      unbind();
      const maxPlayers = [2, 3, 4].includes(p.maxPlayers) ? p.maxPlayers : 4;
      const room = { code: genCode(), maxPlayers, host: 0, seats: [], game: null, lastActivity: Date.now() };
      const seat = newSeat(cleanName(p.name, 'Игрок 1'), TE.DYNASTIES[0], socket.id);
      room.seats.push(seat);
      rooms.set(room.code, room);
      bind(room, seat);
      reply({ ok: true, code: room.code, token: seat.token });
      sendState(room);
    });

    on('room:join', (p, reply) => {
      const code = typeof p.code === 'string' ? p.code.trim().toUpperCase() : '';
      if (!CODE_RE.test(code)) return reply({ ok: false, error: 'Неверный код комнаты' });
      const room = rooms.get(code);
      if (!room) return reply({ ok: false, error: 'Комната не найдена' });
      if (room.game) return reply({ ok: false, error: 'Игра уже идёт' });
      if (room.seats.length >= room.maxPlayers) return reply({ ok: false, error: 'Комната заполнена' });
      unbind();
      const name = uniqueName(cleanName(p.name, `Игрок ${room.seats.length + 1}`), room.seats);
      const seat = newSeat(name, freeDynasty(room), socket.id);
      room.seats.push(seat);
      bind(room, seat);
      reply({ ok: true, code: room.code, token: seat.token });
      sendState(room);
    });

    on('room:rejoin', (p, reply) => {
      const code = typeof p.code === 'string' ? p.code.trim().toUpperCase() : '';
      const token = typeof p.token === 'string' ? p.token : '';
      const room = CODE_RE.test(code) && TOKEN_RE.test(token) ? rooms.get(code) : null;
      const seat = room && room.seats.find(s => s.token === token);
      if (!seat) return reply({ ok: false, error: 'Место в комнате не найдено' });
      const previous = seat.socketId;
      if (binding && binding.token !== token) unbind();
      bind(room, seat); // take the seat over before the old tab disconnects, so it cannot release it
      if (previous && previous !== socket.id) {
        const old = io.sockets.sockets.get(previous);
        if (old) {
          old.emit('kicked', { msg: 'Игра открыта в другой вкладке' });
          old.disconnect(true);
        }
      }
      reply({ ok: true, code: room.code, token });
      sendState(room);
    });

    on('room:leave', (p, reply) => {
      unbind();
      reply({ ok: true });
    });

    on('room:dynasty', (p, reply) => {
      const ctx = requireRoom(reply);
      if (!ctx) return;
      const { room, seat } = ctx;
      if (room.game) return reply({ ok: false, error: 'Игра уже началась' });
      if (!TE.DYNASTIES.includes(p.dynasty)) return reply({ ok: false, error: 'Неизвестная династия' });
      if (room.seats.some((s, i) => i !== seat && s.dynasty === p.dynasty)) {
        return reply({ ok: false, error: 'Эту династию уже выбрал другой игрок' });
      }
      room.seats[seat].dynasty = p.dynasty;
      reply({ ok: true });
      sendState(room);
    });

    on('room:start', (p, reply) => {
      const ctx = requireRoom(reply);
      if (!ctx) return;
      const { room, seat } = ctx;
      if (room.game) return reply({ ok: false, error: 'Игра уже идёт' });
      if (seat !== room.host) return reply({ ok: false, error: 'Начать игру может только создатель комнаты' });
      if (room.seats.length < TE.MIN_PLAYERS) return reply({ ok: false, error: 'Нужно минимум 2 игрока' });
      room.game = TE.createGame({
        names: room.seats.map(s => s.name),
        dynasties: room.seats.map(s => s.dynasty),
        rng: cryptoRng
      });
      reply({ ok: true });
      sendState(room);
    });

    on('game:action', (p, reply) => {
      const ctx = requireRoom(reply);
      if (!ctx) return;
      const { room, seat } = ctx;
      if (!room.game) return reply({ ok: false, error: 'Игра не начата' });
      const res = TE.applyAction(room.game, seat, p);
      if (!res.ok) {
        if (res.internal) console.error('engine error', res.internal, JSON.stringify(p));
        return reply({ ok: false, error: res.error });
      }
      room.game = res.state;
      reply({ ok: true });
      sendState(room);
    });

    // Moves the game on for a player who went offline: safe default decisions or ending the turn.
    on('game:skip', (p, reply) => {
      const ctx = requireRoom(reply);
      if (!ctx) return;
      const { room } = ctx;
      if (!room.game || room.game.phase !== 'play') return reply({ ok: false, error: 'Нечего пропускать' });
      const target = TE.awaiting(room.game);
      const seat = room.seats[target];
      if (seat.socketId) return reply({ ok: false, error: 'Игрок в сети' });
      if (Date.now() - seat.offlineSince < cfg.skipAfterMs) return reply({ ok: false, error: 'Подождите ещё немного' });
      let game = room.game;
      for (let k = 0; k < 20 && game.phase === 'play' && TE.awaiting(game) === target; k++) {
        const res = TE.applyAction(game, target, TE.defaultAction(game));
        if (!res.ok) { console.error('skip failed', res.error, res.internal); break; }
        game = res.state;
      }
      room.game = game;
      reply({ ok: true });
      sendState(room);
    });

    on('game:rematch', (p, reply) => {
      const ctx = requireRoom(reply);
      if (!ctx) return;
      const { room } = ctx;
      if (!room.game || room.game.phase !== 'over') return reply({ ok: false, error: 'Игра ещё не окончена' });
      room.game = TE.createGame({
        names: room.seats.map(s => s.name),
        dynasties: room.seats.map(s => s.dynasty),
        rng: cryptoRng
      });
      reply({ ok: true });
      sendState(room);
    });

    socket.on('disconnect', () => {
      try { unbind(); } catch (e) { console.error('[disconnect]', e); }
    });
  });

  return {
    app, server, io, rooms,
    close() {
      clearInterval(sweeper);
      io.close();
      server.close();
    }
  };
}

if (require.main === module) {
  const { server } = createApp();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => {
    console.log(`Tigris & Euphrates server running on port ${port}`);
    console.log(`Open http://localhost:${port}`);
  });
}

module.exports = { createApp };
