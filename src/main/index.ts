import { app, shell, BrowserWindow, ipcMain, globalShortcut, dialog } from 'electron'
import { join, normalize } from 'path'
import { electronApp, is } from '@electron-toolkit/utils'
import { spawn, ChildProcess, exec } from 'child_process'
import { writeFileSync, existsSync, statSync } from 'fs'
import { db, stmts, closeDb, isHealthy } from './db'
import { executeQuery } from './sdk'

let everythingProcess: ChildProcess | null = null
const INSTANCE_NAME = 'HuoLauncher'
let currentHotkey = (stmts.getSetting?.get('hotkey') as any)?.value || 'Alt+Q'

// --- 图标缓存 ---
const iconCache = new Map<string, string>()
const MAX_CACHE_SIZE = 500 // 调大缓存空间

async function getCachedIcon(p: string, forceSync = false) {
  if (iconCache.has(p)) return iconCache.get(p)!
  if (!forceSync) return '' // 异步模式下如果不命中直接返回空，由后台推送更新
  
  try {
    const icon = await app.getFileIcon(p, { size: 'large' })
    const dataUrl = icon.toDataURL()
    if (dataUrl.length < 500) return ''
    if (iconCache.size >= MAX_CACHE_SIZE) iconCache.delete(iconCache.keys().next().value!)
    iconCache.set(p, dataUrl)
    return dataUrl
  } catch { return '' }
}

// 辅助函数：判断类型
function getFileType(p: string): string {
  try {
    if (statSync(p).isDirectory()) return 'folder'
    if (p.toLowerCase().endsWith('.lnk')) {
      const target = shell.readShortcutLink(p).target
      if (target && existsSync(target) && statSync(target).isDirectory()) return 'folder'
    }
  } catch (e) {}
  return p.split('.').pop() || 'file'
}

function startEverything(): void {
  const userDataPath = app.getPath('userData')
  const iniPath = join(userDataPath, 'Everything.ini'), dbPath = join(userDataPath, 'Everything.db')
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
      if (oldHotkey && oldHotkey !== newHotkey) globalShortcut.unregister(oldHotkey)
      currentHotkey = newHotkey; stmts.setSetting.run('hotkey', newHotkey); return { success: true }
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
  win.on('blur', () => { setTimeout(() => { if (!win.isDestroyed()) win.hide() }, 150) })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

// --- IPC 接口 (性能优化版) ---

ipcMain.handle('get-hotkey', () => currentHotkey)
ipcMain.handle('set-hotkey', (_, h: string) => {
  const win = BrowserWindow.getAllWindows()[0]; if (!win) return { success: false }
  return safeRegisterHotkey(win, h)
})

ipcMain.handle('get-pinned-apps', () => stmts.getPinned.all())

ipcMain.handle('update-app-position', (_, { path, index }) => {
  const cur = db.prepare('SELECT grid_index FROM pinned_apps WHERE path = ?').get(path) as any
  const tgt = db.prepare('SELECT path FROM pinned_apps WHERE grid_index = ?').get(index) as any
  if (!cur) return stmts.getPinned.all()
  db.transaction(() => {
    if (tgt && tgt.path !== path) stmts.updateIndex.run(cur.grid_index, tgt.path)
    stmts.updateIndex.run(index, path)
  })()
  return stmts.getPinned.all()
})

ipcMain.handle('pin-app', (_, { item, index }) => {
  stmts.pin.run(item.path, item.name, item.icon, item.extension, index)
  return stmts.getPinned.all()
})

ipcMain.handle('unpin-app', (_, path) => { stmts.unpin.run(path); return stmts.getPinned.all() })

// --- 性能核心：渐进式搜索 ---
ipcMain.handle('search', async (event, q: string) => {
  if (!q) return []
  const rawResults = executeQuery(q)
  const win = BrowserWindow.fromWebContents(event.sender)

  // 1. 第一阶段：立即生成基础结果 (不阻塞图标获取)
  const results = rawResults.slice(0, 50).map((i) => {
    const p = i.folder.endsWith('\\') ? i.folder + i.name : i.folder + '\\' + i.name
    const usage = stmts.getUsage.get(p) as any
    const cachedIcon = iconCache.get(p) || ''
    
    return {
      name: i.name.replace(/\.[^/.]+$/, ''),
      path: p,
      icon: cachedIcon, // 有缓存用缓存，没缓存先传空
      extension: getFileType(p),
      usageCount: usage?.count ?? 0
    }
  })

  // 排序
  const sorted = results.sort((a, b) => (b.usageCount - a.usageCount) || a.name.localeCompare(b.name))

  // 2. 第二阶段：在后台提取缺失图标并增量推送
  setImmediate(async () => {
    for (const item of sorted) {
      if (!iconCache.has(item.path)) {
        try {
          const icon = await app.getFileIcon(item.path, { size: 'large' })
          const dataUrl = icon.toDataURL()
          if (dataUrl.length > 500) {
            iconCache.set(item.path, dataUrl)
            // 向前端推送图标更新
            if (win && !win.isDestroyed()) {
              win.webContents.send('icon-update', { path: item.path, icon: dataUrl })
            }
          }
        } catch (e) {}
      }
    }
  })

  return sorted
})

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile', 'openDirectory'] })
  if (result.canceled || !result.filePaths[0]) return null
  const p = result.filePaths[0], icon = await getCachedIcon(p, true)
  return { name: p.split(/[\\\/]/).pop()?.replace(/\.[^/.]+$/, '') || '', path: p, icon, extension: getFileType(p) }
})

ipcMain.handle('process-paths', async (_, paths: string[]) => {
  const res = await Promise.all((paths || []).map(async (p) => {
    if (typeof p !== 'string' || !existsSync(p)) return null
    const icon = await getCachedIcon(p, true)
    return { name: p.split(/[\\\/]/).pop()?.replace(/\.[^/.]+$/, '') || '', path: p, icon, extension: getFileType(p) }
  }))
  return res.filter((item): item is NonNullable<typeof item> => item !== null)
})

ipcMain.on('launch', (_, path: string) => {
  const safePath = normalize(path); if (!existsSync(safePath)) return
  try {
    stmts.incrementUsage.run(safePath)
    const psCommand = `Start-Process -FilePath "${safePath.replace(/"/g, '')}" -Verb RunAs`
    exec(`powershell -NoProfile -Command "${psCommand}"`, (err) => {
      if (err) shell.openPath(safePath)
      BrowserWindow.getAllWindows().forEach(w => w.hide())
    })
  } catch (e) {}
})

ipcMain.on('hide-window', () => BrowserWindow.getAllWindows()[0]?.hide())

app.whenReady().then(() => {
  if (!isHealthy) { app.quit(); return }
  electronApp.setAppUserModelId('com.huochat.launcher')
  startEverything()
  const win = createWindow()
  safeRegisterHotkey(win, currentHotkey)
})

app.on('will-quit', () => {
  const binPath = is.dev ? join(process.cwd(), 'resources/bin') : join(process.resourcesPath, 'bin')
  try { 
    spawn('taskkill', ['/F', '/IM', 'Everything.exe'], { shell: true })
    spawn(join(binPath, 'Everything.exe'), ['-instance', INSTANCE_NAME, '-quit']) 
  } catch (e) {}
  closeDb(); globalShortcut.unregisterAll()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
