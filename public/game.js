const params = new URLSearchParams(window.location.search);
const roomId = params.get('room');
const username = params.get('user') || sessionStorage.getItem('cw_username') || 'Oyunçu';

if (!roomId) window.location.href = '/';

const socket = io();
let puzzle = null;
let cells = [];
let lockedCells = [];
let selectedCell = -1;
let direction = 'across';
let myPlayerId = null;
let timerInterval = null;
let gameStartTime = null;
let totalGameWords = 0;

// ─── Socket events ───
socket.emit('join_room', { roomId, username });

socket.on('joined', (data) => {
  myPlayerId = data.playerId;
  document.getElementById('room-name').textContent = data.roomName;
  document.getElementById('room-id-badge').textContent = data.roomId;
  totalGameWords = data.totalWords || 0;
  
  updatePlayersList(data.players);
  if (data.gameStatus === 'playing' && data.puzzle) {
    puzzle = data.puzzle;
    cells = data.cells || [];
    lockedCells = data.lockedCells || [];
    showGame();
    renderGrid();
    renderClues();
    startTimer();
  }
});

socket.on('player_joined', (player) => {
  addOrUpdatePlayer(player);
  addChat('system', `${player.username} qoşuldu 👋`);
});

socket.on('game_started', (data) => {socket.on('game_started', (data) => {
  puzzle = data.puzzle;
  
  // 🔴 Serverdən gələn totalWords-u götürürük
  totalGameWords = data.totalWords || Object.keys(puzzle.cluesAcross || {}).length + Object.keys(puzzle.cluesDown || {}).length;
  
  cells = new Array(puzzle.width * puzzle.height).fill('');
  lockedCells = [];
  showGame();
  renderGrid();
  renderClues();
  startTimer();
  addChat('system', '🎮 Yarış başladı! Uğurlar!');

  // Ekranda "0 / 0 söz" qalan yazıları avtomatik "0 / X söz" edirik
  document.querySelectorAll('.player-score').forEach(el => {
    el.textContent = `0 / ${totalGameWords} söz`;
  });
});
  // Söz DÜZ tapılanda xanaları YAŞIL edib kilidləyir
socket.on('word_correct', ({ wordIndexes }) => {
  wordIndexes.forEach(idx => {
    if (!lockedCells.includes(idx)) lockedCells.push(idx);
    const el = document.querySelector(`[data-index="${idx}"] input`);
    if (el) {
      el.classList.remove('wrong');
      el.classList.add('correct');
      el.disabled = true;
    }
  });
});

// Söz SƏHV tapılanda xanaları 1 saniyəlik QIRMIZI edib titrədir
socket.on('word_incorrect', ({ wordIndexes }) => {
  wordIndexes.forEach(idx => {
    const el = document.querySelector(`[data-index="${idx}"] input`);
    // Əgər həmin xana başqa düz sözün xanası (yaşıl) deyilsə, qırmızı et
    if (el && !lockedCells.includes(idx)) {
      el.classList.add('wrong');
      setTimeout(() => el.classList.remove('wrong'), 800); // 0.8 saniyə sonra qırmızını sil
    }
  });
});
  puzzle = data.puzzle;
  cells = new Array(puzzle.width * puzzle.height).fill('');
  lockedCells = [];
  showGame();
  renderGrid();
  renderClues();
  startTimer();
  addChat('system', '🎮 Yarış başladı! Uğurlar!');
});

// Söz düz tapılanda xanaları YAŞIL rəngə boyayır və kilidləyir
socket.on('word_correct', ({ wordIndexes }) => {
  wordIndexes.forEach(idx => {
    if (!lockedCells.includes(idx)) lockedCells.push(idx);
    const el = document.querySelector(`[data-index="${idx}"] input`);
    if (el) {
      el.classList.add('correct');
      el.disabled = true; // Əllə silməyin qarşısını alırıq
    }
  });
});

