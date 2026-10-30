// Вход по личному коду: формат кода, отпечаток, подпись сессии (спецификация A0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCode, normalizeCode, codeHash, signSession, readSession, CODE_ALPHABET } from '../server/auth.js';
import { makeRng } from '../game/vendor/engine/rng.js';

const SECRET = 'test-secret', PEPPER = 'test-pepper';

test('код: 12 знаков без похожих букв, по 4 через дефис', () => {
  const seen = new Set();
  for (let k = 0; k < 200; k++) {
    const c = newCode();
    assert.match(c, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    for (const ch of c.replace(/-/g, '')) assert.ok(CODE_ALPHABET.includes(ch), ch);
    seen.add(c);
  }
  assert.equal(seen.size, 200);
  for (const ch of '01OIL') assert.ok(!CODE_ALPHABET.includes(ch));
});

test('ввод кода прощает регистр, пробелы, дефисы и русские буквы-двойники', () => {
  assert.equal(normalizeCode(' abcd-efgh-jk23 '), 'ABCDEFGHJK23');
  assert.equal(normalizeCode('АВСЕ НКМР ТХ23'), 'ABCEHKMPTX23'); // кириллица
  assert.equal(normalizeCode('abcd efg'), null, 'короткий код');
  assert.equal(normalizeCode('ABCD-EFGH-JK2!'), null, 'чужой знак');
  assert.equal(normalizeCode('A'.repeat(5_000_000)), null, 'огромный ввод отбрасывается сразу');
  assert.equal(normalizeCode(`${' '.repeat(100)}ABCD-EFGH-JK23`), null, 'длиннее любого кода с пробелами');
});

test('отпечаток кода зависит от соли и одинаков для любой записи кода', () => {
  assert.equal(codeHash('abcd-efgh-jk23', PEPPER), codeHash('ABCDEFGHJK23', PEPPER));
  assert.notEqual(codeHash('ABCDEFGHJK23', PEPPER), codeHash('ABCDEFGHJK23', 'other'));
  assert.notEqual(codeHash('ABCDEFGHJK23', PEPPER), codeHash('ABCDEFGHJK24', PEPPER));
  assert.match(codeHash('ABCDEFGHJK23', PEPPER), /^[0-9a-f]{64}$/);
});

test('сессия: подпись проверяется, подделка и чужой секрет отклоняются', () => {
  const tok = signSession('u-andrey', SECRET, 1000);
  assert.deepEqual(readSession(tok, SECRET), { userId: 'u-andrey', iat: 1000, epoch: 0 });
  assert.equal(readSession(signSession('u-andrey', SECRET, 1000, 3), SECRET).epoch, 3, 'номер сессии в токене');
  assert.equal(readSession(tok, 'other-secret'), null);
  const [body, sig] = tok.split('.');
  const forged = Buffer.from(JSON.stringify({ u: 'u-admin', iat: 1000 })).toString('base64url') + '.' + sig;
  assert.equal(readSession(forged, SECRET), null);
  for (const bad of ['', 'abc', 'a.b.c', null, undefined, body + '.']) assert.equal(readSession(bad, SECRET), null);
});

test('коды из генератора случайности не повторяются и на детерминированном rng', () => {
  const r = makeRng(1);
  assert.notEqual(newCode(r), newCode(r));
});
