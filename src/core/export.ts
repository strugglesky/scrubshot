import type { Box, ExportFormat, RedactStyle } from '../types'
import { drawRedaction } from './redact'

/**
 * 按原始分辨率重新绘制并编码。
 *
 * 关于 EXIF：canvas.toBlob 生成的是全新的位图数据，不会携带原始文件的
 * EXIF / GPS / 设备信息，也不会携带 EXIF 缩略图（那是一张原图的小图，
 * 不清掉就等于没打码）。代价是 ICC 也不保留 —— 需要色彩保真时，后续
 * 版本再单独处理。
 */
export async function renderBlob(
  image: CanvasImageSource,
  width: number,
  height: number,
  boxes: Box[],
  style: RedactStyle,
  format: ExportFormat,
  quality = 0.92,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 2D 画布')

  ctx.drawImage(image, 0, 0, width, height)
  for (const box of boxes) {
    drawRedaction(ctx, image, box, box.style ?? style)
  }

  const mime =
    format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp'
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality))
  if (!blob) throw new Error('编码失败')
  return blob
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function baseName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export function extensionFor(format: ExportFormat): string {
  return format === 'jpeg' ? 'jpg' : format
}