// Kənar paneldə oyunçunun neçə söz tapdığını real vaxtda göstərir
socket.on('player_progress_update', ({ username: u, wordsFound, totalWords }) => {
  totalGameWords = totalWords;
  document.querySelectorAll('.player-item').forEach(el => {
    if (el.querySelector('.player-name')?.textContent.includes(u)) {
      const scoreEl = el.querySelector('.player-score');
      if (scoreEl) scoreEl.textContent = `${wordsFound} / ${totalWords} söz`;
    }
  });
});

socket.on('game_over', ({ scores, winner, time }) => {
  clearInterval(timerInterval);
  showGameOver(scores, winner, time);
});

socket.on('chat_message', ({ username: u, message }) => { addChat(u, message); });
socket.on('error', ({ message }) => { alert('Xəta: ' + message); window.location.href = '/'; });

// ─── Grid rendering ───
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
        
        if (lockedCells.includes(idx)) {
          input.classList.add('correct');
          input.disabled = true;
        }

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
  // Əgər xana onsuz da düpdüzdürsə (yaşıldırsa), klikləyəndə istiqaməti dəyişə bilərik amma seçili qalmasın.
  selectedCell = idx;
  
  document.querySelectorAll('.grid-cell').forEach(c => c.classList.remove('selected', 'highlighted'));
  const cell = document.querySelector(`[data-index="${idx}"]`);
  if (cell) cell.classList.add('selected');
  highlightWord(idx);
  updateClueDisplay(idx);
  document.querySelector(`[data-index="${idx}"] input`)?.focus();
}

function getWordIndexes(idx, dir) {
  const r = Math.floor(idx / puzzle.width);
  const c = idx % puzzle.width;
  let indexes = [];
  
  if (dir === 'across') {
    let start = c;
    while (start > 0 && puzzle.grid[r][start-1] !== '#') start--;
    let end = c;
    while (end < puzzle.width-1 && puzzle.grid[r][end+1] !== '#') end++;
    for (let col = start; col <= end; col++) indexes.push(r * puzzle.width + col);
  } else {
    let start = r;
    while (start > 0 && puzzle.grid[start-1][c] !== '#') start--;
    let end = r;
    while (end < puzzle.height-1 && puzzle.grid[end+1][c] !== '#') end++;
    for (let row = start; row <= end; row++) indexes.push(row * puzzle.width + c);
  }
  return indexes;
}

function highlightWord(idx) {
  const indexes = getWordIndexes(idx, direction);
  indexes.forEach(i => document.querySelector(`[data-index="${i}"]`)?.classList.add('highlighted'));
}

function updateClueDisplay(idx) {
  const indexes = getWordIndexes(idx, direction);
  const firstIdx = indexes[0];
  const r = Math.floor(firstIdx / puzzle.width);
  const c = firstIdx % puzzle.width;
  
  const clueNum = puzzle.numbers[`${r},${c}`];
  const clueText = direction === 'across' ? puzzle.cluesAcross[clueNum] : puzzle.cluesDown[clueNum];
  
  document.getElementById('active-clue').textContent = clueNum ? `${clueNum}. ${clueText}` : 'İpucu yoxdur';
}

function handleInput(e, idx) {
  if (lockedCells.includes(idx)) { e.target.value = cells[idx]; return; }
  
  const val = e.target.value.toUpperCase().replace(/[^A-ZƏİÖÜĞŞÇ]/gi, '');
  const letter = val.slice(-1).toUpperCase();
  e.target.value = letter;
  cells[idx] = letter;

  // Bütün sözün xanalarını yoxlayaq görək tam doldurulubmu?
  const wordIndexes = getWordIndexes(idx, direction);
  let currentWord = '';
  let isFull = true;
  
  wordIndexes.forEach(i => {
    const l = document.querySelector(`[data-index="${i}"] input`)?.value;
    if (!l) isFull = false;
    currentWord += l || ' ';
  });

  // Əgər söz tam yazılıbsa, serverə yoxlamağa göndəririk
  if (isFull) {
    socket.emit('check_word', { wordIndexes, enteredWord: currentWord, direction });
  }

  moveNext(idx);
}

