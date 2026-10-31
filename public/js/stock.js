// Запас в партии: что еще можно построить. Чистая функция над видом стола, ее проверяют тесты.
import { COLNAME, TILE, cellName } from './util.js';

const place = (pos, free) => (pos >= 0 ? `стоит на ${cellName(pos)}` : free);

/** Монументы, здания и чудо; здания и чудо null, если вариант выключен за столом. */
export function stockItems(g, options) {
  return {
    monuments: g.monuments.map((m) => ({
      id: m.id, c1: m.c1, c2: m.c2, built: m.pos >= 0,
      title: `Монумент ${COLNAME[m.c1]} и ${COLNAME[m.c2]}: ${place(m.pos, 'свободен')}`,
    })),
    buildings: options.buildings
      ? g.buildingPos.map((pos, c) => ({ c, built: pos >= 0, title: `Здание «${TILE[c]}»: ${place(pos, 'свободно')}` }))
      : null,
    wonder: options.wonder ? { built: g.wonderPos >= 0, title: `Чудо: ${place(g.wonderPos, 'свободно')}` } : null,
  };
}
