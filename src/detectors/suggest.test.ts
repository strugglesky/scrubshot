import { describe, expect, it } from 'vitest'
import type { TextLine } from '../types'
import { findingToBox, findSensitive } from './suggest'

describe('findSensitive', () => {
  it('narrows the box down to the matching word', () => {
    const line: TextLine = {
      text: '手机号：18967676767',
      x: 0,
      y: 10,
      w: 300,
      h: 22,
      confidence: 92,
      words: [
        { text: '手机号：', x: 0, y: 10, w: 80, h: 22, confidence: 90 },
        { text: '18967676767', x: 88, y: 10, w: 130, h: 22, confidence: 96 },
      ],
    }

    const [finding] = findSensitive([line])
    expect(finding.rect).toEqual({ x: 88, y: 10, w: 130, h: 22 })
    expect(findingToBox(finding).enabled).toBe(true)
  })

  it('keeps a low-confidence line and still auto-redacts high risk', () => {
    const line: TextLine = {
      text: '18967676767',
      x: 0,
      y: 0,
      w: 120,
      h: 20,
      confidence: 12,
      words: [],
    }

    const [finding] = findSensitive([line])
    expect(finding.label).toContain('低置信')
    expect(findingToBox(finding).enabled).toBe(true)
  })

  it('does not auto-enable a low-confidence medium-risk finding', () => {
    const line: TextLine = {
      text: 'hi@example.com',
      x: 0,
      y: 0,
      w: 160,
      h: 20,
      confidence: 12,
      words: [],
    }

    const [finding] = findSensitive([line])
    expect(findingToBox(finding).enabled).toBe(false)
  })

  it('falls back to a proportional box when there are no word boxes', () => {
    const line: TextLine = {
      text: 'ID 11010519491231002X',
      x: 5,
      y: 6,
      w: 200,
      h: 20,
      confidence: 90,
      words: [],
    }

    const [finding] = findSensitive([line])
    // 跳过前面的 "ID "，但不整行框住
    expect(finding.rect.x).toBeGreaterThanOrEqual(5)
    expect(finding.rect.x).toBeLessThan(30)
    expect(finding.rect.x + finding.rect.w).toBeGreaterThan(180)
    expect(finding.rect.y).toBe(6)
  })

  it('excludes the label when label and value share a line', () => {
    const line: TextLine = {
      text: '收件人：孙艳佳 137-5506-1108',
      x: 0,
      y: 0,
      w: 400,
      h: 20,
      confidence: 90,
      words: [],
    }

    const [finding] = findSensitive([line])
    // 「收件人：孙艳佳」不该被整段框进去
    expect(finding.rect.x).toBeGreaterThan(100)
    expect(finding.rect.x + finding.rect.w).toBeLessThanOrEqual(401)
  })

  it('emits one tight box per match instead of one wide box per line', () => {
    const line: TextLine = {
      text: '手机号 13812345678 邮箱 a@b.com',
      x: 0,
      y: 0,
      w: 400,
      h: 20,
      confidence: 90,
      words: [
        { text: '手机号', x: 0, y: 0, w: 40, h: 20, confidence: 90 },
        { text: '13812345678', x: 50, y: 0, w: 100, h: 20, confidence: 90 },
        { text: '邮箱', x: 160, y: 0, w: 30, h: 20, confidence: 90 },
        { text: 'a@b.com', x: 200, y: 0, w: 60, h: 20, confidence: 90 },
      ],
    }

    const findings = findSensitive([line])
    expect(findings.map((finding) => finding.rect)).toEqual([
      { x: 50, y: 0, w: 100, h: 20 },
      { x: 200, y: 0, w: 60, h: 20 },
    ])
  })

  it('keeps detecting when word boxes are missing', () => {
    const line: TextLine = {
      text: '身份证 11010519491231002X',
      x: 0,
      y: 0,
      w: 400,
      h: 20,
      confidence: 90,
      // 只有标签，没有号码 —— 重建文本里没有可匹配的内容
      words: [{ text: '身份证', x: 0, y: 0, w: 60, h: 20, confidence: 90 }],
    }

    const findings = findSensitive([line])
    expect(findings).toHaveLength(1)
    // 允许退回按比例定位，但必须覆盖到值的末尾
    expect(findings[0].rect.x + findings[0].rect.w).toBeGreaterThan(380)
  })
})
