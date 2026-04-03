import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Settings, Keyboard } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import SearchBar from './components/SearchBar'
import LaunchpadGrid from './components/LaunchpadGrid'
import SearchList from './components/SearchList'

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

interface AppState {
  query: string
  results: any[]
  pinnedApps: any[]
  loading: boolean
  selectedIndex: number
  isDraggingOver: boolean
  showSettings: boolean
  hotkey: string
  isRecording: boolean
}

export default function App() {
  const [state, setState] = useState<AppState>({
    query: '', results: [], pinnedApps: [], loading: false,
    selectedIndex: 0, isDraggingOver: false, showSettings: false,
    hotkey: 'Alt+Q', isRecording: false
  })

  const stateRef = useRef(state)
  stateRef.current = state

  const findFirstEmpty = useCallback((apps: any[]) => {
    const used = new Set(apps.map(a => a.grid_index).filter(i => i >= 0))
    let i = 0; while (used.has(i)) i++
    return Math.min(i, 49)
  }, [])

  const loadPinned = useCallback(() => {
    window.api?.getPinnedApps().then(apps => setState(s => ({ ...s, pinnedApps: apps || [] }))).catch(() => {})
  }, [])

  useEffect(() => { 
    loadPinned()
    window.api?.getHotkey().then(h => setState(s => ({ ...s, hotkey: h || 'Alt+Q' }))).catch(() => {})

    // --- 性能优化: 监听增量图标推送 ---
    const removeIconListener = window.api?.onIconUpdate((update: { path: string, icon: string }) => {
      setState(s => ({
        ...s,
        results: s.results.map(item => item.path === update.path ? { ...item, icon: update.icon } : item),
        pinnedApps: s.pinnedApps.map(item => item.path === update.path ? { ...item, icon: update.icon } : item)
      }))
    })

    return () => { if (removeIconListener) removeIconListener() }
  }, [loadPinned])

  // --- 性能优化: 动态 Debounce 提速 ---
  useEffect(() => {
    const delay = setTimeout(async () => {
      const q = state.query.trim()
      if (q) {
        setState(s => ({ ...s, loading: true }))
        try {
          const data = await window.api.search(q)
          setState(s => ({ ...s, results: data || [], loading: false, selectedIndex: 0 }))
        } catch (e) { setState(s => ({ ...s, loading: false })) }
      } else { setState(s => ({ ...s, results: [], selectedIndex: 0 })) }
    }, state.query.length < 2 ? 250 : 100) // 长词搜索更快
    return () => clearTimeout(delay)
  }, [state.query])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const { isRecording, showSettings, query, pinnedApps, results, selectedIndex } = stateRef.current
    if (isRecording) {
      e.preventDefault(); const keys: string[] = []
      if (e.ctrlKey) keys.push('Ctrl'); if (e.shiftKey) keys.push('Shift')
      if (e.altKey) keys.push('Alt'); if (e.metaKey) keys.push('Cmd')
      const key = e.key.toUpperCase()
      if (!['CONTROL', 'SHIFT', 'ALT', 'META'].includes(key)) {
        keys.push(key === ' ' ? 'Space' : key); const h = keys.join('+')
        window.api.setHotkey(h).then(res => {
          if (res.success) setState(s => ({ ...s, hotkey: h, isRecording: false }))
          else { alert(res.message); setState(s => ({ ...s, isRecording: false })) }
        })
      }
      return
    }
    if (showSettings) return
    const isGrid = !query, max = isGrid ? 49 : Math.max(0, results.length - 1)
    if (e.key === 'ArrowRight') setState(s => ({ ...s, selectedIndex: Math.min(s.selectedIndex + 1, max) }))
    if (e.key === 'ArrowLeft') setState(s => ({ ...s, selectedIndex: Math.max(s.selectedIndex - 1, 0) }))
    if (e.key === 'ArrowDown') { e.preventDefault(); setState(s => ({ ...s, selectedIndex: Math.min(s.selectedIndex + (isGrid ? 10 : 1), max) })) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setState(s => ({ ...s, selectedIndex: Math.max(s.selectedIndex - (isGrid ? 10 : 1), 0) })) }
    if (e.key === 'Enter') {
      if (isGrid) {
        const pinned = pinnedApps.find(a => a.grid_index === selectedIndex && a.grid_index >= 0)
        if (pinned) window.api.launch(pinned.path)
      } else if (results[selectedIndex]) window.api.launch(results[selectedIndex].path)
    }
    if (e.key === 'Escape') window.api?.hideWindow?.()
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const handleLaunch = (path: string) => window.api.launch(path)
  
  const handlePin = async (e: any, item: any) => { 
    e.stopPropagation(); const index = findFirstEmpty(state.pinnedApps)
    try {
      const newPinned = await window.api.pinApp(item, index)
      if (newPinned) setState(s => ({ ...s, pinnedApps: newPinned, query: '' }))
    } catch (err) {}
  }

  const handleUnpin = async (e: any, path: string) => { 
    e.stopPropagation()
    try { const res = await window.api.unpinApp(path); if (res) setState(s => ({ ...s, pinnedApps: res })) } catch (e) {}
  }

  const handleReorder = async (path: string, newIndex: number) => {
    try { const res = await window.api.updateAppPosition(path, newIndex); if (res) setState(s => ({ ...s, pinnedApps: res })) } catch (e) {}
  }

  const handleAddFile = async () => { 
    setState(s => ({ ...s, showSettings: false }))
    try {
      const file = await window.api.selectFile()
      if (file) {
        const index = findFirstEmpty(stateRef.current.pinnedApps)
        const newPinned = await window.api.pinApp(file, index)
        if (newPinned) setState(s => ({ ...s, pinnedApps: newPinned }))
      }
    } catch (e) {}
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setState(s => ({ ...s, isDraggingOver: false }))
    const paths = Array.from(e.dataTransfer.files).map(f => f.path)
    if (paths.length > 0) {
      try {
        const newItems = await window.api.processPaths(paths)
        let current = [...stateRef.current.pinnedApps]
        for (const item of newItems) {
          const idx = findFirstEmpty(current); const updated = await window.api.pinApp(item, idx)
          if (updated) current = updated
        }
        setState(s => ({ ...s, pinnedApps: current }))
      } catch (e) {}
    }
  }

  return (
    <div onDragOver={(e) => { e.preventDefault(); setState(s => ({ ...s, isDraggingOver: true })) }} onDragLeave={() => setState(s => ({ ...s, isDraggingOver: false }))} onDrop={handleDrop} className={cn("h-screen w-screen flex flex-col bg-[#EBEBEB] text-[#333] rounded-[12px] border-2 border-[#707070] shadow-2xl overflow-hidden font-sans transition-all duration-300 relative", state.isDraggingOver ? "ring-8 ring-sky-400 ring-inset bg-sky-50" : "")}>
      {state.isDraggingOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-sky-500/20 pointer-events-none">
          <div className="bg-white p-6 rounded-3xl shadow-2xl flex flex-col items-center gap-4 animate-bounce">
            <Plus className="w-12 h-12 text-sky-500" />
            <span className="text-xl font-bold text-sky-600">释放以固定</span>
          </div>
        </div>
      )}
      <SearchBar query={state.query} setQuery={(q) => setState(s => ({ ...s, query: q }))} loading={state.loading} />
      <div className="flex-1 p-6 relative overflow-hidden">
        {!state.query ? (
          <div className="h-full overflow-y-auto custom-scrollbar pr-1">
            {state.pinnedApps.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm gap-4 pt-20">
                <span>你的 Launchpad 是空的。</span>
                <button onClick={handleAddFile} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-all shadow-sm"><Plus className="w-4 h-4" />手动添加应用</button>
              </div>
            ) : (
              <LaunchpadGrid pinnedApps={state.pinnedApps} selectedIndex={state.selectedIndex} onLaunch={handleLaunch} onUnpin={handleUnpin} onReorder={handleReorder} />
            )}
          </div>
        ) : (
          <SearchList results={state.results} selectedIndex={state.selectedIndex} onLaunch={handleLaunch} onPin={handlePin} />
        )}
      </div>
      <div className="p-4 flex justify-between items-center bg-transparent border-t border-[#D6D6D6] relative flex-shrink-0">
        <div className="flex gap-4 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
          <span><kbd className="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-slate-600 font-mono">{state.hotkey}</kbd> 唤起 / ESC 隐藏</span>
        </div>
        <div className="relative">
          {state.showSettings && (
            <div className="absolute bottom-full right-0 mb-2 w-56 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden py-1 z-50 font-sans">
              <button onClick={handleAddFile} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-b border-slate-100">
                <Plus className="w-4 h-4 text-sky-500" /><span>添加快捷方式</span>
              </button>
              <button onClick={() => setState(s => ({ ...s, isRecording: !s.isRecording }))} className={cn("w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors", state.isRecording ? "bg-red-50 text-red-600" : "text-slate-700 hover:bg-slate-50")}>
                <Keyboard className={cn("w-4 h-4", state.isRecording ? "animate-pulse" : "text-sky-500")} />
                <span>{state.isRecording ? '请按组合键...' : '修改唤起热键'}</span>
              </button>
              <div className="px-4 py-2 text-[10px] text-slate-400 font-bold uppercase tracking-wider bg-slate-50 flex justify-between">
                <span>Huo-Launchpad v3.8</span><span className="text-sky-500">{state.hotkey}</span>
              </div>
            </div>
          )}
          <Settings onClick={() => setState(s => ({ ...s, showSettings: !s.showSettings }))} className={cn("w-4 h-4 cursor-pointer transition-all", state.showSettings ? "text-sky-500 rotate-90" : "text-[#888] hover:text-[#444]")} />
        </div>
      </div>
    </div>
  )
}
