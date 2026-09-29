import type { Rect, TextLine } from '../types'
import { mirrorRect } from './mirror'

export interface RawBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface RawLine {
  text: string
  confidence: number
  bbox: RawBox
}

export interface RawWord {
  text: string
  confidence: number
  bbox: RawBox
}

export interface RawPage {
  lines: RawLine[]
  words: RawWord[]
}

/**
 * 把 OCR 的原始输出换算成"原图坐标"的文本行。
 *
 * 顺序很关键：**先在翻转空间里排序，再整体镜像**。
 * 反过来做的话，排序得到的是从右往左的顺序，后面把词对齐到行文本时
 * 会错位，打码框会贴到毫不相干的位置。
 */
export function mapPage(
  page: RawPage,
  scale: number,
  mirrored: boolean,
  width: number,
): TextLine[] {
  const toRect = (box: RawBox): Rect => ({
    x: box.x0 / scale,
    y: box.y0 / scale,
    w: (box.x1 - box.x0) / scale,
    h: (box.y1 - box.y0) / scale,
  })

  const words = page.words
    .map((word) => ({
      ...toRect(word.bbox),
      text: (word.text ?? '').replace(/\s+/g, ' ').trim(),
      confidence: word.confidence ?? 0,
    }))
    .filter((word) => word.text.length > 0 && word.w > 0 && word.h > 0)

  const lines: TextLine[] = page.lines
    .map((line) => {
      const rect = toRect(line.bbox)
      const own = words
        .filter((word) => {
          const cx = word.x + word.w / 2
          const cy = word.y + word.h / 2
          return cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h
        })
        .sort((a, b) => a.x - b.x)

      return {
        ...rect,
        text: (line.text ?? '').replace(/\s+/g, ' ').trim(),
        confidence: line.confidence ?? 0,
        words: own,
      }
    })
    .filter((line) => line.text.length > 0 && line.w > 0 && line.h > 0)

  if (!mirrored) return lines

  return lines.map((line) => ({
    ...line,
    ...mirrorRect(line, width),
    words: line.words.map((word) => ({ ...word, ...mirrorRect(word, width) })),
  }))
}
