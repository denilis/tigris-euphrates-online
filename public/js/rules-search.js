// Поиск по правилам: чистые функции без DOM. В русском слово меняет окончание, поэтому
// ищем по основе: «война» находит «войны» и «войне».

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');

/** Основа слова для поиска. */
export function stem(word) {
  const w = norm(word);
  if (w.length >= 6) return w.slice(0, -2);
  if (w.length >= 4 && /[аеиоуыэюяйь]$/.test(w)) return w.slice(0, -1);
  return w;
}

const stems = (query) => norm(query).split(/[^a-zа-я0-9]+/).filter((w) => w.length >= 2).map(stem);

/** Разделы, где есть все слова запроса; пустой запрос оставляет все. */
export function searchRules(sections, query) {
  const list = stems(query);
  if (!list.length) return sections;
  return sections.filter((s) => {
    const text = norm([s.title, ...s.body].join(' '));
    return list.every((w) => text.includes(w));
  });
}

/** Текст на куски для подсветки: { text, hit }, hit у найденных слов целиком. */
export function markParts(text, query) {
  const list = stems(query);
  if (!list.length) return [{ text, hit: false }];
  const parts = [];
  let at = 0;
  for (const m of text.matchAll(new RegExp(`(?:${list.join('|')})[а-яё0-9a-z]*`, 'giu'))) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index), hit: false });
    parts.push({ text: m[0], hit: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}
