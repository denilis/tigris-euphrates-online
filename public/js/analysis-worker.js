// Разбор партии ботом в фоне страницы (этап 5, 04.11): страница не замирает, пока бот считает.
// Сообщение: { rec, order, humans }; ответы: { progress } от 0 до 1, затем { result } или { error }.
import { analyzeRecord } from './analysis-core.js';

self.onmessage = (e) => {
  const { rec, order, humans } = e.data;
  try {
    let last = 0;
    const result = analyzeRecord(rec, order, humans, {
      onProgress: (done, total) => {
        const p = done / total;
        if (p - last >= 0.02 || done === total) {
          last = p;
          self.postMessage({ progress: p });
        }
      },
    });
    self.postMessage({ result });
  } catch (err) {
    self.postMessage({ error: String(err?.message || err) });
  }
};
