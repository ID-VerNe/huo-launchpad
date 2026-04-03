import { app, shell, BrowserWindow, ipcMain, globalShortcut, dialog } from 'electron'
import { join, normalize } from 'path'
import { electronApp, is } from '@electron-toolkit/utils'
import { spawn, ChildProcess, exec } from 'child_process'
import { writeFileSync, existsSync } from 'fs'
import { db, stmts, closeDb, isHealthy } from './db'
import { executeQuery } from './sdk'

let everythingProcess: ChildProcess | null = null
const INSTANCE_NAME = 'HuoLauncher'

// --- 修复 TODO 1: 数据库健康检查 ---
if (!isHealthy || !stmts.getPinned) {
  app.whenReady().then(() => {
    dialog.showErrorBox('数据库错误', '应用数据库初始化失败，请重启或尝试重新安装。')
    app.quit()
  })
}

let currentHotkey = (stmts.getSetting?.get('hotkey') as any)?.value || 'Alt+Q'

// --- 图标缓存 ---
const iconCache = new Map<string, string>()
const MAX_CACHE_SIZE = 300
async function getCachedIcon(p: string) {
  if (iconCache.has(p)) return iconCache.get(p)!
  try {
    const icon = await app.getFileIcon(p, { size: 'large' })
    const dataUrl = icon.toDataURL()
    if (iconCache.size >= MAX_CACHE_SIZE) iconCache.delete(iconCache.keys().next().value!)
    iconCache.set(p, dataUrl); return dataUrl
  } catch { return '' }
}

// --- 修复 TODO 5 & 7: 引擎进程管理 ---
function startEverything(): void {
  const userDataPath = app.getPath('userData')
  const iniPath = join(userDataPath, 'Everything.ini'), dbPath = join(userDataPath, 'Everything.db')
  const iniContent = `[Everything]\ninstance_name=${INSTANCE_NAME}\nhttp_server_enabled=0\nrun_as_admin=0\ndb_location=${dbPath.replace(/\\/g, '/')}\n`
  writeFileSync(iniPath, iniContent)
  const binPath = is.dev ? join(process.cwd(), 'resources/bin') : join(process.resourcesPath, 'bin')
  
  everythingProcess = spawn(join(binPath, 'Everything.exe'), ['-config', iniPath, '-minimized'], { detached: true, stdio: 'pipe' })
  
  everythingProcess.on('error', (err) => console.error('[ENGINE] 启动失败:', err))
  everythingProcess.on('exit', (code) => {
    console.log('[ENGINE] 引擎进程已退出, Code:', code)
    everythingProcess = null
  })
}

function stopEverything(): void {
  const binPath = is.dev ? join(process.cwd(), 'resources/bin') : join(process.resourcesPath, 'bin')
  try { 
    spawn('taskkill', ['/F', '/IM', 'Everything.exe'], { shell: true })
    spawn(join(binPath, 'Everything.exe'), ['-instance', INSTANCE_NAME, '-quit']) 
  } catch (e) {}
}

// --- 修复 TODO 4: 热键一致性注册 ---
function safeRegisterHotkey(win: BrowserWindow, newHotkey: string) {
  const oldHotkey = currentHotkey
  if (oldHotkey === newHotkey && globalShortcut.isRegistered(newHotkey)) return { success: true }

  try {
    const success = globalShortcut.register(newHotkey, () => {
      if (win.isDestroyed()) return
      win.isVisible() ? win.hide() : (win.show(), win.focus(), win.webContents.send('window-shown'))
    })
    if (success) {
      if (oldHotkey && oldHotkey !== newHotkey) globalShortcut.unregister(oldHotkey)
      currentHotkey = newHotkey
      stmts.setSetting.run('hotkey', newHotkey)
      return { success: true }
    }
    return { success: false, message: '快捷键已被占用' }
  } catch (err: any) { return { success: false, message: err.message } }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000, height: 750, show: false, autoHideMenuBar: true,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  // 修复 TODO 6: 更加稳健的隐藏逻辑
  win.on('blur', () => { setTimeout(() => { if (!win.isDestroyed()) win.hide() }, 150) })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

// --- IPC 接口 ---
ipcMain.handle('get-hotkey', () => currentHotkey)
ipcMain.handle('set-hotkey', (_, h: string) => {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return { success: false, message: '系统未准备好' }
  return safeRegisterHotkey(win, h)
})

ipcMain.handle('get-pinned-apps', () => stmts.getPinned.all())

// --- 修复 TODO 2: 网格互换逻辑 ---
ipcMain.handle('update-app-position', (_, { path, index }) => {
  if (typeof index !== 'number' || index < 0 || index >= 50) return stmts.getPinned.all()
  
  const cur = db.prepare('SELECT grid_index FROM pinned_apps WHERE path = ?').get(path) as any
  if (!cur || cur.grid_index === index) return stmts.getPinned.all()

  try {
    db.transaction(() => {
      // 检查目标位置原住民
      const tgt = stmts.getByIndex.get(index) as any
      if (tgt && tgt.path !== path) {
        // 将原住民交换到我原来的格子里
        stmts.updateIndex.run(cur.grid_index, tgt.path)
      }
      // 将我移动到目标格子
      stmts.updateIndex.run(index, path)
    })()
  } catch (e) { console.error('[DB] 互换失败:', e) }
  return stmts.getPinned.all()
})

ipcMain.handle('pin-app', (_, { item, index }) => {
  if (typeof index !== 'number' || index < 0 || index >= 50) return stmts.getPinned.all()
  stmts.pin.run(item.path, item.name, item.icon, item.extension, index)
  return stmts.getPinned.all()
})

ipcMain.handle('unpin-app', (_, path) => {
  stmts.unpin.run(path); return stmts.getPinned.all()
})

ipcMain.handle('search', async (_, q: string) => {
  const raw = executeQuery(q)
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

// --- 修复 TODO 3 & 8 & 11: 启动安全 ---
ipcMain.on('launch', async (_, path: string) => {
  if (typeof path !== 'string' || !existsSync(path)) {
    console.warn('[LAUNCH] 路径非法或不存在:', path)
    return
  }
  const safePath = normalize(path)
  
  try {
    stmts.incrementUsage.run(safePath)
    // 审计建议 #11: 优先使用原生 shell.openPath，它是原子的且支持提权应用
    const error = await shell.openPath(safePath)
    if (error) {
      console.error('[LAUNCH] 原生启动失败, 尝试提权指令:', error)
      const psCommand = `Start-Process -FilePath "${safePath.replace(/"/g, '')}" -Verb RunAs`
      exec(`powershell -NoProfile -Command "${psCommand}"`, (err) => {
        if (!err) BrowserWindow.getAllWindows().forEach(w => w.hide())
      })
    } else {
      BrowserWindow.getAllWindows().forEach(w => w.hide())
    }
  } catch (e) { console.error('[LAUNCH] 启动异常:', e) }
})

ipcMain.on('hide-window', () => BrowserWindow.getAllWindows()[0]?.hide())

app.whenReady().then(() => {
  try {
    electronApp.setAppUserModelId('com.huochat.launcher')
    startEverything()
    const win = createWindow()
    safeRegisterHotkey(win, currentHotkey)
  } catch (err) { console.error('[MAIN] 启动致命错误:', err); app.quit() }
})

app.on('will-quit', () => {
  stopEverything(); closeDb(); globalShortcut.unregisterAll()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
