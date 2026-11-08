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
export function eventSounds(entries, me, result = null, on = () => true) {
  const has = (...evs) => entries.some((e) => evs.includes(e.ev));
  if (has('gameOver')) return on('gameEnd') ? ['gameEnd'] : [];
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
  // выставленный герой и тайл (Денис 08.11), ниже всех по важности
  if (has('leader')) out.push('leader');
  if (has('tile')) out.push('tile');
  // выключенный в меню звук (Денис 08.11) не занимает место: звучит следующий по важности
  return [...new Set(out)].filter(on).slice(0, 3);
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

// Общая громкость (Денис 08.11: «панель громче, тише»): шаг 10%, от 10 до 150%, 100% = выровненный
// уровень (SFX_GAIN). Все звуки идут через один узел master; выключает звук переключатель «Звук».
export const VOL = { min: 10, max: 150, step: 10, def: 100 };

/** Громкость в процентах из памяти устройства; чего-то не того там нет: 100. */
export function volume() {
  try {
    const v = Number(localStorage.getItem('tigris.volume'));
    return Number.isInteger(v) && v >= VOL.min && v <= VOL.max && v % VOL.step === 0 ? v : VOL.def;
  } catch { return VOL.def; }
}

/** Следующая громкость: dir 1 громче, -1 тише, в пределах VOL. */
export const nextVolume = (v, dir) => Math.min(VOL.max, Math.max(VOL.min, v + Math.sign(dir) * VOL.step));

let master = null;

export function setVolume(v) {
  try { localStorage.setItem('tigris.volume', String(v)); } catch { /* без памяти */ }
  if (master) master.gain.value = v / 100;
}

// Меню «какие звуки играть» (Денис 08.11): все звуки сайта по группам; выключенные помнит устройство.
export const SOUND_LIST = [
  { id: 'chime', group: 'Ход', label: 'Звон «Ваш ход»' },
  { id: 'turnEnd', group: 'Ход', label: 'Конец хода' },
  { id: 'warWin', group: 'Ваши бои', label: 'Победа в битве' },
  { id: 'warLoss', group: 'Ваши бои', label: 'Поражение в битве' },
  { id: 'revoltWin', group: 'Ваши бои', label: 'Победа в восстании' },
  { id: 'revoltLoss', group: 'Ваши бои', label: 'Поражение в восстании' },
  { id: 'battle', group: 'На поле', label: 'Чужой бой' },
  { id: 'monument', group: 'На поле', label: 'Монумент или чудо' },
  { id: 'catastrophe', group: 'На поле', label: 'Катастрофа' },
  { id: 'treasure', group: 'На поле', label: 'Сокровище' },
  { id: 'leader', group: 'На поле', label: 'Выставлен герой' },
  { id: 'tile', group: 'На поле', label: 'Выставлен тайл' },
  { id: 'gameEnd', group: 'Партия', label: 'Конец партии' },
  { id: 'arrive', group: 'Партия', label: 'Игрок зашёл за стол (в лобби)' },
];
const OFF_KEY = 'tigris.sounds.off';

/** Выключенные звуки из памяти устройства; что-то не то в памяти: все включены. */
function offSet() {
  try {
    const a = JSON.parse(localStorage.getItem(OFF_KEY) || '[]');
    return new Set(Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);
  } catch { return new Set(); }
}

function saveOff(s) {
  try { localStorage.setItem(OFF_KEY, JSON.stringify([...s])); } catch { /* без памяти */ }
}

export const soundEnabled = (id) => !offSet().has(id);

export function setSoundEnabled(id, on) {
  const s = offSet();
  if (on) s.delete(id); else s.add(id);
  saveOff(s);
}

export function setAllSounds(on) {
  saveOff(new Set(on ? [] : SOUND_LIST.map((x) => x.id)));
}

/** Куда подключать звуки: общий узел громкости. */
function out() {
  if (!master) {
    master = ac.createGain();
    master.gain.value = volume() / 100;
    master.connect(ac.destination);
  }
  return master;
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
  o.connect(g).connect(out());
  o.start(t);
  o.stop(t + dur + 0.02);
}

// звуки событий, которые синтезирует браузер: [длительность, как играть со сдвигом at]
const EVENT = {
  battle: [0.55, (at) => { tone(130, at, 0.22, 0.26, 'sine', 48); tone(120, at + 0.26, 0.26, 0.24, 'sine', 42); }],
  treasure: [0.35, (at) => { tone(2093, at, 0.12, 0.21); tone(2637, at + 0.07, 0.2, 0.18); }],
  // игрок зашел за стол в лобби: дверной звонок из двух нот
  arrive: [0.45, (at) => { tone(659, at, 0.18, 0.26); tone(880, at + 0.14, 0.3, 0.26); }],
};

/** «Ваш ход» (Денис 04.11: громче и мажорно, «сходи»): колокольчики вверх до-ми-соль-до. */
function chimeAt(at) {
  [523, 659, 784].forEach((f, i) => { tone(f, at + i * 0.11, 0.3, 0.23); tone(f * 2, at + i * 0.11, 0.2, 0.06, 'triangle'); });
  tone(1047, at + 0.33, 0.7, 0.25);
  tone(2094, at + 0.33, 0.4, 0.06, 'triangle');
}

// --- звуки из файлов Дениса (08.11): свой бой и восстание, конец партии; конец хода, монумент или чудо,
// тайл, герой, катастрофа. Монумент и катастрофа были синтезированы, теперь файлы. Часы просрочки
// Денис попросил убрать 08.11 (громко).

export const SFX = {
  warWin: '/sfx/war-win.mp3', revoltWin: '/sfx/revolt-win.mp3',
  warLoss: '/sfx/war-loss.mp3', revoltLoss: '/sfx/revolt-loss.mp3', gameEnd: '/sfx/game-end.mp3',
  turnEnd: '/sfx/turn-end.mp3', monument: '/sfx/monument.wav',
  tile: '/sfx/tile.mp3', leader: '/sfx/leader.mp3', catastrophe: '/sfx/catastrophe.wav',
};
// Громкость (Денис 08.11: «слишком громкие на некоторые события»): выровнена по самому громкому
// месту звука, окно 0,4 с с K-взвешиванием BS.1770 (tools/sfx-loudness.browser.js). Прежнее выравнивание
// по средней громкости пропускало удар в начале длинных звуков: проигрыш в битве был на 7 дБ громче.
// Уровни: события (бой, восстание, катастрофа, монумент, конец партии) -21; «Ваш ход» -22; частые
// (конец хода, тайл, герой, чужой бой, звонок в лобби) -26; сокровище -27.
export const SFX_GAIN = {
  warWin: 0.51, revoltWin: 0.5, warLoss: 0.36, revoltLoss: 0.28, gameEnd: 0.72,
  turnEnd: 0.135, monument: 0.46, tile: 3.4, leader: 1.29, catastrophe: 0.28,
};
// длительность слышимой части по тому же замеру: пока файл не загружен, по ней идет очередь звуков
const SFX_SEC = { warWin: 2.1, revoltWin: 2.3, warLoss: 3.4, revoltLoss: 4.8, gameEnd: 6.5, turnEnd: 1.9, monument: 1.3, tile: 0.3, leader: 0.8, catastrophe: 4.9 };
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

/** Запустить загруженный файл v в момент t0 (время AudioContext); возвращает источник. */
function startSfx(name, v, t0) {
  if (!v?.buf) return null;
  const src = ac.createBufferSource(), g = ac.createGain();
  src.buffer = v.buf;
  g.gain.value = SFX_GAIN[name] ?? 0.6;
  src.connect(g).connect(out());
  src.start(Math.max(ac.currentTime, t0), v.from, v.to - v.from);
  return src;
}

/** Сыграть файл через at секунд; возвращает, сколько он звучит. Не загружен: сыграет, как загрузится. */
function sfxAt(name, at) {
  const t0 = ac.currentTime + at;
  const start = (v) => startSfx(name, v, t0);
  const v = sfx.get(name);
  if (v?.buf) {
    start(v);
    return v.to - v.from;
  }
  Promise.resolve(v || loadSfx(name)).then(start);
  return SFX_SEC[name];
}

/**
 * Сыграть звуки из soundsFor и eventSounds, если звук включен и браузер его разрешил. Следующий звук
 * вступает на 80% предыдущего, но не позже чем через 2 с (катастрофа длинная). Конец хода звучит
 * после звуков событий (раньше щелчок молчал, если был звук события); «Ваш ход» вместо него.
 */
export function play({ tick, chime, events = [] }) {
  events = events.filter(soundEnabled); // выключенные в меню молчат
  const ring = chime && soundEnabled('chime'), click = !chime && tick && soundEnabled('turnEnd');
  if (!(ring || click || events.length) || !soundOn() || !ac || ac.state !== 'running') return;
  let at = 0;
  for (const name of events) {
    if (SFX[name]) {
      at += Math.min(2, sfxAt(name, at) * 0.8);
      continue;
    }
    const [dur, fn] = EVENT[name] || [0, () => {}];
    fn(at);
    at += dur * 0.8;
  }
  if (ring) chimeAt(at);
  else if (click) sfxAt('turnEnd', at);
}

let previewSrc = null;

/**
 * Прослушать звук id из меню (кнопка «▶»): играет с текущей громкостью, даже если он выключен в меню
 * или выключен весь звук: нажали сами. Прошлый пример из файла обрывается, чтобы не наслаивались.
 */
export function previewSound(id) {
  try { ac ??= new AudioContext(); } catch { return; }
  const go = () => {
    if (ac.state !== 'running') return;
    try { previewSrc?.stop(); } catch { /* уже отзвучал */ }
    previewSrc = null;
    if (id === 'chime') return chimeAt(0);
    if (SFX[id]) {
      const t0 = ac.currentTime;
      Promise.resolve(sfx.get(id) || loadSfx(id)).then((v) => { previewSrc = startSfx(id, v, t0); });
      return;
    }
    EVENT[id]?.[1](0);
  };
  if (ac.state === 'running') go();
  else ac.resume().then(go, () => { /* без звука */ });
}

/** Пример громкости после «тише» или «громче»: звук монумента (уровень событий, -21, 1,3 с). */
export function previewVolume() {
  if (soundOn()) previewSound('monument');
}
