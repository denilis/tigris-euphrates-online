// Сигналы «ваш ход»: когда звучит щелчок и звон, что пишется в заголовке вкладки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { snapOf, soundsFor, titleFor, newEntries, eventSounds, SFX, SFX_GAIN, VOL, volume, nextVolume, setVolume, SOUND_LIST, soundEnabled, setSoundEnabled, setAllSounds } from '../public/js/signals.js';

const view = (turn, cur, legal = null, extra = {}) => ({ code: 'AAAAAA', game: { turn, cur, legal, over: false, stopped: false, ...extra } });

test('звуки: при первом взгляде на стол тишина', () => {
  assert.deepEqual(soundsFor(null, snapOf(view(5, 1, [{}]))), { tick: false, chime: false });
  const other = { ...snapOf(view(5, 1)), code: 'BBBBBB' };
  assert.deepEqual(soundsFor(other, snapOf(view(6, 2, [{}]))), { tick: false, chime: false }, 'другой стол');
});

test('звуки: щелчок на смене хода, звон, когда решать вам (без щелчка поверх)', () => {
  const a = snapOf(view(5, 1));
  assert.deepEqual(soundsFor(a, snapOf(view(5, 1))), { tick: false, chime: false }, 'ничего не изменилось');
  assert.deepEqual(soundsFor(a, snapOf(view(5, 2))), { tick: true, chime: false }, 'ход перешел к другому');
  assert.deepEqual(soundsFor(a, snapOf(view(6, 0, [{}]))), { tick: false, chime: true }, 'ход перешел ко мне');
  const mine = snapOf(view(6, 0, [{}]));
  assert.deepEqual(soundsFor(mine, snapOf(view(6, 0, [{}]))), { tick: false, chime: false }, 'второе действие того же хода');
  assert.deepEqual(soundsFor(a, snapOf(view(5, 1, [{}]))), { tick: false, chime: true }, 'решать в чужом ходу: защита в бою');
  assert.equal(snapOf(view(6, 0, [{}], { over: true })).mine, false, 'партия кончилась: решать нечего');
});

test('заголовок: свой ход отмечен, просрочка мигает, чужой ход возвращает прежний заголовок', () => {
  const base = 'Тигр и Евфрат';
  assert.equal(titleFor(base, false, false, 0), base);
  assert.equal(titleFor(base, true, false, 0), '● Ваш ход | ' + base);
  assert.equal(titleFor(base, true, true, 1000), 'Сделайте ход! | ' + base);
  assert.equal(titleFor(base, true, true, 2000), '● Ваш ход | ' + base);
  assert.equal(titleFor('Сделайте ход! | ' + base, false, false, 0), base, 'ход сделан: метка уходит');
  const invite = '(1) Приглашение | ' + base;
  assert.equal(titleFor(invite, true, false, 0), '● Ваш ход | ' + invite, 'приглашение не теряется');
});

// Звуки событий (просьба Дениса 04.11): только новое в журнале, не больше трех, по важности.

const withLog = (log, extra = {}) => ({ code: 'AAAAAA', game: { turn: 3, cur: 0, legal: null, over: false, stopped: false, log, logTotal: log.length, logEpoch: 0, ...extra } });

test('звуки событий: только записи, появившиеся с прошлого взгляда', () => {
  const a = [{ ev: 'tile' }, { ev: 'tile' }];
  const b = [...a, { ev: 'war', winner: 1 }, { ev: 'score' }];
  assert.deepEqual(newEntries(null, withLog(b)), [], 'первый взгляд');
  assert.deepEqual(newEntries(snapOf(withLog(a)), withLog(b)).map((e) => e.ev), ['war', 'score']);
  assert.deepEqual(newEntries(snapOf(withLog(b)), withLog(b)), [], 'ничего нового');
  assert.deepEqual(newEntries(snapOf(withLog(a)), withLog(b, { logEpoch: 1 })), [], 'отмена: журнал перечитан');
  assert.deepEqual(newEntries({ ...snapOf(withLog(a)), code: 'BBBBBB' }, withLog(b)), [], 'другой стол');
  assert.deepEqual(newEntries(snapOf(withLog(a)), withLog(b.slice(0, 3), { logTotal: 4 })), [], 'журнал пришел не целиком');
});

