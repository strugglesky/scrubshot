import { describe, expect, it } from 'vitest'
import { mirrorRect } from './mirror'

describe('mirrorRect', () => {
  it('flips x against the image width', () => {
    expect(mirrorRect({ x: 10, y: 5, w: 20, h: 8 }, 100)).toEqual({ x: 70, y: 5, w: 20, h: 8 })
  })

  it('is its own inverse', () => {
    const once = mirrorRect({ x: 12, y: 0, w: 30, h: 10 }, 200)
    expect(mirrorRect(once, 200)).toEqual({ x: 12, y: 0, w: 30, h: 10 })
  })

  it('keeps a box that spans the full width in place', () => {
    expect(mirrorRect({ x: 0, y: 0, w: 100, h: 10 }, 100)).toEqual({ x: 0, y: 0, w: 100, h: 10 })
  })
})
