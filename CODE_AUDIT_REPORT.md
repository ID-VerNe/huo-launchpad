# 🔍 Huo-Launchpad 代码审计完整报告

## 项目概况

| 项目 | 信息 |
|------|------|
| 项目名称 | Huo-Launchpad (火 Launcher) |
| 技术栈 | Electron + React + TypeScript + better-sqlite3 + koffi |
| 审计日期 | 2026-04-03 |
| 问题总数 | 44 个 |
| 已修复 | 10 个 |
| 仍存在 | 34 个 |

---

## 🔴 高严重程度问题（7个）- 必须修复

### ❌ 问题 1：detached 进程无法监控和清理
**位置**: `src/main/index.ts:38`

```typescript
everythingProcess = spawn(join(binPath, 'Everything.exe'), ['-config', iniPath, '-minimized'], { detached: true, stdio: 'pipe' })
```

**风险**：
- 子进程独立运行，异常退出时无法感知
- 多次启动可能产生多个 Everything 实例
- 无法确保进程被正确终止

**修复建议**：
```typescript
// 添加进程监控
everythingProcess.on('error', (err) => {
  console.error('[ENGINE] 启动失败:', err)
})

// 退出时清理
app.on('will-quit', () => {
  try {
    spawn('taskkill', ['/F', '/IM', 'Everything.exe'], { shell: true })
  } catch (e) {}
})
```

---

### ❌ 问题 2：命令注入风险
**位置**: `src/main/index.ts:148-150`

```typescript
const psCommand = `Start-Process "${safePath}" -Verb RunAs`
exec(`powershell -Command "${psCommand.replace(/"/g, '`"')}"`, ...)
```

**风险**：路径中包含反引号 `` ` `` 时可能被注入

