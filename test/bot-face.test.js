// Портреты ботов: свой у каждого стиля из списка, файл на месте, неизвестный стиль получает
// универсальный портрет, у человека фото, а не портрет бота.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { STYLES, BOT_FACES, botFace, faceBg } from '../public/js/util.js';

test('у каждого стиля бота свой портрет, и файл есть', () => {
  for (const style of Object.keys(STYLES)) {
    assert.ok(BOT_FACES.includes(style), style);
    const src = botFace({ kind: 'bot', bot: { style } });
    assert.equal(src, `/img/bots/${style}.webp`);
    assert.ok(existsSync(new URL(`../public${src}`, import.meta.url)), src);
  }
  for (const style of BOT_FACES) assert.ok(existsSync(new URL(`../public/img/bots/${style}.webp`, import.meta.url)), style);
});

test('стили игроков получают лицо игрока, а не универсальный портрет', () => {
  for (const style of ['denis', 'andrey', 'vlad']) assert.equal(botFace({ kind: 'bot', bot: { style } }), `/img/bots/${style}.webp`);
});

test('неизвестный стиль и бот без стиля получают универсальный портрет', () => {
  assert.equal(botFace({ kind: 'bot', bot: { style: 'gold' } }), '/img/bots/universal.webp');
  assert.equal(botFace({ kind: 'bot' }), '/img/bots/universal.webp');
});

test('у бота портрет поверх жетона, у человека фото поверх жетона', () => {
  assert.match(faceBg({ kind: 'bot', hero: 'lion', bot: { style: 'vlad' } }), /^url\(\/img\/bots\/vlad\.webp\),url\(\/img\/tokens\/lion_red\.png\)$/);
  assert.match(faceBg({ avatar: 'abc', hero: 'bow' }, 1), /^url\(\/api\/avatar\/abc\),url\(\/img\/tokens\/bow_blue\.png\)$/);
  assert.doesNotMatch(faceBg({ hero: 'pot' }), /img\/bots/);
});
