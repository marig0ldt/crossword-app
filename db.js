const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs'); // Admin şifrəsi üçün lazımdır
const dbPath = path.join(__dirname, 'crossword.db');

const db = new sqlite3.Database(dbPath);

const dbAsync = {
  get: (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  }),
  all: (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  }),
  run: (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  })
};

// Cədvəlləri və Default Admini yaradırıq
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, name TEXT, puzzle_id TEXT, max_players INTEGER, status TEXT DEFAULT 'waiting', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, room_id TEXT, username TEXT, socket_id TEXT, score INTEGER DEFAULT 0, cells_filled INTEGER DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS cell_states (room_id TEXT, cell_index INTEGER, letter TEXT, filled_by TEXT, PRIMARY KEY(room_id, cell_index))`);
  db.run(`CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, is_super INTEGER DEFAULT 0)`);
  
  // Əgər bazada admin yoxdursa, avtomatik "admin" və şifrə "admin123" yaradırıq
  db.get("SELECT id FROM admins WHERE username = 'admin'", (err, row) => {
    if (!row) {
      const hash = bcrypt.hashSync('admin123', 10);
      db.run("INSERT INTO admins (username, password_hash, is_super) VALUES ('admin', ?, 1)", [hash]);
    }
  });
});

module.exports = dbAsync;