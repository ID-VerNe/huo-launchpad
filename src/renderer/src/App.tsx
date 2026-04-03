import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Settings, Keyboard } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import SearchBar from './components/SearchBar'
import LaunchpadGrid from './components/LaunchpadGrid'
import SearchList from './components/SearchList'

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

export default function App() {
  // 合并相关状态 (审计建议 #32)
  const [state, setState] = useState({
    query: '',
    results: [] as any[],
    pinnedApps: [] as any[],
    loading: false,
    selectedIndex: 0,
    isDraggingOver: false,
    showSettings: false,
    hotkey: 'Alt+Q',
    isRecording: false
  })

  const stateRef = useRef(state)
  stateRef.current = state

  const loadPinned = useCallback(() => {
    // @ts-ignore (审计建议 #15: 错误处理)
    window.api.getPinnedApps().then(apps => setState(s => ({ ...s, pinnedApps: apps }))).catch(console.error)
  }, [])

  useEffect(() => { 
    loadPinned()
    // @ts-ignore
    window.api.getHotkey().then(h => setState(s => ({ ...s, hotkey: h })))
  }, [loadPinned])

  // 搜索逻辑：防抖优化 (审计建议 #28)
  useEffect(() => {
    const delay = setTimeout(async () => {
      const q = state.query.trim()
      if (q) {
        setState(s => ({ ...s, loading: true }))
        try {
          // @ts-ignore
          const data = await window.api.search(q)
          setState(s => ({ ...s, results: data || [], loading: false, selectedIndex: 0 }))
        } catch (e) {
          setState(s => ({ ...s, loading: false }))
        }
      } else {
        setState(s => ({ ...s, results: [], selectedIndex: 0 }))
      }
    }, 150)
    return () => clearTimeout(delay)
  }, [state.query])

  // 键盘导航 (审计建议 #8: 提取处理函数)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const { isRecording, showSettings, query, pinnedApps, results, selectedIndex } = stateRef.current
    
    if (isRecording) {
      e.preventDefault()
      const keys: string[] = []
      if (e.ctrlKey) keys.push('Ctrl')
      if (e.shiftKey) keys.push('Shift')
      if (e.altKey) keys.push('Alt')
      if (e.metaKey) keys.push('Cmd')
      const key = e.key.toUpperCase()
      // 审计建议 #30: includes
      if (!['CONTROL', 'SHIFT', 'ALT', 'META'].includes(key)) {
        keys.push(key === ' ' ? 'Space' : key)
        const newHotkey = keys.join('+')
        // @ts-ignore
        window.api.setHotkey(newHotkey).then(res => {
          if (res.success) setState(s => ({ ...s, hotkey: newHotkey, isRecording: false }))
          else { alert(res.message); setState(s => ({ ...s, isRecording: false })) }
        })
      }
      return
    }

    if (showSettings) return

    const isGrid = !query
    const maxIndex = isGrid ? 49 : results.length - 1
    if (maxIndex < 0) return

    if (e.key === 'ArrowRight') setState(s => ({ ...s, selectedIndex: Math.min(s.selectedIndex + 1, maxIndex) }))
    if (e.key === 'ArrowLeft') setState(s => ({ ...s, selectedIndex: Math.max(s.selectedIndex - 1, 0) }))
    
    // 审计建议 #26: 优化垂直导航
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setState(s => ({ ...s, selectedIndex: Math.min(s.selectedIndex + (isGrid ? 10 : 1), maxIndex) }))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setState(s => ({ ...s, selectedIndex: Math.max(s.selectedIndex - (isGrid ? 10 : 1), 0) }))
    }
    
    if (e.key === 'Enter') {
      // 审计建议 #27: 边界检查
      if (isGrid) {
        const pinned = pinnedApps.find(a => a.grid_index === selectedIndex)
        if (pinned) window.api.launch(pinned.path)
      } else if (results[selectedIndex]) {
        window.api.launch(results[selectedIndex].path)
      }
    }
    if (e.key === 'Escape') { // @ts-ignore
      window.api.hideWindow()
    }
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // 计算空位逻辑 (审计建议 #24: 提取复用)
  const findFirstEmpty = (apps: any[]) => {
    const indices = apps.map(a => a.grid_index)
    let i = 0; while (indices.includes(i)) i++
    return i
  }

  const handleLaunch = (path: string) => { // @ts-ignore
    window.api.launch(path) }
  
  const handlePin = async (e: any, item: any) => { 
    e.stopPropagation()
    const index = findFirstEmpty(state.pinnedApps)
    // @ts-ignore
    const newPinned = await window.api.pinApp(item, index)
    setState(s => ({ ...s, pinnedApps: newPinned, query: '' }))
  }

  const handleUnpin = async (e: any, path: string) => { 
    e.stopPropagation(); // @ts-ignore
    const newPinned = await window.api.unpinApp(path)
    setState(s => ({ ...s, pinnedApps: newPinned }))
  }

  const handleReorder = async (path: string, newIndex: number) => {
    // @ts-ignore
    const newPinned = await window.api.updateAppPosition(path, newIndex)
    setState(s => ({ ...s, pinnedApps: newPinned }))
  }

  const handleAddFile = async () => { 
    setState(s => ({ ...s, showSettings: false }))
    // @ts-ignore
    const file = await window.api.selectFile()
    if (file) { 
      const index = findFirstEmpty(state.pinnedApps)
      // @ts-ignore
      const newPinned = await window.api.pinApp(file, index)
      setState(s => ({ ...s, pinnedApps: newPinned }))
    } 
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setState(s => ({ ...s, isDraggingOver: false }))
    const paths = Array.from(e.dataTransfer.files).map(f => f.path)
    if (paths.length > 0) {
      // @ts-ignore
      const newItems = await window.api.processPaths(paths)
      // 审计建议 #9: 优化批量固定逻辑
      let currentApps = [...state.pinnedApps]
      for (const item of newItems) {
        const index = findFirstEmpty(currentApps)
        // @ts-ignore
        currentApps = await window.api.pinApp(item, index)
      }
      setState(s => ({ ...s, pinnedApps: currentApps }))
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
          <LaunchpadGrid pinnedApps={state.pinnedApps} selectedIndex={state.selectedIndex} onLaunch={handleLaunch} onUnpin={handleUnpin} onReorder={handleReorder} />
        ) : (
          <SearchList results={state.results} selectedIndex={state.selectedIndex} onLaunch={handleLaunch} onPin={handlePin} />
        )}
      </div>
      <div className="p-4 flex justify-between items-center bg-transparent border-t border-[#D6D6D6] relative">
        <div className="flex gap-4 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
          <span><kbd className="bg-slate-100 px-1 py-0.5 rounded border border-slate-300 text-slate-600">{state.hotkey}</kbd> 唤起 / ESC 隐藏</span>
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
                <span>Huo-Launchpad v3.6</span><span className="text-sky-500">{state.hotkey}</span>
              </div>
            </div>
          )}
          <Settings onClick={() => setState(s => ({ ...s, showSettings: !s.showSettings }))} className={cn("w-4 h-4 cursor-pointer transition-all", state.showSettings ? "text-sky-500 rotate-90" : "text-[#888] hover:text-[#444]")} />
        </div>
      </div>
    </div>
  )
}
