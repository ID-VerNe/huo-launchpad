import { useState, useEffect } from 'react'
import { Plus, Settings, Pin, Keyboard } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import SearchBar from './components/SearchBar'
import LaunchpadGrid from './components/LaunchpadGrid'
import SearchList from './components/SearchList'

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

export default function App() {
  const [query, setQuery] = useState(''), [results, setResults] = useState<any[]>([])
  const [pinnedApps, setPinnedApps] = useState<any[]>([]), [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0), [isDraggingOver, setIsDraggingOver] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [hotkey, setHotkey] = useState('Alt+Q'), [isRecording, setIsRecording] = useState(false)

  const loadPinned = () => { // @ts-ignore
    window.api.getPinnedApps().then(setPinnedApps) }

  useEffect(() => { 
    loadPinned()
    // @ts-ignore
    window.api.getHotkey().then(setHotkey)
  }, [])

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (query.trim()) {
        setLoading(true); // @ts-ignore
        const data = await window.api.search(query)
        setResults(data || []); setLoading(false); setSelectedIndex(0)
      } else { setResults([]); setSelectedIndex(0) }
    }, 200)
    return () => clearTimeout(delayDebounceFn)
  }, [query])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isRecording) {
        e.preventDefault()
        const keys: string[] = []
        if (e.ctrlKey) keys.push('Ctrl')
        if (e.shiftKey) keys.push('Shift')
        if (e.altKey) keys.push('Alt')
        if (e.metaKey) keys.push('Cmd')
        const key = e.key.toUpperCase()
        if (['CONTROL', 'SHIFT', 'ALT', 'META'].indexOf(key) === -1) {
          keys.push(key === ' ' ? 'Space' : key)
          const newHotkey = keys.join('+')
          setHotkey(newHotkey)
          // @ts-ignore
          window.api.setHotkey(newHotkey).then(res => {
            if (!res.success) alert(res.message)
            setIsRecording(false)
          })
        }
        return
      }
      if (showSettings) return
      const isGrid = !query, items = isGrid ? Array.from({length:50}) : results
      if (e.key === 'ArrowRight') setSelectedIndex(p => Math.min(p + 1, items.length - 1))
      if (e.key === 'ArrowLeft') setSelectedIndex(p => Math.max(p - 1, 0))
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(p => Math.min(p + (isGrid ? 10 : 1), items.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(p => Math.max(p - (isGrid ? 10 : 1), 0)) }
      if (e.key === 'Enter') {
        const pinned = pinnedApps.find(a => a.grid_index === selectedIndex)
        if (isGrid && pinned) handleLaunch(pinned.path)
        else if (!isGrid && results[selectedIndex]) handleLaunch(results[selectedIndex].path)
      }
      if (e.key === 'Escape') { // @ts-ignore
        window.api.hideWindow() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [results, pinnedApps, selectedIndex, query, showSettings, isRecording])

  const handleLaunch = (path: string) => { // @ts-ignore
    window.api.launch(path) }
  
  const handlePin = async (e: any, item: any) => { 
    e.stopPropagation()
    const existingIndices = pinnedApps.map(a => a.grid_index)
    let firstEmpty = 0
    while (existingIndices.includes(firstEmpty)) firstEmpty++
    // @ts-ignore
    const newPinned = await window.api.pinApp(item, firstEmpty)
    setPinnedApps(newPinned); setQuery('')
  }

  const handleUnpin = async (e: any, path: string) => { 
    e.stopPropagation(); // @ts-ignore
    const newPinned = await window.api.unpinApp(path); setPinnedApps(newPinned) 
  }

  const handleReorder = async (path: string, newIndex: number) => {
    // @ts-ignore
    const newPinned = await window.api.updateAppPosition(path, newIndex)
    setPinnedApps(newPinned)
  }

  const handleAddFile = async () => { 
    setShowSettings(false); // @ts-ignore
    const file = await window.api.selectFile()
    if (file) { 
      const existingIndices = pinnedApps.map(a => a.grid_index)
      let firstEmpty = 0
      while (existingIndices.includes(firstEmpty)) firstEmpty++
      // @ts-ignore
      const newPinned = await window.api.pinApp(file, firstEmpty)
      setPinnedApps(newPinned) 
    } 
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false)
    const paths = Array.from(e.dataTransfer.files).map(f => f.path)
    if (paths.length > 0) { // @ts-ignore
      const newItems = await window.api.processPaths(paths)
      // @ts-ignore
      for (const item of newItems) {
        const existingIndices = pinnedApps.map(a => a.grid_index)
        let firstEmpty = 0
        while (existingIndices.includes(firstEmpty)) firstEmpty++
        // @ts-ignore
        await window.api.pinApp(item, firstEmpty)
      }
      loadPinned()
    }
  }

  return (
    <div onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true) }} onDragLeave={() => setIsDraggingOver(false)} onDrop={handleDrop} className={cn("h-screen w-screen flex flex-col bg-[#EBEBEB] text-[#333] rounded-[12px] border-2 border-[#707070] shadow-2xl overflow-hidden font-sans transition-all duration-300 relative", isDraggingOver ? "ring-8 ring-sky-400 ring-inset bg-sky-50" : "")}>
      {isDraggingOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-sky-500/20 pointer-events-none">
          <div className="bg-white p-6 rounded-3xl shadow-2xl flex flex-col items-center gap-4 animate-bounce">
            <Plus className="w-12 h-12 text-sky-500" />
            <span className="text-xl font-bold text-sky-600">释放以固定</span>
          </div>
        </div>
      )}
      <SearchBar query={query} setQuery={setQuery} loading={loading} />
      <div className="flex-1 p-6 relative overflow-hidden">
        {!query ? (
          <div className="h-full overflow-y-auto custom-scrollbar">
            {pinnedApps.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm gap-4 pt-20">
                <span>你的 Launchpad 是空的。</span>
                <button onClick={handleAddFile} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-all shadow-sm"><Plus className="w-4 h-4" />手动添加应用</button>
              </div>
            ) : (
              <LaunchpadGrid pinnedApps={pinnedApps} selectedIndex={selectedIndex} onLaunch={handleLaunch} onUnpin={handleUnpin} onReorder={handleReorder} />
            )}
          </div>
        ) : (
          <SearchList results={results} selectedIndex={selectedIndex} onLaunch={handleLaunch} onPin={handlePin} />
        )}
      </div>
      <div className="p-4 flex justify-between items-center bg-transparent border-t border-[#D6D6D6] relative">
        <div className="flex gap-4 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
          <span><kbd className="bg-slate-100 px-1 py-0.5 rounded border border-slate-300 text-slate-600">{hotkey}</kbd> 唤起 / ESC 隐藏</span>
        </div>
        <div className="relative">
          {showSettings && (
            <div className="absolute bottom-full right-0 mb-2 w-56 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden py-1 z-50 font-sans">
              <button onClick={handleAddFile} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-b border-slate-100">
                <Plus className="w-4 h-4 text-sky-500" /><span>添加快捷方式</span>
              </button>
              <button 
                onClick={() => setIsRecording(!isRecording)}
                className={cn("w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors", isRecording ? "bg-red-50 text-red-600" : "text-slate-700 hover:bg-slate-50")}
              >
                <Keyboard className={cn("w-4 h-4", isRecording ? "animate-pulse" : "text-sky-500")} />
                <span>{isRecording ? '请按组合键...' : '修改唤起热键'}</span>
              </button>
              <div className="px-4 py-2 text-[10px] text-slate-400 font-bold uppercase tracking-wider bg-slate-50 flex justify-between">
                <span>Huo-Launchpad v3.5</span>
                <span className="text-sky-500">{hotkey}</span>
              </div>
            </div>
          )}
          <Settings onClick={() => setShowSettings(!showSettings)} className={cn("w-4 h-4 cursor-pointer transition-all", showSettings ? "text-sky-500 rotate-90" : "text-[#888] hover:text-[#444]")} />
        </div>
      </div>
    </div>
  )
}
