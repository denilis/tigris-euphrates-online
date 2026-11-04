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
 * Звуки событий (просьба Дениса 04.11): бой; в своем бою у победителя фанфары, у проигравшего
 * грустный звук; монумент, катастрофа, сокровище; конец партии: первое место фанфары, последнее
 * грустный звук, остальные аккорд. Не больше трех за раз, по важности. result — итог партии из вида.
 */
export function eventSounds(entries, me, result = null) {
  const has = (...evs) => entries.some((e) => evs.includes(e.ev));
  const out = [];
  if (has('gameOver')) {
    const mine = me == null ? null : result?.seats?.find((x) => x.seatId === me);
    const worst = result?.seats?.length ? Math.max(...result.seats.map((x) => x.place)) : null;
    out.push(!mine ? 'gameover' : mine.place === 1 ? 'fanfare' : mine.place === worst ? 'defeat' : 'gameover');
  }
  if (has('war', 'revolt')) out.push('battle');
  if (me != null) {
    const mine = entries.filter((e) => (e.ev === 'war' || e.ev === 'revolt') && [e.att, e.def, e.winner, e.loser].includes(me));
    if (mine.some((e) => e.winner === me)) out.push('victory');
    else if (mine.length) out.push('defeat');
  }
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

/** Медный тон (фанфары, грустная труба): пила через мягкий фильтр, можно со скольжением и вибрато. */
function brass(freq, at, dur, gain, to = null, vibrato = 0) {
  const t = ac.currentTime + at, o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  if (vibrato) {
    const lfo = ac.createOscillator(), depth = ac.createGain();
    lfo.frequency.value = 5.5;
    depth.gain.value = vibrato;
    lfo.connect(depth).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
  f.type = 'lowpass';
  f.frequency.value = 1700;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.03);
  g.gain.setValueAtTime(gain, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// звуки событий: [длительность, как играть со сдвигом at]
const EVENT = {
  battle: [0.55, (at) => { tone(130, at, 0.22, 0.26, 'sine', 48); tone(120, at + 0.26, 0.26, 0.24, 'sine', 42); }],
  // «ту-ту-дун»: фанфары победителю боя
  victory: [0.85, (at) => { brass(392, at, 0.12, 0.17); brass(392, at + 0.14, 0.12, 0.17); for (const [f, v] of [[523, 0.2], [659, 0.12], [784, 0.1]]) brass(f, at + 0.28, 0.55, v); }],
  // грустная труба проигравшему: четыре ноты вниз, последняя с дрожью
  defeat: [1.5, (at) => { brass(311, at, 0.28, 0.16); brass(294, at + 0.3, 0.28, 0.16); brass(277, at + 0.6, 0.28, 0.16); brass(262, at + 0.9, 0.6, 0.17, 247, 6); }],
  fanfare: [1.6, (at) => { [523, 659, 784].forEach((f, i) => brass(f, at + i * 0.13, 0.14, 0.17)); for (const [f, v] of [[523, 0.16], [659, 0.12], [784, 0.11], [1047, 0.1]]) brass(f, at + 0.42, 1.0, v); }],
  monument: [1.2, (at) => { tone(440, at, 1.2, 0.09); tone(880, at, 0.9, 0.07); tone(1320, at, 0.6, 0.035); }],
  catastrophe: [0.9, (at) => { rumble(at, 0.85, 0.24); tone(62, at, 0.8, 0.16, 'sine', 40); }],
  treasure: [0.35, (at) => { tone(2093, at, 0.12, 0.06); tone(2637, at + 0.07, 0.2, 0.05); }],
  // игрок зашел за стол в лобби: дверной звонок из двух нот
  arrive: [0.45, (at) => { tone(659, at, 0.18, 0.16); tone(880, at + 0.14, 0.3, 0.16); }],
  gameover: [1.4, (at) => { for (const f of [392, 494, 587]) tone(f, at, 1.4, 0.07); }],
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

/** Сыграть звуки из soundsFor и eventSounds, если звук включен и браузер его разрешил. */
export function play({ tick, chime, remind, events = [] }) {
  if (!(tick || chime || remind || events.length) || !soundOn() || !ac || ac.state !== 'running') return;
  let at = 0;
  for (const name of events) {
    const [dur, fn] = EVENT[name] || [0, () => {}];
    fn(at);
    at += dur * 0.8;
  }
  if (chime) chimeAt(at);
  else if (remind) remindAt(at);
  else if (tick && !events.length) tone(220, 0, 0.07, 0.07, 'triangle');
}
