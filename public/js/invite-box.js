// Блок приглашения (Денис 13.11, схема одобрена): QR-код, ссылка, «Скопировать ссылку» и «Сохранить QR».
// Один и тот же в «Кодах игроков» и в лобби стола. QR рисуется в браузере (qr.js): ссылка с токеном
// никуда не отправляется.
import { qrSvg, qrMatrix } from './qr.js';
import { esc, copy, toast } from './util.js';

export const QR_FILE = 'tigris-priglashenie.png';

/** Картинка кода или пусто: слишком длинный адрес сайта в код не поместится, а ссылка нужна и без него. */
function qrPicture(url) {
  try { return qrSvg(url); } catch { return ''; }
}

/**
 * Разметка блока. url: ссылка-приглашение целиком, note: подпись под кнопками, cls: свой класс блока.
 * Если код построить нельзя, блок остается со ссылкой и кнопкой «Скопировать» (ревью 13.11): ссылка
 * показывается один раз, терять ее из-за картинки нельзя.
 */
export function inviteBoxHTML(url, note, cls = '') {
  const pic = qrPicture(url);
  return `<div class="qrbox${cls ? ` ${cls}` : ''}">
    ${pic ? `<div class="qrpic">${pic}</div>` : ''}
    <div class="qrside">
      <code class="qrurl">${esc(url)}</code>
      <div class="qracts"><button class="btn sm" type="button" data-qrcopy>Скопировать ссылку</button>${pic ? '<button class="btn sm" type="button" data-qrsave>Сохранить QR</button>' : ''}</div>
      <p class="muted small qrnote">${esc(note)}</p>
    </div>
  </div>`;
}

/** Картинка PNG для отправки в мессенджер: черным по белому, scale точек на модуль, поля 4 модуля. */
export function qrPng(text, scale = 12, margin = 4) {
  const { size, modules } = qrMatrix(text);
  const side = (size + 2 * margin) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = side;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, side, side);
  g.fillStyle = '#000';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) g.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
}

/** Скачать картинку файлом. */
function download(blob) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = QR_FILE;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10000);
}

/**
 * Кнопки блока внутри root. Картинка готовится заранее, а не по нажатию: так «Сохранить QR» срабатывает
 * прямо в обработчике нажатия, без ожидания (телефонные браузеры иначе не дают ни скачать, ни поделиться).
 * На телефоне кнопка открывает «Поделиться» с картинкой (оттуда же ее можно сохранить), на компьютере
 * скачивает файл.
 */
export function bindInviteBox(root, url) {
  const box = root?.querySelector('.qrbox');
  if (!box) return;
  box.querySelector('[data-qrcopy]').addEventListener('click', () => copy(url));
  const save = box.querySelector('[data-qrsave]');
  if (!save) return;
  let blob = null;
  qrPng(url).then((b) => { blob = b; }).catch(() => {});
  save.addEventListener('click', () => {
    if (!blob) return toast('Картинка еще готовится, нажмите еще раз');
    try {
      const file = typeof File === 'function' ? new File([blob], QR_FILE, { type: 'image/png' }) : null;
      const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
      if (touch && file && navigator.canShare?.({ files: [file] })) {
        // отказ человека (AbortError) не ошибка; любой другой сбой: обычное скачивание
        navigator.share({ files: [file], title: 'Приглашение в «Тигр и Евфрат»' }).catch((e) => { if (e?.name !== 'AbortError') download(blob); });
        return;
      }
      download(blob);
    } catch {
      toast('Не получилось сохранить картинку: сделайте снимок экрана');
    }
  });
}
