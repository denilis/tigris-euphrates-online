// Чистые помощники кнопки «Скачать копию» (15.11): без браузера, их проверяет test/backup-box.test.js.

export const KEY = 'tigris.backupAt';
const DAY = 86_400_000;
export const BACKUP_FORMAT = 1; // как server/backup.js, сверяет test/backup-box.test.js

/** Имя файла копии: tigris-kopiya-2026-11-15.json (латиницей: файл уходит в «Загрузки» любого устройства). */
export const backupName = (at) => {
  const d = new Date(at);
  const p = (n) => String(n).padStart(2, '0');
  return `tigris-kopiya-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
};

const days = (n) => {
  const m10 = n % 10, m100 = n % 100;
  return `${n} ${m10 === 1 && m100 !== 11 ? 'день' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'дня' : 'дней'}`;
};

/** Подпись у кнопки: когда скачивали прошлую копию на этом устройстве; late, если прошло 7 дней и больше. */
export function ageLine(at, now = Date.now()) {
  if (!at) return { text: 'На этом устройстве копию еще не скачивали.', late: true };
  const d = new Date(at), p = (n) => String(n).padStart(2, '0');
  const when = `${p(d.getDate())}.${p(d.getMonth() + 1)}, ${p(d.getHours())}:${p(d.getMinutes())}`;
  const n = Math.floor((now - at) / DAY);
  return n >= 7 ? { text: `Прошлая копия: ${when}. Прошло ${days(n)}, пора скачать новую.`, late: true } : { text: `Прошлая копия: ${when} на этом устройстве.`, late: false };
}

/** Части в файл копии, как backupFile на сервере. */
export function packBackup(pages, at, site = '') {
  const keys = pages.flatMap((p) => p.keys);
  const count = {};
  for (const { k } of keys) {
    const kind = k.includes(':') ? k.slice(0, k.indexOf(':')) : k;
    count[kind] = (count[kind] || 0) + 1;
  }
  return { format: BACKUP_FORMAT, site, at: new Date(at).toISOString(), total: keys.length, count, keys };
}


/** Размер файла: до мегабайта в КБ, дальше в МБ с одним знаком. */
export const sizeText = (b) => (b < 1_048_576 ? `${Math.max(1, Math.round(b / 1024))} КБ` : `${(b / 1_048_576).toFixed(1).replace('.', ',')} МБ`);
