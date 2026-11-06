// Анимации поля (просьба Дениса 04.11): снятые войной тайлы гаснут, катастрофа трескается,
// монумент вырастает, кубик сокровища подпрыгивает и улетает к карточке того, кто его взял,
// свой тайл летит из руки в клетку. Что анимировать, решают чистые функции по разнице видов;
// поле перерисовывается каждый опрос, поэтому у эффекта есть возраст и анимация не начинается
// заново (отрицательная задержка, как у следа хода).
import { W, CATASTROPHE } from './util.js';

// burn и fall (схема одобрена Денисом 06.11): тайл, снятый войной, сгорает; проигравший лидер
// падает набок и улетает к карточке хозяина (сам перелет запускает game.js)
export const FX_MS = { gone: 700, crack: 900, grow: 900, cube: 900, burn: 1600, fall: 560 };
export const BURN_STEP = 80; // мс между соседними кольцами огня
export const BURN_RINGS = 10; // дальше волна не тянется: большое царство горит не дольше 0,8 с сверх

const ring = (a, b) => Math.max(Math.abs((a % W) - (b % W)), Math.abs(((a / W) | 0) - ((b / W) | 0)));

/** Откуда бежит огонь: тайл, что объединил царства (последний тайл перед боем), иначе метка объединения прошлого вида. */
function fireFrom(prev, entries) {
  const w = entries.findIndex((e) => e.ev === 'war');
  for (let j = w - 1; j >= 0; j--) if (entries[j].ev === 'tile') return entries[j].pos;
  return prev.unite ?? null;
}

/**
 * Что изменилось на поле между двумя видами одной партии: [{ kind, pos, c?, delay?, seat? }].
 * gone: тайл цвета c исчез (отмена хода и все, что не война); burn: тайл сняла война, delay —
 * через сколько мс до него дойдет волна огня от места стычки; crack: на клетку легла катастрофа;
 * grow: построен монумент (pos — левая верхняя клетка); cube: со храма взяли сокровище;
 * fall: лидер цвета c места seat снят боем (проиграл войну или восстание, остался без храма).
 * Под монументом тайлы не исчезают, а переворачиваются, поэтому ложных gone нет.
 * entries — новые записи журнала этого обновления: по ним видно, что был бой и кто проиграл.
 */
export function boardChanges(prev, next, entries = []) {
  if (!prev || !next) return [];
  const a = prev.board, b = next.board, out = [];
  const fought = entries.some((e) => e.ev === 'war');
  for (let i = 0; i < b.tile.length; i++) {
    const was = a.tile[i], now = b.tile[i];
    if (now === CATASTROPHE && was !== CATASTROPHE) out.push({ kind: 'crack', pos: i, c: was });
    else if (was >= 0 && was <= 3 && now < 0) out.push({ kind: fought ? 'burn' : 'gone', pos: i, c: was });
    if (a.treasure[i] && !b.treasure[i]) out.push({ kind: 'cube', pos: i });
  }
  const burn = out.filter((f) => f.kind === 'burn');
  if (burn.length) {
    const from = fireFrom(prev, entries);
    const near = from == null ? 0 : Math.min(...burn.map((f) => ring(from, f.pos)));
    for (const f of burn) f.delay = from == null ? 0 : Math.min(ring(from, f.pos) - near, BURN_RINGS) * BURN_STEP;
  }
  for (const m of next.monuments || []) {
    const old = (prev.monuments || []).find((x) => x.id === m.id);
    if (m.pos >= 0 && !(old?.pos >= 0)) out.push({ kind: 'grow', pos: m.pos });
  }
  if (a.leader && b.leader) {
    const lost = new Set();
    for (const e of entries) {
      if ((e.ev === 'war' || e.ev === 'revolt') && e.loser != null) lost.add(`${e.loser}:${e.color}`);
      if (e.ev === 'leaderReturned') lost.add(`${e.seat}:${e.c}`);
    }
    for (let i = 0; lost.size && i < a.leader.length; i++) {
      const v = a.leader[i];
      if (v < 0 || b.leader.includes(v)) continue; // на месте или переставлен
      const seat = next.order ? next.order[v >> 2] : v >> 2, c = v & 3;
      if (lost.has(`${seat}:${c}`)) out.push({ kind: 'fall', pos: i, c, seat });
    }
  }
  return out;
}

/** Добавить новые эффекты с отметкой времени и убрать отыгравшие; вернуть живые с возрастом. */
export function ageFx(list, fresh, now) {
  const all = [...list, ...fresh.map((f) => ({ ...f, t0: now }))];
  return all.filter((f) => now - f.t0 < FX_MS[f.kind] + (f.delay || 0)).map((f) => ({ ...f, age: now - f.t0 }));
}

/** Кто взял сокровище с клетки pos: место из записей журнала этого обновления. */
export const takerOf = (entries, pos) => entries.find((e) => e.ev === 'treasure' && e.pos === pos)?.seat ?? null;

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Перелет картинки src из прямоугольника from в прямоугольник to (координаты экрана), ms.
 * Картинка живет поверх страницы и исчезает в конце; при «уменьшить движение» ничего не делает.
 */
export function fly(src, from, to, { ms = 380, round = 6, fade = false } = {}) {
  if (!from || !to || still()) return;
  const img = document.createElement('img');
  img.className = 'fly';
  img.src = src;
  img.alt = '';
  Object.assign(img.style, { left: `${from.x}px`, top: `${from.y}px`, width: `${from.w}px`, height: `${from.h}px`, borderRadius: `${round}px` });
  document.body.appendChild(img);
  const dx = to.x + to.w / 2 - (from.x + from.w / 2), dy = to.y + to.h / 2 - (from.y + from.h / 2);
  const k = to.w / from.w;
  const anim = img.animate([
    { transform: 'translate(0,0) scale(1)', opacity: 1 },
    { transform: `translate(${dx * 0.5}px,${dy * 0.5 - 30}px) scale(${(1 + k) / 2 + 0.1})`, opacity: 1, offset: 0.5 },
    { transform: `translate(${dx}px,${dy}px) scale(${k})`, opacity: fade ? 0.2 : 1 },
  ], { duration: ms, easing: 'cubic-bezier(.3,.7,.4,1)' });
  anim.onfinish = anim.oncancel = () => img.remove();
}

/** Прямоугольник элемента на экране в виде { x, y, w, h }. */
export function boxOf(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
}
