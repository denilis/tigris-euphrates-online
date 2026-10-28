// Состояние движка в JSON и обратно. Поля поля — типизированные массивы: JSON.stringify
// превратил бы их в объекты {"0":..}, поэтому переводим явно.
const TYPED = {
  river: Uint8Array,
  special: Uint8Array,
  tile: Int8Array,
  leader: Int8Array,
  treasure: Uint8Array,
  building: Int8Array,
  monument: Int8Array,
};

/** Состояние движка → обычный объект для JSON (журнал движка не храним). */
export function stateToJSON(s) {
  const o = { ...s, log: null };
  for (const k of Object.keys(TYPED)) o[k] = Array.from(s[k]);
  return JSON.parse(JSON.stringify(o));
}

/** Обычный объект → состояние движка (глубокая копия, исходник не трогаем). */
export function stateFromJSON(o) {
  const s = JSON.parse(JSON.stringify(o));
  for (const [k, T] of Object.entries(TYPED)) s[k] = T.from(o[k]);
  s.log = null;
  return s;
}
