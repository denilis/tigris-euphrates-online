'use strict';
// In-process room store: the same contract as the Supabase store (see supabase/migrations),
// for local play without a database and for tests. Everything lives in one process's memory.

const LOBBY_IDLE_MS = 6 * 3600 * 1000;
const OVER_IDLE_MS = 2 * 24 * 3600 * 1000;
const ANY_IDLE_MS = 14 * 24 * 3600 * 1000;

function createMemoryStore(options) {
  const opts = options || {};
  const clock = opts.now || Date.now;
  const rooms = new Map(); // code -> { rev, phase, data, creator, createdAt, updatedAt, seen: Map(tokenHash -> ms) }
  const copy = v => (v === null || v === undefined ? v : structuredClone(v));

  const isSeated = (row, tokenHash) => !!tokenHash && row.data.seats.some(s => s.tokenHash === tokenHash);
  const lastSeen = row => Object.fromEntries(row.seen);

  return {
    kind: 'memory',
    rooms,

    async sync(code, tokenHash, have) {
      const row = rooms.get(code);
      if (!row) return null;
      const now = clock();
      const seated = isSeated(row, tokenHash);
      if (seated) row.seen.set(tokenHash, now);
      return {
        rev: row.rev,
        seated,
        now,
        seen: lastSeen(row),
        data: row.rev > (have || 0) ? copy(row.data) : null
      };
    },

    async create(code, data, tokenHash, creator, limit, windowMs) {
      const now = clock();
      if (creator && limit > 0) {
        let recent = 0;
        for (const row of rooms.values()) if (row.creator === creator && now - row.createdAt < windowMs) recent++;
        if (recent >= limit) return 'limited';
      }
      if (rooms.has(code)) return 'duplicate';
      rooms.set(code, {
        rev: 1, phase: 'lobby', data: copy(data), creator: creator || null,
        createdAt: now, updatedAt: now, seen: new Map([[tokenHash, now]])
      });
      return 'ok';
    },

    async save(code, rev, data, phase, tokenHash) {
      const row = rooms.get(code);
      if (!row || row.rev !== rev) return null;
      const now = clock();
      row.rev = rev + 1;
      row.data = copy(data);
      row.phase = phase;
      row.updatedAt = now;
      if (tokenHash) row.seen.set(tokenHash, now);
      return row.rev;
    },

    async remove(code, rev) {
      const row = rooms.get(code);
      if (!row || row.rev !== rev) return false;
      rooms.delete(code);
      return true;
    },

    // Marks a seat as gone right now, as if it had been silent for offlineMs.
    async away(code, tokenHash, offlineMs) {
      const row = rooms.get(code);
      if (!row || !row.seen.has(tokenHash)) return;
      row.seen.set(tokenHash, Math.min(row.seen.get(tokenHash), clock() - offlineMs));
    },

    async cleanup() {
      const now = clock();
      let deleted = 0;
      for (const [code, row] of rooms) {
        const idle = now - row.updatedAt;
        if ((row.phase === 'lobby' && idle > LOBBY_IDLE_MS) || (row.phase === 'over' && idle > OVER_IDLE_MS) || idle > ANY_IDLE_MS) {
          rooms.delete(code);
          deleted++;
        }
      }
      return deleted;
    },

    async ping() {
      return true;
    }
  };
}

module.exports = { createMemoryStore };
