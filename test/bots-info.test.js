// Карточки ботов (Денис 05.11): точки характера идут в том же порядке, что веса стилей; тексты
// без длинного тире и многоточия; окно знает все стили сайта и ставит ступени силы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOT_INFO, TRAITS, STRENGTH_GUIDE, guideHTML, botShort, stepChance, stepOf, dossierHTML } from '../public/js/bots-info.js';
import { LADDER } from '../public/js/bot-ladder.js';
import { LEVELS } from '../tools/calibration-levels.mjs';
import { STYLES } from '../public/js/util.js';
import { styleParams } from '../game/vendor/bot/styles.js';

// черта: как ее мерить по весам стиля (больше значит больше точек)
const MEASURE = {
  war: (p) => p.weights.bWar,
  revolt: (p) => p.weights.bRevolt,
  leader: (p) => p.weights.bLeaderNew,
  move: (p) => -p.relocate, // цена перестановки: чем дешевле, тем чаще переставляет
  weak: (p) => -p.weights.lowest.slice(1).reduce((a, b) => a + b, 0), // чем меньше вес сильных цветов, тем упорнее тянет слабейший
};

test('карточка у каждого стиля сайта, у каждой черты точки 1-5', () => {
  assert.deepEqual(Object.keys(BOT_INFO).sort(), Object.keys(STYLES).sort());
  for (const [k, b] of Object.entries(BOT_INFO)) {
    for (const [t] of TRAITS) assert.ok(b.traits[t] >= 1 && b.traits[t] <= 5, `${k}.${t}`);
    for (const f of ['tag', 'short', 'focus', 'made', 'fit']) assert.ok(b[f], `${k}.${f}`);
  }
  assert.deepEqual(TRAITS.map(([k]) => k).sort(), Object.keys(MEASURE).sort());
});

test('точки характера не противоречат весам стилей', () => {
  const styles = Object.keys(BOT_INFO);
  for (const [t, m] of Object.entries(MEASURE)) {
    for (const a of styles) for (const b of styles) {
      const va = m(styleParams({ style: a })), vb = m(styleParams({ style: b }));
      if (va > vb + 1e-9) assert.ok(BOT_INFO[a].traits[t] >= BOT_INFO[b].traits[t], `${t}: ${a} (${va}) не меньше ${b} (${vb})`);
    }
  }
});

test('тексты без длинного тире, многоточия и неразрывных пробелов', () => {
  const all = JSON.stringify([BOT_INFO, TRAITS, STRENGTH_GUIDE]) + guideHTML('denis', { canPick: true });
  assert.doesNotMatch(all, /[—…  ]/);
});

test('окно: вкладки всех стилей, кнопки только у хозяина, ступени силы в пределах ползунков', () => {
  const h = guideHTML('andrey', { canPick: true });
  for (const k of Object.keys(STYLES)) assert.match(h, new RegExp(`data-bgstyle="${k}"`));
  assert.match(h, /data-bgstyle="andrey" type="button"/);
  assert.match(h, /data-pickstyle="andrey"/);
  assert.equal((h.match(/data-pickstep=/g) || []).length, STRENGTH_GUIDE.length);
  assert.doesNotMatch(guideHTML('andrey'), /data-pick/, 'гость и не хозяин только читают');
  assert.match(guideHTML('нет такого'), /data-pickstyle|Универсальный/);
  for (const g of STRENGTH_GUIDE) {
    assert.ok(g.set.strength >= 0 && g.set.strength <= 100 && g.set.strength % 5 === 0);
    assert.ok(g.set.errors >= 0 && g.set.errors <= 30);
    assert.ok(['none', 'approx', 'exact'].includes(g.set.counting));
  }
  assert.equal(botShort('mix'), BOT_INFO.universal.short);
});

test('шансы по турниру ботов: те же ступени, шансы пары дают в сумме 100, у каждой ступени карточки строка шанса', () => {
  assert.deepEqual(LADDER.levels.map((l) => l.id), LEVELS.map((l) => l.id));
  assert.deepEqual(LADDER.levels.map((l) => l.set), LEVELS.map((l) => l.set), 'турнир играл нынешние ступени: после правки ступеней перезапустить tools/calibrate.mjs');
  const n = LADDER.levels.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) assert.ok(Math.abs(LADDER.chance[i][j] + LADDER.chance[j][i] - 100) <= 1);
  for (const g of STRENGTH_GUIDE) assert.ok(stepChance(g.set), g.title);
  assert.equal(stepChance({ strength: 33, errors: 1, counting: 'none' }), '', 'чужая настройка без строки');
  assert.match(guideHTML('universal'), /Шансы один на один по турниру ботов/);
});

test('досье бота: ступень при точном совпадении с шансом, иначе ближайшая по силе без шанса', () => {
  assert.deepEqual(stepOf({ strength: 50, errors: 5, counting: 'none' }), { title: 'Играю иногда', exact: true });
  assert.deepEqual(stepOf({ strength: 0, errors: 30, counting: 'none' }), { title: 'Самый слабый', exact: true });
  assert.deepEqual(stepOf({ strength: 80, errors: 5, counting: 'none' }), { title: 'Уверенный игрок', exact: false });
  assert.equal(stepOf({ strength: 65, errors: 5, counting: 'none' }).title, 'Играю иногда', 'поровну до 50 и 80: берем слабее');
  const bot = (set) => ({ name: 'Бот <3>', face: 'url(/img/bots/top.webp)', settings: { style: 'top', risk: 50, ...set } });
  const exact = dossierHTML(bot({ strength: 100, errors: 0, counting: 'exact', risk: 70 }));
  assert.match(exact, /Стиль Топ-мастера\./);
  assert.match(exact, /Сила 100, ошибки 0%, подсчет тайлов: точно, риск 70 \(чаще нападает\)/);
  assert.match(exact, /Ступень силы «Серьезный бой»\. Против бота по умолчанию выигрывает \d+%/);
  const near = dossierHTML(bot({ strength: 70, errors: 3, counting: 'approx', risk: 30 }));
  assert.match(near, /Ближе всего к ступени «Уверенный игрок»\. Точных шансов/);
  assert.match(near, /риск 30 \(бережет лидеров\)/);
  const g = guideHTML('top', { bot: bot({ strength: 50, errors: 5, counting: 'none' }) });
  assert.match(g, /<h2>Досье: Бот &lt;3&gt;<\/h2>/, 'имя экранировано');
  assert.match(g, /Ступень силы «Играю иногда»\. Это бот по умолчанию\./);
  assert.match(g, /<h3>Какого бота выбрать<\/h3>/);
  assert.doesNotMatch(guideHTML('top'), /Досье/, 'без бота окно как раньше');
  assert.doesNotMatch(exact + near, /[—…]/);
});
