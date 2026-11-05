// Карточки ботов (Денис 05.11): точки характера идут в том же порядке, что веса стилей; тексты
// без длинного тире и многоточия; окно знает все стили сайта и ставит ступени силы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOT_INFO, TRAITS, STRENGTH_GUIDE, guideHTML, botShort } from '../public/js/bots-info.js';
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
