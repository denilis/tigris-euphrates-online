// Сигналы «ваш ход» (просьба Дениса 03.11): переход хода было не видно. Тихий щелчок, когда
// закончился любой ход, двойной звон, когда решать вам; заголовок вкладки и мигающая надпись,
// когда время хода вышло. Звук синтезирует браузер, файлов нет. Выбор «Звук» помнит браузер.

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
 * Звуки событий (просьба Дениса 04.11): бой, победа в своем бою, монумент, катастрофа,
 * сокровище, конец партии. Не больше трех за раз, по важности.
 */
export function eventSounds(entries, me) {
  const has = (...evs) => entries.some((e) => evs.includes(e.ev));
  const out = [];
  if (has('gameOver')) out.push('gameover');
  if (has('war', 'revolt')) out.push('battle');
  if (me != null && entries.some((e) => (e.ev === 'war' || e.ev === 'revolt') && e.winner === me)) out.push('victory');
  if (has('monument', 'wonder')) out.push('monument');
  if (has('catastrophe')) out.push('catastrophe');
  if (has('treasure')) out.push('treasure');
  return out.slice(0, 3);
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
  battle: [0.55, (at) => { tone(130, at, 0.22, 0.22, 'sine', 48); tone(120, at + 0.26, 0.26, 0.2, 'sine', 42); }],
  victory: [0.5, (at) => { tone(523, at, 0.14, 0.07, 'triangle'); tone(659, at + 0.12, 0.14, 0.07, 'triangle'); tone(784, at + 0.24, 0.26, 0.08, 'triangle'); }],
  monument: [1.2, (at) => { tone(440, at, 1.2, 0.06); tone(880, at, 0.9, 0.05); tone(1320, at, 0.6, 0.025); }],
  catastrophe: [0.9, (at) => { rumble(at, 0.85, 0.18); tone(62, at, 0.8, 0.12, 'sine', 40); }],
  treasure: [0.35, (at) => { tone(2093, at, 0.12, 0.04); tone(2637, at + 0.07, 0.2, 0.035); }],
  gameover: [1.4, (at) => { for (const f of [392, 494, 587]) tone(f, at, 1.4, 0.05); }],
};

/** Сыграть звуки из soundsFor и eventSounds, если звук включен и браузер его разрешил. */
export function play({ tick, chime, events = [] }) {
  if (!(tick || chime || events.length) || !soundOn() || !ac || ac.state !== 'running') return;
  let at = 0;
  for (const name of events) {
    const [dur, fn] = EVENT[name] || [0, () => {}];
    fn(at);
    at += dur * 0.8;
  }
  if (chime) {
    tone(660, at, 0.22, 0.12);
    tone(990, at + 0.15, 0.32, 0.1);
  } else if (tick && !events.length) {
    tone(220, 0, 0.07, 0.05, 'triangle');
  }
}
