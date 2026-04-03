import { app, shell, BrowserWindow, ipcMain, globalShortcut, dialog } from 'electron'
import { join } from 'path'
import { electronApp, is } from '@electron-toolkit/utils'
import { spawn, ChildProcess } from 'child_process'
import { writeFileSync } from 'fs'
import { db, stmts, closeDb } from './db'
import { executeQuery } from './sdk'

let everythingProcess: ChildProcess | null = null
const INSTANCE_NAME = 'HuoLauncher'
let currentHotkey = (stmts.getSetting.get('hotkey') as any)?.value || 'Alt+Q'

// --- 图标缓存 ---
const iconCache = new Map<string, string>()
const MAX_CACHE = 200
async function getCachedIcon(fullPath: string): Promise<string> {
  if (iconCache.has(fullPath)) return iconCache.get(fullPath)!
  try {
    const icon = await app.getFileIcon(fullPath, { size: 'large' })
    const dataUrl = icon.toDataURL()
    if (iconCache.size >= MAX_CACHE) iconCache.delete(iconCache.keys().next().value!)
    iconCache.set(fullPath, dataUrl)
    return dataUrl
  } catch { return '' }
}

function startEverything(): void {
  const userDataPath = app.getPath('userData')
  const iniPath = join(userDataPath, 'Everything.ini')
  const dbPath = join(userDataPath, 'Everything.db')
  const iniContent = `[Everything]\ninstance_name=${INSTANCE_NAME}\nhttp_server_enabled=0\nrun_as_admin=0\ndb_location=${dbPath.replace(/\\/g, '/')}\n`
  writeFileSync(iniPath, iniContent)
  const binPath = is.dev ? join(process.cwd(), 'resources/bin') : join(process.resourcesPath, 'bin')
  const exePath = join(binPath, 'Everything.exe')
  everythingProcess = spawn(exePath, ['-config', iniPath, '-minimized'], { detached: true, stdio: 'pipe' })
  everythingProcess.on('exit', () => everythingProcess = null)
  everythingProcess.unref()
}

function registerMainHotkey(win: BrowserWindow) {
  globalShortcut.unregisterAll()
  const success = globalShortcut.register(currentHotkey, () => {
    if (win.isVisible()) win.hide()
    else { win.show(); win.focus(); win.webContents.send('window-shown') }
  })
  if (!success) console.error(`Failed to register hotkey: ${currentHotkey}`)
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

// --- IPC 接口 ---
ipcMain.handle('get-hotkey', () => currentHotkey)
ipcMain.handle('set-hotkey', (_, newHotkey: string) => {
  try {
    const win = BrowserWindow.getAllWindows()[0]
    globalShortcut.unregister(currentHotkey)
    const success = globalShortcut.register(newHotkey, () => {
      if (win.isVisible()) win.hide()
      else { win.show(); win.focus(); win.webContents.send('window-shown') }
    })
    if (success) {
      currentHotkey = newHotkey
      stmts.setSetting.run('hotkey', newHotkey)
      return { success: true, hotkey: newHotkey }
    }
    // 如果失败，恢复旧热键
    globalShortcut.register(currentHotkey, () => {
      if (win.isVisible()) win.hide()
      else { win.show(); win.focus(); win.webContents.send('window-shown') }
    })
    return { success: false, message: '热键已被占用' }
  } catch (e: any) { return { success: false, message: e.message } }
})

ipcMain.handle('get-pinned-apps', () => stmts.getPinned.all())
ipcMain.handle('update-app-position', (_, { path, index }) => {
  const currentApp = db.prepare('SELECT grid_index FROM pinned_apps WHERE path = ?').get(path) as any
  const targetOccupant = db.prepare('SELECT path FROM pinned_apps WHERE grid_index = ?').get(index) as any
  db.transaction(() => {
    if (targetOccupant && targetOccupant.path !== path) stmts.updateIndex.run(currentApp.grid_index, targetOccupant.path)
    stmts.updateIndex.run(index, path)
  })()
  return stmts.getPinned.all()
})
ipcMain.handle('pin-app', async (_, { item, index }) => { stmts.pin.run(item.path, item.name, item.icon, item.extension, index); return stmts.getPinned.all() })
ipcMain.handle('unpin-app', (_, path) => { stmts.unpin.run(path); return stmts.getPinned.all() })
ipcMain.handle('search', async (_, query: string) => {
  const rawResults = executeQuery(query)
  const results = await Promise.all(rawResults.map(async (item) => {
    const fullPath = item.folder.endsWith('\\') ? item.folder + item.name : item.folder + '\\' + item.name
    const usage = stmts.getUsage.get(fullPath) as any
    const iconData = await getCachedIcon(fullPath)
    return { name: item.name.replace(/\.[^/.]+$/, ''), path: fullPath, icon: iconData, extension: item.name.split('.').pop() || 'file', usageCount: usage ? usage.count : 0 }
  }))
  return results.sort((a, b) => (b.usageCount - a.usageCount) || a.name.localeCompare(b.name))
})
ipcMain.handle('select-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile', 'openDirectory'] })
  if (canceled || filePaths.length === 0) return null
  const fullPath = filePaths[0], fileName = fullPath.split(/[\\\/]/).pop() || ''
  const iconData = await getCachedIcon(fullPath)
  return { name: fileName.replace(/\.[^/.]+$/, ''), path: fullPath, icon: iconData, extension: fileName.split('.').pop() || 'folder' }
})
ipcMain.handle('process-paths', async (_, paths: string[]) => {
  const res = await Promise.all((paths || []).map(async (p) => {
    if (typeof p !== 'string') return null
    const name = p.split(/[\\\/]/).pop() || '', iconData = await getCachedIcon(p)
    return { name: name.replace(/\.[^/.]+$/, ''), path: p, icon: iconData, extension: name.split('.').pop() || 'file' }
  }))
  return res.filter(Boolean)
})
ipcMain.on('launch', (_, path: string) => { try { stmts.incrementUsage.run(path); shell.openPath(path) } catch(e){} BrowserWindow.getAllWindows()[0]?.hide() })
ipcMain.on('hide-window', () => BrowserWindow.getAllWindows()[0]?.hide())

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.huochat.launcher')
  startEverything()
  const win = createWindow()
  registerMainHotkey(win)
})

app.on('will-quit', () => {
  const binPath = is.dev ? join(process.cwd(), 'resources/bin') : join(process.resourcesPath, 'bin')
  spawn(join(binPath, 'Everything.exe'), ['-instance', INSTANCE_NAME, '-quit'])
  closeDb(); globalShortcut.unregisterAll()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
