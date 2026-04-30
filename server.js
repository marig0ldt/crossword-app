const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { parsePuz } = require('./puzParser');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 🔴 DİQQƏT: Railway-in serveri görə bilməsi üçün ən vacib hissə:
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS_PER_ROOM = 25;
const activeRooms = {}; 

function loadBuiltinPuzzles() {
  const dir = path.join(__dirname, 'puzzles');
  const puzzles = [];
  if (!fs.existsSync(dir)) return puzzles;
  for (const file of fs.readdirSync(dir)) {
    try {
      if (file.endsWith('.json')) {
        const p = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        puzzles.push(p);
      } else if (file.endsWith('.puz')) {
        const buf = fs.readFileSync(path.join(dir, file));
        const p = parsePuz(buf);
        if (p) { p.id = file.replace('.puz', ''); puzzles.push(p); }
      }
    } catch (e) { console.warn('Failed to load puzzle:', file); }
  }
  return puzzles;
}

// ─── Middleware ───────────────────────────────────────────────────────────────
async function adminAuth(req, res, next) {
  const { username, password } = req.headers;
  if (!username || !password) return res.status(401).json({ error: 'Giriş tələb olunur' });
  try {
    const admin = await db.get('SELECT * FROM admins WHERE username = ?', [username]);
    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
      return res.status(401).json({ error: 'Giriş rədd edildi' });
    }
    req.admin = admin;
    next();
  } catch (e) { 
    console.error("Admin Auth xətası:", e);
    res.status(500).json({ error: 'Server xətası' }); 
  }
}

// ─── API ──────────────────────────────────────────────────────────────────────
app.get('/api/puzzles', (req, res) => {
  const puzzles = loadBuiltinPuzzles().map(p => ({
    id: p.id, title: p.title, author: p.author, width: p.width, height: p.height
  }));
  res.json(puzzles);
});

app.get('/api/rooms', async (req, res) => {
  try {
    const rooms = await db.all('SELECT * FROM rooms ORDER BY created_at DESC');
    const result = [];
    for (const r of rooms) {
      const players = await db.all('SELECT id, username, score, cells_filled FROM players WHERE room_id = ?', [r.id]);
      result.push({ ...r, playerCount: players.length, inProgress: r.status === 'playing' });
    }
    res.json(result);
  } catch (e) { 
    console.error(e);
    res.status(500).json({ error: 'Datalar gətirilmədi' }); 
  }
});

