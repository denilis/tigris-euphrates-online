// Собрать уроки в public/lessons: node tools/build-lessons.js
// Запускать после любой правки lessons/ и движка, иначе упадет test/lessons.test.js.
import { mkdirSync, writeFileSync } from 'node:fs';
import { LESSONS } from '../lessons/index.js';
import { buildLesson } from '../lessons/kit.js';
import { tourLobby } from '../lessons/tour.js';

const OUT = new URL('../public/lessons/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const list = [];
for (const def of LESSONS) {
  const lesson = buildLesson(def);
  const json = JSON.stringify(lesson);
  writeFileSync(new URL(`${lesson.id}.json`, OUT), json);
  list.push({ id: lesson.id, title: lesson.title, goal: lesson.goal, minutes: lesson.minutes, steps: lesson.steps.length });
  console.log(`урок ${lesson.id}: ${lesson.steps.length} шагов, ${Math.round(json.length / 1024)} КБ`);
}
writeFileSync(new URL('index.json', OUT), JSON.stringify(list));
// учебный стол экскурсии по сайту (05.11)
writeFileSync(new URL('tour-lobby.json', OUT), JSON.stringify(tourLobby()));
console.log('учебный стол экскурсии');
