// Servidor de la mesa de rol: sirve la web y sincroniza mapa y fichas entre todos los jugadores.
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { randomInt } = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 20e6 }); // permite imágenes de hasta ~20 MB

app.use(express.static(__dirname + '/public'));

// Estado de la partida (vive en memoria: si reinicias el servidor, se pierde)
const state = {
  map: null,      // imagen del mapa como data URL
  tokens: {},     // id -> { id, name, color, image, size, x, y }
  log: []         // últimos mensajes del chat y tiradas
};

const isDataUrl = (v) => typeof v === 'string' && v.startsWith('data:image/') && v.length < 15e6;
const clamp = (n) => Math.min(100, Math.max(0, Number(n) || 0));


/* ---------- Chat y dados ---------- */
const MAX_LOG = 100;
// Acepta: /r 2d6+3, /r d20, /roll 1d8-1, /tirada 4d6
const ROLL_RE = /^\/(?:r|roll|tirada)\s+(\d{1,2})?d(\d{1,3})(?:\s*([+-])\s*(\d{1,4}))?\s*$/i;

function pushLog(msg) {
  state.log.push(msg);
  if (state.log.length > MAX_LOG) state.log.shift();
  io.emit('chat:msg', msg);
}

// Los dados se tiran en el servidor: todos ven el mismo resultado y nadie puede manipularlo.
function makeRoll(name, match) {
  const count = match[1] ? parseInt(match[1], 10) : 1;
  const sides = parseInt(match[2], 10);
  if (count < 1 || count > 50 || sides < 2 || sides > 1000) return null;
  const mod = match[3] ? (match[3] === '-' ? -1 : 1) * parseInt(match[4], 10) : 0;
  const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1));
  const total = rolls.reduce((a, b) => a + b, 0) + mod;
  const expr = `${count}d${sides}${mod ? (mod > 0 ? '+' : '-') + Math.abs(mod) : ''}`;
  return { type: 'roll', name, expr, count, sides, rolls, mod, total };
}

io.on('connection', (socket) => {
  socket.emit('state', state);

  socket.on('chat:send', ({ name, text } = {}) => {
    name = String(name || '').trim().slice(0, 20) || 'Anónimo';
    text = String(text || '').trim().slice(0, 300);
    if (!text) return;
    if (text.startsWith('/')) {
      const match = text.match(ROLL_RE);
      const roll = match && makeRoll(name, match);
      if (roll) pushLog(roll);
      else socket.emit('chat:msg', { type: 'system', text: 'Tirada no válida. Ejemplos: /r d20, /r 2d6+3, /r 4d6-1 (hasta 50 dados, de 2 a 1000 caras).' });
      return;
    }
    pushLog({ type: 'chat', name, text });
  });

  socket.on('map:set', (dataUrl) => {
    if (!isDataUrl(dataUrl)) return;
    state.map = dataUrl;
    io.emit('map:set', dataUrl);
  });

  socket.on('token:add', (t) => {
    if (!t || typeof t.id !== 'string' || state.tokens[t.id]) return;
    const token = {
      id: t.id.slice(0, 40),
      name: String(t.name || '').slice(0, 30),
      color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#888888',
      image: isDataUrl(t.image) && t.image.length < 1e6 ? t.image : null,
      size: Math.min(15, Math.max(2, Number(t.size) || 5)),
      x: clamp(t.x ?? 50),
      y: clamp(t.y ?? 50)
    };
    state.tokens[token.id] = token;
    io.emit('token:add', token);
  });

  socket.on('token:move', ({ id, x, y } = {}) => {
    const token = state.tokens[id];
    if (!token) return;
    token.x = clamp(x);
    token.y = clamp(y);
    socket.broadcast.emit('token:move', { id, x: token.x, y: token.y });
  });

  socket.on('token:remove', (id) => {
    if (!state.tokens[id]) return;
    delete state.tokens[id];
    io.emit('token:remove', id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Mesa de rol en http://localhost:${PORT}`));
