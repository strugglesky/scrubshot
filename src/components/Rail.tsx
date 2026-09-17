import type { BatchItem } from '../types'

interface Props {
  items: BatchItem[]
  activeId: string | null
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}

export default function Rail({ items, activeId, onSelect, onRemove }: Props) {
  return (
    <nav className="rail" aria-label="图片队列">
      {items.map((item) => {
        const count = item.boxes.filter((box) => box.enabled !== false).length
        return (
          <div key={item.id} className={`rail-item ${item.id === activeId ? 'active' : ''}`}>
            <button
              type="button"
              className="rail-thumb"
              onClick={() => onSelect(item.id)}
              title={item.name}
            >
              {item.thumb ? <img src={item.thumb} alt={item.name} /> : null}
              <span className={`rail-status ${item.status}`} />
              {count > 0 && <span className="rail-count">{count}</span>}
            </button>
            <button
              type="button"
              className="rail-remove"
              onClick={() => onRemove(item.id)}
              aria-label="移除这张图"
            >
              ×
            </button>
          </div>
        )
      })}
    </nav>
  )
}
