import { app, shell, BrowserWindow, ipcMain, globalShortcut, dialog } from 'electron'
import { join, normalize } from 'path'
import { electronApp, is } from '@electron-toolkit/utils'
import { spawn, ChildProcess, exec } from 'child_process'
import { writeFileSync, existsSync } from 'fs'
import { db, stmts, closeDb } from './db'
import { executeQuery } from './sdk'

let everythingProcess: ChildProcess | null = null
const INSTANCE_NAME = 'HuoLauncher'

// --- 修复问题 3: 热键初始化安全检查 ---
let currentHotkey = 'Alt+Q'
try {
  if (stmts?.getSetting) {
    const saved = stmts.getSetting.get('hotkey') as any
    if (saved?.value) currentHotkey = saved.value
  }
} catch (e) { console.error('[HOTKEY] 读取失败:', e) }

// --- 修复问题 7: 图标缓存与并发限制 (审计建议 #27) ---
const iconCache = new Map<string, string>()
const MAX_CACHE_SIZE = 300

async function getCachedIcon(p: string) {
  if (iconCache.has(p)) return iconCache.get(p)!
  try {
    const icon = await app.getFileIcon(p, { size: 'large' })
    const data = icon.toDataURL()
    if (iconCache.size >= MAX_CACHE_SIZE) iconCache.delete(iconCache.keys().next().value!)
    iconCache.set(p, data); return data
  } catch { return '' }
}

function startEverything(): void {
  const userDataPath = app.getPath('userData')
  const iniPath = join(userDataPath, 'Everything.ini')
  const dbPath = join(userDataPath, 'Everything.db')
  const iniContent = `[Everything]\ninstance_name=${INSTANCE_NAME}\nhttp_server_enabled=0\nrun_as_admin=0\ndb_location=${dbPath.replace(/\\/g, '/')}\n`
  writeFileSync(iniPath, iniContent)
  const binPath = is.dev ? join(process.cwd(), 'resources/bin') : join(process.resourcesPath, 'bin')
  everythingProcess = spawn(join(binPath, 'Everything.exe'), ['-config', iniPath, '-minimized'], { detached: true, stdio: 'pipe' })
  everythingProcess.on('exit', () => everythingProcess = null)
}

function safeRegisterHotkey(win: BrowserWindow, newHotkey: string) {
  const oldHotkey = currentHotkey
  try {
    const success = globalShortcut.register(newHotkey, () => {
      if (win.isDestroyed()) return
      win.isVisible() ? win.hide() : (win.show(), win.focus(), win.webContents.send('window-shown'))
    })
    if (success) {
      if (oldHotkey !== newHotkey) globalShortcut.unregister(oldHotkey)
      currentHotkey = newHotkey; stmts.setSetting.run('hotkey', newHotkey)
      return { success: true }
    }
    // 修复问题 37: 增加详细错误日志
    console.error(`[HOTKEY] 注册失败: ${newHotkey} 已被占用`)
    return { success: false, message: '快捷键已被占用' }
  } catch (err: any) { return { success: false, message: err.message } }
}

