// Расчёты клиента без DOM: склонения, итог по слабейшему цвету и разбиение поля на группы
// (контуры царств и стороны войны должны совпадать с движком).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cells, plural, finalScore, groups, tileOwners, kingdomLeaders, unitePos, CONTESTED } from '../public/js/util.js';
import { createGame, legalMoves, applyMove, components, finalVector } from '../game/vendor/engine/engine.js';
import { BOARDS } from '../game/vendor/engine/boards.js';
import { battlesIn, battleCard } from '../public/js/battle.js';
import { journalEntries } from '../game/journal.js';
import { makeRng } from '../game/vendor/engine/rng.js';

test('склонения: клетки и тайлы', () => {
  assert.deepEqual([1, 2, 5, 11, 12, 21, 22, 25, 111, 123].map(cells),
    ['1 клетка', '2 клетки', '5 клеток', '11 клеток', '12 клеток', '21 клетка', '22 клетки', '25 клеток', '111 клеток', '123 клетки']);
  assert.deepEqual([1, 2, 5].map((n) => plural(n, 0)), ['храм', 'храма', 'храмов']);
  assert.deepEqual([1, 3, 7].map((n) => plural(n, 1)), ['ферма', 'фермы', 'ферм']);
});

test('итог по слабейшему цвету совпадает с движком', () => {
  const r = makeRng(3);
  for (let k = 0; k < 500; k++) {
    const score = [0, 1, 2, 3].map(() => Math.floor(r() * 12));
    const treasures = Math.floor(r() * 5);
    assert.equal(finalScore(score, treasures), finalVector({ score, treasures })[0]);
  }
});

// одинаковое разбиение на группы (номера групп могут отличаться)
const canon = (lab) => {
  const m = new Map();
  return Array.from(lab, (l) => (l < 0 ? -1 : (m.has(l) ? m.get(l) : (m.set(l, m.size), m.size - 1))));
};

test('группы клеток на клиенте совпадают с движком, в том числе без объединяющей клетки', () => {
  let checks = 0;
  for (let seed = 1; seed <= 15; seed++) {
    const r = makeRng(seed);
    const s = createGame({ layout: BOARDS.advanced, numPlayers: 4, cfg: { englishSupport: true, buildings: true, wonder: true } }, r);
    for (let k = 0; k < 400 && !s.over; k++) {
      if (k % 7 === 0) {
        const board = { tile: Array.from(s.tile), leader: Array.from(s.leader) };
        assert.deepEqual(canon(groups(board)), canon(components(s).lab));
        const blocked = Math.floor(r() * 176);
        assert.deepEqual(canon(groups(board, blocked)), canon(components(s, blocked).lab));
        checks++;
      }
      const legal = legalMoves(s);
      applyMove(s, legal[Math.floor(r() * legal.length)], r);
    }
  }
  assert.ok(checks > 300);
});

test('метка владельца тайла совпадает с тем, кому движок начисляет очко за тайл', () => {
  let checks = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = makeRng(seed);
    const s = createGame({ layout: BOARDS.advanced, numPlayers: 4, cfg: { englishSupport: true, buildings: true, wonder: true } }, r);
    s.log = [];
    for (let k = 0; k < 500 && !s.over; k++) {
      const legal = legalMoves(s);
      s.log.length = 0;
      applyMove(s, legal[Math.floor(r() * legal.length)], r);
      // тайл без объединения: очко за него получает лидер того же цвета в царстве или царь
      const tile = s.log.find((e) => e.ev === 'tile');
      const score = s.log.find((e) => e.ev === 'score' && e.why === 'tile');
      if (!tile || !score || s.log.some((e) => e.ev === 'unite') || s.tile[tile.pos] !== tile.c) continue;
      const own = tileOwners({ tile: Array.from(s.tile), leader: Array.from(s.leader) })[tile.pos];
      assert.ok(own, `у тайла ${tile.pos} должна быть метка`);
      assert.equal(own.p, score.p);
      assert.equal(own.king, own.c !== tile.c, 'метка царя ставится, только если своего лидера нет');
      checks++;
    }
  }
  assert.ok(checks > 200, `проверок ${checks}`);
});

// замечание Дениса 29.10: во время войны метки считались по слитому царству, и синие тайлы
// соперника получали жетон кувшина (двух синих лидеров в одной группе побеждал нижний)
test('во время войны тайл объединения ничей, а метки остаются у своих царств', () => {
  const board = { tile: new Array(176).fill(-1), leader: new Array(176).fill(-1) };
  // A1 ферма, B1 синий лидер игрока 0, C1 ферма объединения, D1 синий лидер игрока 1, E1 ферма
  board.tile[0] = 1; board.tile[2] = 1; board.tile[4] = 1;
  board.leader[1] = 0 * 4 + 1; board.leader[3] = 1 * 4 + 1;
  const merged = tileOwners(board);
  assert.deepEqual([merged[0], merged[2], merged[4]], [null, null, null], 'спорный цвет без блокировки: меток нет, а не чужие');
  const own = tileOwners(board, kingdomLeaders(board, 2));
  assert.equal(own[0].p, 0);
  assert.equal(own[4].p, 1);
  assert.equal(own[2], null);
  assert.equal(unitePos({ ctx: { unite: true, pos: 2 } }), 2);
  assert.equal(unitePos({ ctx: { unite: false, pos: 2 } }), null);
  assert.equal(unitePos({ ctx: null }), null);
});

