import { describe, expect, it } from 'vitest'
import type { FindingLike } from './score'
import { scoreCase, summarize } from './score'

const finding = (detail: string): FindingLike => ({ detail, label: 'x', risk: 'high' })

describe('scoreCase', () => {
  it('counts an exact match as a hit', () => {
    const result = scoreCase('a.png', ['18967676767'], [finding('18967676767')], false)
    expect(result.hits).toEqual(['18967676767'])
    expect(result.misses).toEqual([])
    expect(result.extra).toEqual([])
  })

  it('ignores spaces and dashes inserted by OCR', () => {
    const result = scoreCase('a.png', ['18967676767'], [finding('189 6767 6767')], false)
    expect(result.hits).toHaveLength(1)
  })

  it('matches when the finding carries a prefix', () => {
    const result = scoreCase('a.png', ['342622200206082951'], [finding('身份证:342622200206082951')], false)
    expect(result.hits).toHaveLength(1)
  })

  it('reports a miss and keeps unmatched findings as extra', () => {
    const result = scoreCase('a.png', ['18967676767'], [finding('hi@example.com')], false)
    expect(result.misses).toEqual(['18967676767'])
    expect(result.extra).toHaveLength(1)
    expect(result.hits).toHaveLength(0)
  })

  it('does not let one finding satisfy two expectations', () => {
    const result = scoreCase('a.png', ['18967676767', '18967676768'], [finding('18967676767')], false)
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
