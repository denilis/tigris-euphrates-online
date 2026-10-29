// Общие названия, склонения и мелкие помощники интерфейса.
export const W = 16, H = 11;
export const HEX = ['#b8432f', '#2d6a93', '#3d7a46', '#1f1f1f'];
export const RING = ['#b8432f', '#2d6a93', '#3d7a46', '#cfc6b4']; // у черного светлая обводка
export const COLKEY = ['red', 'blue', 'green', 'black'];
export const COLNAME = ['красный', 'синий', 'зеленый', 'черный'];
export const COLADJPL = ['красных', 'синих', 'зеленых', 'черных'];
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

export const tileImg = (c) => `/img/tiles/${TILEFILE[c]}.jpg`;
export const catImg = '/img/tiles/catastrophe.jpg';
export const tokenImg = (hero, c) => `/img/tokens/${hero || 'pot'}_${COLKEY[c]}.png`;
export const cellName = (i) => String.fromCharCode(65 + (i % W)) + ((i / W | 0) + 1);

const PLURAL = [['храм', 'храма', 'храмов'], ['ферма', 'фермы', 'ферм'], ['рынок', 'рынка', 'рынков'], ['поселение', 'поселения', 'поселений']];
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
