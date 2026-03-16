const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(__dirname));

// ─── GAME CONSTANTS ────────────────────────────────────────────────────────────

const RIVER = new Set(
  '0,1 1,1 2,1 3,1 4,1 5,2 6,2 7,2 8,1 9,1 10,1 11,1 12,1 13,1 14,1 15,1 0,9 1,9 2,9 3,9 4,9 5,8 6,8 7,8 8,9 9,9 10,9 11,9 12,9 13,9 14,9 15,9'
    .split(' ')
);

const SHEDU_S = new Set(
  [[2,3],[6,3],[10,3],[14,3],[0,5],[4,6],[8,5],[12,6],[2,7],[13,7]]
    .map(([c,r]) => `${c},${r}`)
);

const PLAYER_COLORS = ['blue','red','black','green'];
const PLAYER_DISPLAY = [
  {name:'Игрок 1', c:'#fb923c', tc:'#000', dk:'#c2410c'},
  {name:'Игрок 2', c:'#f87171', tc:'#fff', dk:'#b91c1c'},
  {name:'Игрок 3', c:'#60a5fa', tc:'#fff', dk:'#1d4ed8'},
  {name:'Игрок 4', c:'#4ade80', tc:'#000', dk:'#15803d'}
];

const MONUMENTS = [
  {id:0,c1:'green', c2:'black', img:'assets/monuments/green_black.jpg'},
  {id:1,c1:'green', c2:'blue',  img:'assets/monuments/green_blue.jpg'},
  {id:2,c1:'blue',  c2:'red',   img:'assets/monuments/blue_red.jpg'},
  {id:3,c1:'red',   c2:'green', img:'assets/monuments/red_green.jpg'},
  {id:4,c1:'red',   c2:'black', img:'assets/monuments/red_black.jpg'},
  {id:5,c1:'blue',  c2:'black', img:'assets/monuments/blue_black.jpg'}
];

// ─── GAME LOGIC ────────────────────────────────────────────────────────────────

function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function makeBag() {
  const t = [];
  [{t:'TEMPLE',n:22},{t:'FARM',n:14},{t:'MARKET',n:12},{t:'SETTLEMENT',n:12}]
    .forEach(({t:tp,n}) => { for (let i=0;i<n;i++) t.push(tp); });
  return shuffle(t);
}

function initBoard() {
  const b = {};
  SHEDU_S.forEach(k => { b[k] = {t:'TEMPLE', tr:true, fx:true}; });
  return b;
}

function setupGame(numPlayers, names) {
  const bag = makeBag();
  const hands = [];
  const players = PLAYER_DISPLAY.slice(0, numPlayers).map((cfg, i) => {
    hands.push(bag.splice(0, 6));
    return {
      ...cfg,
      name: names[i] || cfg.name,
      color: PLAYER_COLORS[i],
      ldrs: ['LION','BOW','POT','BULL'].map(k => ({k, ob: null})),
      cat: 2,
      vp: [0,0,0,0]
    };
  });

  return {
    players,
    hands,  // private — not sent to all
    bag,    // private
    board: initBoard(),
    cur: 0,
    acts: 2,
    log: ['Игра началась!'],
    monuments: MONUMENTS.map(m => ({...m, placed:false})),
    numPlayers
  };
}

