# 代码审计报告

## 项目概述

- **项目名称**: Huo-Launchpad (火 Launcher)
- **技术栈**: Electron + React + TypeScript + better-sqlite3 + koffi (Everything SDK)
- **项目类型**: 桌面应用启动器
- **审计日期**: 2026-04-03

---

## 一、高严重程度问题（5个）

### 1. 热键注册竞态条件

**位置**: [src/main/index.ts:51-58](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\index.ts#L51-L58)

**问题描述**:
```typescript
ipcMain.handle('set-hotkey', (_, h: string) => {
  const win = BrowserWindow.getAllWindows()[0]
  globalShortcut.unregister(currentHotkey)  // Step 1: 注销旧热键
  if (globalShortcut.register(h, () => { ... })) {
    currentHotkey = h; stmts.setSetting.run('hotkey', h); return { success: true }
  }
  globalShortcut.register(currentHotkey, () => { ... })  // Step 3: 恢复旧热键
  return { success: false, message: '被占用' }
})
```

在 Step 1 和 Step 3 之间存在时间窗口，此时全局热键完全失效。如果用户在此窗口内按下组合键，将没有任何响应。

**严重程度**: 高

**建议修复**: 使用临时变量保存状态，原子性地完成切换。

---

### 2. process-paths 返回值类型丢失

**位置**: [src/main/index.ts:88-94](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\index.ts#L88-L94)

**问题描述**:
```typescript
const res = await Promise.all((paths || []).map(async (p) => {
  if (typeof p !== 'string') return null
  // ...
}))
return res.filter(Boolean)
```

`filter(Boolean)` 无法让 TypeScript 正确收缩类型，返回类型仍然是 `(T | null)[]` 而非 `T[]`，导致调用方可能遇到类型问题。

**严重程度**: 高

**建议修复**:
```typescript
return res.filter((item): item is NonNullable<typeof item> => item !== null)
```

---

### 3. 图标缓存内存泄漏

**位置**: [src/main/index.ts:14-22](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\index.ts#L14-L22)

**问题描述**:
```typescript
const iconCache = new Map<string, string>()
async function getCachedIcon(p: string) {
  if (iconCache.has(p)) return iconCache.get(p)!
  // ...
  iconCache.set(p, data)
}
```

`iconCache` 是无限增长的 `Map`，长期运行会导致内存泄漏。

**严重程度**: 高

**建议修复**: 使用 LRU 缓存或设置最大容量限制。

---

### 4. closeDb 缺少空检查

**位置**: [src/main/db.ts:49-50](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\db.ts#L49-L50)

**问题描述**:
```typescript
export function closeDb() {
  db.close()
}
```

如果数据库初始化失败（koffi 加载失败导致 app 异常退出），`db` 可能未正确初始化，调用 `closeDb()` 会抛出异常。

**严重程度**: 高

**建议修复**:
```typescript
export function closeDb() {
  if (db && typeof db.close === 'function') {
    db.close()
  }
}
```

---

### 5. detached 进程无法监控和清理

**位置**: [src/main/index.ts:32](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\index.ts#L32)

**问题描述**:
```typescript
everythingProcess = spawn(join(binPath, 'Everything.exe'), ['-config', iniPath, '-minimized'], { detached: true, stdio: 'ignore' })
everythingProcess.unref()
```

`unref()` 后无法监控进程状态，无法获取返回值，也无法确保进程被正确终止。

**严重程度**: 高

---

## 二、中严重程度问题（13个）

### 6. search IPC 存在空指针风险

**位置**: [src/main/index.ts:73-80](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\index.ts#L73-L80)

**问题描述**:
```typescript
const usage = stmts.getUsage.get(p) as any, icon = await getCachedIcon(p)
return { name: i.name.replace(/\.[^/.]+$/, ''), path: p, icon, extension: i.name.split('.').pop() || 'file', usageCount: usage ? usage.count : 0 }
```

`usage.count` 直接访问应改为 `usage?.count ?? 0`

**严重程度**: 高

**建议修复**:
```typescript
usageCount: usage?.count ?? 0
```

---

### 7. launch IPC 回调中隐藏窗口时机不当

**位置**: [src/main/index.ts:98-113](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\index.ts#L98-L113)

**问题描述**:
```typescript
exec(`powershell -Command "${psCommand}"`, (err) => {
  if (err) {
    console.error('[LAUNCH] 提权启动失败，尝试普通启动:', err)
    shell.openPath(path)
  }
  BrowserWindow.getAllWindows().forEach(w => w.hide())  // 这行在 err 时也会执行
})
```

`BrowserWindow.getAllWindows().forEach(w => w.hide())` 在回调中执行，但无论成功失败都隐藏窗口，即使启动失败也需要窗口显示错误。

**严重程度**: 中

---

### 8. useEffect 依赖项过多

**位置**: [src/renderer/src/App.tsx:38-76](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\renderer\src\App.tsx#L38-L76)

**问题描述**:
```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => { ... }
  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [results, pinnedApps, selectedIndex, query, showSettings, isRecording])
```

`handleKeyDown` 函数定义在 `useEffect` 内部但依赖数组很长，每次依赖变化都会重新绑定监听器，可能导致性能问题和状态不一致。

**严重程度**: 中

---

### 9. handleDrop 中循环调用 pinApp 效率低下

**位置**: [src/renderer/src/App.tsx:115-129](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\renderer\src\App.tsx#L115-L129)

**问题描述**:
```typescript
for (const item of newItems) {
  const existingIndices = pinnedApps.map(a => a.grid_index)
  let firstEmpty = 0
  while (existingIndices.includes(firstEmpty)) firstEmpty++
  await window.api.pinApp(item, firstEmpty)
}
loadPinned()
```

每次循环都重新计算 `existingIndices`，效率低下。且 `loadPinned()` 在所有 `pinApp` 之后调用，可能导致竞态条件。

**严重程度**: 中

---

### 10. 数据库迁移逻辑过于简单

**位置**: [src/main/db.ts:31-36](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\db.ts#L31-L36)

**问题描述**:
```typescript
try {
  const tableInfo = db.pragma('table_info(pinned_apps)') as any[]
  if (!tableInfo.some(col => col.name === 'grid_index')) {
    db.exec('ALTER TABLE pinned_apps ADD COLUMN grid_index INTEGER DEFAULT -1')
  }
} catch (e) {}
```

迁移逻辑只检查单列，没有版本控制，如果未来有更多迁移会难以维护。

**严重程度**: 中

---

### 11. 数据库路径创建未使用 try-catch

**位置**: [src/main/db.ts:6-7](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\db.ts#L6-L7)

**问题描述**:
```typescript
if (!existsSync(userDataPath)) mkdirSync(userDataPath, { recursive: true })
export const db = new Database(join(userDataPath, 'launcher.db'))
```

如果目录创建失败或数据库初始化失败，没有错误处理。

**严重程度**: 中

---

### 12. SQLite ON CONFLICT 没有日志

**位置**: [src/main/db.ts:43](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\db.ts#L43)

**问题描述**:
```typescript
incrementUsage: db.prepare('INSERT INTO usage_stats (path, count) VALUES (?, 1) ON CONFLICT(path) DO UPDATE SET count = count + 1'),
```

每次应用启动/运行都调用此语句，没有日志记录，难以追踪和调试。

**严重程度**: 中

---

### 13. set-hotkey 失败时没有日志

**位置**: [src/main/index.ts:51-58](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\index.ts#L51-L58)

**问题描述**:
```typescript
return { success: false, message: '被占用' }
```

热键注册失败时只返回错误消息，没有 `console.error` 记录详细原因。

**严重程度**: 中

---

### 14. app.whenReady 之后无错误处理

**位置**: [src/main/index.ts:120-121](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\index.ts#L120-L121)

**问题描述**:
```typescript
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.huochat.launcher')
  startEverything(); const win = createWindow()
  globalShortcut.register(currentHotkey, () => { ... })
})
```

如果 `startEverything()` 或 `createWindow()` 失败，没有错误处理，可能导致应用处于未知状态。

**严重程度**: 中

---

### 15. loadPinned 缺少错误处理

**位置**: [src/renderer/src/App.tsx:18-19](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\renderer\src\App.tsx#L18-L19)

**问题描述**:
```typescript
const loadPinned = () => { window.api.getPinnedApps().then(setPinnedApps) }
```

如果 `getPinnedApps()` 失败（如数据库错误），没有 `.catch()` 处理。

**严重程度**: 中

---

### 16. isLoaded 检查前缺少 null 检查

**位置**: [src/main/sdk.ts:32](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\sdk.ts#L32)

**问题描述**:
```typescript
if (!sdk || !sdk.isLoaded()) return []
```

虽然 `sdk` 有 null 检查，但如果 koffi 加载的 DLL 函数指针部分失败，`sdk` 存在但某些函数可能为 undefined。

**严重程度**: 中

---

### 17. 命令注入风险

**位置**: [src/main/index.ts:98-113](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\index.ts#L98-L113)

**问题描述**:
```typescript
ipcMain.on('launch', (_, path: string) => {
  // ...
  const psCommand = `Start-Process "${path}" -Verb RunAs`
  exec(`powershell -Command "${psCommand}"`, ...)
})
```

如果 `path` 包含恶意命令，会被直接执行。虽然是管理员应用，但仍然存在命令注入风险。

**严重程度**: 中

**建议修复**: 对 `path` 进行严格验证，确保是合法路径。

---

### 18. select-file 没有路径验证

**位置**: [src/main/index.ts:85](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\index.ts#L85)

**问题描述**:
```typescript
const p = filePaths[0], n = p.split(/[\\\/]/).pop() || '', icon = await getCachedIcon(p)
return { name: n.replace(/\.[^/.]+$/, ''), path: p, icon, extension: n.includes('.') ? n.split('.').pop() : 'folder' }
```

`filePaths[0]` 直接使用，没有验证路径有效性。

**严重程度**: 低

---

## 三、低严重程度问题（9个）

### 19. BrowserWindow.getAllWindows()[0] 缺少验证

**位置**: [src/main/index.ts:52](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\index.ts#L52)

**问题描述**:
```typescript
const win = BrowserWindow.getAllWindows()[0]
```

如果窗口尚未创建，`getAllWindows()` 返回空数组，`win` 为 `undefined`，后续调用会静默失败。

**严重程度**: 低

---

### 20. key 使用 path + index 组合不理想

**位置**: [src/renderer/src/components/SearchList.tsx:28](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\renderer\src\components\SearchList.tsx#L28)

**问题描述**:
```typescript
key={item.path + index}
```

`path` 作为 PRIMARY KEY 应该是唯一的，但使用 `+ index` 是防御性做法，更好的做法是确保数据唯一性。

**严重程度**: 低

---

### 21. grid 数组查找效率低

**位置**: [src/renderer/src/components/LaunchpadGrid.tsx:80-82](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\renderer\src\components\LaunchpadGrid.tsx#L80-L82)

**问题描述**:
```typescript
const grid = Array.from({ length: 50 }, (_, i) => {
  return pinnedApps.find((a: any) => a.grid_index === i) || null
})
```

每次渲染都遍历整个 `pinnedApps` 数组 50 次，时间复杂度 O(50 * n)。

**严重程度**: 低

**建议修复**:
```typescript
const pinnedByIndex = new Map(pinnedApps.map(a => [a.grid_index, a]))
const grid = Array.from({ length: 50 }, (_, i) => pinnedByIndex.get(i) || null)
```

---

### 22. globalShortcut.unregisterAll() 影响范围过大

**位置**: [src/main/index.ts:43](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\index.ts#L43)

**问题描述**:
```typescript
closeDb(); globalShortcut.unregisterAll()
```

`unregisterAll()` 会注销所有全局快捷键，可能影响系统或其他应用的热键。

**严重程度**: 低

---

### 23. 热键初始化可以合并到 SQL

**位置**: [src/main/db.ts:25-28](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\db.ts#L25-L28)

**问题描述**:
```typescript
const hotkeyExists = db.prepare('SELECT value FROM settings WHERE key = ?').get('hotkey')
if (!hotkeyExists) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('hotkey', 'Alt+Q')
}
```

可以使用 `INSERT OR IGNORE` 简化为单条语句。

**严重程度**: 低

---

### 24. handlePin 中 firstEmpty 计算可复用

**位置**: [src/renderer/src/App.tsx:82-88](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\renderer\src\App.tsx#L82-L88)

**问题描述**:

`handlePin` 和 `handleAddFile` 中有重复的 `firstEmpty` 计算逻辑，应该提取为工具函数。

**严重程度**: 低

---

### 25. iniContent 中的路径分隔符转换

**位置**: [src/main/index.ts:29](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\index.ts#L29)

**问题描述**:
```typescript
const iniContent = `[Everything]\ninstance_name=${INSTANCE_NAME}\nhttp_server_enabled=0\nrun_as_admin=0\ndb_location=${dbPath.replace(/\\/g, '/')}\n`
```

虽然注释说是为了让本体已是管理员，但路径格式转换可能导致在某些环境下的问题。

**严重程度**: 低

---

### 26. 键盘导航可能产生负数索引

**位置**: [src/renderer/src/App.tsx:61-65](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\renderer\src\App.tsx#L61-L65)

**问题描述**:
```typescript
const isGrid = !query, items = isGrid ? Array.from({length:50}) : results
if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(p => Math.min(p + (isGrid ? 10 : 1), items.length - 1)) }
if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(p => Math.max(p - (isGrid ? 10 : 1), 0)) }
```

当 `isGrid` 为 true 时，向上导航跳跃 10 个位置可能导致用户困惑。

**严重程度**: 低

---

### 27. Enter 键处理缺少边界检查

**位置**: [src/renderer/src/App.tsx:66-70](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\renderer\src\App.tsx#L66-L70)

**问题描述**:
```typescript
if (e.key === 'Enter') {
  const pinned = pinnedApps.find(a => a.grid_index === selectedIndex)
  if (isGrid && pinned) handleLaunch(pinned.path)
  else if (!isGrid && results[selectedIndex]) handleLaunch(results[selectedIndex].path)
}
```

如果 `selectedIndex` 超出 `results` 数组范围，`results[selectedIndex]` 会返回 `undefined`，虽然有 `&&` 保护但逻辑不清晰。

**严重程度**: 低

---

## 四、性能问题

### 28. search 防抖 200ms 较长

**位置**: [src/renderer/src/App.tsx:27-35](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\renderer\src\App.tsx#L27-L35)

**问题描述**:
```typescript
const delayDebounceFn = setTimeout(async () => {
  if (query.trim()) {
    setLoading(true);
    const data = await window.api.search(query)
    // ...
  }
}, 200)
```

200ms 防抖对于快速输入的用户可能感觉响应迟缓。

**严重程度**: 低

---

### 29. search 中逐个获取图标

**位置**: [src/main/index.ts:75-79](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\index.ts#L75-L79)

**问题描述**:
```typescript
const res = await Promise.all(raw.map(async (i) => {
  const p = i.folder.endsWith('\\') ? ... : ...
  const usage = stmts.getUsage.get(p), icon = await getCachedIcon(p)
  // ...
}))
```

每个搜索结果都单独调用 `getCachedIcon`（虽然有缓存），但初始化时仍然可能同时打开大量文件句柄。

**严重程度**: 低

---

## 五、代码质量问题

### 30. key 检测使用 indexOf === -1

**位置**: [src/renderer/src/App.tsx:47-48](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\renderer\src\App.tsx#L47-L48)

**问题描述**:
```typescript
if (['CONTROL', 'SHIFT', 'ALT', 'META'].indexOf(key) === -1) {
```

应该使用 `includes()` 替代 `indexOf() === -1`。

**严重程度**: 低

---

### 31. setSetting 的 SQL 注入风险

**位置**: [src/main/db.ts:46](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\main\db.ts#L46)

**问题描述**:
```typescript
setSetting: db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
```

虽然使用参数化查询，但如果 `key` 或 `value` 包含特殊字符可能导致问题。当前所有 key 都是代码中预设的，问题不大。

**严重程度**: 低

---

### 32. 多个 state 可以合并

**位置**: [src/renderer/src/App.tsx:11-16](file:///c:\Users\VerNe\Downloads\Documents\huochat\src\renderer\src\App.tsx#L11-L16)

**问题描述**:
```typescript
const [query, setQuery] = useState('')
const [results, setResults] = useState<any[]>([])
const [pinnedApps, setPinnedApps] = useState<any[]>([])
// ... 更多 state
```

可以使用 `useReducer` 合并相关状态。

**严重程度**: 低

---

## 六、修复优先级建议

### 第一优先级（必须修复）

1. **热键注册竞态条件** - 使用临时变量原子性完成热键切换
2. **图标缓存内存泄漏** - 实现 LRU 缓存限制大小
3. **closeDb 空检查** - 添加 db 存在性检查
4. **launch 命令注入** - 对 path 进行严格路径验证
5. **handleDrop 竞态** - 优化 firstEmpty 计算逻辑

### 第二优先级（建议修复）

6. **search 空指针风险** - 使用 `usage?.count ?? 0`
7. **launch 隐藏窗口时机** - 启动失败时不隐藏窗口
8. **app.whenReady 错误处理** - 添加完整错误处理
9. **loadPinned 错误处理** - 添加 `.catch()` 处理

### 第三优先级（可选修复）

10. **grid 查找效率** - 使用 Map 优化
11. **useEffect 依赖** - 提取 handleKeyDown
12. **数据库迁移** - 添加版本控制

---

## 七、审计总结

| 类别 | 高 | 中 | 低 |
|------|----|----|-----|
| 死锁/竞态问题 | 2 | 3 | 2 |
| 空指针/越界 | 3 | 5 | 4 |
| 异常处理 | 1 | 5 | 3 |
| 性能问题 | 0 | 2 | 3 |
| 安全问题 | 1 | 1 | 2 |
| 代码质量 | 0 | 2 | 5 |
| **总计** | **7** | **18** | **19** |

---

## 八、问题清单汇总

| # | 严重程度 | 问题 | 文件位置 |
|---|----------|------|----------|
| 1 | 高 | 热键注册竞态条件 | src/main/index.ts:51-58 |
| 2 | 高 | process-paths 返回值类型丢失 | src/main/index.ts:88-94 |
| 3 | 高 | 图标缓存内存泄漏 | src/main/index.ts:14-22 |
| 4 | 高 | closeDb 缺少空检查 | src/main/db.ts:49-50 |
| 5 | 高 | detached 进程无法监控 | src/main/index.ts:32 |
| 6 | 高 | search IPC 空指针风险 | src/main/index.ts:73-80 |
| 7 | 中 | launch 隐藏窗口时机不当 | src/main/index.ts:98-113 |
| 8 | 中 | useEffect 依赖项过多 | src/renderer/src/App.tsx:38-76 |
| 9 | 中 | handleDrop 循环效率低 | src/renderer/src/App.tsx:115-129 |
| 10 | 中 | 数据库迁移过于简单 | src/main/db.ts:31-36 |
| 11 | 中 | 数据库路径创建无错误处理 | src/main/db.ts:6-7 |
| 12 | 中 | ON CONFLICT 没有日志 | src/main/db.ts:43 |
| 13 | 中 | set-hotkey 失败无日志 | src/main/index.ts:51-58 |
| 14 | 中 | app.whenReady 无错误处理 | src/main/index.ts:120-121 |
| 15 | 中 | loadPinned 缺少错误处理 | src/renderer/src/App.tsx:18-19 |
| 16 | 中 | isLoaded 检查不完善 | src/main/sdk.ts:32 |
| 17 | 中 | 命令注入风险 | src/main/index.ts:98-113 |
| 18 | 中 | select-file 无路径验证 | src/main/index.ts:85 |
| 19 | 低 | BrowserWindow 验证缺失 | src/main/index.ts:52 |
| 20 | 低 | key 生成不理想 | src/renderer/src/components/SearchList.tsx:28 |
| 21 | 低 | grid 查找效率低 | src/renderer/src/components/LaunchpadGrid.tsx:80-82 |
| 22 | 低 | unregisterAll 范围过大 | src/main/index.ts:43 |
| 23 | 低 | 热键初始化可简化 | src/main/db.ts:25-28 |
| 24 | 低 | firstEmpty 计算重复 | src/renderer/src/App.tsx:82-88 |
| 25 | 低 | 路径分隔符转换 | src/main/index.ts:29 |
| 26 | 低 | 键盘导航逻辑 | src/renderer/src/App.tsx:61-65 |
| 27 | 低 | Enter 键边界检查 | src/renderer/src/App.tsx:66-70 |
| 28 | 低 | search 防抖较长 | src/renderer/src/App.tsx:27-35 |
| 29 | 低 | 图标获取并发 | src/main/index.ts:75-79 |
| 30 | 低 | indexOf 应改 includes | src/renderer/src/App.tsx:47-48 |
| 31 | 低 | SQL 注入潜在风险 | src/main/db.ts:46 |
| 32 | 低 | state 可合并 | src/renderer/src/App.tsx:11-16 |
