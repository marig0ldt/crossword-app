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

const PORT = process.env.PORT || 3000;
const activeRooms = {}; 
const playerProgress = {}; // Fərdi yarış yaddaşı: { roomId: { username: { cells: [], finishedWords: [] } } }

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

// ─── Middleware ───
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
    res.status(500).json({ error: 'Server xətası' }); 
  }
}

// ─── API ───
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
    res.status(500).json({ error: 'Datalar gətirilmədi' }); 
  }
});

app.post('/api/player/rooms', async (req, res) => {
  try {
    const { name, puzzleId, maxPlayers } = req.body;
    if (!name || !puzzleId) return res.status(400).json({ error: 'Ad və tapmaca tələb olunur' });
    const id = uuidv4().slice(0, 8).toUpperCase();
    await db.run('INSERT INTO rooms (id, name, puzzle_id, max_players) VALUES (?, ?, ?, ?)', [id, name, puzzleId, maxPlayers || 25]);
    res.json({ id, name, puzzleId });
  } catch (e) {
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
    res.status(500).json({ error: 'Daxil olarkən xəta baş verdi' });
  }
});

app.delete('/api/rooms/:id', adminAuth, async (req, res) => {
  try {
    await db.run('DELETE FROM players WHERE room_id = ?', [req.params.id]);
    await db.run('DELETE FROM cell_states WHERE room_id = ?', [req.params.id]);
    await db.run('DELETE FROM rooms WHERE id = ?', [req.params.id]);
    delete activeRooms[req.params.id];
    delete playerProgress[req.params.id];
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Otağı silmək mümkün olmadı' });
  }
});

// ─── Helpers ───
function sanitizePuzzle(puzzle) {
  const grid = puzzle.grid.map(row => row.map(cell => cell === '#' ? '#' : ''));
  return { ...puzzle, grid, solution: undefined };
}

async function startGameForRoom(roomId) {
  try {
    const room = await db.get('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (!room || room.status === 'playing') return;

    const puzzles = loadBuiltinPuzzles();
    const puzzle = puzzles.find(p => p.id === room.puzzle_id);
    if (!puzzle) return;

    // Bütün sözlərin və xanaların ümumi sayını hesablayırıq
    const totalWords = Object.keys(puzzle.cluesAcross || {}).length + Object.keys(puzzle.cluesDown || {}).length;
    let totalCells = 0;
    puzzle.grid.forEach(row => row.forEach(c => { if(c !== '#') totalCells++; }));

    await db.run('DELETE FROM cell_states WHERE room_id = ?', [room.id]);
    await db.run('UPDATE rooms SET status = ? WHERE id = ?', ['playing', room.id]);
    await db.run('UPDATE players SET score = 0, cells_filled = 0 WHERE room_id = ?', [room.id]);

    activeRooms[room.id] = { puzzle, totalWords, totalCells, startTime: Date.now(), status: 'playing' };
    playerProgress[room.id] = {}; // Hər kəs üçün fərdi progress yaradırıq

    io.to(room.id).emit('game_started', { puzzle: sanitizePuzzle(puzzle) });
  } catch (e) {
    console.error("Oyunu başladarkən xəta:", e);
  }
}

async function endGame(roomId, winnerUsername) {
  try {
    const state = activeRooms[roomId];
    if (!state) return;
    state.status = 'finished';
    
    const timeTaken = Math.floor((Date.now() - state.startTime) / 1000);
    const m = Math.floor(timeTaken / 60).toString().padStart(2, '0');
    const s = (timeTaken % 60).toString().padStart(2, '0');

    await db.run('UPDATE rooms SET status = ? WHERE id = ?', ['waiting', roomId]);
    const scores = await db.all('SELECT username, score FROM players WHERE room_id = ? ORDER BY score DESC', [roomId]);
    
    io.to(roomId).emit('game_over', { scores, winner: winnerUsername, time: `${m}:${s}` });
  } catch(e) {
    console.error("Oyunu bitirərkən xəta:", e);
  }
}

// ─── Socket.io ───
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

      const state = activeRooms[roomId];
      if (!playerProgress[roomId]) playerProgress[roomId] = {};
      if (!playerProgress[roomId][username]) {
        playerProgress[roomId][username] = { 
          cells: state ? new Array(state.puzzle.width * state.puzzle.height).fill('') : [], 
          correctWords: 0, 
          lockedCells: [] 
        };
      }

      const players = await db.all('SELECT id, username, score FROM players WHERE room_id = ?', [roomId]);
      const myProgress = playerProgress[roomId][username];
      
      socket.emit('joined', {
        playerId, roomId, roomName: room.name, players,
        gameStatus: room.status,
        puzzle: state?.status === 'playing' ? sanitizePuzzle(state.puzzle) : null,
        cells: myProgress.cells,
        lockedCells: myProgress.lockedCells,
        totalWords: state ? state.totalWords : 0
      });
      socket.to(roomId).emit('player_joined', { id: playerId, username, score: existing ? existing.score : 0 });
    } catch (e) {
      console.error("Otağa qoşulma xətası:", e);
    }
  });

  socket.on('check_word', async ({ wordIndexes, enteredWord, direction }) => {
    const { roomId, username } = socket.data || {};
    const state = activeRooms[roomId];
    if (!state || state.status !== 'playing') return;

    // Əsl həlli yoxlayırıq
    let correctWord = '';
    wordIndexes.forEach(idx => {
      const r = Math.floor(idx / state.puzzle.width);
      const c = idx % state.puzzle.width;
      correctWord += state.puzzle.grid[r][c];
    });

    if (enteredWord.toUpperCase() === correctWord.toUpperCase()) {
      const progress = playerProgress[roomId][username];
      progress.correctWords += 1;
      
      // Həmin sözün xanalarını kilidlənmiş kimi qeyd edirik
      wordIndexes.forEach(idx => {
        if (!progress.lockedCells.includes(idx)) progress.lockedCells.push(idx);
      });

      // Digər oyunçulara "Filankəs söz tapdı" statusunu göndəririk (sözü göstərmirik)
      io.to(roomId).emit('player_progress_update', { username, wordsFound: progress.correctWords, totalWords: state.totalWords });
      
      // Bu oyunçuya "Söz düzdür, Yaşıl et!" əmri göndəririk
      socket.emit('word_correct', { wordIndexes });

      // Əgər bütün sözləri tapıbsa - Qalibdir!
      if (progress.correctWords >= state.totalWords) {
        await endGame(roomId, username);
      }
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
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Yarış Serveri Onlayndır! Port: ${PORT}`);
});