function createWindow(): BrowserWindow | null {
  const win = new BrowserWindow({
    width: 1000, height: 750, show: false, autoHideMenuBar: true,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  // 修复问题 33: 增加微小延迟防止失去焦点时的闪烁
  win.on('blur', () => { setTimeout(() => { if (!win.isDestroyed()) win.hide() }, 100) })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

// --- IPC 接口 ---
ipcMain.handle('get-hotkey', () => currentHotkey)
ipcMain.handle('set-hotkey', (_, h: string) => {
  const win = BrowserWindow.getAllWindows()[0]
  // 修复问题 19: 增加有效性检查
  if (!win) return { success: false, message: '系统未准备好' }
  return safeRegisterHotkey(win, h)
})

ipcMain.handle('get-pinned-apps', () => stmts.getPinned.all())
ipcMain.handle('update-app-position', (_, { path, index }) => {
  if (typeof index !== 'number' || index < 0 || index >= 50) return stmts.getPinned.all()
  const cur = db.prepare('SELECT grid_index FROM pinned_apps WHERE path = ?').get(path) as any
  const tgt = db.prepare('SELECT path FROM pinned_apps WHERE grid_index = ?').get(index) as any
  db.transaction(() => {
    if (tgt && tgt.path !== path) stmts.updateIndex.run(cur.grid_index, tgt.path)
    stmts.updateIndex.run(index, path)
  })()
  return stmts.getPinned.all()
})

ipcMain.handle('search', async (_, q: string) => {
  const raw = executeQuery(q)
  // 优化问题 29: 限制图标获取的并发，防止文件句柄爆炸
  const res = await Promise.all(raw.slice(0, 50).map(async (i) => {
    const p = i.folder.endsWith('\\') ? i.folder + i.name : i.folder + '\\' + i.name
    const usage = stmts.getUsage.get(p) as any, icon = await getCachedIcon(p)
    return { name: i.name.replace(/\.[^/.]+$/, ''), path: p, icon, extension: i.name.split('.').pop() || 'file', usageCount: usage?.count ?? 0 }
  }))
  return res.sort((a, b) => (b.usageCount - a.usageCount) || a.name.localeCompare(b.name))
})

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile', 'openDirectory'], filters: [{ name: 'Apps', extensions: ['exe', 'lnk'] }] })
  if (result.canceled || !result.filePaths[0]) return null
  const p = result.filePaths[0]; if (!existsSync(p)) return null
  const n = p.split(/[\\\/]/).pop() || '', icon = await getCachedIcon(p)
  return { name: n.replace(/\.[^/.]+$/, ''), path: p, icon, extension: n.includes('.') ? n.split('.').pop() : 'folder' }
})

ipcMain.handle('process-paths', async (_, paths: string[]) => {
  const res = await Promise.all((paths || []).map(async (p) => {
    if (typeof p !== 'string' || !existsSync(p)) return null
    const n = p.split(/[\\\/]/).pop() || '', icon = await getCachedIcon(p)
    return { name: n.replace(/\.[^/.]+$/, ''), path: p, icon, extension: n.includes('.') ? n.split('.').pop() : 'file' }
  }))
  return res.filter((item): item is NonNullable<typeof item> => item !== null)
})

ipcMain.on('launch', (_, path: string) => {
  if (typeof path !== 'string' || !existsSync(path)) return
  const safePath = normalize(path)
  if (!/^[a-zA-Z]:\\/.test(safePath)) return
  try {
    stmts.incrementUsage.run(safePath)
    const psCommand = `Start-Process -FilePath "${safePath.replace(/"/g, '')}" -Verb RunAs`
    exec(`powershell -NoProfile -Command "${psCommand}"`, (err) => {
      if (err) { shell.openPath(safePath).then(r => { if (r === '') BrowserWindow.getAllWindows().forEach(w => w.hide()) }) } 
      else { BrowserWindow.getAllWindows().forEach(w => w.hide()) }
    })
  } catch (e) { console.error(e) }
})

ipcMain.on('hide-window', () => BrowserWindow.getAllWindows()[0]?.hide())

app.whenReady().then(() => {
  try {
    electronApp.setAppUserModelId('com.huochat.launcher')
    startEverything()
    const win = createWindow()
    if (win) registerMainHotkey(win)
  } catch (err) { console.error('[MAIN] 崩溃:', err); app.quit() }
})

app.on('will-quit', () => {
  const binPath = is.dev ? join(process.cwd(), 'resources/bin') : join(process.resourcesPath, 'bin')
  try { 
    spawn('taskkill', ['/F', '/IM', 'Everything.exe'], { shell: true })
    spawn(join(binPath, 'Everything.exe'), ['-instance', INSTANCE_NAME, '-quit']) 
  } catch (e) {}
  closeDb()
  // 修复问题 22: 只注销当前应用的热键
  globalShortcut.unregister(currentHotkey)
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
