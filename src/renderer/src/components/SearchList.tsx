import { Pin } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

interface SearchItem {
  path: string
  name: string
  icon: string
  extension: string
}

interface SearchListProps {
  results: SearchItem[]
  selectedIndex: number
  onLaunch: (path: string) => void
  onPin: (e: React.MouseEvent, item: SearchItem) => void
}

export default function SearchList({ results, selectedIndex, onLaunch, onPin }: SearchListProps) {
  return (
    <div className="h-full overflow-y-auto custom-scrollbar space-y-1">
      {results.map((item, index) => (
        <div 
          key={item.path + index} 
          onClick={() => onLaunch(item.path)} 
          className={cn(
            "flex items-center gap-4 p-2 rounded-[6px] cursor-pointer group", 
            index === selectedIndex ? "bg-[#B8D8FF]" : "hover:bg-[#E0E0E0]"
          )}
        >
          <img src={item.icon} alt={item.name} className="w-8 h-8 object-contain" />
          <div className="flex-1 min-w-0">
            <div className={cn("text-sm font-semibold truncate", index === selectedIndex ? "text-blue-800" : "text-[#333]")}>
              {item.name}
            </div>
            <div className="text-[10px] text-[#888] truncate">{item.path}</div>
          </div>
          <button 
            onClick={(e) => onPin(e, item)} 
            className={cn(
              "p-1.5 rounded transition-all opacity-0 group-hover:opacity-100", 
              index === selectedIndex ? "bg-blue-500 text-white opacity-100" : "bg-slate-200 text-slate-500 hover:bg-blue-500 hover:text-white"
            )}
          >
            <Pin className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
