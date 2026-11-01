// Страница «Правила»: разбор, инфографика и текст с поиском. Открыта без входа: новичок
// должен прочитать правила раньше, чем получит код.
import { esc } from './util.js';
import { RULES } from './rules-text.js';
import { searchRules, markParts } from './rules-search.js';
import { figureHTML } from './rules-art.js';

const marked = (text, query) => markParts(text, query).map((p) => (p.hit ? `<mark>${esc(p.text)}</mark>` : esc(p.text))).join('');

function block(b, query) {
  if (typeof b === 'string') return `<p>${marked(b, query)}</p>`;
  if (b.h) return `<h3>${marked(b.h, query)}</h3>`;
  if (b.fig) return figureHTML(b.fig, marked(b.cap, query));
  if (b.links) return `<p class="rlinks">${b.links.map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${marked(l.text, query)}</a>`).join('')}</p>`;
  const tag = b.ordered ? 'ol' : 'ul';
  return `<${tag}>${b.list.map((x) => `<li>${marked(x, query)}</li>`).join('')}</${tag}>`;
}

/** Вкладки раздела: правила и обучение. */
export const rulesTabs = (active) => `<nav class="rtabs"><a href="#/rules" class="${active === 'rules' ? 'on' : ''}">Правила</a><a href="#/learn" class="${active === 'learn' ? 'on' : ''}">Обучение</a></nav>`;

/** Нарисовать страницу в app. top и bindTop — шапка сайта и привязка ее кнопок. */
export function renderRules(app, top, bindTop) {
  app.innerHTML = `<div class="page">${top}<main class="pcard rules">
    <h1>Правила</h1>
    ${rulesTabs('rules')}
    <div class="rsearch">
      <input id="rQuery" type="search" placeholder="Поиск по правилам" aria-label="Поиск по правилам" autocomplete="off">
      <span class="muted" id="rCount"></span>
    </div>
    <div class="rmedia" id="rMedia">
      <figure>
        <video src="/media/razbor.mp4" controls preload="metadata" playsinline></video>
        <figcaption>Разбор правил, 7 минут</figcaption>
      </figure>
      <figure>
        <a href="/img/rules-infographic.webp" target="_blank" rel="noopener" title="Открыть крупно"><img src="/img/rules-infographic.webp" alt="Инфографика: главное о правилах" loading="lazy"></a>
        <figcaption>Условная иллюстрация: настоящее поле выглядит иначе, клетки квадратные, вместо фигурок жетоны. Нажмите, чтобы открыть крупно.</figcaption>
      </figure>
    </div>
    <nav class="rnav" id="rNav" aria-label="Разделы правил"></nav>
    <div id="rText"></div>
  </main></div>`;
  bindTop();

  const $ = (id) => app.querySelector('#' + id);
  const update = () => {
    const query = $('rQuery').value;
    const found = searchRules(RULES, query);
    const active = found !== RULES;
    $('rMedia').hidden = active;
    $('rCount').textContent = active ? `Найдено разделов: ${found.length}` : '';
    $('rNav').innerHTML = found.map((s) => `<button class="linkbtn" data-sec="${s.id}">${esc(s.title)}</button>`).join('');
    $('rText').innerHTML = found.map((s) => `<section class="rsec" id="sec-${s.id}"><h2>${marked(s.title, query)}</h2>${s.body.map((b) => block(b, query)).join('')}</section>`).join('')
      || '<p class="muted">Ничего не нашлось. Попробуйте другое слово.</p>';
  };
  $('rQuery').addEventListener('input', update);
  $('rNav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sec]');
    if (b) app.querySelector(`#sec-${b.dataset.sec}`)?.scrollIntoView({ behavior: 'smooth' });
  });
  update();
}
