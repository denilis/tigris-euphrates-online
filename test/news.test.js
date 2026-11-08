// «Что нового за неделю» на главной (Денис 08.11): дни старше недели уходят сами, последний раскрыт.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEWS, recentNews, newsHTML } from '../public/js/news.js';

const at = (d) => new Date(`${d}T12:00:00`).getTime();

test('за неделю: дни за последние 7 суток, новые сверху', () => {
  const days = recentNews(at('2026-11-08')).map((d) => d.date);
  assert.deepEqual(days, [...days].sort().reverse(), 'новые сверху');
  assert.ok(days.includes('2026-11-08') && days.includes('2026-11-03'));
  assert.ok(recentNews(at('2026-11-09')).some((d) => d.date === '2026-11-03'), 'шестой день назад еще виден');
  assert.ok(!recentNews(at('2026-11-10')).some((d) => d.date === '2026-11-03'), 'седьмой день назад ушел');
  assert.deepEqual(recentNews(at('2026-12-31')), [], 'через месяц пусто');
});

test('разметка: последний день раскрыт, остальные свернуты; пусто: блока нет', () => {
  const html = newsHTML(recentNews(at('2026-11-08')));
  assert.match(html, /<h2>Что нового за неделю<\/h2>/);
  const opens = html.match(/<details[^>]*>/g);
  assert.equal(opens[0], '<details class="nday" open>');
  assert.ok(opens.slice(1).every((d) => d === '<details class="nday">'));
  assert.match(html, /<summary>8 ноября<\/summary>/);
  assert.equal(newsHTML([]), '');
});

test('текст без длинного тире, многоточия и неразрывных пробелов (правило Дениса)', () => {
  for (const d of NEWS) {
    assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(d.items.length);
    for (const s of d.items) assert.doesNotMatch(s, /[—…   ]/, s.slice(0, 40));
  }
});
