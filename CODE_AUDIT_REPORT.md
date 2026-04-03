# 代码审计报告 - 逻辑死锁与潜在 Bug

> 审计时间：2026-04-03
> 项目：HuoLauncher (Electron + React + better-sqlite3 + Everything SDK)

---

## 一、严重级别问题（可能导致崩溃或数据丢失）

### 1. 【严重】数据库 prepare 语句空指针访问 🔴

**位置**: [db.ts:31-40](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/db.ts#L31-L40)

**问题描述**:
```typescript
export const stmts = {
  getPinned: db?.prepare('...'),  // 如果 db 初始化失败，stmts.getPinned 是 undefined
  // ...
}
```
在 [index.ts:11](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/index.ts#L11) 中：
```typescript
let currentHotkey = (stmts.getSetting?.get('hotkey') as any)?.value || 'Alt+Q'
```
虽然使用了可选链，但后续多处直接调用 `stmts.updateIndex.run()` 而没有检查，如果数据库初始化失败，整个应用会在运行时直接崩溃。

**触发条件**: 数据库文件权限不足或磁盘空间不足导致 better-sqlite3 初始化失败。

**修复建议**:
```typescript
// 在 index.ts 启动时添加数据库健康检查
if (!db || !stmts.getPinned) {
  dialog.showErrorBox('数据库错误', '应用数据库初始化失败，请重启或重新安装')
  app.quit()
}
```

---

### 2. 【严重】updateIndex 死锁与数据竞争 🟠

**位置**: [index.ts:94-103](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/index.ts#L94-L103)

**问题描述**:
```typescript
ipcMain.handle('update-app-position', (_, { path, index }) => {
  const cur = db.prepare('SELECT grid_index FROM pinned_apps WHERE path = ?').get(path) as any
  const tgt = db.prepare('SELECT path FROM pinned_apps WHERE grid_index = ?').get(index) as any
  if (!cur) return stmts.getPinned.all()
  db.transaction(() => {
    if (tgt && tgt.path !== path) stmts.updateIndex.run(cur.grid_index, tgt.path)
    stmts.updateIndex.run(index, path)  // ⚠️ 问题：第二次 run 如果 tgt 不存在，这里会把 cur.app 的 grid_index 也改掉
  })()
  return stmts.getPinned.all()
})
```

**具体问题**:
1. `stmts.updateIndex.run(index, path)` 没有 WHERE 条件，如果 `cur` 存在而 `tgt` 不存在，会把 cur.app 的位置错误地更新
2. 两次 updateIndex 调用在 transaction 内，但逻辑有误
3. 没有处理 `cur.grid_index === index` 的情况（不需要移动）

**复现场景**: 把应用从位置 3 拖到位置 7（位置 7 为空），位置 3 的应用会被错误更新。

**修复建议**:
```typescript
ipcMain.handle('update-app-position', (_, { path, index }) => {
  const cur = db.prepare('SELECT grid_index FROM pinned_apps WHERE path = ?').get(path) as any
  if (!cur || cur.grid_index === index) return stmts.getPinned.all()

  db.transaction(() => {
    // 先清除目标位置（如果有应用的话）
    const tgt = stmts.getByIndex.get(index) as any
    if (tgt && tgt.path !== path) {
      stmts.updateIndex.run(cur.grid_index, tgt.path)
    }
    stmts.updateIndex.run(index, path)
  })()
  return stmts.getPinned.all()
})
```

---

### 3. 【严重】launch 事件路径验证 Race Condition 🟠

**位置**: [index.ts:141-152](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/index.ts#L141-L152)

**问题描述**:
```typescript
ipcMain.on('launch', (_, path: string) => {
  const safePath = normalize(path)
  if (!existsSync(safePath)) return  // ⚠️ existsSync 检查后，文件可能在检查和打开之间被删除/移动
  try {
    stmts.incrementUsage.run(safePath)
    // ... launch logic
  } catch (e) {}
})
```

**问题**:
1. `existsSync` 和实际 `shell.openPath` 之间存在时间窗口，文件可能在此期间被删除
2. `normalize` 没有处理 UNC 路径 `\\server\share` 的特殊情况
3. 吞掉了所有异常，可能导致静默失败

**修复建议**:
```typescript
ipcMain.on('launch', (_, path: string) => {
  try {
    const safePath = normalize(path)
    if (!safePath || typeof safePath !== 'string') return
    if (!existsSync(safePath)) {
      console.warn('[LAUNCH] 文件不存在:', safePath)
      return
    }
    stmts.incrementUsage.run(safePath)
    // 使用 shell.openPath 而不是 exec powershell，更可靠
    const opened = await shell.openPath(safePath)
    if (opened) console.error('[LAUNCH] 打开失败:', opened)
  } catch (e) {
    console.error('[LAUNCH] 启动异常:', e)
  }
  BrowserWindow.getAllWindows().forEach(w => w.hide())
})
```

---

## 二、中等级别问题（可能导致功能异常或性能问题）

### 4. 【中等】热键注册失败处理不一致 🟡

**位置**: [index.ts:50-64](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/index.ts#L50-L64)

**问题描述**:
```typescript
function safeRegisterHotkey(win: BrowserWindow, newHotkey: string) {
  const oldHotkey = currentHotkey
  try {
    const success = globalShortcut.register(newHotkey, handler)
    if (success) {
      if (oldHotkey !== newHotkey) globalShortcut.unregister(oldHotkey)
      currentHotkey = newHotkey
      stmts.setSetting.run('hotkey', newHotkey)  // ⚠️ 数据库写入在 try 块内
      return { success: true }
    }
    return { success: false, message: '快捷键已被占用' }
  } catch (err: any) {  // ⚠️ catch 块吞掉了错误，但没有回滚任何状态
    return { success: false, message: err.message }
  }
}
```

**问题**:
1. 如果 `globalShortcut.register` 成功但 `stmts.setSetting.run` 失败，currentHotkey 已经更新但数据库没更新
2. `oldHotkey` 已经在函数开头保存，但如果注册成功且是同一个热键，不会 unregister，但 currentHotkey 还是会被设为同一个值（虽然没实际影响）

**修复建议**:
```typescript
function safeRegisterHotkey(win: BrowserWindow, newHotkey: string) {
  const oldHotkey = currentHotkey
  if (oldHotkey === newHotkey) return { success: true }

  try {
    globalShortcut.register(newHotkey, handler)
    if (oldHotkey) globalShortcut.unregister(oldHotkey)
    stmts.setSetting.run('hotkey', newHotkey)
    currentHotkey = newHotkey
    return { success: true }
  } catch (err: any) {
    // 注册失败时不尝试 unregister（本来就没注册成功）
    return { success: false, message: err.message }
  }
}
```

---

### 5. 【中等】窗口 blur 事件隐藏逻辑缺陷 🟡

**位置**: [index.ts:79](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/index.ts#L79)

**问题描述**:
```typescript
win.on('blur', () => {
  setTimeout(() => {
    if (!win.isDestroyed()) win.hide()  // ⚠️ 100ms 后才检查，窗口可能已经不可用
  }, 100)
})
```

**问题**:
1. 100ms 延迟可能导致用户点击窗口内容时窗口已经隐藏（用户点击和 blur 几乎同时发生时）
2. 没有区分是点击窗口内部还是外部的 blur

**修复建议**:
```typescript
win.on('blur', () => {
  // 使用更长的延迟，或者在 mousedown 事件中标记
  setTimeout(() => {
    if (!win.isDestroyed() && !win.webContents.isDevToolsOpened()) {
      win.hide()
    }
  }, 200)
})

// 在点击窗口时阻止隐藏（通过 IPC 通知主进程）
win.webContents.on('before-input-event', (event, input) => {
  if (input.type === 'mouseDown') {
    // 用户在窗口内点击，标记为不隐藏
  }
})
```

---

### 6. 【中等】SQL 语句参数化不完整 🟡

**位置**: [db.ts:14-18](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/db.ts#L14-L18)

**问题描述**:
```typescript
db.exec(`
  CREATE TABLE IF NOT EXISTS pinned_apps (...);
  CREATE TABLE IF NOT EXISTS usage_stats (...);
  CREATE TABLE IF NOT EXISTS settings (...);
  INSERT OR IGNORE INTO settings (key, value) VALUES ('hotkey', 'Alt+Q');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('db_version', '1');
`)
```

**问题**:
1. 直接拼接 `db_version` 值，如果未来版本管理不当可能造成注入风险
2. 迁移逻辑只是注释，没有实际实现

**当前状态**: 实际上这里没有用户输入，所以风险较低，但不符合安全最佳实践。

---

### 7. 【中等】Everything 进程退出事件处理 🟡

**位置**: [index.ts:47](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/index.ts#L47)

**问题描述**:
```typescript
everythingProcess.on('exit', () => everythingProcess = null)
```

**问题**:
1. `exit` 事件在进程退出时触发，但如果是被杀死的（taskkill），exit code 不为 0
2. 没有监听 `error` 事件来处理启动失败
3. 没有重试机制

**修复建议**:
```typescript
everythingProcess.on('error', (err) => {
  console.error('[Everything] 启动失败:', err)
  everythingProcess = null
  // 可以在这里添加重试逻辑
})

everythingProcess.on('exit', (code) => {
  console.log('[Everything] 退出, code:', code)
  everythingProcess = null
})
```

---

## 三、低级别问题（代码质量/健壮性）

### 8. 【低】preload 上下文隔离检查不准确 ⚪

**位置**: [preload/index.ts:22-31](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/preload/index.ts#L22-L31)

**问题**:
```typescript
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) { console.error(error) }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
```

`process.contextIsolated` 在某些 Electron 版本中可能不准确，应该依赖 `contextBridge` 是否存在来判断。

**修复建议**:
```typescript
if (typeof contextBridge !== 'undefined' && typeof contextBridge.exposeInMainWorld === 'function') {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
```

---

### 9. 【低】App.tsx 中 stateRef 同步问题 ⚪

**位置**: [App.tsx:36-37](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/renderer/src/App.tsx#L36-L37)

**问题**:
```typescript
const stateRef = useRef(state)
stateRef.current = state
```

在 React 19 + Concurrent Mode 下，这种同步方式在 `useCallback` 中使用 `stateRef.current` 可能读到过期状态。应该使用 `useRef` 的 setter 模式或 `useSyncExternalStore`。

**影响**: 低，因为当前代码中 React 版本较新但并发特性没有完全启用。

---

### 10. 【低】handlePin 返回值未校验 ⚪

**位置**: [App.tsx:153-161](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/renderer/src/App.tsx#L153-L161)

**问题**:
```typescript
const newPinned = await window.api.pinApp(item, index)
if (newPinned) setState(s => ({ ...s, pinnedApps: newPinned, query: '' }))
```

如果 `pinApp` 返回 `undefined`（IPC 调用失败但没抛异常），代码仍然会清空搜索结果。

**修复建议**: 添加更多校验或依赖乐观更新。

---

## 四、安全问题

### 11. 【安全】launch 路径注入风险

**位置**: [index.ts:145-147](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/index.ts#L145-L147)

**问题**:
```typescript
const psCommand = `Start-Process -FilePath "${safePath.replace(/"/g, '')}" -Verb RunAs`
exec(`powershell -NoProfile -Command "${psCommand}"`, ...)
```

虽然使用了 `replace(/"/g, '')` 过滤引号，但仍然存在风险：
1. `safePath` 可能包含特殊字符导致 PowerShell 命令注入
2. `replace` 只处理引号，其他危险字符（如 `;`, `&`, `|`）没有处理

**当前风险评估**: 低（因为路径已经过 `normalize` 和 `existsSync` 检查），但建议改进。

**修复建议**:
```typescript
// 使用 shell.openPath 代替 PowerShell exec，更安全
const opened = await shell.openPath(safePath)
if (opened) {
  // 如果普通打开失败，尝试管理员权限
  const adminCommand = `Start-Process -FilePath "${safePath.replace(/"/g, '`"')}" -Verb RunAs`
  exec(`powershell -NoProfile -Command "${adminCommand}"`, ...)
}
```

---

## 五、问题汇总表

| 编号 | 问题 | 级别 | 影响 |
|------|------|------|------|
| 1 | 数据库 prepare 空指针 | 🔴 严重 | 应用崩溃 |
| 2 | updateIndex 死锁与数据竞争 | 🟠 严重 | 数据错乱 |
| 3 | launch 路径验证 Race Condition | 🟠 严重 | 启动失败 |
| 4 | 热键注册失败处理不一致 | 🟡 中等 | 状态不一致 |
| 5 | 窗口 blur 隐藏逻辑缺陷 | 🟡 中等 | 用户体验 |
| 6 | SQL 参数化不完整 | 🟡 中等 | 未来风险 |
| 7 | Everything 退出事件处理 | 🟡 中等 | 进程管理 |
| 8 | preload 上下文隔离检查 | ⚪ 低 | 代码质量 |
| 9 | stateRef 同步问题 | ⚪ 低 | 未来兼容 |
| 10 | handlePin 返回值未校验 | ⚪ 低 | 状态错误 |
| 11 | launch 路径注入风险 | ⚪ 低 | 安全性 |

---

## 六、优先修复顺序建议

1. **立即修复**: 问题 1（数据库空指针）、问题 2（updateIndex 死锁）
2. **本周内修复**: 问题 3（Race Condition）、问题 4（热键处理）
3. **计划内修复**: 问题 5-7
4. **代码优化**: 问题 8-11
