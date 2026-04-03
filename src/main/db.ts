import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import Database from 'better-sqlite3'

const userDataPath = app.getPath('userData')
let db: any = null
let isHealthy = false

try {
  if (!existsSync(userDataPath)) mkdirSync(userDataPath, { recursive: true })
  db = new Database(join(userDataPath, 'launcher.db'), { timeout: 5000 }) // 增加超时防止死锁
  
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
    INSERT OR IGNORE INTO settings (key, value) VALUES ('hotkey', 'Alt+Q');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('db_version', '1');
  `)
  isHealthy = true
} catch (err) {
  console.error('[DB] 数据库初始化失败:', err)
}

// 审计建议 #1: 导出 stmts 时增加防御性
export const stmts = {
  getPinned: db?.prepare('SELECT * FROM pinned_apps ORDER BY grid_index ASC'),
  pin: db?.prepare('INSERT OR REPLACE INTO pinned_apps (path, name, icon, extension, grid_index) VALUES (?, ?, ?, ?, ?)'),
  unpin: db?.prepare('DELETE FROM pinned_apps WHERE path = ?'),
  updateIndex: db?.prepare('UPDATE pinned_apps SET grid_index = ? WHERE path = ?'),
  incrementUsage: db?.prepare('INSERT INTO usage_stats (path, count) VALUES (?, 1) ON CONFLICT(path) DO UPDATE SET count = count + 1'),
  getUsage: db?.prepare('SELECT count FROM usage_stats WHERE path = ?'),
  getSetting: db?.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db?.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'),
  // 审计建议 #2 所需：
  getByIndex: db?.prepare('SELECT path FROM pinned_apps WHERE grid_index = ?')
}

export function closeDb() {
  if (db && typeof db.close === 'function') db.close()
}

export { db, isHealthy }
