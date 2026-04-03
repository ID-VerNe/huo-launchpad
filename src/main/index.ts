import { app, shell, BrowserWindow, ipcMain, globalShortcut, dialog } from 'electron'
import { join } from 'path'
import { electronApp, is } from '@electron-toolkit/utils'
import { spawn, ChildProcess, exec } from 'child_process'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { db, stmts, closeDb } from './db'
import { executeQuery } from './sdk'

let everythingProcess: ChildProcess | null = null
const INSTANCE_NAME = 'HuoLauncher'
let currentHotkey = (stmts.getSetting.get('hotkey') as any)?.value || 'Alt+Q'

// --- 图标缓存 ---
const iconCache = new Map<string, string>()
async function getCachedIcon(p: string) {
  if (iconCache.has(p)) return iconCache.get(p)!
  try {
    const icon = await app.getFileIcon(p, { size: 'large' })
    const data = icon.toDataURL()
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
  // 由于本体已是管理员，此处无需再传 -admin
  everythingProcess = spawn(join(binPath, 'Everything.exe'), ['-config', iniPath, '-minimized'], { detached: true, stdio: 'ignore' })
  everythingProcess.unref()
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000, height: 750, show: false, autoHideMenuBar: true,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  win.on('blur', () => win.hide())
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

// --- IPC ---
ipcMain.handle('get-hotkey', () => currentHotkey)
ipcMain.handle('set-hotkey', (_, h: string) => {
  const win = BrowserWindow.getAllWindows()[0]
  globalShortcut.unregister(currentHotkey)
  if (globalShortcut.register(h, () => { win.isVisible() ? win.hide() : (win.show(), win.focus(), win.webContents.send('window-shown')) })) {
    currentHotkey = h; stmts.setSetting.run('hotkey', h); return { success: true }
  }
  globalShortcut.register(currentHotkey, () => { win.isVisible() ? win.hide() : (win.show(), win.focus(), win.webContents.send('window-shown')) })
  return { success: false, message: '被占用' }
})

ipcMain.handle('get-pinned-apps', () => stmts.getPinned.all())
ipcMain.handle('update-app-position', (_, { path, index }) => {
  const cur = db.prepare('SELECT grid_index FROM pinned_apps WHERE path = ?').get(path) as any
  const tgt = db.prepare('SELECT path FROM pinned_apps WHERE grid_index = ?').get(index) as any
  db.transaction(() => {
    if (tgt && tgt.path !== path) stmts.updateIndex.run(cur.grid_index, tgt.path)
    stmts.updateIndex.run(index, path)
  })()
  return stmts.getPinned.all()
})
ipcMain.handle('pin-app', (_, { item, index }) => { stmts.pin.run(item.path, item.name, item.icon, item.extension, index); return stmts.getPinned.all() })
ipcMain.handle('unpin-app', (_, path) => { stmts.unpin.run(path); return stmts.getPinned.all() })
ipcMain.handle('search', async (_, q: string) => {
  const raw = executeQuery(q)
  const res = await Promise.all(raw.map(async (i) => {
    const p = i.folder.endsWith('\\') ? i.folder + i.name : i.folder + '\\' + i.name
    const usage = stmts.getUsage.get(p) as any, icon = await getCachedIcon(p)
    return { name: i.name.replace(/\.[^/.]+$/, ''), path: p, icon, extension: i.name.split('.').pop() || 'file', usageCount: usage ? usage.count : 0 }
  }))
  return res.sort((a, b) => (b.usageCount - a.usageCount) || a.name.localeCompare(b.name))
})
ipcMain.handle('select-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile', 'openDirectory'] })
  if (canceled || filePaths.length === 0) return null
  const p = filePaths[0], n = p.split(/[\\\/]/).pop() || '', icon = await getCachedIcon(p)
  return { name: n.replace(/\.[^/.]+$/, ''), path: p, icon, extension: n.includes('.') ? n.split('.').pop() : 'folder' }
})
ipcMain.handle('process-paths', async (_, paths: string[]) => {
  const res = await Promise.all((paths || []).map(async (p) => {
    if (typeof p !== 'string') return null
    const n = p.split(/[\\\/]/).pop() || '', icon = await getCachedIcon(p)
    return { name: n.replace(/\.[^/.]+$/, ''), path: p, icon, extension: n.includes('.') ? n.split('.').pop() : 'file' }
  }))
  return res.filter(Boolean)
})

// --- 核心改动：默认管理员启动 ---
ipcMain.on('launch', (_, path: string) => {
  try {
    stmts.incrementUsage.run(path)
    console.log(`[LAUNCH] 正在以管理员身份启动: ${path}`)
    
    // 使用 PowerShell 的强制管理员启动命令
    const psCommand = `Start-Process "${path}" -Verb RunAs`
    exec(`powershell -Command "${psCommand}"`, (err) => {
      if (err) {
        console.error('[LAUNCH] 提权启动失败，尝试普通启动:', err)
        shell.openPath(path) // 回退到普通启动
      }
    })
    
    BrowserWindow.getAllWindows().forEach(w => w.hide())
  } catch (e) { console.error(e) }
})

ipcMain.on('hide-window', () => BrowserWindow.getAllWindows()[0]?.hide())

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.huochat.launcher')
  startEverything(); const win = createWindow()
  globalShortcut.register(currentHotkey, () => { win.isVisible() ? win.hide() : (win.show(), win.focus(), win.webContents.send('window-shown')) })
})

app.on('will-quit', () => {
  const binPath = is.dev ? join(process.cwd(), 'resources/bin') : join(process.resourcesPath, 'bin')
  spawn(join(binPath, 'Everything.exe'), ['-instance', INSTANCE_NAME, '-quit'])
  closeDb(); globalShortcut.unregisterAll()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