test('метки во время войны совпадают со сторонами войны в движке', () => {
  let checks = 0;
  for (let seed = 1; seed <= 60 && checks < 150; seed++) {
    const r = makeRng(seed);
    const s = createGame({ layout: BOARDS.advanced, numPlayers: 4, cfg: { englishSupport: true, buildings: true, wonder: true } }, r);
    for (let k = 0; k < 600 && !s.over; k++) {
      if (s.phase === 'warSupport' && s.ctx.unite && s.ctx.war) {
        const board = { tile: Array.from(s.tile), leader: Array.from(s.leader) };
        const kl = kingdomLeaders(board, s.ctx.pos);
        for (const a of kl.lead.values()) assert.ok(!a.includes(CONTESTED), 'после блокировки в группе нет двух лидеров одного цвета');
        const w = s.ctx.war;
        assert.equal(kl.lead.get(kl.lab[w.attPos])[w.color], w.att);
        assert.equal(kl.lead.get(kl.lab[w.defPos])[w.color], w.def);
        assert.equal(tileOwners(board, kl)[s.ctx.pos], null);
        checks++;
      }
      const legal = legalMoves(s);
      applyMove(s, legal[Math.floor(r() * legal.length)], r);
    }
  }
  assert.ok(checks > 50, `проверок ${checks}`);
});

// просьба Дениса 29.10: видеть ход боя, в том числе сколько тайлов выложил бот
test('ход боя: из журнала стола берутся обе стороны, очки и снятые тайлы', () => {
  const order = [2, 0, 1]; // индекс движка -> место
  let seen = { war: 0, revolt: 0, tie: 0 };
  for (let seed = 1; seed <= 25; seed++) {
    const r = makeRng(seed);
    const s = createGame({ layout: BOARDS.advanced, numPlayers: 3, cfg: { englishSupport: true, buildings: true, wonder: true } }, r);
    s.log = [];
    const log = [];
    for (let k = 0; k < 600 && !s.over; k++) {
      const meta = { turn: s.turn, cur: s.cur, action: s.actionNo };
      const legal = legalMoves(s);
      applyMove(s, legal[Math.floor(r() * legal.length)], r);
      log.push(...journalEntries(s.log, order, meta));
      s.log.length = 0;
    }
    const view = { me: 0, seats: [{ id: 0, name: 'Денис', hero: 'lion' }, { id: 1, name: 'Бот', hero: 'pot' }, { id: 2, name: 'Бот 2', hero: 'bow' }] };
    for (const b of battlesIn(log)) {
      const { e } = b;
      seen[e.ev]++;
      assert.ok(order.includes(e.att) && order.includes(e.def) && e.att !== e.def, 'стороны переведены в места');
      if (e.ev === 'war') {
        const sc = log.slice(b.i).find((x) => x.ev === 'score' && x.why === 'war');
        assert.equal(b.points, sc.n);
        assert.equal(b.removed, sc.n - 1);
      } else assert.equal(b.points, 1);
      const card = battleCard(b, view);
      assert.equal((card.match(/class="mt sent"/g) || []).length, e.attN + e.defN, 'тайлы из руки обеих сторон');
      assert.equal((card.match(/class="mt brd"/g) || []).length, e.attBoard + e.defBoard, 'тайлы на поле обеих сторон');
      if (e.attTotal === e.defTotal) { seen.tie++; assert.match(card, /Ничья, побеждает защитник/); }
      assert.equal(/\(вы\)/.test(card), [e.att, e.def].includes(0), 'свое место подписано «(вы)»');
    }
  }
  assert.ok(seen.war > 10 && seen.revolt > 10 && seen.tie > 0, JSON.stringify(seen));
});

test('ход боя: старая запись без сторон показывает только итог', () => {
  const log = [{ ev: 'revolt', turn: 3, actor: 0, winner: 1, loser: 0, color: 2, attTotal: 2, defTotal: 3, att: 0, def: 1 }];
  const [b] = battlesIn(log);
  const card = battleCard(b, { me: 0, seats: [{ id: 0, name: 'Денис', hero: 'lion' }, { id: 1, name: 'Бот', hero: 'pot' }] });
  assert.doesNotMatch(card, /из руки/);
  assert.match(card, /Восстание: торговец/);
  assert.match(card, /Победа: Бот, \+1 к красному\. Денис \(вы\) теряет торговца\./);
});
