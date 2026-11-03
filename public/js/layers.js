// Слои поля (просьба Дениса 03.11): метки, которые каждый прячет у себя ползунками в шапке
// партии. Браузер помнит выбор для всех столов. Чистые функции, их проверяют тесты.

export const LAYERS = [
  { id: 'owners', label: 'Тайлы', title: 'Метка на тайле: к чьему лидеру он идет' },
  { id: 'support', label: 'Сила', title: 'Поддержка у лидера: сколько тайлов его цвета в царстве' },
  { id: 'moves', label: 'Ходы', title: 'Номера действий последнего хода соперника' },
  { id: 'monuments', label: 'Монументы', title: 'На монументе: чей лидер получает за него очко' },
];

export const ALL_ON = Object.fromEntries(LAYERS.map((l) => [l.id, true]));

/** Слои из браузера: что не подошло, включено. legacy — прежняя кнопка «Метки» ('off' прятала метки на тайлах). */
export function cleanLayers(raw, legacy = null) {
  const out = { ...ALL_ON, owners: legacy !== 'off' };
  if (!raw || typeof raw !== 'object') return out;
  for (const { id } of LAYERS) if (typeof raw[id] === 'boolean') out[id] = raw[id];
  return out;
}