function applyAction(G, action, playerIndex) {
  // Only active player can act (except VP adjustments)
  if (action.type !== 'ADJUST_VP' && playerIndex !== G.cur) {
    return {ok:false, msg:'Сейчас не ваш ход'};
  }
  if (action.type !== 'ADJUST_VP' && action.type !== 'END_TURN' && G.acts <= 0) {
    return {ok:false, msg:'Действия закончились — завершите ход'};
  }

  const p = G.players[G.cur];

  switch (action.type) {

    case 'PLACE_TILE': {
      const {tileIndex, col, row} = action;
      const key = `${col},${row}`;
      const isRiv = RIVER.has(key);
      if (G.board[key]) return {ok:false, msg:'Клетка занята'};
      const tp = G.hands[G.cur][tileIndex];
      if (!tp) return {ok:false, msg:'Нет такого тайла'};
      if (tp === 'FARM' && !isRiv) return {ok:false, msg:'Фермы — только на реку!'};
      if (tp !== 'FARM' && tp !== 'CATASTROPHE' && isRiv) return {ok:false, msg:'Только фермы на реку!'};
      G.board[key] = {t: tp};
      G.hands[G.cur].splice(tileIndex, 1);
      G.acts--;
      G.log.unshift(`${p.name}: ${tp} → (${col},${row})`);
      break;
    }

    case 'PLACE_LEADER': {
      const {ldrIndex, col, row} = action;
      const key = `${col},${row}`;
      const isRiv = RIVER.has(key);
      if (isRiv) return {ok:false, msg:'Лидер не может стоять на реке'};
      if (G.board[key]) return {ok:false, msg:'Клетка занята'};
      const ld = p.ldrs[ldrIndex];
      if (ld.ob) return {ok:false, msg:'Лидер уже на поле — сначала верните'};
      G.board[key] = {t:'LDR', lk:ld.k, pi:G.cur};
      ld.ob = key;
      G.acts--;
      G.log.unshift(`${p.name}: лидер ${ld.k} → (${col},${row})`);
      break;
    }

    case 'RECALL_LEADER': {
      const {ldrIndex} = action;
      const ld = p.ldrs[ldrIndex];
      if (!ld.ob) return {ok:false, msg:'Лидер не на поле'};
      delete G.board[ld.ob];
      G.log.unshift(`${p.name}: вернул лидера ${ld.k}`);
      ld.ob = null;
      G.acts--;
      break;
    }

    case 'REMOVE_TILE': {
      const {col, row} = action;
      const key = `${col},${row}`;
      const cell = G.board[key];
      if (!cell) return {ok:false, msg:'Нет тайла'};
      if (cell.fx) return {ok:false, msg:'Нельзя убрать стартовый храм'};
      // Recall leader if it's there
      if (cell.t === 'LDR') {
        const owner = G.players[cell.pi];
        const ld = owner.ldrs.find(l => l.ob === key);
        if (ld) ld.ob = null;
      }
      delete G.board[key];
      G.acts--;
      G.log.unshift(`${p.name}: убрал тайл (${col},${row})`);
      break;
    }

    case 'SWAP_TILES': {
      const {indices} = action;
      if (!indices || !indices.length) return {ok:false, msg:'Нет тайлов для обмена'};
      const hand = G.hands[G.cur];
      const discarded = indices.map(i => hand[i]);
      const kept = hand.filter((_, i) => !indices.includes(i));
      const drawn = G.bag.splice(0, Math.min(discarded.length, G.bag.length));
      G.bag.push(...shuffle(discarded));
      G.hands[G.cur] = [...kept, ...drawn];
      G.acts--;
      G.log.unshift(`${p.name}: обменял ${discarded.length} тайлов`);
      break;
    }

    case 'PLACE_MONUMENT': {
      const {monumentIndex, col, row} = action;
      const key = `${col},${row}`;
      if (G.board[key] && G.board[key].t !== 'MONUMENT') return {ok:false, msg:'Место занято'};
      const m = G.monuments[monumentIndex];
      if (m.placed) return {ok:false, msg:'Монумент уже установлен'};
      G.board[key] = {t:'MONUMENT', mIdx:monumentIndex, img:m.img, c1:m.c1, c2:m.c2};
      m.placed = true;
      G.acts--;
      G.log.unshift(`${p.name}: монумент (${m.c1}+${m.c2}) → (${col},${row})`);
      break;
    }

    case 'END_TURN': {
      // Auto-draw tiles for current player
      const hand = G.hands[G.cur];
      const need = 6 - hand.length;
      if (need > 0 && G.bag.length > 0) {
        const drawn = G.bag.splice(0, Math.min(need, G.bag.length));
        hand.push(...drawn);
        G.log.unshift(`${p.name}: добрал ${drawn.length} тайлов`);
      }
      // Advance turn
      G.cur = (G.cur + 1) % G.numPlayers;
      G.acts = 2;
      G.log.unshift(`━ Ход: ${G.players[G.cur].name} ━`);
      if (G.log.length > 60) G.log = G.log.slice(0, 60);
      break;
    }

    case 'ADJUST_VP': {
      const {targetPlayerIndex, colorIndex, delta} = action;
      if (targetPlayerIndex < 0 || targetPlayerIndex >= G.numPlayers) return {ok:false};
      G.players[targetPlayerIndex].vp[colorIndex] = Math.max(0,
        G.players[targetPlayerIndex].vp[colorIndex] + delta
      );
      break;
    }

    default:
      return {ok:false, msg:`Неизвестное действие: ${action.type}`};
  }

  if (G.log.length > 60) G.log = G.log.slice(0, 60);
  return {ok: true};
}

