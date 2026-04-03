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
    // 审计建议 #5: 增加卸载清理逻辑
    // @ts-ignore
    const removeListener = window.api.onWindowShown(() => {
      setQuery('')
      setTimeout(() => inputRef.current?.focus(), 50)
    })

    return () => {
      if (removeListener) removeListener()
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
