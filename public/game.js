const params = new URLSearchParams(window.location.search);
const roomId = params.get('room');
const username = params.get('user') || sessionStorage.getItem('cw_username') || 'Oyunçu';

if (!roomId) window.location.href = '/';

const socket = io();
let puzzle = null;
let cells = [];
let selectedCell = -1;
let direction = 'across';
let myPlayerId = null;
let timerInterval = null;
let gameStartTime = null;

// ─── Socket events ─────────────────────────────────────────────────────────
socket.emit('join_room', { roomId, username });

socket.on('joined', (data) => {
  myPlayerId = data.playerId;
  document.getElementById('room-name').textContent = data.roomName;
  document.getElementById('room-id-badge').textContent = data.roomId;
  updatePlayersList(data.players);
  if (data.gameStatus === 'playing' && data.puzzle) {
    puzzle = data.puzzle;
    cells = data.cells;
    showGame();
    renderGrid();
    renderClues();
  }
});

socket.on('player_joined', (player) => {
  addOrUpdatePlayer(player);
  addChat('system', `${player.username} qoşuldu 👋`);
});

socket.on('player_left', ({ playerId, username: u }) => {
  document.getElementById(`player-${playerId}`)?.remove();
  updatePlayerCount();
  if (u) addChat('system', `${u} ayrıldı`);
});

socket.on('game_started', (data) => {
  puzzle = data.puzzle;
  cells = data.cells;
  showGame();
  renderGrid();
  renderClues();
  startTimer();
  addChat('system', '🎮 Oyun başladı! Uğurlar!');
});

socket.on('cell_filled', ({ cellIndex, letter, byUsername, correct }) => {
  cells[cellIndex] = letter;
  const el = document.querySelector(`[data-index="${cellIndex}"] input`);
  if (el) {
    el.value = letter;
    el.classList.remove('correct', 'wrong', 'other');
    el.classList.add(byUsername === username ? (correct ? 'correct' : 'wrong') : 'other');
    setTimeout(() => el.classList.remove('correct', 'wrong', 'other'), 1000);
  }
  updatePlayerScore(byUsername, correct);
});

socket.on('game_over', ({ scores, winnerId }) => {
  clearInterval(timerInterval);
  showGameOver(scores);
});

socket.on('chat_message', ({ username: u, message }) => {
  addChat(u, message);
});

socket.on('kicked', ({ message }) => {
  alert(message);
  window.location.href = '/';
});

socket.on('room_closed', ({ message }) => {
  alert(message);
  window.location.href = '/';
});

socket.on('error', ({ message }) => {
  alert('Xəta: ' + message);
  window.location.href = '/';
});

// ─── Grid rendering ─────────────────────────────────────────────────────────
function renderGrid() {
  if (!puzzle) return;
  const container = document.getElementById('crossword-grid');
  container.style.gridTemplateColumns = `repeat(${puzzle.width}, 1fr)`;
  container.innerHTML = '';
  
  for (let r = 0; r < puzzle.height; r++) {
    for (let c = 0; c < puzzle.width; c++) {
      const idx = r * puzzle.width + c;
      const sol = puzzle.grid[r][c];
      
      const cell = document.createElement('div');
      cell.className = 'grid-cell' + (sol === '#' ? ' black' : '');
      cell.dataset.index = idx;
      cell.dataset.row = r;
      cell.dataset.col = c;
      
      if (sol !== '#') {
        const num = puzzle.numbers[`${r},${c}`];
        if (num) {
          const numEl = document.createElement('span');
          numEl.className = 'cell-number';
          numEl.textContent = num;
          cell.appendChild(numEl);
        }
        
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 1;
        input.value = cells[idx] || '';
        input.dataset.index = idx;
        input.autocomplete = 'off';
        
        input.addEventListener('click', () => selectCell(idx));
        input.addEventListener('keydown', (e) => handleKeydown(e, idx));
        input.addEventListener('input', (e) => handleInput(e, idx));
        
        cell.appendChild(input);
      }
      container.appendChild(cell);
    }
  }
}

function renderClues() {
  const across = document.getElementById('clues-across');
  const down = document.getElementById('clues-down');
  
  across.innerHTML = Object.entries(puzzle.cluesAcross || {})
    .sort((a,b) => a[0]-b[0])
    .map(([num, clue]) => `<div class="clue-item" data-dir="across" data-num="${num}" onclick="goToClue('across',${num})">${num}. ${clue}</div>`)
    .join('');
    
  down.innerHTML = Object.entries(puzzle.cluesDown || {})
    .sort((a,b) => a[0]-b[0])
    .map(([num, clue]) => `<div class="clue-item" data-dir="down" data-num="${num}" onclick="goToClue('down',${num})">${num}. ${clue}</div>`)
    .join('');
}