test('звуки событий: бой, своя победа, монумент, катастрофа, сокровище, конец', () => {
  assert.deepEqual(eventSounds([{ ev: 'war', winner: 2 }], 1), ['battle']);
  assert.deepEqual(eventSounds([{ ev: 'revolt', winner: 1 }], 1), ['revoltWin']);
  assert.deepEqual(eventSounds([{ ev: 'monument' }, { ev: 'treasure' }], 0), ['monument', 'treasure']);
  assert.deepEqual(eventSounds([{ ev: 'catastrophe' }], null), ['catastrophe']);
  assert.deepEqual(eventSounds([{ ev: 'score' }, { ev: 'unite' }], 0), []);
  const all = [{ ev: 'treasure' }, { ev: 'catastrophe' }, { ev: 'monument' }, { ev: 'war', winner: 0 }, { ev: 'gameOver' }];
  assert.deepEqual(eventSounds(all, 0), ['gameEnd'], 'конец партии: только звук финальной таблицы');
  const many = [{ ev: 'treasure' }, { ev: 'catastrophe' }, { ev: 'monument' }, { ev: 'war', winner: 2 }];
  assert.deepEqual(eventSounds(many, 0), ['battle', 'monument', 'catastrophe'], 'не больше трех, важное первым');
});

test('звуки своего боя и конца партии из файлов (Денис 08.11)', () => {
  const war = { ev: 'war', att: 0, def: 1, winner: 0, loser: 1 };
  assert.deepEqual(eventSounds([war], 0), ['warWin']);
  assert.deepEqual(eventSounds([war], 1), ['warLoss']);
  assert.deepEqual(eventSounds([war], 2), ['battle'], 'чужой бой: только удары');
  const revolt = { ev: 'revolt', att: 1, def: 0, winner: 0, loser: 1 };
  assert.deepEqual(eventSounds([revolt], 0), ['revoltWin']);
  assert.deepEqual(eventSounds([revolt], 1), ['revoltLoss']);
  // две войны за ход: одну выиграл, другую проиграл; звучит победа
  assert.deepEqual(eventSounds([{ ...war, winner: 1, loser: 0 }, { ev: 'war', att: 0, def: 2, winner: 0, loser: 2 }], 0), ['warWin']);
  const result = { seats: [{ seatId: 0, place: 1 }, { seatId: 1, place: 2 }, { seatId: 2, place: 3 }] };
  for (const me of [0, 1, 2, null]) assert.deepEqual(eventSounds([{ ev: 'gameOver' }], me, result), ['gameEnd'], `место ${me}`);
});

test('файлы звуков лежат на сайте: mp3 или wav, не тяжелые', () => {
  for (const [name, url] of Object.entries(SFX)) {
    const buf = readFileSync(new URL(`../public${url}`, import.meta.url));
    assert.ok(buf.length > 5000 && buf.length < 250000, `${name}: ${buf.length} байт`);
    const mp3 = (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) || buf.slice(0, 3).toString() === 'ID3';
    const wav = buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WAVE';
    assert.ok(url.endsWith('.wav') ? wav : mp3, `${name}: формат не тот`);
  }
  assert.deepEqual(Object.keys(SFX).sort(), ['catastrophe', 'gameEnd', 'leader', 'monument', 'revoltLoss', 'revoltWin', 'tile', 'turnEnd', 'warLoss', 'warWin']);
});

test('звуки хода (Денис 08.11): тайл, герой, монумент или чудо, катастрофа', () => {
  assert.deepEqual(eventSounds([{ ev: 'tile', c: 0 }], 0), ['tile']);
  assert.deepEqual(eventSounds([{ ev: 'leader', c: 3 }], 1), ['leader']);
  assert.deepEqual(eventSounds([{ ev: 'tile' }, { ev: 'monument' }], 0), ['monument', 'tile']);
  assert.deepEqual(eventSounds([{ ev: 'wonder' }], 0), ['monument'], 'чудо звучит как монумент');
  assert.deepEqual(eventSounds([{ ev: 'catastrophe' }, { ev: 'leaderReturned' }], 2), ['catastrophe']);
  // своя битва важнее тайла, который ее начал; больше трех не звучит
  const war = { ev: 'war', att: 0, def: 1, winner: 0, loser: 1 };
  assert.deepEqual(eventSounds([{ ev: 'tile' }, war, { ev: 'treasure' }, { ev: 'leader' }], 0), ['warWin', 'treasure', 'leader']);
});

