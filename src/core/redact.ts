import type { Rect, RedactStyle } from '../types'

/**
 * 在 ctx 上对 rect 区域执行打码。
 *
 * 重要：默认样式是 solid（不透明色块）。模糊与像素化在特定条件下
 * 可被算法还原，因此只作为用户显式选择提供，UI 侧必须给出警告。
 */
export function drawRedaction(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  rect: Rect,
  style: RedactStyle,
): void {
  const { x, y, w, h } = rect
  if (w <= 0 || h <= 0) return

  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()

  if (style === 'solid') {
    ctx.fillStyle = '#000000'
    ctx.fillRect(x, y, w, h)
  } else if (style === 'blur') {
    ctx.filter = 'blur(16px)'
    ctx.drawImage(source, 0, 0)
    ctx.filter = 'none'
  } else {
    pixelate(ctx, source, rect)
  }

  ctx.restore()
}

function pixelate(ctx: CanvasRenderingContext2D, source: CanvasImageSource, rect: Rect): void {
  const { x, y, w, h } = rect
  const block = 14
  const sw = Math.max(1, Math.round(w / block))
  const sh = Math.max(1, Math.round(h / block))

  const tmp = document.createElement('canvas')
  tmp.width = sw
  tmp.height = sh
  const tctx = tmp.getContext('2d')
  if (!tctx) return

  tctx.imageSmoothingEnabled = true
  tctx.drawImage(source, x, y, w, h, 0, 0, sw, sh)

  const previous = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, h)
  ctx.imageSmoothingEnabled = previous
}
