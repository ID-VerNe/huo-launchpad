import { Trash2, Folder, FileText } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { useSortable, SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay, defaultDropAnimationSideEffects } from '@dnd-kit/core'
import { useState, useMemo } from 'react'

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

function AppIcon({ item, isPlaceholder, isOverlay }: any) {
  if (!item) return null
  
  // 核心视觉策略：
  // 1. 如果检测到是文件夹（包括快捷方式指向的文件夹），统一强制使用高质量 SVG 文件夹图标
  // 2. 如果系统提取的 icon 过短（代表无效或空白），则使用文件 SVG 兜底
  const isFolder = item.extension === 'folder'
  const isInvalidIcon = !item.icon || item.icon.length < 500
  const showFallback = isFolder || isInvalidIcon

  return (
    <div className={cn(
      "flex flex-col items-center justify-start p-2 rounded-[8px] w-full h-[100px] relative transition-all duration-200",
      isPlaceholder ? "opacity-20" : "opacity-100",
      isOverlay ? "scale-110 shadow-2xl bg-[#B8D8FF]/80 backdrop-blur-sm rotate-2 ring-2 ring-blue-400/30" : ""
    )}>
      <div className="w-12 h-12 mb-2 flex items-center justify-center pointer-events-none">
        {showFallback ? (
          isFolder ? (
            <Folder className="w-10 h-10 text-yellow-500 fill-yellow-400/30 drop-shadow-sm" />
          ) : (
            <FileText className="w-10 h-10 text-blue-400/80 drop-shadow-sm" />
          )
        ) : (
          <img src={item.icon} alt={item.name} className="w-10 h-10 object-contain drop-shadow-md" />
        )}
      </div>
      <span className="text-[11px] text-center w-full truncate px-1 text-[#444] font-semibold pointer-events-none tracking-tight">
        {item.name}
      </span>
    </div>
  )
}

function GridSlot({ item, index, selectedIndex, onLaunch, onUnpin }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ 
    id: item ? item.path : `empty-${index}`,
    disabled: !item 
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? 'none' : transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(item ? { ...attributes, ...listeners } : {})}
      onClick={() => item && onLaunch(item.path)}
      className={cn(
        "relative rounded-[8px] transition-all duration-200 cursor-pointer group w-full h-[100px] touch-none",
        index === selectedIndex && !isDragging ? "bg-[#B8D8FF] shadow-inner" : "hover:bg-[#E0E0E0]/50",
        !item && "border border-dashed border-transparent hover:border-[#C0C0C0]/50"
      )}
    >
      {item ? (
        <>
          <AppIcon item={item} isPlaceholder={isDragging} />
          <button 
            onClick={(e) => { e.stopPropagation(); onUnpin(e, item.path) }}
            className="absolute -top-1 -right-1 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 scale-75 hover:scale-90 transition-all z-20 pointer-events-auto shadow-sm"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center opacity-0 group-hover:opacity-10 pointer-events-none">
          <div className="w-6 h-6 rounded-full bg-[#333]" />
        </div>
      )}
    </div>
  )
}

export default function LaunchpadGrid({ pinnedApps, selectedIndex, onLaunch, onUnpin, onReorder }: any) {
  const [activeItem, setActiveItem] = useState<any>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const grid = useMemo(() => {
    const pinnedMap = new Map(pinnedApps.map((a: any) => [a.grid_index, a]))
    return Array.from({ length: 50 }, (_, i) => pinnedMap.get(i) || null)
  }, [pinnedApps])

  const handleDragStart = (event: any) => {
    const item = pinnedApps.find((a: any) => a.path === event.active.id)
    if (item) setActiveItem(item)
  }

  const handleDragEnd = (event: any) => {
    const { active, over } = event
    setActiveItem(null)
    if (over && active.id !== over.id) {
      const targetId = String(over.id)
      const newIndex = targetId.startsWith('empty-') 
        ? parseInt(targetId.split('-')[1]) 
        : grid.findIndex(g => g?.path === targetId)
      if (!isNaN(newIndex) && newIndex >= 0 && newIndex < 50) onReorder(active.id, newIndex)
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <SortableContext items={grid.map((item, i) => item ? item.path : `empty-${i}`)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-10 gap-y-4 gap-x-2">
          {grid.map((item, index) => (
            <GridSlot key={item ? item.path : `empty-${index}`} item={item} index={index} selectedIndex={selectedIndex} onLaunch={onLaunch} onUnpin={onUnpin} />
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={{ sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.5' } } }) }}>
        {activeItem ? <div className="w-[90px] pointer-events-none select-none"><AppIcon item={activeItem} isOverlay /></div> : null}
      </DragOverlay>
    </DndContext>
  )
}
