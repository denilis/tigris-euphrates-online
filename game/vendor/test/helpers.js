// Вспомогательные функции для тестов: ручная расстановка позиции.
import { createState } from '../engine/engine.js';
import { W, RED, BLUE, GREEN, BLACK } from '../engine/constants.js';

export const C = { red: RED, blue: BLUE, green: GREEN, black: BLACK };

/** 'A1' -> индекс клетки (столбец A..P, ряд 1..11). */
export function at(name) {
  const x = name.charCodeAt(0) - 65;
  const y = parseInt(name.slice(1), 10) - 1;
  return y * W + x;
}

/** Синтетическое поле: река по рядам 6 и столбцу H, 10 стартовых храмов. */
export function testLayout() {
  const river = [];
  for (let x = 0; x < 16; x++) river.push(at(String.fromCharCode(65 + x) + '6'));
  for (let y = 1; y <= 11; y++) if (y !== 6) river.push(at('H' + y));
  const temples = ['B2', 'E3', 'L2', 'O4', 'C9', 'F10', 'K9', 'N10', 'D4', 'M8'].map(at);
  return { river, temples, special: [] };
}

/** Пустое поле с рекой в ряду 6 и без стартовых храмов. */
export function bare(numPlayers = 2, cfg = {}, extra = {}) {
  const river = [];
  for (let x = 0; x < 16; x++) river.push(at(String.fromCharCode(65 + x) + '6'));
  const s = createState({
    layout: { river, temples: [], special: extra.special || [] },
    numPlayers,
    cfg,
  });
  return s;
}

/** Положить тайл цвета color на клетку (берётся из мешка). */
export function put(s, name, color, { treasure = false } = {}) {
  const i = at(name);
  s.tile[i] = color;
  s.bag[color]--;
  if (treasure) s.treasure[i] = 1;
  return i;
}

/** Поставить лидера игрока p. */
export function lead(s, p, color, name) {
  const i = at(name);
  s.leader[i] = p * 4 + color;
  s.players[p].leaders[color] = i;
  return i;
}

/** Задать руку игрока (тайлы берутся из мешка). */
export function setHand(s, p, counts) {
  const h = s.players[p].hand;
  for (let c = 0; c < 4; c++) {
    s.bag[c] += h[c];
    h[c] = counts[c];
    s.bag[c] -= counts[c];
  }
}

export const rngConst = () => 0; // всегда тянет первый непустой цвет
