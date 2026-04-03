import { Trash2 } from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { useSortable, SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay, defaultDropAnimationSideEffects } from '@dnd-kit/core'
import { useState } from 'react'

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

// --- 纯净图标组件 (用于复用) ---
function AppIcon({ item, isPlaceholder, isOverlay }: any) {
  if (!item) return null
  return (
    <div className={cn(
      "flex flex-col items-center justify-start p-2 rounded-[8px] w-full h-[100px] relative",
      isPlaceholder ? "opacity-20" : "opacity-100",
      isOverlay ? "scale-110 shadow-2xl bg-[#B8D8FF] rotate-3" : ""
    )}>
      <div className="w-12 h-12 mb-2 flex items-center justify-center pointer-events-none">
        <img src={item.icon} alt={item.name} className="w-10 h-10 object-contain drop-shadow-md" />
      </div>
      <span className="text-[11px] text-center w-full truncate px-1 text-[#444] font-medium pointer-events-none">
        {item.name}
      </span>
    </div>
  )
}

// --- 槽位组件 ---
function GridSlot({ item, index, selectedIndex, onLaunch, onUnpin }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ 
    id: item ? item.path : `empty-${index}`,
    disabled: !item 
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? 'none' : transition, // 关键：拖拽时禁用过渡
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(item ? { ...attributes, ...listeners } : {})}
      onClick={() => item && onLaunch(item.path)}
      className={cn(
        "relative rounded-[8px] transition-all duration-200 cursor-pointer group w-full h-[100px]",
        index === selectedIndex && !isDragging ? "bg-[#B8D8FF]" : "hover:bg-[#E0E0E0]/50",
        !item && "border border-dashed border-transparent hover:border-[#C0C0C0]"
      )}
    >
      {item ? (
        <>
          <AppIcon item={item} isPlaceholder={isDragging} />
          <button 
            onClick={(e) => { e.stopPropagation(); onUnpin(e, item.path) }}
            className="absolute -top-1 -right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 scale-75 transition-all z-20 pointer-events-auto"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center opacity-0 group-hover:opacity-20 pointer-events-none">
          <div className="w-8 h-8 rounded-full bg-[#666]" />
        </div>
      )}
    </div>
  )
}

export default function LaunchpadGrid({ pinnedApps, selectedIndex, onLaunch, onUnpin, onReorder }: any) {
  const [activeItem, setActiveItem] = useState<any>(null)
  
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }) // 更敏感的指针传感器
  )

  const grid = Array.from({ length: 50 }, (_, i) => {
    return pinnedApps.find((a: any) => a.grid_index === i) || null
  })

  const handleDragStart = (event: any) => {
    const item = pinnedApps.find((a: any) => a.path === event.active.id)
    setActiveItem(item)
  }

  const handleDragEnd = (event: any) => {
    const { active, over } = event
    setActiveItem(null)
    if (over && active.id !== over.id) {
      const newIndex = parseInt(over.id.startsWith('empty-') ? over.id.split('-')[1] : grid.findIndex(g => g?.path === over.id))
      if (!isNaN(newIndex)) {
        onReorder(active.id, newIndex)
      }
    }
  }

  return (
    <DndContext 
      sensors={sensors} 
      collisionDetection={closestCenter} 
      onDragStart={handleDragStart} 
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={grid.map((item, i) => item ? item.path : `empty-${i}`)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-10 gap-y-4 gap-x-2">
          {grid.map((item, index) => (
            <GridSlot 
              key={item ? item.path : `empty-${index}`} 
              item={item} 
              index={index} 
              selectedIndex={selectedIndex} 
              onLaunch={onLaunch} 
              onUnpin={onUnpin} 
            />
          ))}
        </div>
      </SortableContext>

      {/* 核心性能优化：拖拽浮层 */}
      <DragOverlay dropAnimation={{
        sideEffects: defaultDropAnimationSideEffects({
          styles: { active: { opacity: '0.5' } }
        })
      }}>
        {activeItem ? (
          <div className="w-[90px]"> {/* 固定宽度防止浮层抖动 */}
            <AppIcon item={activeItem} isOverlay />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