function selectCell(idx) {
  if (!puzzle) return;
  selectedCell = idx;
  
  document.querySelectorAll('.grid-cell').forEach(c => c.classList.remove('selected', 'highlighted'));
  const cell = document.querySelector(`[data-index="${idx}"]`);
  
  if (cell) cell.classList.add('selected');
  highlightWord(idx);
  updateClueDisplay(idx);
  document.querySelector(`[data-index="${idx}"] input`)?.focus();
}

function highlightWord(idx) {
  if (!puzzle) return;
  const r = Math.floor(idx / puzzle.width);
  const c = idx % puzzle.width;
  
  if (direction === 'across') {
    let start = c;
    while (start > 0 && puzzle.grid[r][start-1] !== '#') start--;
    let end = c;
    while (end < puzzle.width-1 && puzzle.grid[r][end+1] !== '#') end++;
    
    for (let col = start; col <= end; col++) {
      document.querySelector(`[data-index="${r*puzzle.width+col}"]`)?.classList.add('highlighted');
    }
  } else {
    let start = r;
    while (start > 0 && puzzle.grid[start-1][c] !== '#') start--;
    let end = r;
    while (end < puzzle.height-1 && puzzle.grid[end+1][c] !== '#') end++;
    
    for (let row = start; row <= end; row++) {
      document.querySelector(`[data-index="${row*puzzle.width+c}"]`)?.classList.add('highlighted');
    }
  }
}

function updateClueDisplay(idx) {
  const r = Math.floor(idx / puzzle.width);
  const c = idx % puzzle.width;
  let clueNum = null, clueText = '';
  
  if (direction === 'across') {
    let start = c;
    while (start > 0 && puzzle.grid[r][start-1] !== '#') start--;
    clueNum = puzzle.numbers[`${r},${start}`];
    if (clueNum) clueText = puzzle.cluesAcross[clueNum] || '';
  } else {
    let start = r;
    while (start > 0 && puzzle.grid[start-1][c] !== '#') start--;
    clueNum = puzzle.numbers[`${start},${c}`];
    if (clueNum) clueText = puzzle.cluesDown[clueNum] || '';
  }
  
  const display = clueNum ? `${clueNum}. ${clueText}` : 'İpucu yoxdur';
  document.getElementById('active-clue').textContent = display;
  
  document.querySelectorAll('.clue-item').forEach(el => el.classList.remove('active-clue-item'));
  if (clueNum) {
    const clueEl = document.querySelector(`.clue-item[data-dir="${direction}"][data-num="${clueNum}"]`);
    if (clueEl) { 
      clueEl.classList.add('active-clue-item'); 
      clueEl.scrollIntoView({ block: 'nearest' }); 
    }
  }
}

function handleInput(e, idx) {
  const val = e.target.value.toUpperCase().replace(/[^A-ZƏİÖÜĞŞÇ]/gi, '');
  if (!val) { 
    socket.emit('fill_cell', { cellIndex: idx, letter: '' }); 
    return; 
  }
  const letter = val.slice(-1).toUpperCase();
  e.target.value = letter;
  socket.emit('fill_cell', { cellIndex: idx, letter });
  moveNext(idx);
}

function handleKeydown(e, idx) {
  const r = Math.floor(idx / puzzle.width);
  const c = idx % puzzle.width;
  
  if (e.key === 'Backspace' && !e.target.value) {
    movePrev(idx); return;
  }
  if (e.key === 'ArrowRight') { e.preventDefault(); moveToCell(r, c+1); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); moveToCell(r, c-1); }
  if (e.key === 'ArrowDown') { e.preventDefault(); moveToCell(r+1, c); }
  if (e.key === 'ArrowUp') { e.preventDefault(); moveToCell(r-1, c); }
  
  if (e.key === 'Tab') { 
    e.preventDefault(); 
    setDir(direction === 'across' ? 'down' : 'across'); 
  }
}

function moveNext(idx) {
  const r = Math.floor(idx / puzzle.width);
  const c = idx % puzzle.width;
  if (direction === 'across') { moveToCell(r, c+1); }
  else { moveToCell(r+1, c); }
}

function movePrev(idx) {
  const r = Math.floor(idx / puzzle.width);
  const c = idx % puzzle.width;
  if (direction === 'across') { moveToCell(r, c-1); }
  else { moveToCell(r-1, c); }
}

function moveToCell(r, c) {
  if (r < 0 || r >= puzzle.height || c < 0 || c >= puzzle.width) return;
  const idx = r * puzzle.width + c;
  if (puzzle.grid[r][c] === '#') return;
  selectCell(idx);
}

