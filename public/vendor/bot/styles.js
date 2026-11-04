// Стили игры бота: наборы весов оценки и цен ходов, подобранные по партиям
// BGA (sim/train.js -> bot/styles_data.js). Смесь стилей — взвешенное среднее
// их весов: 50% Дениса и 50% топ-мастеров дают веса ровно посередине.

import { DEFAULT_WEIGHTS } from './evaluate.js';
import { TRAINED as BUILT_IN } from './styles_data.js';

let TRAINED = BUILT_IN;

/** Подменить обученные стили (турниры сравнивают разные прогоны обучения). */
export function useTrained(styles) {
  TRAINED = styles || BUILT_IN;
}

export const STYLE_LABELS = {
  universal: 'Универсальный',
  base: 'Базовый',
  top: 'Топ-мастера',
  denis: 'Денис',
  andrey: 'Андрей',
  vlad: 'Влад',
  mix: 'Смесь',
};

// Стили, из которых собирается смесь, и ключи настроек панели для их долей.
export const MIX_KEYS = { top: 'mixTop', denis: 'mixDenis', andrey: 'mixAndrey', vlad: 'mixVlad' };

const BASE = { weights: DEFAULT_WEIGHTS, relocate: 0.6, discard: 0.3 };

/** Доли смеси из настроек: { top: 50, denis: 50 } или строка "top:50/denis:50". */
export function mixShares(settings) {
  let mix = settings.mix;
  if (typeof mix === 'string') {
    const o = {};
    for (const part of mix.split(/[/+;]/)) {
      const [k, v] = part.split(':');
      if (k) o[k.trim()] = Number(v);
    }
    mix = o;
  }
  if (!mix) {
    mix = {};
    for (const [style, key] of Object.entries(MIX_KEYS)) if (settings[key] !== undefined) mix[style] = Number(settings[key]);
  }
  const out = {};
  let total = 0;
  for (const [k, v] of Object.entries(mix)) {
    if (!(v > 0) || !TRAINED[k]) continue;
    out[k] = v;
    total += v;
  }
  if (!total) return null;
  for (const k of Object.keys(out)) out[k] /= total;
  return out;
}

function blend(parts) {
  const weights = {};
  for (const [k, v] of Object.entries(DEFAULT_WEIGHTS)) weights[k] = Array.isArray(v) ? v.map(() => 0) : 0;
  let relocate = 0, discard = 0;
  for (const { style, share } of parts) {
    const w = { ...DEFAULT_WEIGHTS, ...style.weights };
    for (const [k, v] of Object.entries(w)) {
      if (!(k in weights)) continue;
      if (Array.isArray(v)) v.forEach((x, i) => { weights[k][i] += share * x; });
      else weights[k] += share * v;
    }
    relocate += share * style.relocate;
    discard += share * style.discard;
  }
  return { weights, relocate, discard };
}

/** Веса оценки и цены ходов по настройкам бота: settings.style, settings.mix / mixTop... */
export function styleParams(settings = {}) {
  const name = settings.style || 'base';
  if (name === 'mix') {
    const shares = mixShares(settings);
    if (!shares) return BASE;
    return blend(Object.entries(shares).map(([k, share]) => ({ style: TRAINED[k], share })));
  }
  const st = TRAINED[name];
  if (!st) return BASE;
  return blend([{ style: st, share: 1 }]);
}

/** Какие стили есть в сборке (обученные + базовый и смесь). */
export function availableStyles() {
  return Object.keys(STYLE_LABELS).filter((k) => k === 'base' || k === 'mix' || TRAINED[k]);
}
