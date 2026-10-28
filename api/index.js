// Единственная функция Vercel: все запросы /api/* приходят сюда (rewrite в vercel.json,
// путь в параметре route). Фаза 0: только проверочный маршрут ping.
import { createGame, legalMoves, applyMove, validate } from '../game/vendor/engine/engine.js';
import { BOARDS } from '../game/vendor/engine/boards.js';
import { ENGINE } from '../game/vendor/version.js';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

// Одна случайная партия движком: проверяет, что копия движка попала в сборку функции,
// и сколько времени у функции занимает работа движка.
function smokeGame() {
  const t0 = performance.now();
  const s = createGame({ layout: BOARDS.advanced, numPlayers: 4, cfg: { englishSupport: true, buildings: true, wonder: true } }, Math.random);
  let steps = 0;
  while (!s.over && steps < 5000) {
    const moves = legalMoves(s);
    applyMove(s, moves[Math.floor(Math.random() * moves.length)], Math.random);
    steps++;
  }
  return { steps, valid: validate(s).length === 0, over: s.over, ms: Math.round(performance.now() - t0) };
}

export default function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const route = (url.searchParams.get('route') || url.pathname.replace(/^\/api\/?/, '')).replace(/^\/+|\/+$/g, '');
  if (route === 'ping') {
    return send(res, 200, {
      ok: true,
      env: process.env.VERCEL_ENV || 'local',
      region: process.env.VERCEL_REGION || null,
      node: process.version,
      engine: ENGINE.commit.slice(0, 7),
      route,
      smoke: smokeGame(),
    });
  }
  return send(res, 404, { ok: false, error: `Нет такого адреса: /api/${route}` });
}
