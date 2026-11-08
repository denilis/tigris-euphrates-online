// Разбор партии ботом скрыт (решение Дениса 08.11): ни блока на экране итога, ни подсказок в просмотре.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ANALYSIS_SHOWN } from '../public/js/util.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('разбор скрыт и на экране итога, и в просмотре партии', () => {
  assert.equal(ANALYSIS_SHOWN, false);
  assert.match(src('../public/js/end.js'), /g\.replay && ANALYSIS_SHOWN \? '<div class="ana" id="eAna">/);
  assert.match(src('../public/js/replay.js'), /ANALYSIS_SHOWN \? hintsAt\(data\.analysis, k\) : \[\]/);
});
