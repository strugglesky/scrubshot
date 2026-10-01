import { describe, expect, it } from 'vitest'
import type { RawPage } from './mapping'
import { mapPage } from './mapping'

const page: RawPage = {
  lines: [{ text: 'ab 12', confidence: 80, bbox: { x0: 0, y0: 0, x1: 200, y1: 20 } }],
  words: [
    { text: 'ab', confidence: 80, bbox: { x0: 0, y0: 0, x1: 40, y1: 20 } },
    { text: '12', confidence: 80, bbox: { x0: 160, y0: 0, x1: 200, y1: 20 } },
  ],
}

describe('mapPage', () => {
  it('keeps reading order when not mirrored', () => {
    const [line] = mapPage(page, 1, false, 200)
    expect(line.words.map((word) => word.text)).toEqual(['ab', '12'])
    expect(line.words[0]).toMatchObject({ x: 0, w: 40 })
  })

  it('keeps reading order after mirroring, but flips the boxes', () => {
    const [line] = mapPage(page, 1, true, 200)

    // 顺序必须还是 ab → 12（真实阅读顺序），不能因为镜像就反过来
    expect(line.words.map((word) => word.text)).toEqual(['ab', '12'])

    // 但位置要翻到另一边：ab 原来在 0..40 → 160..200
    expect(line.words[0]).toMatchObject({ x: 160, w: 40 })
    expect(line.words[1]).toMatchObject({ x: 0, w: 40 })
    expect(line).toMatchObject({ x: 0, w: 200 })
  })

  it('applies the upscale factor before mirroring', () => {
    const [line] = mapPage(page, 2, true, 100)
    // 缩放后 0..40 变成 0..20；镜像到 100 宽的图上 → 80..100
    expect(line.words[0]).toMatchObject({ x: 80, w: 20 })
  })
})
