import type { Rect } from '../types'

/**
 * 把"在水平翻转后的画布上"量出来的矩形，映射回原图坐标。
 *
 * 翻转画布时只有 x 方向镜像：x' = width - (x + w)。
 * 这个函数单独抽出来，是因为这里的 off-by-width 是最容易错又最难肉眼发现的地方。
 */
export function mirrorRect(rect: Rect, width: number): Rect {
  return { x: width - rect.x - rect.w, y: rect.y, w: rect.w, h: rect.h }
}
