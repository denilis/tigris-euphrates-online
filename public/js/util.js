// Общие названия, склонения и мелкие помощники интерфейса.
// Размер поля текущего стола: 16x11, у большого поля 19x13. Меняется через useBoard, модули
// берут W и H живой привязкой импорта.
export let W = 16, H = 11;
const SIZES = { 176: [16, 11], 247: [19, 13] };
/** Поле стола по числу клеток (длина board.tile): выставляет W и H для отрисовки и имен клеток. */
export function useBoard(cells) {
  [W, H] = SIZES[cells] || SIZES[176];
}
export const HEX = ['#b8432f', '#2d6a93', '#3d7a46', '#1f1f1f'];
export const RING = ['#b8432f', '#2d6a93', '#3d7a46', '#cfc6b4']; // для темных панелей: у черного светлая обводка, на поле кольцо цвета HEX
export const COLKEY = ['red', 'blue', 'green', 'black'];
export const COLNAME = ['красный', 'синий', 'зеленый', 'черный'];
/** Порядок цветных очков слева направо, как на BGA (просьба Дениса 04.11): красный, черный, зеленый, синий. */
export const SCORE_ORDER = [0, 3, 2, 1];
export const COLADJPL = ['красных', 'синих', 'зеленых', 'черных'];
export const COLGEN = ['красного', 'синего', 'зеленого', 'черного'];
export const COLDAT = ['красному', 'синему', 'зеленому', 'черному'];
export const TILE = ['храм', 'ферма', 'рынок', 'поселение'];
export const TILEPL = ['храмов', 'ферм', 'рынков', 'поселений'];
export const TILEDAT = ['храмам', 'фермам', 'рынкам', 'поселениям'];
export const TILEACCPL = ['храмы', 'фермы', 'рынки', 'поселения'];
export const TILEFILE = ['temple', 'farm', 'market', 'settlement'];
export const LEADER = ['жрец', 'фермер', 'торговец', 'царь'];
export const LEADERACC = ['жреца', 'фермера', 'торговца', 'царя'];
export const HEROES = ['lion', 'bull', 'bow', 'pot'];
export const HERONAME = { lion: 'лев', bull: 'бык', bow: 'лук', pot: 'кувшин' };
export const STYLES = { universal: 'Универсальный', base: 'Базовый', top: 'Топ-мастера', denis: 'Денис', andrey: 'Андрей', vlad: 'Влад' };
export const FACEDOWN = 4, WONDER = 5, CATASTROPHE = 6;

// вид тайлов стола (Денис 04.11): plate — плитки в кирпичной рамке (лист Дениса 04.11, сначала был
// поставлен зданиями), classic — прежние картинки. Ставят экран партии и повтор по опции стола;
// правила и уроки просят classic явно. Катастрофа и объединение одни на оба вида.
export const TILE_STYLES = ['plate', 'classic'];
let tileStyle = 'classic';
export const setTileStyle = (s) => { tileStyle = s === 'plate' ? 'plate' : 'classic'; };
export const getTileStyle = () => tileStyle;
export const tileImg = (c, style = tileStyle) => (style === 'plate' ? `/img/tiles/plate/${TILEFILE[c]}.webp` : `/img/tiles/${TILEFILE[c]}.jpg`);
export const catImg = '/img/tiles/catastrophe.jpg';
export const uniteImg = '/img/tiles/unification.jpg';
export const tokenImg = (hero, c) => `/img/tokens/${hero || 'pot'}_${COLKEY[c]}.png`;

// Разбор партии ботом скрыт (решение Дениса 08.11): советы смотрели на одно действие вперед и
// без причин. Вернуть после усиления бота в новом виде; сервер и сохраненные разборы не тронуты.
export const ANALYSIS_SHOWN = false;

