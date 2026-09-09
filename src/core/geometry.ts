import type { Box, Handle, Pt, Rect } from '../types'

/** 两个点构成的归一化矩形（可能来自任意方向的拖拽）。 */
export function normalizeRect(a: Pt, b: Pt): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  }
}

export function contains(r: Rect, p: Pt): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

/** 把矩形裁进画布内（会改变尺寸，用于"拖拽新建"）。 */
export function clampRect(r: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.min(r.x, width))
  const y = Math.max(0, Math.min(r.y, height))
  const w = Math.max(0, Math.min(r.w, width - x))
  const h = Math.max(0, Math.min(r.h, height - y))
  return { x, y, w, h }
}

/** 只平移、不改尺寸（用于"拖动已有框"）。 */
export function clampOrigin(r: Rect, width: number, height: number): Rect {
  return {
    ...r,
    x: Math.max(0, Math.min(r.x, width - r.w)),
    y: Math.max(0, Math.min(r.y, height - r.h)),
  }
}

export function corners(box: Rect): Array<[number, number]> {
  return [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ]
}

/** 命中四个角的控制点（tol 为图像坐标下的容差）。 */
export function handleAt(box: Box, p: Pt, tol: number): Handle | null {
  const candidates: Array<[Handle, number, number]> = [
    ['nw', box.x, box.y],
    ['ne', box.x + box.w, box.y],
    ['sw', box.x, box.y + box.h],
    ['se', box.x + box.w, box.y + box.h],
  ]
  for (const [handle, cx, cy] of candidates) {
    if (Math.abs(p.x - cx) <= tol && Math.abs(p.y - cy) <= tol) return handle
  }
  return null
}

/** 拖拽某个角，返回归一化后的矩形。 */
export function resizeRect(
  origin: Rect,
  handle: Handle,
  p: Pt,
  width: number,
  height: number,
): Rect {
  const right = origin.x + origin.w
  const bottom = origin.y + origin.h
  const px = Math.max(0, Math.min(p.x, width))
  const py = Math.max(0, Math.min(p.y, height))

  let x = origin.x
  let y = origin.y
  let w = origin.w
  let h = origin.h

  if (handle === 'nw') {
    x = px
    y = py
    w = right - px
    h = bottom - py
  } else if (handle === 'ne') {
    y = py
    w = px - origin.x
    h = bottom - py
  } else if (handle === 'sw') {
    x = px
    w = right - px
    h = py - origin.y
  } else {
    w = px - origin.x
    h = py - origin.y
  }

  return normalizeSize({ x, y, w, h })
}

function normalizeSize(r: Rect): Rect {
  return {
    x: r.w < 0 ? r.x + r.w : r.x,
    y: r.h < 0 ? r.y + r.h : r.y,
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  }
}

export function rectOf(box: Box): Rect {
  return { x: box.x, y: box.y, w: box.w, h: box.h }
}