function setDir(dir) {
  direction = dir;
  document.getElementById('btn-across').classList.toggle('active', dir === 'across');
  document.getElementById('btn-down').classList.toggle('active', dir === 'down');
  if (selectedCell >= 0) { 
    highlightWord(selectedCell); 
    updateClueDisplay(selectedCell); 
  }
}

function goToClue(dir, num) {
  direction = dir;
  const entry = Object.entries(puzzle.numbers).find(([key, n]) => {
    if (n !== parseInt(num)) return false;
    const [r, c] = key.split(',').map(Number);
    if (dir === 'across') return c === 0 || puzzle.grid[r][c-1] === '#';
    return r === 0 || puzzle.grid[r-1][c] === '#';
  });
  if (entry) {
    const [r, c] = entry[0].split(',').map(Number);
    selectCell(r * puzzle.width + c);
    setDir(dir);
  }
}

// ─── Players ────────────────────────────────────────────────────────────────
function updatePlayersList(players) {
  const list = document.getElementById('players-list');
  list.innerHTML = players.map(p => playerHTML(p)).join('');
  document.getElementById('player-count').textContent = `(${players.length})`;
}

function addOrUpdatePlayer(player) {
  const existing = document.getElementById(`player-${player.id}`);
  if (existing) existing.outerHTML = playerHTML(player);
  else {
    document.getElementById('players-list').insertAdjacentHTML('beforeend', playerHTML(player));
    updatePlayerCount();
  }
}

function playerHTML(p) {
  const isMe = p.id === myPlayerId || p.username === username;
  return `
    <div class="player-item ${isMe ? 'me' : ''}" id="player-${p.id}">
      <span class="player-name">${isMe ? '⭐ ' : ''}${p.username}</span>
      <span class="player-score">${p.score || 0} xal</span>
    </div>
  `;
}

function updatePlayerCount() {
  const count = document.querySelectorAll('.player-item').length;
  document.getElementById('player-count').textContent = `(${count})`;
}

function updatePlayerScore(uname, correct) {
  document.querySelectorAll('.player-item').forEach(el => {
    if (el.querySelector('.player-name')?.textContent.includes(uname)) {
      const scoreEl = el.querySelector('.player-score');
      if (scoreEl && correct) {
        const cur = parseInt(scoreEl.textContent) || 0;
        scoreEl.textContent = (cur + 10) + ' xal';
      }
    }
  });
}

// ─── Chat ────────────────────────────────────────────────────────────────────
function addChat(user, msg) {
  const el = document.getElementById('chat-messages');
  const isSystem = user === 'system';
  el.insertAdjacentHTML('beforeend',
    `<div class="chat-msg ${isSystem ? 'system' : ''}">${isSystem ? `<em>${msg}</em>` : `<strong>${user}:</strong> ${msg}`}</div>`
  );
  el.scrollTop = el.scrollHeight;
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  
  // Burada username əlavə edildi ki, adı düzgün düşsün
  socket.emit('chat_message', { username: username, message: msg });
  input.value = '';
}

document.getElementById('chat-input').addEventListener('keypress', e => {
  if (e.key === 'Enter') sendChat();
});

// ─── UI helpers ──────────────────────────────────────────────────────────────
function showGame() {
  document.getElementById('waiting-screen').style.display = 'none';
  document.getElementById('game-screen').style.display = 'block';
  document.getElementById('gameover-screen').style.display = 'none';
  document.getElementById('status-badge').textContent = 'Oyun Gedir';
  document.getElementById('status-badge').className = 'badge badge-green';
  
  // "Krossüord" əvəzinə "Krossword"
  document.getElementById('puzzle-title').textContent = puzzle.title || 'Krossword';
  document.getElementById('timer').style.display = 'inline';
}

function showGameOver(scores) {
  document.getElementById('game-screen').style.display = 'none';
  document.getElementById('gameover-screen').style.display = 'flex';
  document.getElementById('status-badge').textContent = 'Oyun bitdi';
  
  const scoreHtml = scores.map((p, i) =>
    `<div class="score-row ${i===0?'winner':''}">
      <span>${i===0?'🥇':i===1?'🥈':i===2?'🥉':'  '} ${p.username}</span>
      <span>${p.score} xal (${p.cells_filled} hücrə)</span>
    </div>`
  ).join('');
  
  document.getElementById('final-scores').innerHTML = scoreHtml || '<p>Nəticə yoxdur</p>';
}

function startTimer() {
  gameStartTime = Date.now();
  const timerEl = document.getElementById('timer');
  timerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - gameStartTime) / 1000);
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    timerEl.textContent = `${m}:${sec}`;
  }, 1000);
}

// ─── Yeni Funksiya: Oyunçunun admin olmadan oyunu başlatması ─────────────────
function playerStartGame() {
  if (confirm("Oyunu bütün otaq üçün başlatmağa əminsiniz?")) {
    socket.emit('request_start_game');
  }
}