// Сокровища на поле: партия кончается, когда их остается столько или меньше (движок, конец хода).
export const TREASURE_END = 2;
/** Порог стола: у большого поля свой (сервер кладет его в game.treasureEnd). */
export const treasureEnd = (g) => g?.treasureEnd ?? TREASURE_END;
export const treasuresOn = (g) => g.board.treasure.reduce((a, b) => a + b, 0);
/** До конца партии одно взятие сокровища: число в верхней строке красное (Денис 06.11). */
export const treasureLow = (n, end = TREASURE_END) => n <= end + 1;
/**
 * Лицо игрока для background-image: фото, а под ним жетон героя. Жетон виден, если фото нет
 * или его уже сменили, а за старым столом остался прежний адрес.
 */
// портреты ботов (картинки Дениса 04.11): свой у каждого стиля, у стилей игроков (Денис, Андрей,
// Влад) лицо этого игрока. В файле крупный план лица без рамки медальона: в кружке 30-50 точек
// медальон целиком не читался. Неизвестный стиль получает портрет универсального бота.
export const BOT_FACES = ['universal', 'base', 'top', 'mix', 'denis', 'andrey', 'vlad'];
export const botFace = (who) => `/img/bots/${BOT_FACES.includes(who?.bot?.style) ? who.bot.style : 'universal'}.webp`;

export function faceBg(who, c = 0) {
  const token = `url(${tokenImg(who?.hero, c)})`;
  if (who?.kind === 'bot') return `url(${botFace(who)}),${token}`;
  return who?.avatar ? `url(/api/avatar/${who.avatar}),${token}` : token;
}
export const cellName = (i) => String.fromCharCode(65 + (i % W)) + ((i / W | 0) + 1);

const PLURAL = [['храм', 'храма', 'храмов'], ['ферма', 'фермы', 'ферм'], ['рынок', 'рынка', 'рынков'], ['поселение', 'поселения', 'поселений']];
const POINT_WHY = { monument: ' за монумент', wonder: ' за чудо' };

/** Очки строки журнала: если они у разных игроков, подписан каждый, иначе очко ходившего читается как чужое. */
export function pointsText(pts, actor, name) {
  const mixed = pts.some((p) => p.seat !== actor);
  return pts.map((p) => `${mixed ? `${name(p.seat)} ` : ''}+${p.n} ${COLNAME[p.c]}${POINT_WHY[p.why] || ''}`);
}

/** Момент партии: при его смене прежний выбор игрока больше не к месту. Отмена тоже новый момент. */
export const momentKey = (view) => {
  const g = view.game;
  return `${view.code}:${g.turn}:${g.actionNo}:${g.phase}:${g.toMove}:${g.logEpoch}`;
};

/**
 * Круг и ход в круге (Денис 12.11: «ход считать кругами, круг это когда все сходили»). turn в
 * движке растет с каждым игроком с 1; np игроков. { round, k, n }: круг, ход в нем, ходов в круге.
 */
export function roundOf(turn, np) {
  const n = Math.max(1, np || 1), t = Math.max(1, turn || 1);
  return { round: Math.ceil(t / n), k: ((t - 1) % n) + 1, n };
}

/** «круг 2, ход 1 из 4» (у одного игрока просто «круг 2»). */
export function turnLabel(turn, np) {
  const { round, k, n } = roundOf(turn, np);
  return n > 1 ? `круг ${round}, ход ${k} из ${n}` : `круг ${round}`;
}

export function plural(n, c) {
  const f = PLURAL[c], m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? f[0] : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? f[1] : f[2];
}

