import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import Database from 'better-sqlite3'

const userDataPath = app.getPath('userData')
if (!existsSync(userDataPath)) mkdirSync(userDataPath, { recursive: true })

export const db = new Database(join(userDataPath, 'launcher.db'))

// 初始化表结构
db.exec(`
  CREATE TABLE IF NOT EXISTS pinned_apps (
    path TEXT PRIMARY KEY, 
    name TEXT, 
    icon TEXT, 
    extension TEXT,
    grid_index INTEGER DEFAULT -1
  );
  CREATE TABLE IF NOT EXISTS usage_stats (path TEXT PRIMARY KEY, count INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`)

// 预设默认热键
const hotkeyExists = db.prepare('SELECT value FROM settings WHERE key = ?').get('hotkey')
if (!hotkeyExists) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('hotkey', 'Alt+Q')
}

// 迁移逻辑
try {
  const tableInfo = db.pragma('table_info(pinned_apps)') as any[]
  if (!tableInfo.some(col => col.name === 'grid_index')) {
    db.exec('ALTER TABLE pinned_apps ADD COLUMN grid_index INTEGER DEFAULT -1')
  }
} catch (e) {}

export const stmts = {
  getPinned: db.prepare('SELECT * FROM pinned_apps ORDER BY grid_index ASC'),
  pin: db.prepare('INSERT OR REPLACE INTO pinned_apps (path, name, icon, extension, grid_index) VALUES (?, ?, ?, ?, ?)'),
  unpin: db.prepare('DELETE FROM pinned_apps WHERE path = ?'),
  updateIndex: db.prepare('UPDATE pinned_apps SET grid_index = ? WHERE path = ?'),
  incrementUsage: db.prepare('INSERT INTO usage_stats (path, count) VALUES (?, 1) ON CONFLICT(path) DO UPDATE SET count = count + 1'),
  getUsage: db.prepare('SELECT count FROM usage_stats WHERE path = ?'),
  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
}

export function closeDb() {
  db.close()
}
