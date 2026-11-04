// Картинка итога партии (этап 4 пакета 04.11, схема одобрена Денисом): финальное поле, места,
// итоги, очки по цветам в порядке BGA и строка турнира одной картинкой 1600 на 1000. Скачать
// может каждый; отправить в чат ДВАК можно только по нажатию, если за столом только свои.
// Поле берется из того же svg, что на экране: картинки внутри заменяются на data:, иначе canvas
// их не нарисует, а элементы, которым нужны стили страницы (щелчки, подсветки), убираются.
import { api } from './api.js';
import { HEX, SCORE_ORDER, esc } from './util.js';
import { canSendPhoto, pictureRows, tourLine, PICTURE_DROP, pictureName } from './endshot-core.js';

const W = 1600, H = 1000;

async function dataUrl(url) {
  const blob = await (await fetch(url)).blob();
  return new Promise((ok, no) => {
    const fr = new FileReader();
    fr.onload = () => ok(fr.result);
    fr.onerror = no;
    fr.readAsDataURL(blob);
  });
}

/** Поле картинкой: копия svg без лишнего, все картинки внутри как data:. */
async function boardImage(svg) {
  const clone = svg.cloneNode(true);
  clone.querySelectorAll(PICTURE_DROP).forEach((e) => e.remove());
  const [, , vw, vh] = (svg.getAttribute('viewBox') || '0 0 990 690').split(/\s+/).map(Number);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', vw);
  clone.setAttribute('height', vh);
  const cache = new Map();
  for (const im of clone.querySelectorAll('image')) {
    const href = im.getAttribute('href');
    if (!href || href.startsWith('data:')) continue;
    if (!cache.has(href)) cache.set(href, dataUrl(href));
    im.setAttribute('href', await cache.get(href));
  }
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { img, vw, vh };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function roundRect(x, X, Y, w, h, r) {
  x.beginPath();
  x.roundRect(X, Y, w, h, r);
  x.fill();
}

/** Нарисовать картинку итога: Blob jpeg. tours — список турниров или null. */
export async function makePicture(view, svg, tours) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#2a2017');
  bg.addColorStop(1, '#14110e');
  x.fillStyle = bg;
  x.fillRect(0, 0, W, H);

  // шапка: название, стол, поле, дата
  x.fillStyle = '#e0b65a';
  x.font = '600 42px Cinzel, Georgia, serif';
  x.fillText('Тигр и Евфрат', 44, 72);
  const tw = x.measureText('Тигр и Евфрат').width;
  const day = new Date(view.game.result.finishedAt || Date.now()).toLocaleDateString('ru-RU');
  const board = view.options.board === 'advanced' ? 'Продвинутое поле' : 'Обычное поле';
  x.fillStyle = '#d8cbb2';
  x.font = '26px Georgia, serif';
  x.fillText(`Стол ${view.title || view.code}  |  ${board}  |  ${day}`, 44 + tw + 30, 70);
  x.fillStyle = 'rgba(224,182,90,.45)';
  x.fillRect(44, 96, W - 88, 2);

  // финальное поле слева
  const { img, vw, vh } = await boardImage(svg);
  const bw = 1040, bh = (bw * vh) / vw;
  x.drawImage(img, 40, 120, bw, bh);

  // места справа
  const rows = pictureRows(view);
  const L = 1120;
  let y = 150;
  x.fillStyle = '#a8987c';
  x.font = '600 18px "Segoe UI", sans-serif';
  x.fillText('ИТОГ ПАРТИИ', L, y);
  y += 30;
  for (const r of rows) {
    x.fillStyle = 'rgba(255,255,255,.04)';
    roundRect(x, L - 12, y, W - L - 30, 118, 12);
    x.fillStyle = r.place === 1 ? '#e0b65a' : '#d8cbb2';
    x.font = '600 46px Georgia, serif';
    x.fillText(String(r.place), L, y + 56);
    x.font = '30px Georgia, serif';
    x.fillText(r.name, L + 50, y + 48);
    x.font = '600 46px Georgia, serif';
    x.textAlign = 'right';
    x.fillText(String(r.final), W - 58, y + 56);
    x.textAlign = 'left';
    // плашки цветов в порядке BGA и сокровища
    let cx = L + 50;
    for (const k of SCORE_ORDER) {
      x.fillStyle = HEX[k];
      roundRect(x, cx, y + 70, 54, 34, 6);
      if (k === 3) { x.strokeStyle = '#cfc6b4'; x.lineWidth = 1.5; x.strokeRect(cx + 0.5, y + 70.5, 53, 33); }
      x.fillStyle = '#fff';
      x.font = '700 22px "Segoe UI", sans-serif';
      x.textAlign = 'center';
      x.fillText(String(r.score[k]), cx + 27, y + 95);
      x.textAlign = 'left';
      cx += 62;
    }
    x.fillStyle = '#d8cbb2';
    x.font = '22px "Segoe UI", sans-serif';
    x.fillText(`+${r.treasures} сокр.`, cx + 6, y + 95);
    y += 134;
  }

  // строка турнира
  const tour = tours ? tourLine(tours, view) : null;
  if (tour) {
    x.fillStyle = '#a8987c';
    x.font = '600 18px "Segoe UI", sans-serif';
    x.fillText('ЗАЧЕТ ТУРНИРА', L, y + 20);
    x.fillStyle = '#e8dcc4';
    x.font = '24px Georgia, serif';
    // перенос по словам в ширину колонки
    let line = '', ly = y + 56;
    for (const word of tour.split(' ')) {
      const t = line ? `${line} ${word}` : word;
      if (x.measureText(t).width > W - L - 40 && line) {
        x.fillText(line, L, ly);
        line = word;
        ly += 32;
      } else line = t;
    }
    x.fillText(line, L, ly);
  }
  x.fillStyle = '#7a6a4f';
  x.font = '18px "Segoe UI", sans-serif';
  x.textAlign = 'right';
  x.fillText('tigris-euphrates-online.vercel.app', W - 44, H - 30);
  x.textAlign = 'left';
  return new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.9));
}

