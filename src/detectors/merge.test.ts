import { describe, expect, it } from 'vitest'
import type { TextLine } from '../types'
import { mergeFindings, mergeLines } from './merge'
import type { Finding } from './suggest'

function finding(detail: string, x: number, y: number): Finding {
  return {
    id: `${detail}-${x}`,
    label: '手机号',
    risk: 'high',
    detail,
    line: { text: detail, x, y, w: 100, h: 20, confidence: 90, words: [] },
    rect: { x, y, w: 100, h: 20 },
  }
}

function line(text: string, x: number, y: number): TextLine {
  return { text, x, y, w: 100, h: 20, confidence: 90, words: [] }
}

describe('mergeFindings', () => {
  it('drops the same value found at the same place by both passes', () => {
    const merged = mergeFindings([finding('189 6767 6767', 10, 10)], [finding('18967676767', 11, 10)])
    expect(merged).toHaveLength(1)
  })

  it('keeps the same value found at two different places', () => {
    const merged = mergeFindings([finding('18967676767', 10, 10)], [finding('18967676767', 400, 500)])
    expect(merged).toHaveLength(2)
  })

  it('adds values only the second pass found', () => {
    const merged = mergeFindings([finding('18967676767', 10, 10)], [finding('342622200206082951', 10, 80)])
    expect(merged).toHaveLength(2)
  })
})

describe('mergeLines', () => {
  it('dedupes identical lines at the same position', () => {
    const merged = mergeLines([line('你好', 10, 10)], [line('你好', 12, 11)])
    expect(merged).toHaveLength(1)
  })

  it('keeps different lines', () => {
    const merged = mergeLines([line('你好', 10, 10)], [line('再见', 10, 40)])
    expect(merged).toHaveLength(2)
  })
})
