// «Резервная копия базы» внизу «Кодов игроков» (15.11, дорожная карта п.3, схема одобрена Денисом):
// только главный администратор. Части берутся с GET /api/admin/backup, склеиваются в один файл
// в формате server/backup.js (backupFile) и скачиваются. Когда скачивали прошлый раз, помнит браузер.
import { api } from './api.js';
import { KEY, ageLine, packBackup, backupName, sizeText } from './backup-core.js';

export const backupHTML = () => `<h2>Резервная копия базы</h2>
    <p class="muted">Все игроки, партии, турниры и фото одним файлом. Раз в неделю скачивайте копию и кладите в папку «Тигрис/резервные-копии» на Google Диске.</p>
    <div class="jlinks"><button class="btn" id="bkGo" type="button">Скачать копию</button><span class="small" id="bkNote" role="status"></span></div>`;

const readAt = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; } };
const saveAt = (at) => { try { localStorage.setItem(KEY, String(at)); } catch { /* без памяти */ } };

/** Кнопка внутри root: части по очереди, ход скачивания в подписи, потом файл. */
export function bindBackup(root) {
  const btn = root.querySelector('#bkGo'), note = root.querySelector('#bkNote');
  if (!btn) return;
  const paint = () => {
    const a = ageLine(readAt());
    note.textContent = a.text;
    note.className = `small ${a.late ? 'bklate' : 'muted'}`;
  };
  paint();
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const pages = [];
    let cursor = '0', n = 0;
    try {
      do {
        note.className = 'small muted';
        note.textContent = `Скачиваю: часть ${pages.length + 1}, записей ${n}`;
        const p = await api('GET', `admin/backup?cursor=${encodeURIComponent(cursor)}`);
        pages.push(p);
        n += p.keys.length;
        cursor = String(p.cursor);
        if (pages.length > 500) throw new Error('слишком много частей');
      } while (cursor !== '0');
      const at = Date.now();
      const blob = new Blob([JSON.stringify(packBackup(pages, at, location.host))], { type: 'application/json' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = backupName(at);
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 30_000);
      saveAt(at);
      paint();
      note.textContent = `Готово: ${a.download}, записей ${n}, ${sizeText(blob.size)}. ${note.textContent}`;
    } catch (e) {
      note.className = 'small bklate';
      note.textContent = `Копия не скачалась: ${e.message || 'нет связи'}. Попробуйте еще раз.`;
    } finally {
      btn.disabled = false;
    }
  });
}