const blobUrl = (blob) => new Promise((ok) => {
  const fr = new FileReader();
  fr.onload = () => ok(fr.result);
  fr.readAsDataURL(blob);
});

/** Окно «Картинка итога» поверх экрана итога: картинка, «Скачать», «Отправить в чат ДВАК». */
export async function openPicture(view, svg) {
  const myName = view.seats.find((s) => s.id === view.me)?.name || '';
  const chat = canSendPhoto(view, myName);
  const box = document.createElement('div');
  box.className = 'shot';
  box.innerHTML = `<div class="shotcard" role="dialog" aria-label="Картинка итога">
    <h2>Картинка итога</h2>
    <div class="shotimg"><p class="muted">Рисую картинку...</p></div>
    <div class="mfoot">
      <a class="btn" id="shDown" aria-disabled="true">Скачать картинку</a>
      ${chat ? '<button class="btn primary" id="shSend" disabled>Отправить в чат ДВАК</button>' : ''}
      <button class="btn" id="shClose">Закрыть</button>
    </div>
    <p class="mnote" id="shNote">${chat ? 'В чат картинка уйдет только по нажатию кнопки.' : ''}</p>
  </div>`;
  document.body.append(box);
  let url = null;
  const close = () => {
    box.remove();
    if (url) URL.revokeObjectURL(url);
  };
  box.querySelector('#shClose').addEventListener('click', close);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  const note = box.querySelector('#shNote');
  let blob;
  try {
    const tours = await api('GET', 'tournaments').then((r) => r.tours).catch(() => null);
    blob = await makePicture(view, svg, tours);
  } catch (e) {
    box.querySelector('.shotimg').innerHTML = `<p class="muted">Не получилось нарисовать: ${esc(e.message || 'ошибка')}</p>`;
    return;
  }
  url = URL.createObjectURL(blob);
  box.querySelector('.shotimg').innerHTML = `<img src="${url}" alt="Картинка итога партии">`;
  const down = box.querySelector('#shDown');
  down.href = url;
  down.download = pictureName(view);
  down.removeAttribute('aria-disabled');
  const send = box.querySelector('#shSend');
  if (!send) return;
  send.disabled = false;
  send.addEventListener('click', async () => {
    send.disabled = true;
    note.textContent = 'Отправляю...';
    try {
      await api('POST', `tables/${view.code}/photo`, { image: await blobUrl(blob) });
      note.textContent = 'Отправлено в чат ДВАК.';
      send.textContent = 'Отправлено';
    } catch (e) {
      note.textContent = e.message;
      send.disabled = false;
    }
  });
}
