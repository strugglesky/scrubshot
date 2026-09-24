import type { Rect, TextLine } from '../types'
import type { Finding } from './suggest'

function normalize(value: string): string {
  return value.replace(/[\s-]/g, '').toLowerCase()
}

/** 交叠面积占较小那个矩形的比例 */
function overlapRatio(a: Rect, b: Rect): number {
  const width = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  const minArea = Math.min(a.w * a.h, b.w * b.h)
  return minArea > 0 ? (width * height) / minArea : 0
}

/**
 * 合并两遍识别的结果（整图 + 分块）。
 *
 * 只去掉"同一个值、几乎同一个位置"的重复项；同一个值出现在图上两处时，
 * 两个框都要保留，否则会漏掉一块。
 */
export function mergeFindings(base: Finding[], extra: Finding[]): Finding[] {
  const merged = [...base]

  for (const candidate of extra) {
    const duplicate = merged.some(
      (existing) =>
        normalize(existing.detail) === normalize(candidate.detail) &&
        overlapRatio(existing.rect, candidate.rect) > 0.5,
    )
    if (!duplicate) merged.push(candidate)
  }

  return merged
}

/** 文本行也去重：同一个字符串、位置相近就算同一行 */
export function mergeLines(base: TextLine[], extra: TextLine[]): TextLine[] {
  const merged = [...base]

  for (const candidate of extra) {
    const duplicate = merged.some(
      (existing) =>
        normalize(existing.text) === normalize(candidate.text) &&
        overlapRatio(existing, candidate) > 0.5,
    )
    if (!duplicate) merged.push(candidate)
  }

  return merged
}