test('у каждого звука свое усиление, частые тише событий (Денис 08.11: «слишком громкие»)', () => {
  assert.deepEqual(Object.keys(SFX_GAIN).sort(), Object.keys(SFX).sort());
  for (const [name, g] of Object.entries(SFX_GAIN)) assert.ok(g > 0.05 && g < 4, `${name}: ${g}`);
  // замер tools/sfx-loudness.browser.js: самое громкое место проигрыша в битве было на 7 дБ выше победы
  assert.ok(SFX_GAIN.warLoss < SFX_GAIN.warWin && SFX_GAIN.revoltLoss < SFX_GAIN.revoltWin);
  assert.ok(SFX_GAIN.turnEnd < 0.2, 'конец хода звучит каждый ход: тихо');
});

/** Память браузера на время теста. */
function withStorage(init, fn) {
  const m = new Map(Object.entries(init));
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) } });
  try { return fn(m); } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete globalThis.localStorage;
  }
}

test('громкость (Денис 08.11: «громче, тише»): шаг 10%, от 10 до 150, по умолчанию 100', () => {
  assert.deepEqual(VOL, { min: 10, max: 150, step: 10, def: 100 });
  assert.equal(nextVolume(100, 1), 110);
  assert.equal(nextVolume(100, -1), 90);
  assert.equal(nextVolume(150, 1), 150, 'выше 150 нет');
  assert.equal(nextVolume(10, -1), 10, 'тише 10 нет: выключает звук переключатель «Звук»');
});

test('громкость запоминается на устройстве, мусор в памяти дает 100', () => {
  assert.equal(volume(), 100, 'без памяти браузера');
  withStorage({}, (m) => {
    assert.equal(volume(), 100);
    setVolume(70);
    assert.equal(m.get('tigris.volume'), '70');
    assert.equal(volume(), 70);
  });
  for (const bad of ['', 'abc', '0', '5', '75', '160', '-10', '1e2x']) {
    withStorage({ 'tigris.volume': bad }, () => assert.equal(volume(), 100, `в памяти «${bad}»`));
  }
  withStorage({ 'tigris.volume': '150' }, () => assert.equal(volume(), 150));
});

test('меню звуков (Денис 08.11): в перечне все звуки сайта, по группам, с подписями', () => {
  const ids = SOUND_LIST.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'без повторов');
  assert.deepEqual([...ids].sort(), [...Object.keys(SFX), 'battle', 'treasure', 'chime', 'arrive'].sort());
  for (const s of SOUND_LIST) assert.ok(s.label && s.group, s.id);
});

test('выбор звуков запоминается на устройстве; мусор в памяти: все включены', () => {
  assert.equal(soundEnabled('tile'), true, 'без памяти браузера');
  withStorage({}, (m) => {
    assert.ok(SOUND_LIST.every((s) => soundEnabled(s.id)), 'по умолчанию все');
    setSoundEnabled('tile', false);
    setSoundEnabled('turnEnd', false);
    assert.equal(soundEnabled('tile'), false);
    assert.equal(soundEnabled('leader'), true);
    assert.deepEqual(JSON.parse(m.get('tigris.sounds.off')).sort(), ['tile', 'turnEnd']);
    setSoundEnabled('tile', true);
    assert.deepEqual(JSON.parse(m.get('tigris.sounds.off')), ['turnEnd']);
    setAllSounds(false);
    assert.ok(SOUND_LIST.every((s) => !soundEnabled(s.id)), 'выключить все');
    setAllSounds(true);
    assert.ok(SOUND_LIST.every((s) => soundEnabled(s.id)), 'включить все');
  });
  for (const bad of ['', '{', '7', '"tile"', '{"a":1}']) {
    withStorage({ 'tigris.sounds.off': bad }, () => assert.equal(soundEnabled('tile'), true, `в памяти «${bad}»`));
  }
});

test('выключенный звук не занимает место: вместо него следующий по важности', () => {
  const many = [{ ev: 'treasure' }, { ev: 'catastrophe' }, { ev: 'monument' }, { ev: 'war', winner: 2 }];
  const off = (...ids) => (id) => !ids.includes(id);
  assert.deepEqual(eventSounds(many, 0, null, off('monument')), ['battle', 'catastrophe', 'treasure']);
  assert.deepEqual(eventSounds([{ ev: 'gameOver' }, { ev: 'monument' }], 0, null, off('gameEnd')), [], 'конец партии выключен: тишина');
  const war = { ev: 'war', att: 0, def: 1, winner: 0, loser: 1 };
  assert.deepEqual(eventSounds([war, { ev: 'tile' }], 0, null, off('warWin')), ['tile']);
});
