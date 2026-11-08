// Сигналы «ваш ход» (просьба Дениса 03.11): переход хода было не видно. Тихий щелчок, когда
// закончился любой ход, двойной звон, когда решать вам; заголовок вкладки и мигающая надпись,
// когда время хода вышло. Звук синтезирует браузер; свой бой, восстание и конец партии звучат файлами
// Дениса из public/sfx (08.11). Выбор «Звук» помнит браузер.

/** Снимок партии для сигналов: чей ход, решает ли смотрящий и докуда он видел журнал. */
export const snapOf = (view) => ({
  code: view.code, turn: view.game.turn, cur: view.game.cur,
  mine: Boolean(view.game.legal) && !view.game.over && !view.game.stopped,
  logTotal: view.game.logTotal ?? view.game.log?.length ?? 0, logEpoch: view.game.logEpoch ?? 0,
});

/**
 * Записи журнала, появившиеся с прошлого снимка. Первый взгляд на стол, другой стол и отмена хода
 * (журнал укоротился) дают пусто: звучать должно только то, что случилось у вас на глазах.
 */
export function newEntries(prev, view) {
  const log = view.game.log || [], total = view.game.logTotal ?? log.length;
  if (!prev || prev.code !== view.code || prev.logEpoch !== (view.game.logEpoch ?? 0)) return [];
  if (total <= prev.logTotal || log.length !== total) return [];
  return log.slice(prev.logTotal);
}

/**
 * Звуки событий (просьба Дениса 04.11): бой, монумент, катастрофа, сокровище; не больше трех за раз,
 * по важности. 08.11 звуки из файлов Дениса (SFX): свой бой (война) и свое восстание, победа и
 * поражение, вместо глухого удара; конец партии: звук финальной таблицы для всех, один (таблица
 * появляется в той же перерисовке, звуки последнего хода с ним не наслаиваются). Чужой бой: удары.
 * result — итог партии из вида (раньше по нему выбирались фанфары или грустный звук).
 */
export function eventSounds(entries, me, result = null) {
  const has = (...evs) => entries.some((e) => evs.includes(e.ev));
  if (has('gameOver')) return ['gameEnd'];
  const out = [];
  const mine = me == null ? [] : entries.filter((e) => (e.ev === 'war' || e.ev === 'revolt') && [e.att, e.def, e.winner, e.loser].includes(me));
  if (mine.length) {
    // несколько боев за ход: если хоть один выигран, звучит победа (в том бою, что выигран)
    const won = mine.find((e) => e.winner === me);
    const e = won || mine[0];
    out.push(`${e.ev === 'war' ? 'war' : 'revolt'}${won ? 'Win' : 'Loss'}`);
  } else if (has('war', 'revolt')) out.push('battle');
  if (has('monument', 'wonder')) out.push('monument');
  if (has('catastrophe')) out.push('catastrophe');
  if (has('treasure')) out.push('treasure');
  return [...new Set(out)].slice(0, 3);
}

/** Звуки при переходе от prev к next. При первом взгляде на стол тишина. */
export function soundsFor(prev, next) {
  if (!prev || prev.code !== next.code) return { tick: false, chime: false };
  const chime = next.mine && !prev.mine;
  const passed = prev.turn !== next.turn || prev.cur !== next.cur;
  return { tick: passed && !chime, chime };
}

const OURS = /^(● Ваш ход|Сделайте ход!) \| /;

/** Заголовок вкладки поверх текущего (в нем может быть приглашение): просрочка мигает раз в секунду. */
export function titleFor(cur, mine, overdue, now) {
  const base = cur.replace(OURS, '');
  if (!mine) return base;
  return `${overdue && Math.floor(now / 1000) % 2 ? 'Сделайте ход!' : '● Ваш ход'} | ${base}`;
}

// --- звук

let ac = null;

export function soundOn() {
  try { return localStorage.getItem('tigris.sound') !== 'off'; } catch { return true; }
}

export function setSound(on) {
  try { localStorage.setItem('tigris.sound', on ? 'on' : 'off'); } catch { /* без памяти */ }
}

/** Браузер дает звук только после жеста пользователя: готовим его на первом нажатии. */
export function unlockAudio() {
  const go = () => {
    try {
      ac ??= new AudioContext();
      if (ac.state === 'suspended') ac.resume();
      preloadSfx(); // файлы звуков (около 260 КБ) качаем, когда звук уже можно играть
    } catch { /* без звука */ }
  };
  addEventListener('pointerdown', go, { once: true, capture: true });
  addEventListener('keydown', go, { once: true, capture: true });
}

