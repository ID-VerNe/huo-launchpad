import { useRef, useEffect } from 'react'
import { Loader2 } from 'lucide-react'

interface SearchBarProps {
  query: string
  setQuery: (q: string) => void
  loading: boolean
}

export default function SearchBar({ query, setQuery, loading }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // --- 修复 TODO 10: 防重复监听与卸载清理 ---
    let removeListener: (() => void) | undefined

    // @ts-ignore
    if (window.api?.onWindowShown) {
      // @ts-ignore
      removeListener = window.api.onWindowShown(() => {
        setQuery('')
        // 增加延时确保 DOM 节点已在活跃窗口中
        setTimeout(() => {
          if (inputRef.current) inputRef.current.focus()
        }, 60)
      })
    }

    return () => {
      if (removeListener) {
        removeListener()
        removeListener = undefined
      }
    }
  }, [setQuery])

  return (
    <div className="bg-[#D6D6D6] h-[60px] flex items-center px-4 mx-2 mt-2 rounded-t-[8px] border-b border-[#C0C0C0] relative flex-shrink-0">
      <input
        ref={inputRef}
        autoFocus
        className="w-full bg-transparent border-none outline-none text-xl font-normal placeholder:text-[#999] px-2"
        placeholder="|"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {loading && <Loader2 className="w-5 h-5 animate-spin text-[#666]" />}
    </div>
  )
}