**修复建议**：
```typescript
const safePath = normalize(path)
if (!safePath || !existsSync(safePath)) return

if (!/^[a-zA-Z]:\\/.test(safePath)) {
  console.error('[LAUNCH] 非法路径格式:', safePath)
  return
}

const psCommand = `Start-Process -FilePath "${safePath.replace(/"/g, '')}" -Verb RunAs`
exec(`powershell -NoProfile -Command "${psCommand}"`, (err) => {
  if (err) {
    console.error('[LAUNCH] 提权启动失败:', err)
    shell.openPath(safePath)
  }
  BrowserWindow.getAllWindows().forEach(w => w.hide())
})
```

---

### ❌ 问题 3：热键初始化可能访问 undefined
**位置**: `src/main/index.ts:11`

```typescript
let currentHotkey = (stmts.getSetting?.get('hotkey') as any)?.value || 'Alt+Q'
```

**风险**：`stmts` 在 db.ts 中定义为可选链 `db?.prepare()`，如果 db 初始化失败，`stmts.getSetting` 为 undefined

**修复建议**：
```typescript
let currentHotkey = 'Alt+Q'
try {
  if (stmts?.getSetting) {
    const saved = stmts.getSetting.get('hotkey') as any
    if (saved?.value) currentHotkey = saved.value
  }
} catch (e) {
  console.error('[HOTKEY] 读取保存的热键失败:', e)
}
```

---

### ✅ 问题 4：已修复 - closeDb 空检查
`db.ts:42-46` 已添加检查

---

### ✅ 问题 5：已修复 - 图标缓存内存泄漏
`src/main/index.ts:14-27` 已添加 MAX_CACHE_SIZE 和 LRU 淘汰

---

### ✅ 问题 6：已修复 - search 空指针风险
`src/main/index.ts:126` 已使用 `usage?.count ?? 0`

---

### ✅ 问题 7：已修复 - 热键注册竞态条件
`src/main/index.ts:49-72` 已改为"先注册成功再注销旧热键"

---

## 🟡 中严重程度问题（13个）- 建议修复

### ❌ 问题 8：app.whenReady 无错误处理
**位置**: `src/main/index.ts:161-168`

```typescript
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.huochat.launcher')
  startEverything()
  const win = createWindow()
  if (win) registerMainHotkey(win)
})
```

**修复建议**：
```typescript
app.whenReady().then(() => {
  try {
    electronApp.setAppUserModelId('com.huochat.launcher')
    startEverything()
    const win = createWindow()
    if (!win) {
      console.error('[MAIN] 窗口创建失败')
      app.quit()
      return
    }
    registerMainHotkey(win)
  } catch (err) {
    console.error('[MAIN] 启动过程崩溃:', err)
    app.quit()
  }
}).catch(err => {
  console.error('[MAIN] 应用就绪失败:', err)
  app.quit()
})
```

---

### ❌ 问题 9：loadPinned 缺少 .catch()
**位置**: `src/renderer/src/App.tsx:28-31`

```typescript
const loadPinned = useCallback(() => {
  window.api.getPinnedApps().then(apps => setState(s => ({ ...s, pinnedApps: apps }))).catch(console.error)
}, [])
```

**说明**：虽然有 .catch(console.error)，但应该添加用户提示

**修复建议**：
```typescript
const loadPinned = useCallback(() => {
  window.api.getPinnedApps()
    .then(apps => setState(s => ({ ...s, pinnedApps: apps || [] })))
    .catch(err => {
      console.error('[UI] 加载固定应用失败:', err)
      setState(s => ({ ...s, pinnedApps: [] }))
    })
}, [])
```

---

### ❌ 问题 10：select-file IPC 未实现路径验证
**位置**: 主进程缺少对应 handler

**修复建议**：在 index.ts 中添加：
```typescript
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: '快捷方式', extensions: ['exe', 'lnk', 'url'] }
    ]
  })
  if (result.canceled || !result.filePaths[0]) return null

  const filePath = result.filePaths[0]
  if (!existsSync(filePath)) return null

  return {
    path: filePath,
    name: filePath.split(/[\\\/]/).pop() || '',
    icon: await getCachedIcon(filePath)
  }
})
```

---

### ❌ 问题 11：DragOverlay 未限制边界
**位置**: `src/renderer/src/components/LaunchpadGrid.tsx:110-112`

**修复建议**：
```typescript
<DragOverlay
  dropAnimation={{
    sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.5' } } })
  }}
>
  {activeItem ? (
    <div
      className="w-[90px]"
      style={{
        transform: 'translate(0, 0)',
        maxX: window.innerWidth - 100,
        maxY: window.innerHeight - 100
      }}
    >
      <AppIcon item={activeItem} isOverlay />
    </div>
  ) : null}
