import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Box, Handle, Pt, Rect, RedactStyle } from '../types'
import {
  clampOrigin,
  clampRect,
  contains,
  corners,
  handleAt,
  normalizeRect,
  rectOf,
  resizeRect,
} from '../core/geometry'
import { drawRedaction } from '../core/redact'
import { uid } from '../core/uid'

interface Props {
  image: HTMLImageElement
  width: number
  height: number
  boxes: Box[]
  style: RedactStyle
  preview: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (boxes: Box[]) => void
}

type Drag =
  | { kind: 'draw'; start: Pt; current: Pt }
  | { kind: 'move'; id: string; start: Pt; current: Pt; origin: Rect }
  | { kind: 'resize'; id: string; start: Pt; current: Pt; origin: Rect; handle: Handle }

const DRAFT_ID = '__draft__'
const MIN_SIZE = 6

function withCurrent(drag: Drag, current: Pt): Drag {
  switch (drag.kind) {
    case 'draw':
      return { ...drag, current }
    case 'move':
      return { ...drag, current }
    case 'resize':
      return { ...drag, current }
  }
}

function draftRect(drag: Drag, width: number, height: number): Rect {
  if (drag.kind === 'draw') {
    return clampRect(normalizeRect(drag.start, drag.current), width, height)
  }
  if (drag.kind === 'move') {
    const dx = drag.current.x - drag.start.x
    const dy = drag.current.y - drag.start.y
    return clampOrigin(
      { ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy },
      width,
      height,
    )
  }
  return resizeRect(drag.origin, drag.handle, drag.current, width, height)
}

function guideColor(box: Box): string {
  if (box.enabled === false) return '#6b7385'
  if (box.risk === 'medium') return '#f5a524'
  if (box.risk === 'low') return '#8b93a7'
  return '#ff5a68'
}

function drawGuide(ctx: CanvasRenderingContext2D, box: Box, selected: boolean, scale: number): void {
  const unit = 1 / scale
  const color = guideColor(box)
  const disabled = box.enabled === false

  ctx.save()
  ctx.lineWidth = (selected ? 2 : 1) * unit
  ctx.strokeStyle = color
  ctx.setLineDash(disabled ? [3 * unit, 3 * unit] : selected ? [] : [6 * unit, 4 * unit])

  ctx.globalAlpha = disabled ? 0.05 : 0.1
  ctx.fillStyle = color
  ctx.fillRect(box.x, box.y, box.w, box.h)

  ctx.globalAlpha = disabled ? 0.6 : 1
  ctx.strokeRect(box.x, box.y, box.w, box.h)

  if (selected) {
    const size = 7 * unit
    ctx.setLineDash([])
    ctx.fillStyle = color
    for (const [cx, cy] of corners(box)) {
      ctx.fillRect(cx - size / 2, cy - size / 2, size, size)
    }
  }

  ctx.restore()
}

export default function Stage(props: Props) {
  const { image, width, height, boxes, style, preview, selectedId, onSelect, onChange } = props

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const [drag, setDrag] = useState<Drag | null>(null)

  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const measure = () => setViewport({ w: element.clientWidth, h: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const scale = useMemo(() => {
    if (!viewport.w || !viewport.h) return 1
    return Math.min(viewport.w / width, viewport.h / height, 1)
  }, [viewport, width, height])

  const displayBoxes = useMemo<Box[]>(() => {
    if (!drag) return boxes
    const rect = draftRect(drag, width, height)
    if (drag.kind === 'draw') return [...boxes, { id: DRAFT_ID, ...rect }]
    return boxes.map((box) => (box.id === drag.id ? { ...box, ...rect } : box))
  }, [boxes, drag, width, height])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    const cssWidth = Math.max(1, Math.round(width * scale))
    const cssHeight = Math.max(1, Math.round(height * scale))
    canvas.width = Math.round(cssWidth * dpr)
    canvas.height = Math.round(cssHeight * dpr)
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssHeight}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, 0, 0, width, height)

    for (const box of displayBoxes) {
      const isDraft = box.id === DRAFT_ID
      if (preview && !isDraft && box.enabled !== false) {
        drawRedaction(ctx, image, box, box.style ?? style)
      } else {
        drawGuide(ctx, box, box.id === selectedId, scale)
      }
    }
  }, [image, width, height, scale, displayBoxes, style, preview, selectedId])

  const toImage = (event: ReactPointerEvent<HTMLCanvasElement>): Pt => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) / scale,
      y: (event.clientY - rect.top) / scale,
    }
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return
    const point = toImage(event)
    const tolerance = 8 / scale
    const selected = boxes.find((box) => box.id === selectedId)

    if (selected) {
      const handle = handleAt(selected, point, tolerance)
      if (handle) {
        event.currentTarget.setPointerCapture(event.pointerId)
        setDrag({
          kind: 'resize',
          id: selected.id,
          start: point,
          current: point,
          origin: rectOf(selected),
          handle,
        })
        return
      }
    }

    for (let index = boxes.length - 1; index >= 0; index -= 1) {
      const box = boxes[index]
      if (contains(box, point)) {
        onSelect(box.id)
        event.currentTarget.setPointerCapture(event.pointerId)
        setDrag({
          kind: 'move',
          id: box.id,
          start: point,
          current: point,
          origin: rectOf(box),
        })
        return
      }
    }

    onSelect(null)
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ kind: 'draw', start: point, current: point })
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drag) return
    setDrag(withCurrent(drag, toImage(event)))
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drag) return
    const rect = draftRect(drag, width, height)

    if (drag.kind === 'draw') {
      if (rect.w >= MIN_SIZE && rect.h >= MIN_SIZE) {
        const box: Box = { id: uid(), ...rect }
        onChange([...boxes, box])
        onSelect(box.id)
      } else {
        onSelect(null)
      }
    } else {
      // 只是点了一下（没有真正移动/缩放）就不要写历史，否则 Ctrl+Z 会被空操作塞满
      const changed =
        rect.x !== drag.origin.x ||
        rect.y !== drag.origin.y ||
        rect.w !== drag.origin.w ||
        rect.h !== drag.origin.h
      if (changed) {
        onChange(boxes.map((box) => (box.id === drag.id ? { ...box, ...rect } : box)))
      }
    }

    setDrag(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div className="stage" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setDrag(null)}
      />
    </div>
  )
}
