# 代码审计报告

**项目**: HuoChat / HuoLauncher
**审计日期**: 2026-04-03
**审计范围**: `src/` 目录下的主要源代码

---

## 🔴 严重问题 (Critical)

### 1. 死锁风险：`Everything.exe` 进程管理问题

**位置**: [src/main/index.ts#L19-20](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/index.ts#L19-L20)

```typescript
everythingProcess = spawn(join(binPath, 'Everything.exe'), ['-config', iniPath, '-minimized'], { detached: true, stdio: 'ignore' })
everythingProcess.unref()
```

**问题描述**:
- `detached: true` + `stdio: 'ignore'` + `unref()` 意味着主进程无法监控子进程状态
- 如果 `Everything.exe` 崩溃或被其他程序终止，`everythingProcess` 仍保留为 stale reference
- 后续调用 `executeQuery()` 会静默失败（返回空数组），用户完全不知道 SDK 已断开

**修复建议**:
```typescript
everythingProcess = spawn(join(binPath, 'Everything.exe'), ['-config', iniPath, '-minimized'], { detached: true, stdio: 'pipe' })
everythingProcess.on('error', (err) => console.error('[Everything] Process error:', err))
everythingProcess.on('exit', (code) => {
  if (code !== 0) console.warn('[Everything] Process exited with code:', code)
  everythingProcess = null
})
```

---

### 2. 致命 Bug：拖拽排序互换逻辑错误

**位置**: [src/main/index.ts#L48-58](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/index.ts#L48-L58)

```typescript
const swapTransaction = db.transaction(() => {
  if (targetOccupant && targetOccupant.path !== path) {
    stmts.updateIndex.run(currentApp.grid_index, targetOccupant.path)  // BUG!
  }
  stmts.updateIndex.run(index, path)  // 第二次同样参数
})
```

**问题描述**:
1. 第一行执行 `UPDATE pinned_apps SET grid_index = currentApp.grid_index WHERE path = targetOccupant.path`
2. 第二行执行 `UPDATE pinned_apps SET grid_index = index WHERE path = path`
3. 当 `targetOccupant.path` 存在时，第二次 `updateIndex.run(index, path)` 会将目标位置设为传入的 `index`，但 `targetOccupant` 已经被移到 `currentApp.grid_index`——**逻辑完全错误**

**正确逻辑**:
```typescript
const swapTransaction = db.transaction(() => {
  if (targetOccupant && targetOccupant.path !== path) {
    stmts.updateIndex.run(currentApp.grid_index, targetOccupant.path)  // 目标移到原位
  }
  stmts.updateIndex.run(index, path)  // 拖拽项移到新位置
})
```

---

### 3. 数据库并发写入竞态条件

**位置**: [src/main/db.ts#L31-38](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/db.ts#L31-L38)

```typescript
export const stmts = {
  getPinned: db.prepare('SELECT * FROM pinned_apps ORDER BY grid_index ASC'),
  pin: db.prepare('INSERT OR REPLACE INTO pinned_apps ...'),
  unpin: db.prepare('DELETE FROM pinned_apps WHERE path = ?'),
  updateIndex: db.prepare('UPDATE pinned_apps SET grid_index = ? WHERE path = ?'),
  incrementUsage: db.prepare('INSERT INTO usage_stats ...'),
  getUsage: db.prepare('SELECT count FROM usage_stats WHERE path = ?')
}
```

**问题描述**: `better-sqlite3` 是同步库，在 Electron 主进程中直接使用没有问题。但如果同时有多个 IPC 调用（如快速连续拖拽两次），SQLite 的事务隔离可能导致：
- 脏读：读取到未提交的事务
- lost update：两个事务同时更新同一行

**当前状态**: 当前代码已用事务包装 ([index.ts#L48-57](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/index.ts#L48-L57))，但 `updateAppPosition` 没有重试机制，高并发时会 SQLITE_BUSY 失败

---

## 🟠 中等问题 (Major)

### 4. SDK 查询无超时保护

**位置**: [src/main/sdk.ts#L30-52](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/sdk.ts#L30-L52)

```typescript
export function executeQuery(query: string, maxResults = 50): SearchResult[] {
  if (!sdk) return []
  try {
    sdk.setSearch(query + ' ext:exe;lnk;url !uninstall !"c:\\windows\\"')
    sdk.setRequestFlags(0x00000001 | 0x00000002)

    if (!sdk.query(true)) return []  // bWait=true 会阻塞!
    // ...
  }
}
```

**问题描述**: `sdk.query(true)` 是同步阻塞调用。如果 Everything 服务卡死（如大量文件索引），会无限期阻塞主进程。

**建议**: 使用 `setTimeout` + `process.kill(everythingProcess.pid)` 实现超时保护。

---

### 5. 内存泄漏：`onWindowShown` 监听器未移除

**位置**: [src/renderer/src/components/SearchBar.tsx#L13-18](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/renderer/src/components/SearchBar.tsx#L13-L18)

```typescript
useEffect(() => {
  window.api.onWindowShown(() => {
    setQuery('')
    setTimeout(() => inputRef.current?.focus(), 50)
  })
}, [])  // 空的依赖数组，监听器永远不会被清理
```

**问题描述**: 每次组件挂载都注册新监听器，但卸载时不清除。在 React StrictMode 下会触发两次挂载，导致重复监听。

**修复建议**:
```typescript
useEffect(() => {
  const handler = () => {
    setQuery('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }
  window.api.onWindowShown(handler)
  return () => { window.api.removeWindowShown?.(handler) }  // 需要在 preload 中添加移除方法
}, [])
```

---

### 6. 输入验证缺失：路径注入风险

**位置**: [src/main/index.ts#L71-86](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/index.ts#L71-L86)

```typescript
ipcMain.handle('search', async (_, query: string) => {
  const rawResults = executeQuery(query)  // query 直接拼接到 SQL-like 查询
```

**问题描述**: `query` 参数没有经过验证。用户可以输入恶意字符串如 `"\n!\0"` 或超长字符串。虽然 Everything.exe 会处理，但可能引发 SDK 崩溃或异常行为。

---

### 7. 图标获取无缓存，重复操作

**位置**: [src/main/index.ts#L73-80](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/index.ts#L73-L80)

```typescript
const icon = await app.getFileIcon(fullPath, { size: 'large' }).catch(() => null)
```

**问题描述**: 每次搜索都重新获取文件图标，Windows 上 `getFileIcon` 是昂贵的 COM 调用。频繁搜索会导致 UI 卡顿。

**建议**: 实现 LRU 缓存（如 `node-cache`）限制 100 个条目。

---

## 🟡 轻微问题 (Minor)

### 8. 类型安全：preload 大量使用 `any`

**位置**: [src/renderer/src/App.tsx#L12-17](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/renderer/src/App.tsx#L12-L17)

```typescript
const [results, setResults] = useState<any[]>([])
const [pinnedApps, setPinnedApps] = useState<any[]>([])
```

**建议**: 定义 TypeScript 接口：
```typescript
interface PinnedApp {
  path: string
  name: string
  icon: string
  extension: string
  grid_index: number
}

interface SearchResult {
  path: string
  name: string
  icon: string
  extension: string
  usageCount: number
}
```

---

### 9. 错误处理不一致

**位置**: [src/main/index.ts#L106-110](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/index.ts#L106-L110)

```typescript
ipcMain.on('launch', (_, path: string) => {
  try { stmts.incrementUsage.run(path) } catch(e){}  // 吞掉所有错误
  shell.openPath(path)  // 没有错误处理
  BrowserWindow.getAllWindows().forEach(w => w.hide())
})
```

---

### 10. 窗口 blur 事件直接 hide 可能丢失焦点

**位置**: [src/main/index.ts#L30](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/index.ts#L30)

```typescript
win.on('blur', () => win.hide())
```

**问题描述**: 如果用户点击窗口自身内部的元素，blur 事件先于 click 触发，导致窗口关闭。这在拖拽操作时尤其烦人。

**建议**: 使用 `mousedown` + 判断点击目标是否在窗口内。

---

### 11. 搜索结果排序不稳定

**位置**: [src/main/index.ts#L85](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/index.ts#L85)

```typescript
return resultsWithUsage.sort((a, b) => b.usageCount - a.usageCount)
```

**问题描述**: 当 `usageCount` 相同时，排序顺序不确定（稳定排序问题）。相同使用次数的文件每次顺序可能不同。

---

## 📊 总结

| 严重程度 | 数量 | 说明 |
|---------|------|------|
| 🔴 Critical | 3 | 死锁风险、排序 bug、竞态条件 |
| 🟠 Major | 4 | SDK 超时、内存泄漏、输入验证、图标缓存 |
| 🟡 Minor | 4 | any 类型、错误处理、窗口焦点、排序稳定性 |

---

## 🎯 优先修复建议

**最优先修复**:

1. **拖拽排序逻辑** ([src/main/index.ts#L48-58](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/index.ts#L48-L58))
   - 当前会导致数据错乱，必须立即修复

2. **Everything.exe 进程监控** ([src/main/index.ts#L19-20](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/main/index.ts#L19-L20))
   - 防止静默失败，添加进程状态监控

3. **SearchBar.tsx 内存泄漏** ([src/renderer/src/components/SearchBar.tsx#L13-18](file:///c:/Users/VerNe/Downloads/Documents/huochat/src/renderer/src/components/SearchBar.tsx#L13-L18))
   - 移除重复监听器，避免内存泄漏