/** Тон: частота freq (или скольжение к to), через at секунд, длительность dur, громкость gain. */
function tone(freq, at, dur, gain, type = 'sine', to = null) {
  const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Глухой шум (гул катастрофы): белый шум через низкий фильтр. */
function rumble(at, dur, gain) {
  const t = ac.currentTime + at, n = Math.ceil(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, n, ac.sampleRate), data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = buf;
  f.type = 'lowpass';
  f.frequency.value = 180;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(ac.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// звуки событий: [длительность, как играть со сдвигом at]
const EVENT = {
  battle: [0.55, (at) => { tone(130, at, 0.22, 0.26, 'sine', 48); tone(120, at + 0.26, 0.26, 0.24, 'sine', 42); }],
  monument: [1.2, (at) => { tone(440, at, 1.2, 0.09); tone(880, at, 0.9, 0.07); tone(1320, at, 0.6, 0.035); }],
  catastrophe: [0.9, (at) => { rumble(at, 0.85, 0.24); tone(62, at, 0.8, 0.16, 'sine', 40); }],
  treasure: [0.35, (at) => { tone(2093, at, 0.12, 0.06); tone(2637, at + 0.07, 0.2, 0.05); }],
  // игрок зашел за стол в лобби: дверной звонок из двух нот
  arrive: [0.45, (at) => { tone(659, at, 0.18, 0.16); tone(880, at + 0.14, 0.3, 0.16); }],
};

/** «Ваш ход» (Денис 04.11: громче и мажорно, «сходи»): колокольчики вверх до-ми-соль-до. */
function chimeAt(at) {
  [523, 659, 784].forEach((f, i) => { tone(f, at + i * 0.11, 0.3, 0.2); tone(f * 2, at + i * 0.11, 0.2, 0.05, 'triangle'); });
  tone(1047, at + 0.33, 0.7, 0.22);
  tone(2094, at + 0.33, 0.4, 0.05, 'triangle');
}

/** Напоминание, когда время хода вышло: два коротких «динь» вверх. */
function remindAt(at) {
  tone(784, at, 0.22, 0.2);
  tone(1047, at + 0.18, 0.35, 0.22);
}

// --- звуки из файлов (Денис 08.11): свой бой и восстание, победа и поражение; конец партии

export const SFX = {
  warWin: '/sfx/war-win.mp3', revoltWin: '/sfx/revolt-win.mp3',
  warLoss: '/sfx/war-loss.mp3', revoltLoss: '/sfx/revolt-loss.mp3', gameEnd: '/sfx/game-end.mp3',
};
// громкость выровнена по замеру 08.11 (RMS от -20 до -24,5 дБ), чтобы ни один не выделялся
const SFX_GAIN = { warWin: 0.62, revoltWin: 0.78, warLoss: 0.78, revoltLoss: 0.5, gameEnd: 0.55 };
// длительность слышимой части по тому же замеру: пока файл не загружен, по ней идет очередь звуков
const SFX_SEC = { warWin: 2.1, revoltWin: 2.3, warLoss: 3.4, revoltLoss: 4.8, gameEnd: 6.5 };
const sfx = new Map(); // имя -> { buf, from, to } или обещание загрузки

function loadSfx(name) {
  if (!ac || sfx.has(name)) return sfx.get(name);
  const p = fetch(SFX[name]).then((r) => r.arrayBuffer()).then((b) => ac.decodeAudioData(b)).then((buf) => {
    // тишину в начале и в конце файла не играем (в «проигрыше в битве» 0,36 с тишины)
    const ch = buf.getChannelData(0);
    let a = 0, z = ch.length - 1;
    while (a < ch.length && Math.abs(ch[a]) < 0.01) a++;
    while (z > a && Math.abs(ch[z]) < 0.01) z--;
    const v = { buf, from: a / buf.sampleRate, to: Math.min(buf.duration, z / buf.sampleRate + 0.25) };
    sfx.set(name, v);
    return v;
  }).catch(() => {
    sfx.delete(name); // сеть подвела: попробуем в следующий раз
    return null;
  });
  sfx.set(name, p);
  return p;
}

function preloadSfx() {
  for (const name of Object.keys(SFX)) loadSfx(name);
}

/** Сыграть файл через at секунд; возвращает, сколько он звучит. Не загружен: сыграет, как загрузится. */
function sfxAt(name, at) {
  const t0 = ac.currentTime + at;
  const start = (v) => {
    if (!v?.buf) return;
    const src = ac.createBufferSource(), g = ac.createGain();
    src.buffer = v.buf;
    g.gain.value = SFX_GAIN[name] ?? 0.6;
    src.connect(g).connect(ac.destination);
    src.start(Math.max(ac.currentTime, t0), v.from, v.to - v.from);
  };
  const v = sfx.get(name);
  if (v?.buf) {
    start(v);
    return v.to - v.from;
  }
  Promise.resolve(v || loadSfx(name)).then(start);
  return SFX_SEC[name];
}

/** Сыграть звуки из soundsFor и eventSounds, если звук включен и браузер его разрешил. */
export function play({ tick, chime, remind, events = [] }) {
  if (!(tick || chime || remind || events.length) || !soundOn() || !ac || ac.state !== 'running') return;
  let at = 0;
  for (const name of events) {
    if (SFX[name]) {
      at += sfxAt(name, at) * 0.8;
      continue;
    }
    const [dur, fn] = EVENT[name] || [0, () => {}];
    fn(at);
    at += dur * 0.8;
  }
  if (chime) chimeAt(at);
  else if (remind) remindAt(at);
  else if (tick && !events.length) tone(220, 0, 0.07, 0.07, 'triangle');
}
