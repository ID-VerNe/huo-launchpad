import { app, shell, BrowserWindow, ipcMain, globalShortcut, dialog } from 'electron'
import { join, normalize } from 'path'
import { electronApp, is } from '@electron-toolkit/utils'
import { spawn, ChildProcess, exec } from 'child_process'
import { writeFileSync, existsSync } from 'fs'
import { db, stmts, closeDb } from './db'
import { executeQuery } from './sdk'

let everythingProcess: ChildProcess | null = null
const INSTANCE_NAME = 'HuoLauncher'
let currentHotkey = (stmts.getSetting?.get('hotkey') as any)?.value || 'Alt+Q'

// --- 图标缓存加固 (审计建议 #3) ---
const iconCache = new Map<string, string>()
const MAX_CACHE_SIZE = 300
async function getCachedIcon(p: string) {
  if (iconCache.has(p)) return iconCache.get(p)!
  try {
    const icon = await app.getFileIcon(p, { size: 'large' })
    const data = icon.toDataURL()
    if (iconCache.size >= MAX_CACHE_SIZE) {
      const firstKey = iconCache.keys().next().value
      if (firstKey) iconCache.delete(firstKey)
    }
    iconCache.set(p, data); return data
  } catch { return '' }
}

// --- 引擎生命周期 (审计建议 #5) ---
function startEverything(): void {
  const userDataPath = app.getPath('userData')
  const iniPath = join(userDataPath, 'Everything.ini')
  const dbPath = join(userDataPath, 'Everything.db')
  const iniContent = `[Everything]\ninstance_name=${INSTANCE_NAME}\nhttp_server_enabled=0\nrun_as_admin=0\ndb_location=${dbPath.replace(/\\/g, '/')}\n`
  writeFileSync(iniPath, iniContent)
  
  const binPath = is.dev ? join(process.cwd(), 'resources/bin') : join(process.resourcesPath, 'bin')
  everythingProcess = spawn(join(binPath, 'Everything.exe'), ['-config', iniPath, '-minimized'], { detached: true, stdio: 'pipe' })
  
  everythingProcess.stdout?.on('data', (d) => console.log(`[ENGINE] ${d}`))
  everythingProcess.on('error', (err) => console.error('[ENGINE] 启动失败:', err))
  everythingProcess.on('exit', (code) => {
    console.warn(`[ENGINE] 进程已退出 (Code: ${code})`)
    everythingProcess = null
  })
}

// --- 热键切换 (审计建议 #1) ---
function safeRegisterHotkey(win: BrowserWindow, newHotkey: string) {
  const oldHotkey = currentHotkey
  try {
    // 先尝试注册新热键
    const success = globalShortcut.register(newHotkey, () => {
      if (win.isDestroyed()) return
      win.isVisible() ? win.hide() : (win.show(), win.focus(), win.webContents.send('window-shown'))
    })

    if (success) {
      if (oldHotkey !== newHotkey) globalShortcut.unregister(oldHotkey)
      currentHotkey = newHotkey
      stmts.setSetting.run('hotkey', newHotkey)
      console.log(`[HOTKEY] 已成功切换至: ${newHotkey}`)
      return { success: true }
    } else {
      console.error(`[HOTKEY] 注册失败: ${newHotkey} 已被占用`)
      return { success: false, message: '该热键已被系统或其他程序占用' }
    }
  } catch (err: any) {
    console.error(`[HOTKEY] 注册异常:`, err)
    return { success: false, message: err.message }
  }
}

function createWindow(): BrowserWindow | null {
  try {
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
  } catch (e) {
    console.error('[MAIN] 窗口创建失败:', e)
    return null
  }
}

// --- IPC 接口修复 ---
ipcMain.handle('get-hotkey', () => currentHotkey)
ipcMain.handle('set-hotkey', (_, h: string) => {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return { success: false, message: '窗口未就绪' }
  return safeRegisterHotkey(win, h)
})

ipcMain.handle('update-app-position', (_, { path, index }) => {
  if (typeof index !== 'number' || index < 0 || index >= 50) return stmts.getPinned.all()
  const cur = db.prepare('SELECT grid_index FROM pinned_apps WHERE path = ?').get(path) as any
  if (!cur) return stmts.getPinned.all()
  
  const tgt = db.prepare('SELECT path FROM pinned_apps WHERE grid_index = ?').get(index) as any
  try {
    db.transaction(() => {
      if (tgt && tgt.path !== path) stmts.updateIndex.run(cur.grid_index, tgt.path)
      stmts.updateIndex.run(index, path)
    })()
  } catch (e) { console.error('[DB] 位置更新失败:', e) }
  return stmts.getPinned.all()
})

ipcMain.handle('search', async (_, q: string) => {
  const raw = executeQuery(q)
  const res = await Promise.all(raw.map(async (i) => {
    const p = i.folder.endsWith('\\') ? i.folder + i.name : i.folder + '\\' + i.name
    const usage = stmts.getUsage.get(p) as any
    const icon = await getCachedIcon(p)
    return { 
      name: i.name.replace(/\.[^/.]+$/, ''), 
      path: p, 
      icon, 
      extension: i.name.split('.').pop() || 'file', 
      usageCount: usage?.count ?? 0 // 审计建议 #6
    }
  }))
  return res.sort((a, b) => (b.usageCount - a.usageCount) || a.name.localeCompare(b.name))
})

ipcMain.handle('process-paths', async (_, paths: string[]) => {
  const res = await Promise.all((paths || []).map(async (p) => {
    if (typeof p !== 'string' || !existsSync(p)) return null
    const n = p.split(/[\\\/]/).pop() || '', icon = await getCachedIcon(p)
    return { name: n.replace(/\.[^/.]+$/, ''), path: p, icon, extension: n.includes('.') ? n.split('.').pop() : 'folder' }
  }))
  // 审计建议 #2: 精准类型收缩
  return res.filter((item): item is NonNullable<typeof item> => item !== null)
})

ipcMain.on('launch', (_, path: string) => {
  // 审计建议 #17: 命令注入防护
  if (typeof path !== 'string' || !existsSync(path)) return
  const safePath = normalize(path)
  
  try {
    stmts.incrementUsage.run(safePath)
    const psCommand = `Start-Process "${safePath}" -Verb RunAs`
    exec(`powershell -Command "${psCommand.replace(/"/g, '`"')}"`, (err) => {
      if (err) {
        console.error('[LAUNCH] 提权启动失败:', err)
        shell.openPath(safePath)
      }
      // 审计建议 #7: 只有成功时或明确处理后才隐藏
      BrowserWindow.getAllWindows().forEach(w => w.hide())
    })
  } catch (e) { console.error(e) }
})

app.whenReady().then(() => {
  try {
    electronApp.setAppUserModelId('com.huochat.launcher')
    startEverything()
    const win = createWindow()
    if (win) registerMainHotkey(win)
  } catch (err) { console.error('[MAIN] 启动过程崩溃:', err) }
})

function registerMainHotkey(win: BrowserWindow) {
  globalShortcut.register(currentHotkey, () => {
    if (win.isDestroyed()) return
    win.isVisible() ? win.hide() : (win.show(), win.focus(), win.webContents.send('window-shown'))
  })
}

app.on('will-quit', () => {
  const binPath = is.dev ? join(process.cwd(), 'resources/bin') : join(process.resourcesPath, 'bin')
  try { spawn(join(binPath, 'Everything.exe'), ['-instance', INSTANCE_NAME, '-quit']) } catch (e) {}
  closeDb()
  globalShortcut.unregisterAll()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
