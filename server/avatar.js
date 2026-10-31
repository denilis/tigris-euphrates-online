// Фото игрока: браузер присылает квадрат 160 на 160. Принимаем только jpeg и webp с настоящими
// сигнатурами файла: чужой тип, например svg со скриптом, на сайт не попадет.
const MAX_CHARS = 30000;
const DATA = /^data:image\/(webp|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

/** { type, data } из адреса data: или null, если это не подходящая картинка. */
export function parseAvatar(text) {
  if (typeof text !== 'string' || text.length > MAX_CHARS) return null;
  const m = DATA.exec(text);
  if (!m) return null;
  const b = Buffer.from(m[2], 'base64');
  const fits = m[1] === 'jpeg'
    ? b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
    : b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
  return fits ? { type: `image/${m[1]}`, data: m[2] } : null;
}