/** 1 клетка, 2 клетки, 5 клеток */
export function cells(n) {
  const m10 = n % 10, m100 = n % 100;
  return `${n} ${m10 === 1 && m100 !== 11 ? 'клетка' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'клетки' : 'клеток'}`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/** Итог по слабейшему цвету: сокровища добавляются к слабейшим цветам. */
export function finalScore(score, treasures) {
  const v = score.slice();
  for (let t = 0; t < treasures; t++) v[v.indexOf(Math.min(...v))]++;
  return Math.min(...v);
}

export function nb(i) {
  const x = i % W, y = i / W | 0, o = [];
  if (x > 0) o.push(i - 1);
  if (x < W - 1) o.push(i + 1);
  if (y > 0) o.push(i - W);
  if (y < H - 1) o.push(i + W);
  return o;
}

/** Метки связных групп занятых клеток (как components в движке). */
export function groups(board, blocked = -1) {
  const lab = new Array(W * H).fill(-1);
  const occ = (i) => (board.tile[i] >= 0 && board.tile[i] <= WONDER) || board.leader[i] >= 0;
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    if (lab[i] !== -1 || i === blocked || !occ(i)) continue;
    const stack = [i];
    lab[i] = n;
    while (stack.length) {
      const c = stack.pop();
      for (const j of nb(c)) if (lab[j] === -1 && j !== blocked && occ(j)) { lab[j] = n; stack.push(j); }
    }
    n++;
  }
  return lab;
}

/** Два лидера одного цвета в одной группе (идет восстание): чей цвет, решит конфликт. */
export const CONTESTED = -1;

/**
 * Группы клеток и лидеры в каждой: lead.get(группа)[цвет] = игрок движка, null или CONTESTED.
 * blocked — тайл объединения во время войны: как и в движке, он не входит ни в одно царство.
 */
export function kingdomLeaders(board, blocked = -1) {
  const lab = groups(board, blocked);
  const lead = new Map();
  for (let i = 0; i < W * H; i++) {
    const v = board.leader[i];
    if (v < 0 || lab[i] < 0) continue;
    const a = lead.get(lab[i]) || [null, null, null, null];
    a[v & 3] = a[v & 3] == null ? v >> 2 : CONTESTED;
    lead.set(lab[i], a);
  }
  return { lab, lead };
}

/**
 * Чей тайл (метки владельца, идея Дениса 29.10): тайл в царстве идёт лидеру своего цвета,
 * а если такого лидера нет, царю (ему движок начисляет очки за такие тайлы). Тайл вне
 * царства и тайл, за цвет которого идет восстание, ничей. Возвращает по клетке null или { p, c, king }.
 */
export function tileOwners(board, kl = kingdomLeaders(board)) {
  const { lab, lead } = kl;
  return Array.from({ length: W * H }, (_, i) => {
    const t = board.tile[i];
    const a = t >= 0 && t <= 3 && lab[i] >= 0 ? lead.get(lab[i]) : null;
    if (!a) return null;
    const own = a[t] != null ? a[t] : a[3];
    if (own == null || own === CONTESTED) return null;
    return { p: own, c: a[t] != null ? t : 3, king: a[t] == null };
  });
}

/**
 * Поддержка лидера (просьба Дениса 29.10): сколько тайлов его цвета в его царстве, это его сила
 * в войне, как считает движок. lab — группы клеток (во время войны без тайла объединения).
 * По клетке лидера число, по остальным null.
 */
export function leaderSupport(board, lab = groups(board)) {
  const n = new Map();
  for (let i = 0; i < W * H; i++) {
    const t = board.tile[i];
    if (t >= 0 && t <= 3 && lab[i] >= 0) n.set(lab[i] * 4 + t, (n.get(lab[i] * 4 + t) || 0) + 1);
  }
  return Array.from({ length: W * H }, (_, i) => {
    const v = board.leader[i];
    return v < 0 ? null : n.get(lab[i] * 4 + (v & 3)) || 0;
  });
}

/** Клетка тайла объединения, пока идут войны за него, иначе null. */
export function unitePos(g) {
  return g?.ctx?.unite && g.ctx.pos != null ? g.ctx.pos : null;
}

/** Разметка из строки шаблона в узел. */
export function html(s) {
  const t = document.createElement('template');
  t.innerHTML = s.trim();
  return t.content.firstElementChild;
}

export function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('on'), 3200);
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Скопировано');
  } catch {
    prompt('Скопируйте:', text);
  }
}
