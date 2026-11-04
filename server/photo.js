// Картинка итога партии в чат ДВАК (этап 4 пакета 04.11, схема одобрена Денисом). Уходит только
// по нажатию «Отправить в чат ДВАК», только из законченной партии и только от своих людей (правило
// 01.11: сами по себе в чат идут лишь приглашения). Картинку рисует браузер, сервер проверяет,
// что это настоящий jpeg или png разумного размера, и передает в Telegram.
const MAX_BYTES = 2_500_000; // 1600 на 1000 в jpeg около 0,5 МБ; запас на png
const DATA = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/;

/** { type, bytes } из адреса data: или null, если это не jpeg и не png или картинка слишком большая. */
export function parsePhoto(text) {
  if (typeof text !== 'string' || text.length > Math.ceil((MAX_BYTES * 4) / 3) + 40) return null;
  const m = DATA.exec(text);
  if (!m) return null;
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > MAX_BYTES || bytes.length < 100) return null;
  const fits = m[1] === 'jpeg'
    ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a;
  return fits ? { type: `image/${m[1]}`, bytes } : null;
}

/** Подпись к картинке: стол и места по итогу. */
export function photoCaption(t, from) {
  const seat = (id) => t.seats.find((s) => s.id === id);
  const lines = [...t.game.result.seats].sort((a, b) => a.place - b.place)
    .map((r) => `${r.place}. ${seat(r.seatId)?.name || 'Бот'}: ${r.vector?.[0] ?? ''}`);
  return `Итог партии ${t.title || t.code}\n${lines.join('\n')}\nОтправил ${from}`;
}