function handleKeydown(e, idx) {
  if (lockedCells.includes(idx) && e.key !== 'Tab') return; // Kilidlənibsə üstündə gəzməyə ehtiyac yoxdur
  
  const r = Math.floor(idx / puzzle.width);
  const c = idx % puzzle.width;
  
  if (e.key === 'Backspace' && !e.target.value) { movePrev(idx); return; }
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
  if (direction === 'across') moveToCell(r, c+1);
  else moveToCell(r+1, c);
}

function movePrev(idx) {
  const r = Math.floor(idx / puzzle.width);
  const c = idx % puzzle.width;
  if (direction === 'across') moveToCell(r, c-1);
  else moveToCell(r-1, c);
}

function moveToCell(r, c) {
  if (r < 0 || r >= puzzle.height || c < 0 || c >= puzzle.width) return;
  const idx = r * puzzle.width + c;
  if (puzzle.grid[r][c] === '#' || lockedCells.includes(idx)) return; // Qara və ya yaşıl xanaya atlama
  selectCell(idx);
}

function setDir(dir) {
  direction = dir;
  document.getElementById('btn-across').classList.toggle('active', dir === 'across');
  document.getElementById('btn-down').classList.toggle('active', dir === 'down');
  if (selectedCell >= 0) { highlightWord(selectedCell); updateClueDisplay(selectedCell); }
}

function goToClue(dir, num) {
  direction = dir;
  const entry = Object.entries(puzzle.numbers).find(([key, n]) => n === parseInt(num));
  if (entry) {
    const [r, c] = entry[0].split(',').map(Number);
    selectCell(r * puzzle.width + c);
    setDir(dir);
  }
}

// ─── Players ───
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
    document.getElementById('player-count').textContent = `(${document.querySelectorAll('.player-item').length})`;
  }
}

function playerHTML(p) {
  const isMe = p.id === myPlayerId || p.username === username;
  return `
    <div class="player-item ${isMe ? 'me' : ''}" id="player-${p.id}">
      <span class="player-name">${isMe ? '⭐ ' : ''}${p.username}</span>
      <span class="player-score">0 / ${totalGameWords} söz</span>
    </div>
  `;
}

// ─── Chat ───
function addChat(user, msg) {
  const el = document.getElementById('chat-messages');
  const isSystem = user === 'system';
  el.insertAdjacentHTML('beforeend', `<div class="chat-msg ${isSystem ? 'system' : ''}">${isSystem ? `<em>${msg}</em>` : `<strong>${user}:</strong> ${msg}`}</div>`);
  el.scrollTop = el.scrollHeight;
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit('chat_message', { username: username, message: msg });
  input.value = '';
}
document.getElementById('chat-input').addEventListener('keypress', e => { if (e.key === 'Enter') sendChat(); });

// ─── UI helpers ───
function showGame() {
  document.getElementById('waiting-screen').style.display = 'none';
  document.getElementById('game-screen').style.display = 'block';
  document.getElementById('gameover-screen').style.display = 'none';
  document.getElementById('status-badge').textContent = 'Yarış Gedir';
  document.getElementById('status-badge').className = 'badge badge-green';
  document.getElementById('puzzle-title').textContent = puzzle.title || 'Krossword';
  document.getElementById('timer').style.display = 'inline';
}

function showGameOver(scores, winner, time) {
  document.getElementById('game-screen').style.display = 'none';
  document.getElementById('gameover-screen').style.display = 'flex';
  document.getElementById('status-badge').textContent = 'Oyun bitdi';
  
  const scoreHtml = `
    <div class="score-row winner" style="text-align: center; margin-bottom: 20px;">
      <h3 style="color: gold; font-size: 24px;">🏆 QALİB: ${winner} 🏆</h3>
      <p style="font-size: 18px;">Bitirmə vaxtı: <strong>${time}</strong></p>
    </div>
  `;
  document.getElementById('final-scores').innerHTML = scoreHtml;
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

function playerStartGame() {
  if (confirm("Yarışı başlatmağa əminsiniz?")) socket.emit('request_start_game');
}