// ─── ROOMS ─────────────────────────────────────────────────────────────────────

const rooms = {}; // code → room object

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function getPublicState(G) {
  // Returns game state without private hands/bag
  const {hands, bag, ...pub} = G;
  pub.bagSize = bag.length;
  pub.handSizes = hands.map(h => h.length);
  return pub;
}

function broadcastState(code) {
  const room = rooms[code];
  if (!room || !room.G) return;
  const pub = getPublicState(room.G);
  io.to(code).emit('game_state', pub);
  // Send each player their private hand
  room.players.forEach(player => {
    if (player.socketId) {
      io.to(player.socketId).emit('your_hand', room.G.hands[player.index] || []);
    }
  });
}

// ─── SOCKET.IO ─────────────────────────────────────────────────────────────────

io.on('connection', socket => {
  let roomCode = null;
  let myIndex = null;

  socket.on('create_room', ({name, numPlayers}) => {
    const code = genCode();
    rooms[code] = {
      code,
      hostId: socket.id,
      numPlayers: numPlayers || 2,
      players: [{socketId: socket.id, name: name || 'Игрок 1', index: 0}],
      G: null
    };
    roomCode = code;
    myIndex = 0;
    socket.join(code);
    socket.emit('room_created', {
      code,
      playerIndex: 0,
      players: rooms[code].players,
      numPlayers: rooms[code].numPlayers
    });
    console.log(`Room ${code} created by ${name}`);
  });

  socket.on('join_room', ({name, code}) => {
    const c = (code || '').toUpperCase().trim();
    const room = rooms[c];
    if (!room) { socket.emit('join_error', {msg: 'Комната не найдена'}); return; }
    if (room.G) { socket.emit('join_error', {msg: 'Игра уже идёт'}); return; }
    if (room.players.length >= room.numPlayers) {
      socket.emit('join_error', {msg: 'Комната полная'}); return;
    }
    const idx = room.players.length;
    room.players.push({socketId: socket.id, name: name || `Игрок ${idx+1}`, index: idx});
    roomCode = c;
    myIndex = idx;
    socket.join(c);
    socket.emit('room_joined', {
      code: c,
      playerIndex: idx,
      players: room.players,
      numPlayers: room.numPlayers
    });
    io.to(c).emit('room_update', {players: room.players});
    console.log(`${name} joined room ${c}`);
  });

  socket.on('start_game', () => {
    const room = rooms[roomCode];
    if (!room || socket.id !== room.hostId) return;
    if (room.players.length < 2) {
      socket.emit('start_error', {msg: 'Нужно минимум 2 игрока'}); return;
    }
    const names = room.players.map(p => p.name);
    room.G = setupGame(room.players.length, names);
    console.log(`Game started in room ${roomCode}`);
    io.to(roomCode).emit('game_started', {numPlayers: room.players.length});
    broadcastState(roomCode);
  });

  socket.on('game_action', action => {
    const room = rooms[roomCode];
    if (!room || !room.G) return;
    const result = applyAction(room.G, action, myIndex);
    if (!result.ok) {
      socket.emit('action_error', {msg: result.msg || 'Ошибка действия'});
      return;
    }
    broadcastState(roomCode);
  });

  socket.on('disconnect', () => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    const name = player ? player.name : 'Игрок';
    room.players = room.players.filter(p => p.socketId !== socket.id);
    if (room.players.length === 0) {
      delete rooms[roomCode];
      console.log(`Room ${roomCode} deleted`);
    } else {
      io.to(roomCode).emit('player_disconnected', {name});
      io.to(roomCode).emit('room_update', {players: room.players});
    }
  });
});

// ─── START ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Tigris & Euphrates server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT}`);
});
