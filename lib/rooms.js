'use strict';
// Room rules: seats, lobby, starting and moving a game on. Pure functions over plain JSON rooms —
// they never mutate their input, so a room can be cached, stored and compared by reference.
const crypto = require('crypto');
const TE = require('../shared/engine');

const ROOM_VERSION = 1;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-Z0-9]{6}$/;
const TOKEN_RE = /^[a-f0-9]{32}$/;
const NAME_MAX = 20;

// An error whose message is safe to show to the player.
class ApiError extends Error {
  constructor(message, status, flags) {
    super(message);
    this.status = status || 400;
    this.flags = flags || null; // e.g. { gone: true } or { stale: true } for the client
  }
}

// ─── IDENTIFIERS ───────────────────────────────────────────────────────────────

function newCode() {
  return Array.from({ length: 6 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
}

function newToken() {
  return crypto.randomBytes(16).toString('hex');
}

// Only hashes of seat tokens are stored: a leaked database row cannot be used to take a seat.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return CODE_RE.test(code) ? code : null;
}

function normToken(value) {
  return typeof value === 'string' && TOKEN_RE.test(value) ? value : null;
}

const cryptoRng = () => crypto.randomInt(0, 0x100000000) / 0x100000000;

// ─── NAMES ─────────────────────────────────────────────────────────────────────

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

// ─── ROOMS ─────────────────────────────────────────────────────────────────────

function phaseOf(room) {
  return room.game ? room.game.phase : 'lobby';
}

function seatOf(room, tokenHash) {
  return tokenHash ? room.seats.findIndex(s => s.tokenHash === tokenHash) : -1;
}

function freeDynasty(seats) {
  return TE.DYNASTIES.find(d => !seats.some(s => s.dynasty === d));
}

function createRoom({ code, name, maxPlayers, tokenHash }) {
  return {
    v: ROOM_VERSION,
    code,
    maxPlayers: [2, 3, 4].includes(maxPlayers) ? maxPlayers : 4,
    host: 0,
    seats: [{ name: cleanName(name, 'Игрок 1'), dynasty: TE.DYNASTIES[0], tokenHash }],
    game: null
  };
}

function addSeat(room, name, tokenHash) {
  if (room.game) throw new ApiError('Игра уже идёт', 409);
  if (room.seats.length >= room.maxPlayers) throw new ApiError('Комната заполнена', 409);
  const seat = {
    name: uniqueName(cleanName(name, `Игрок ${room.seats.length + 1}`), room.seats),
    dynasty: freeDynasty(room.seats),
    tokenHash
  };
  return Object.assign({}, room, { seats: room.seats.concat(seat) });
}

// Lobby seats vanish on leave (the host role moves on); returns null when nobody is left.
function removeSeat(room, seat) {
  const seats = room.seats.filter((s, i) => i !== seat);
  if (!seats.length) return null;
  const host = room.host === seat ? 0 : room.host > seat ? room.host - 1 : room.host;
  return Object.assign({}, room, { seats, host });
}

function setDynasty(room, seat, dynasty) {
  if (room.game) throw new ApiError('Игра уже началась', 409);
  if (!TE.DYNASTIES.includes(dynasty)) throw new ApiError('Неизвестная династия');
  if (room.seats.some((s, i) => i !== seat && s.dynasty === dynasty)) {
    throw new ApiError('Эту династию уже выбрал другой игрок', 409);
  }
  if (room.seats[seat].dynasty === dynasty) return room;
  const seats = room.seats.map((s, i) => (i === seat ? Object.assign({}, s, { dynasty }) : s));
  return Object.assign({}, room, { seats });
}

function newGame(room, rng) {
  return TE.createGame({
    names: room.seats.map(s => s.name),
    dynasties: room.seats.map(s => s.dynasty),
    rng: rng || cryptoRng
  });
}

function startGame(room, seat, rng) {
  if (room.game) throw new ApiError('Игра уже идёт', 409);
  if (seat !== room.host) throw new ApiError('Начать игру может только создатель комнаты', 403);
  if (room.seats.length < TE.MIN_PLAYERS) throw new ApiError('Нужно минимум 2 игрока');
  return Object.assign({}, room, { game: newGame(room, rng) });
}

function applyAction(room, seat, action, log) {
  if (!room.game) throw new ApiError('Игра не начата', 409);
  const res = TE.applyAction(room.game, seat, action);
  if (!res.ok) {
    if (res.internal && log) log.error('engine error', res.internal, JSON.stringify(action).slice(0, 500));
    throw new ApiError(res.error);
  }
  return Object.assign({}, room, { game: res.state });
}

// Moves the game on for a player who went offline: safe default decisions or ending the turn.
function skipAwaited(room, lastSeen, now, timing, log) {
  if (!room.game || room.game.phase !== 'play') throw new ApiError('Нечего пропускать', 409);
  const target = TE.awaiting(room.game);
  const quiet = now - (lastSeen[room.seats[target].tokenHash] || 0);
  if (quiet < timing.skipAfterMs) {
    throw new ApiError(quiet < timing.onlineMs ? 'Игрок в сети' : 'Подождите ещё немного', 409);
  }
  let game = room.game;
  for (let k = 0; k < 20 && game.phase === 'play' && TE.awaiting(game) === target; k++) {
    const res = TE.applyAction(game, target, TE.defaultAction(game));
    if (!res.ok) {
      if (log) log.error('skip failed', res.error, res.internal);
      break;
    }
    game = res.state;
  }
  return Object.assign({}, room, { game });
}

function rematch(room, rng) {
  if (!room.game || room.game.phase !== 'over') throw new ApiError('Игра ещё не окончена', 409);
  return Object.assign({}, room, { game: newGame(room, rng) });
}

// ─── WHAT A PLAYER SEES ────────────────────────────────────────────────────────

// lastSeen: tokenHash -> ms of the seat's latest request. A seat is online while it keeps polling.
function publicRoom(room, you, lastSeen, now, onlineMs) {
  return {
    code: room.code,
    maxPlayers: room.maxPlayers,
    host: room.host,
    you,
    started: !!room.game,
    seats: room.seats.map(s => {
      const seen = lastSeen[s.tokenHash] || 0;
      const online = now - seen < onlineMs;
      return { name: s.name, dynasty: s.dynasty, online, offlineSince: online ? null : seen };
    })
  };
}

module.exports = {
  ApiError,
  CODE_RE,
  newCode,
  newToken,
  hashToken,
  normCode,
  normToken,
  cleanName,
  cryptoRng,
  phaseOf,
  seatOf,
  createRoom,
  addSeat,
  removeSeat,
  setDynasty,
  startGame,
  applyAction,
  skipAwaited,
  rematch,
  publicRoom
};