</DragOverlay>
```

---

### ❌ 问题 12：findFirstEmpty 未考虑 grid_index=-1
**位置**: `src/renderer/src/App.tsx:123-127`

**修复建议**：
```typescript
const findFirstEmpty = (apps: any[]) => {
  const usedIndices = new Set(apps.map(a => a.grid_index).filter(i => i >= 0))
  let i = 0
  while (usedIndices.has(i)) i++
  return Math.min(i, 49)
}
```

---

### ❌ 问题 13：registerMainHotkey 与 safeRegisterHotkey 重复
**位置**: `src/main/index.ts:170-175`

**修复建议**：复用 safeRegisterHotkey
```typescript
function registerMainHotkey(win: BrowserWindow) {
  const result = safeRegisterHotkey(win, currentHotkey)
  if (!result.success) {
    console.error('[HOTKEY] 初始热键注册失败:', result.message)
  }
}
```

---

### ❌ 问题 14：onWindowShown 可能重复监听
**位置**: `src/renderer/src/components/SearchBar.tsx:13-24`

**修复建议**：
```typescript
useEffect(() => {
  let removeListener: (() => void) | undefined

  // @ts-ignore
  if (window.api?.onWindowShown) {
    // @ts-ignore
    removeListener = window.api.onWindowShown(() => {
      setQuery('')
      setTimeout(() => inputRef.current?.focus(), 50)
    })
  }

  return () => {
    if (removeListener) {
      removeListener()
      removeListener = undefined
    }
  }
}, [setQuery])
```

---

### ❌ 问题 15：handlePin 返回值未检查
**位置**: `src/renderer/src/App.tsx:132-138`

**修复建议**：
```typescript
const handlePin = async (e: any, item: any) => {
  e.stopPropagation()
  const index = findFirstEmpty(state.pinnedApps)
  try {
    const newPinned = await window.api.pinApp(item, index)
    if (newPinned) {
      setState(s => ({ ...s, pinnedApps: newPinned, query: '' }))
    }
  } catch (err) {
    console.error('[UI] 固定应用失败:', err)
  }
}
```

---

### ❌ 问题 16：launch IPC 隐藏窗口时机不当
**位置**: `src/main/index.ts:156`

**修复建议**：
```typescript
exec(`powershell -Command "${psCommand}"`, (err) => {
  if (err) {
    console.error('[LAUNCH] 提权启动失败，尝试普通启动:', err)
    shell.openPath(safePath).then(result => {
      if (result !== '') {
        console.error('[LAUNCH] 普通启动也失败:', result)
        return
      }
      BrowserWindow.getAllWindows().forEach(w => w.hide())
    })
  } else {
    BrowserWindow.getAllWindows().forEach(w => w.hide())
  }
})
```

---

### ❌ 问题 17：grid_index 可能为 -1 的边界问题
**位置**: `src/renderer/src/App.tsx:106`

**修复建议**：
```typescript
if (isGrid) {
  const pinned = pinnedApps.find(a => a.grid_index === selectedIndex && a.grid_index >= 0)
  if (pinned) window.api.launch(pinned.path)
}
```

---

### ❌ 问题 18：update-app-position 缺少越界检查
**位置**: `src/main/index.ts:100-113`

**修复建议**：
```typescript
ipcMain.handle('update-app-position', (_, { path, index }) => {
  if (typeof index !== 'number' || index < 0 || index >= 50) {
    console.error('[DB] 无效的网格索引:', index)
    return stmts.getPinned.all()
  }
})
```

---

### ✅ 问题 19-21：已修复
- handleDrop 效率低 - 已优化
- useEffect 依赖过多 - 已用 useCallback
- 数据库迁移过于简单 - 已有基础结构

---

## 🟢 低严重程度问题（19个）- 可选优化

| # | 问题 | 位置 | 修复建议 |
|---|------|------|---------|
| 1 | **SearchList key 不应拼接 index** | SearchList.tsx:28 | 使用 `item.path` 作为 key |
| 2 | **grid 拖拽后 index 验证** | LaunchpadGrid.tsx:95 | 添加 `newIndex >= 0 && newIndex < 50` |
| 3 | **unregisterAll 范围过大** | index.ts:181 | 只注销本应用的热键 |
| 4 | **热键正则不验证合法性** | App.tsx:72 | 添加格式验证 |
| 5 | **search 防抖 150ms 可优化** | App.tsx:55 | 考虑动态防抖 |
| 6 | **图标获取并发控制** | index.ts:117 | 添加并发限制 |
| 7 | **state 可用 useReducer** | App.tsx:13-23 | 简化状态管理 |
| 8 | **SQL 注入潜在风险** | db.ts:39 | 验证 key 格式 |
| 9 | **ArrowUp/ArrowDown 跳跃困惑** | App.tsx:94-101 | 考虑网格按行导航 |
| 10 | **Enter 键边界检查** | App.tsx:103-111 | 添加显式边界验证 |
| 11 | **firstEmpty 未检查上限** | App.tsx:123-127 | 限制最大 49 |
| 12 | **窗口 blur 直接 hide** | index.ts:82 | 可添加延迟 |
| 13 | **pinApp 返回值未检查** | App.tsx:136 | 添加 try-catch |
| 14 | **拖拽时未禁止滚动** | LaunchpadGrid.tsx | 添加 touch-action |
| 15 | **数据库路径创建无 try-catch** | db.ts:6-7 | 包装 mkdirSync |
| 16 | **ON CONFLICT 无日志** | db.ts:36 | 添加调试日志 |
| 17 | **set-hotkey 失败无详细日志** | index.ts:66 | 添加 console.error |
| 18 | **isLoaded 检查不完善** | sdk.ts:33 | 添加更多检查 |

---

## 📋 修复清单

### 🔥 第一优先级（必须修复 - 共 3 个）

| # | 问题 | 文件 | 修复代码量 |
|---|------|------|-----------|
| 1 | detached 进程管理 | src/main/index.ts | ~15 行 |
| 2 | 命令注入防护 | src/main/index.ts | ~10 行 |
| 3 | 热键初始化空检查 | src/main/index.ts | ~8 行 |

### ⚠️ 第二优先级（建议修复 - 共 8 个）

| # | 问题 | 文件 |
|---|------|------|
| 4 | app.whenReady 错误处理 | src/main/index.ts |
| 5 | loadPinned 完善错误处理 | src/renderer/src/App.tsx |
| 6 | select-file IPC 路径验证 | src/main/index.ts |
| 7 | DragOverlay 边界限制 | src/renderer/src/components/LaunchpadGrid.tsx |
| 8 | findFirstEmpty 上限检查 | src/renderer/src/App.tsx |
| 9 | registerMainHotkey 复用 | src/main/index.ts |
| 10 | onWindowShown 防重复 | src/renderer/src/components/SearchBar.tsx |
| 11 | handlePin 返回值检查 | src/renderer/src/App.tsx |

### 💡 第三优先级（可选优化 - 共 19 个）

可根据时间和资源情况逐步优化。

---

## 📊 总结

```
修复工作量估算：
━━━━━━━━━━━━━━━━━━━━━━
第一优先级（必须）: 约 35 行代码
第二优先级（建议）: 约 60 行代码
第三优先级（可选）: 约 40 行代码
━━━━━━━━━━━━━━━━━━━━━━
总计               : 约 135 行代码
```

**建议**：优先修复第一优先级的 3 个问题，这将是代码安全性和稳定性的关键保障。

---

## 问题清单汇总表

| # | 严重程度 | 问题 | 文件位置 | 状态 |
|---|----------|------|----------|------|
| 1 | 高 | detached 进程无法监控 | src/main/index.ts:38 | ❌ 未修复 |
| 2 | 高 | 命令注入风险 | src/main/index.ts:148-150 | ❌ 未修复 |
| 3 | 高 | 热键初始化可能 undefined | src/main/index.ts:11 | ❌ 未修复 |
| 4 | 高 | closeDb 空检查 | src/main/db.ts:49-50 | ✅ 已修复 |
| 5 | 高 | 图标缓存内存泄漏 | src/main/index.ts:14-22 | ✅ 已修复 |
| 6 | 高 | search 空指针风险 | src/main/index.ts:73-80 | ✅ 已修复 |
| 7 | 高 | 热键注册竞态条件 | src/main/index.ts:51-58 | ✅ 已修复 |
| 8 | 中 | app.whenReady 无错误处理 | src/main/index.ts:120-121 | ❌ 未修复 |
| 9 | 中 | loadPinned 缺少 .catch() | src/renderer/src/App.tsx:18-19 | ❌ 未修复 |
| 10 | 中 | select-file 无路径验证 | src/main/index.ts:85 | ❌ 未修复 |
| 11 | 中 | DragOverlay 未限制边界 | src/renderer/src/components/LaunchpadGrid.tsx:110 | ❌ 未修复 |
| 12 | 中 | findFirstEmpty 未考虑 -1 | src/renderer/src/App.tsx:123-127 | ❌ 未修复 |
| 13 | 中 | registerMainHotkey 重复 | src/main/index.ts:170-175 | ❌ 未修复 |
| 14 | 中 | onWindowShown 重复监听 | src/renderer/src/components/SearchBar.tsx:13-24 | ❌ 未修复 |
| 15 | 中 | handlePin 返回值未检查 | src/renderer/src/App.tsx:132-138 | ❌ 未修复 |
| 16 | 中 | launch 隐藏窗口时机 | src/main/index.ts:156 | ❌ 未修复 |
| 17 | 中 | grid_index 可能为 -1 | src/renderer/src/App.tsx:106 | ❌ 未修复 |
| 18 | 中 | update-app-position 越界 | src/main/index.ts:100-113 | ❌ 未修复 |
| 19 | 中 | handleDrop 效率低 | src/renderer/src/App.tsx:115-129 | ✅ 已修复 |
| 20 | 中 | useEffect 依赖过多 | src/renderer/src/App.tsx:38-76 | ✅ 已修复 |
| 21 | 中 | 数据库迁移过于简单 | src/main/db.ts:31-36 | ✅ 已修复 |
| 22 | 低 | SearchList key 拼接 index | src/renderer/src/components/SearchList.tsx:28 | ❌ 未修复 |
| 23 | 低 | grid 拖拽 index 验证 | src/renderer/src/components/LaunchpadGrid.tsx:95 | ❌ 未修复 |
| 24 | 低 | unregisterAll 范围过大 | src/main/index.ts:181 | ❌ 未修复 |
| 25 | 低 | 热键正则不验证 | src/renderer/src/App.tsx:72 | ❌ 未修复 |
| 26 | 低 | search 防抖较长 | src/renderer/src/App.tsx:55 | ❌ 未修复 |
| 27 | 低 | 图标获取并发 | src/main/index.ts:117 | ❌ 未修复 |
| 28 | 低 | state 可合并 | src/renderer/src/App.tsx:13-23 | ❌ 未修复 |
| 29 | 低 | SQL 注入潜在风险 | src/main/db.ts:39 | ❌ 未修复 |
| 30 | 低 | ArrowUp/Down 跳跃困惑 | src/renderer/src/App.tsx:94-101 | ❌ 未修复 |
| 31 | 低 | Enter 键边界检查 | src/renderer/src/App.tsx:103-111 | ❌ 未修复 |
| 32 | 低 | firstEmpty 未检查上限 | src/renderer/src/App.tsx:123-127 | ❌ 未修复 |
| 33 | 低 | 窗口 blur 直接 hide | src/main/index.ts:82 | ❌ 未修复 |
| 34 | 低 | 拖拽时未禁止滚动 | src/renderer/src/components/LaunchpadGrid.tsx | ❌ 未修复 |
| 35 | 低 | 数据库路径创建无 try-catch | src/main/db.ts:6-7 | ❌ 未修复 |
| 36 | 低 | ON CONFLICT 无日志 | src/main/db.ts:36 | ❌ 未修复 |
| 37 | 低 | set-hotkey 失败无日志 | src/main/index.ts:66 | ❌ 未修复 |
| 38 | 低 | isLoaded 检查不完善 | src/main/sdk.ts:33 | ❌ 未修复 |
| 39 | 低 | indexOf 应改 includes | src/renderer/src/App.tsx:47-48 | ✅ 已修复 |
| 40 | 低 | grid 查找效率低 | src/renderer/src/components/LaunchpadGrid.tsx:80-82 | ✅ 已修复 |
| 41 | 低 | process-paths 类型丢失 | src/main/index.ts:88-94 | ✅ 已修复 |
| 42 | 低 | BrowserWindow 验证缺失 | src/main/index.ts:52 | ❌ 未修复 |
| 43 | 低 | 数据库迁移逻辑简单 | src/main/db.ts:31-36 | ❌ 未修复 |
| 44 | 低 | state 合并可优化 | src/renderer/src/App.tsx:11-16 | ❌ 未修复 |
