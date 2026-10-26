// Servidor de la mesa de rol: sirve la web y sincroniza mapa y fichas entre todos los jugadores.
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 20e6 }); // permite imágenes de hasta ~20 MB

app.use(express.static(__dirname + '/public'));

// Estado de la partida (vive en memoria: si reinicias el servidor, se pierde)
const state = {
  map: null,      // imagen del mapa como data URL
  tokens: {}      // id -> { id, name, color, image, size, x, y }
};

const isDataUrl = (v) => typeof v === 'string' && v.startsWith('data:image/') && v.length < 15e6;
const clamp = (n) => Math.min(100, Math.max(0, Number(n) || 0));

io.on('connection', (socket) => {
  socket.emit('state', state);

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
