import { describe, expect, it } from 'vitest'
import type { FindingLike } from './score'
import { scoreCase, summarize } from './score'

const finding = (detail: string): FindingLike => ({ detail, label: 'x', risk: 'high' })

// 测试用占位值：13800138000 是文档中通用的示例号码；
// 证件类用全 0 串，确保不会与任何真实证件号重合。
// 本项目做的是脱敏，测试数据不应该长得像真实个人信息。

describe('scoreCase', () => {
  it('counts an exact match as a hit', () => {
    const result = scoreCase('a.png', ['13800138000'], [finding('13800138000')], false)
    expect(result.hits).toEqual(['13800138000'])
    expect(result.misses).toEqual([])
    expect(result.extra).toEqual([])
  })

  it('ignores spaces and dashes inserted by OCR', () => {
    const result = scoreCase('a.png', ['13800138000'], [finding('138 0013 8000')], false)
    expect(result.hits).toHaveLength(1)
  })

  it('matches when the finding carries a prefix', () => {
    const result = scoreCase('a.png', ['000000000000000000'], [finding('身份证:000000000000000000')], false)
    expect(result.hits).toHaveLength(1)
  })

  it('reports a miss and keeps unmatched findings as extra', () => {
    const result = scoreCase('a.png', ['13800138000'], [finding('hi@example.com')], false)
    expect(result.misses).toEqual(['13800138000'])
    expect(result.extra).toHaveLength(1)
    expect(result.hits).toHaveLength(0)
  })

  it('does not let one finding satisfy two expectations', () => {
    const result = scoreCase('a.png', ['13800138000', '13800138001'], [finding('13800138000')], false)
    expect(result.hits).toHaveLength(1)
    expect(result.misses).toHaveLength(1)
  })
})

describe('summarize', () => {
  it('computes recall and precision', () => {
    const cases = [
      scoreCase('a.png', ['11111111111', '22222222222'], [finding('11111111111')], false),
      scoreCase('b.png', ['33333333333'], [finding('33333333333'), finding('noise@x.com')], false),
    ]

    const summary = summarize(cases)
    expect(summary.expected).toBe(3)
    expect(summary.hits).toBe(2)
    expect(summary.found).toBe(3)
    expect(summary.extra).toBe(1)
    expect(summary.recall).toBeCloseTo(2 / 3)
    expect(summary.precision).toBeCloseTo(2 / 3)
  })
})
