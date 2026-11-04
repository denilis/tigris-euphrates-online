// Разбор партии ботом (этап 5 пакета 04.11): считает браузер (public/js/analysis-core.js), сервер
// отдает запись законченной партии и хранит готовый разбор, чтобы второй раз не считать. Разбор
// присылает клиент, поэтому здесь он пересобирается только из известных полей с проверкой границ.
export const ANALYSIS_VERSION = 1;
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);
const MOVE_TYPES = ['tile', 'leader', 'catastrophe', 'withdraw', 'discard', 'pass'];

function cleanMove(m) {
  if (!m || typeof m !== 'object' || !MOVE_TYPES.includes(m.type)) return null;
  const out = { type: m.type };
  for (const k of ['color', 'pos', 'from']) if (m[k] !== undefined) out[k] = int(m[k], -1, 175);
  return Object.values(out).some((v) => v === null) ? null : out;
}

/** Чистый разбор для места в базе или null, если прислано не то. humans — места людей за столом. */
export function cleanAnalysis(a, humans) {
  if (!a || typeof a !== 'object' || a.v !== ANALYSIS_VERSION || !a.players || typeof a.players !== 'object') return null;
  const players = {};
  for (const id of humans) {
    const p = a.players[id];
    if (!p) return null;
    const actions = int(p.actions, 0, 300), exact = int(p.exact, 0, 300);
    const accuracy = p.accuracy === null ? null : int(p.accuracy, 0, 100);
    if (actions === null || exact === null || exact > actions || (accuracy === null && actions > 0)) return null;
    if (!Array.isArray(p.mistakes) || p.mistakes.length > 5) return null;
    const mistakes = [];
    for (const x of p.mistakes) {
      const e = {
        k: int(x?.k, 1, 1000), turn: int(x?.turn, 1, 400), action: int(x?.action, 1, 2),
        played: str(x?.played, 80), best: str(x?.best, 80),
        loss: typeof x?.loss === 'number' && x.loss >= 0 && x.loss <= 20 ? Math.round(x.loss * 10) / 10 : null,
        bestMove: x?.bestMove == null ? null : cleanMove(x.bestMove),
      };
      if (Object.entries(e).some(([k, v]) => v === null && k !== 'bestMove')) return null;
      mistakes.push(e);
    }
    players[id] = { actions, exact, accuracy, mistakes };
  }
  return { v: ANALYSIS_VERSION, players };
}

/** Места людей за столом: их ходы разбирает бот. */
export const humanSeats = (t) => t.seats.filter((s) => s.kind === 'human').map((s) => s.id);
