const db = require('./db');
const path = require('path');
const bcrypt = require('bcryptjs');



// Tables
(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_super INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    puzzle_id TEXT NOT NULL,
    status TEXT DEFAULT 'waiting',
    max_players INTEGER DEFAULT 25,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    room_id TEXT,
    username TEXT NOT NULL,
    socket_id TEXT,
    score INTEGER DEFAULT 0,
    cells_filled INTEGER DEFAULT 0,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(room_id) REFERENCES rooms(id)
  );
  CREATE TABLE IF NOT EXISTS game_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    puzzle_id TEXT NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    winner_id TEXT,
    FOREIGN KEY(room_id) REFERENCES rooms(id)
  );
  CREATE TABLE IF NOT EXISTS cell_states (
    room_id TEXT NOT NULL,
    cell_index INTEGER NOT NULL,
    letter TEXT,
    filled_by TEXT,
    filled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(room_id, cell_index)
  );
`);

// Create default super admin if not exists

if (!existingAdmin) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admins (username, password_hash, is_super) VALUES (?, ?, 1)').run('admin', hash);
  console.log('✅ Default admin created: admin / admin123');
}

module.exports = db;