app.post('/api/player/rooms', async (req, res) => {
  try {
    const { name, puzzleId } = req.body;
    if (!name || !puzzleId) return res.status(400).json({ error: 'Ad və tapmaca tələb olunur' });
    const id = uuidv4().slice(0, 8).toUpperCase();
    await db.run('INSERT INTO rooms (id, name, puzzle_id, max_players) VALUES (?, ?, ?, ?)', [id, name, puzzleId, 25]);
    res.json({ id, name, puzzleId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Otaq yaradılarkən xəta baş verdi' });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await db.get('SELECT * FROM admins WHERE username = ?', [username]);
    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
      return res.status(401).json({ error: 'Yanlış istifadəçi adı və ya şifrə' });
    }
    res.json({ ok: true, username: admin.username, isSuper: admin.is_super === 1 });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Daxil olarkən xəta baş verdi' });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sanitizePuzzle(puzzle) {
  const grid = puzzle.grid.map(row => row.map(cell => cell === '#' ? '#' : ''));
  return { ...puzzle, grid, solution: undefined };
}

async function checkCompletion(roomId) {
  const state = activeRooms[roomId];
  if (!state || state.status !== 'playing') return false;
  const { puzzle, cells } = state;
  let correct = 0, total = 0;
  for (let r = 0; r < puzzle.height; r++) {
    for (let c = 0; c < puzzle.width; c++) {
      const sol = puzzle.grid[r][c];
      if (sol === '#') continue;
      total++;
      if (cells[r * puzzle.width + c] === sol) correct++;
    }
  }
  return correct === total;
}

async function startGameForRoom(roomId) {
  try {
    const room = await db.get('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (!room || room.status === 'playing') return;

    const puzzles = loadBuiltinPuzzles();
    const puzzle = puzzles.find(p => p.id === room.puzzle_id);
    if (!puzzle) return;

    await db.run('DELETE FROM cell_states WHERE room_id = ?', [room.id]);
    await db.run('UPDATE rooms SET status = ? WHERE id = ?', ['playing', room.id]);
    await db.run('UPDATE players SET score = 0, cells_filled = 0 WHERE room_id = ?', [room.id]);

    activeRooms[room.id] = { puzzle, cells: new Array(puzzle.width * puzzle.height).fill(''), status: 'playing' };
    io.to(room.id).emit('game_started', { puzzle: sanitizePuzzle(puzzle), cells: activeRooms[room.id].cells });
  } catch (e) {
    console.error("Oyunu başladarkən xəta:", e);
  }
}

async function endGame(roomId, winnerId) {
  try {
    const state = activeRooms[roomId];
    if (!state) return;
    state.status = 'finished';
    await db.run('UPDATE rooms SET status = ? WHERE id = ?', ['waiting', roomId]);
    const scores = await db.all('SELECT username, score, cells_filled FROM players WHERE room_id = ? ORDER BY score DESC', [roomId]);
    io.to(roomId).emit('game_over', { scores, winnerId });
  } catch(e) {
    console.error("Oyunu bitirərkən xəta:", e);
  }
}

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('join_room', async ({ roomId, username }) => {
    if (!username || !roomId) return;
    try {
      const room = await db.get('SELECT * FROM rooms WHERE id = ?', [roomId]);
      if (!room) return socket.emit('error', { message: 'Otaq tapılmadı' });

      const existing = await db.get('SELECT * FROM players WHERE room_id = ? AND username = ?', [roomId, username]);
      let playerId = existing ? existing.id : uuidv4();
      
      if (existing) {
        await db.run('UPDATE players SET socket_id = ? WHERE id = ?', [socket.id, playerId]);
      } else {
        await db.run('INSERT INTO players (id, room_id, username, socket_id) VALUES (?, ?, ?, ?)', [playerId, roomId, username, socket.id]);
      }
      
      socket.join(roomId);
      socket.data = { roomId, username, playerId };

      // Yaddaşın bərpası
      if (room.status === 'playing' && !activeRooms[roomId]) {
        const puzzle = loadBuiltinPuzzles().find(p => p.id === room.puzzle_id);
        if (puzzle) {
          const cells = new Array(puzzle.width * puzzle.height).fill('');
          const saved = await db.all('SELECT cell_index, letter FROM cell_states WHERE room_id = ?', [roomId]);
          saved.forEach(s => cells[s.cell_index] = s.letter);
          activeRooms[roomId] = { puzzle, cells, status: 'playing' };
        }
      }

      const state = activeRooms[roomId];
      const players = await db.all('SELECT id, username, score, cells_filled FROM players WHERE room_id = ?', [roomId]);
      
      socket.emit('joined', {
        playerId, roomId, roomName: room.name, players,
        gameStatus: room.status,
        puzzle: state?.status === 'playing' ? sanitizePuzzle(state.puzzle) : null,
        cells: state?.cells || []
      });
      socket.to(roomId).emit('player_joined', { id: playerId, username, score: existing ? existing.score : 0 });
    } catch (e) {
      console.error("Otağa qoşulma xətası:", e);
    }
  });

  socket.on('fill_cell', async ({ cellIndex, letter }) => {
    try {
      const { roomId, username, playerId } = socket.data || {};
      const state = activeRooms[roomId];
      if (!state || state.status !== 'playing') return;

      const upperLetter = (letter || '').toUpperCase().slice(0, 1);
      state.cells[cellIndex] = upperLetter;
      await db.run('INSERT OR REPLACE INTO cell_states (room_id, cell_index, letter, filled_by) VALUES (?, ?, ?, ?)', [roomId, cellIndex, upperLetter, username]);

      const row = Math.floor(cellIndex / state.puzzle.width), col = cellIndex % state.puzzle.width;
      const correct = state.puzzle.grid[row][col] === upperLetter;
      if (correct) {
        await db.run('UPDATE players SET score = score + 10, cells_filled = cells_filled + 1 WHERE id = ?', [playerId]);
      }

      io.to(roomId).emit('cell_filled', { cellIndex, letter: upperLetter, byUsername: username, correct });
      if (await checkCompletion(roomId)) await endGame(roomId, playerId);
    } catch(e) {
      console.error("Xana doldurularkən xəta:", e);
    }
  });

  socket.on('request_start_game', () => { 
    if (socket.data?.roomId) startGameForRoom(socket.data.roomId); 
  });

  socket.on('chat_message', (data) => {
    if (socket.data?.roomId) {
      io.to(socket.data.roomId).emit('chat_message', { username: socket.data.username, message: data.message.slice(0, 200) });
    }
  });

  socket.on('disconnect', async () => {
    try {
      if (socket.data?.playerId) {
        await db.run('UPDATE players SET socket_id = NULL WHERE id = ?', [socket.data.playerId]);
      }
    } catch(e) {
      console.error("Disconnect xətası:", e);
    }
  });
});

// Front-end faylları
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/game', (_, res) => res.sendFile(path.join(__dirname, 'public', 'game.html')));
app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// 🔴 DİQQƏT: 0.0.0.0 hissəsi Railway üçün məcburidir!
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Krossword serveri onlayndır! Port: ${PORT}`);
});