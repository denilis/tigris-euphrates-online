// Сигналы «ваш ход» (просьба Дениса 03.11): переход хода было не видно. Тихий щелчок, когда
// закончился любой ход, двойной звон, когда решать вам; заголовок вкладки и мигающая надпись,
// когда время хода вышло. Звук синтезирует браузер, файлов нет. Выбор «Звук» помнит браузер.

/** Снимок партии для сигналов: чей ход и решает ли смотрящий. */
export const snapOf = (view) => ({
  code: view.code, turn: view.game.turn, cur: view.game.cur,
  mine: Boolean(view.game.legal) && !view.game.over && !view.game.stopped,
});

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

function tone(freq, at, dur, gain, type = 'sine') {
  const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Сыграть звуки из soundsFor, если звук включен и браузер его разрешил. */
export function play({ tick, chime }) {
  if (!(tick || chime) || !soundOn() || !ac || ac.state !== 'running') return;
  if (chime) {
    tone(660, 0, 0.22, 0.12);
    tone(990, 0.15, 0.32, 0.1);
  } else {
    tone(220, 0, 0.07, 0.05, 'triangle');
  }
}
