import { uid } from '../core/uid'
import type { Box, OcrWord, Rect, Risk, TextLine } from '../types'
import { scanText } from './rules'

export interface Finding {
  id: string
  label: string
  risk: Risk
  detail: string
  line: TextLine
  /** 精确到命中词的包围盒；没有词级数据时退化为整行 */
  rect: Rect
}

interface WordSpan {
  start: number
  end: number
  word: OcrWord
}

const PADDING = 2
/** 低于这个置信度，标签前加"低置信"提示 */
const LOW_CONFIDENCE = 40
/** 低于这个置信度，默认只列出、不打码（避免在噪声上乱画框） */
const AUTO_ENABLE_CONFIDENCE = 25

/** 标签-值结构：值本身可能不匹配任何正则，但字段名暴露了它 */
const CONTEXT_LABEL =
  /(密码|口令|token|secret|api[\s_-]?key|access[\s_-]?key|账号|用户名|手机号?|电话|邮箱|e-?mail|身份证|银行卡|收货地址|地址)\s*[:：=]\s*(\S{3,})/i

/**
 * 把每个词对齐到行文本里的字符区间。
 *
 * 关键点：**匹配始终跑在 line.text 上**，不重新拼文本。
 * 重新拼会引入两个坑：中文常被切成单字词，补空格会拆散号码；英文又需要空格，
 * 阈值很难定。用 indexOf 顺序对齐，则既保留原始文本（匹配行为不变），
 * 又拿到了每个词的字符区间。
 */
function alignWords(line: TextLine): WordSpan[] {
  if (line.words.length === 0) return []

  const spans: WordSpan[] = []
  let cursor = 0

  for (const word of line.words) {
    if (!word.text) continue
    const index = line.text.indexOf(word.text, cursor)
    if (index === -1) continue
    spans.push({ start: index, end: index + word.text.length, word })
    cursor = index + word.text.length
  }

  return spans
}

/** 把字符区间映射成一组词的并集包围盒。 */
function locate(spans: WordSpan[], start: number, end: number): Rect | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let hit = false

  for (const span of spans) {
    if (span.end <= start || span.start >= end) continue
    hit = true
    minX = Math.min(minX, span.word.x)
    minY = Math.min(minY, span.word.y)
    maxX = Math.max(maxX, span.word.x + span.word.w)
    maxY = Math.max(maxY, span.word.y + span.word.h)
  }

  return hit ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null
}

/**
 * 退化成整行时也要返回纯净的 Rect。
 * 直接把 TextLine 当 Rect 用会把 text / confidence / words 一起带进
 * Finding.rect，渲染看不出来，但序列化和报告会变脏。
 */
function lineRect(line: TextLine): Rect {
  return { x: line.x, y: line.y, w: line.w, h: line.h }
}

const CJK = /[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/

/** 中文按 2 个单位、西文按 1 个单位估算宽度 */
function weightedLength(text: string): number {
  let total = 0
  for (const char of text) total += CJK.test(char) ? 2 : 1
  return total
}

/**
 * 没有词级坐标时，按字符宽度比例在行内定位。
 *
 * RapidOCR 只给"一行一个框"，如果不做这一步，`收件人：孙艳佳 137-5506-1108`
 * 会把整行（含标签）都框进去。按比例估算能把标签排除掉，
 * 左右各留 1.5 个字符的余量——宁可多盖一点，也不能因为估算偏差漏掉一位数字。
 */
function proportionalRect(line: TextLine, start: number, end: number): Rect {
  const total = weightedLength(line.text)
  if (total <= 0) return lineRect(line)

  const before = weightedLength(line.text.slice(0, start))
  const span = Math.max(1, weightedLength(line.text.slice(start, end)))
  const pad = 1.5

  const from = Math.max(0, before - pad)
  const to = Math.min(total, before + span + pad)

  return {
    x: line.x + (line.w * from) / total,
    y: line.y,
    w: Math.max(1, (line.w * (to - from)) / total),
    h: line.h,
  }
}

export function findSensitive(lines: TextLine[]): Finding[] {
  const findings: Finding[] = []

  for (const line of lines) {
    if (line.text.trim().length < 3) continue

    // 注意：这里不再按置信度丢弃整行。
    // 镜像/低质量 OCR 出来的行置信度普遍很低，但数字本身可能是完全正确的。
    // 置信度只用来决定"要不要自动打码"和"标签要不要标低置信"。
    const lowConfidence = line.confidence > 0 && line.confidence < LOW_CONFIDENCE

    const text = line.text
    const spans = alignWords(line)
    const matches = scanText(text)

    if (matches.length > 0) {
      for (const match of matches) {
        findings.push({
          id: uid(),
          label: lowConfidence ? `低置信 · ${match.label}` : match.label,
          risk: match.risk,
          detail: match.value,
          line,
          rect: locate(spans, match.start, match.end) ?? proportionalRect(line, match.start, match.end),
        })
      }
      continue
    }

    const hint = contextualHint(text)
    if (hint) {
      findings.push({
        id: uid(),
        label: lowConfidence ? `低置信 · ${hint.label}` : hint.label,
        risk: 'medium',
        detail: hint.value,
        line,
        rect: locate(spans, hint.start, hint.end) ?? proportionalRect(line, hint.start, hint.end),
      })
    }
  }

  return stitchSplitNumbers(lines, findings)
}

const STITCHABLE_LENGTHS = new Set([11, 16, 17, 18, 19])

/** 行尾那段数字（含中间的分隔符），同时给出起始下标 */
function trailingDigitRun(text: string): { digits: string; start: number } | null {
  const trimmed = text.replace(/\s+$/, '')
  const match = /\d[\d\s-]*$/.exec(trimmed)
  if (!match) return null
  return { digits: match[0].replace(/[\s-]/g, ''), start: match.index }
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.w, b.x + b.w)
  const bottom = Math.max(a.y + a.h, b.y + b.h)
  return { x, y, w: right - x, h: bottom - y }
}

/**
 * 跨行拼接。
 *
 * 聊天框、窄表单会把长号码折行，单行只能匹配到前半段 —— 结果是"打了一半码"，
 * 后半段还露着。这比漏检更危险，因为用户以为已经处理干净了。
 *
 * 规则刻意收得很紧，避免把表格相邻两行拼成假号码：
 *   1. 上一行以 ≥6 位数字结尾
 *   2. 下一行**整行**只有 2–10 位数字
 *   3. 拼起来的长度必须是 11 / 16–19（手机、银行卡、身份证）
 */
function stitchSplitNumbers(lines: TextLine[], findings: Finding[]): Finding[] {
  const result = [...findings]

  for (let index = 0; index < lines.length - 1; index += 1) {
    const upper = lines[index]
    const lower = lines[index + 1]

    const gap = lower.y - (upper.y + upper.h)
    if (gap > upper.h || gap < -upper.h) continue

    const head = lower.text.trim()
    if (!/^\d{2,10}$/.test(head)) continue

    const run = trailingDigitRun(upper.text)
    if (!run || run.digits.length < 6) continue
    const tail = run.digits

    const joined = tail + head
    if (!STITCHABLE_LENGTHS.has(joined.length)) continue

    const matches = scanText(joined)
    if (matches.length === 0) continue

    const match = matches[0]

    // 去掉被这次拼接取代的半截结果，否则会同时出现"前半段框"和"完整框"
    for (let position = result.length - 1; position >= 0; position -= 1) {
      const existing = result[position]
      if (existing.line !== upper) continue
      if (tail.includes(existing.detail.replace(/[\s-]/g, ''))) result.splice(position, 1)
    }

    result.push({
      id: uid(),
      label: match.label,
      risk: match.risk,
      detail: joined,
      line: lower,
      rect: unionRect(
        proportionalRect(upper, run.start, upper.text.length),
        proportionalRect(lower, 0, head.length),
      ),
    })
  }

  return result
}

/** 高风险默认打码；中风险默认也打（宁可多框）；低风险只提示。 */
export function findingToBox(finding: Finding): Box {
  const { rect } = finding
  return {
    id: finding.id,
    x: Math.max(0, rect.x - PADDING),
    y: Math.max(0, rect.y - PADDING),
    w: rect.w + PADDING * 2,
    h: rect.h + PADDING * 2,
    origin: 'auto',
    label: finding.label,
    detail: finding.detail,
    risk: finding.risk,
    // 高风险（证件号、密钥、手机号）无条件打码：漏一个的代价远大于多框一个。
    // 中风险看置信度：低置信时只列出，避免在噪声上乱画框。
    enabled:
      finding.risk === 'high' ||
      (finding.risk === 'medium' &&
        (finding.line.confidence === 0 ||
          finding.line.confidence >= AUTO_ENABLE_CONFIDENCE)),
  }
}

function contextualHint(
  text: string,
): { label: string; value: string; start: number; end: number } | null {
  const match = CONTEXT_LABEL.exec(text)
  if (!match) return null

  const value = match[2].trim()
  if (!/[A-Za-z0-9\u4e00-\u9fa5]/.test(value)) return null

  // 模式以值结尾，所以值的结束位置就是整个匹配的结束位置
  const end = match.index + match[0].length
  return { label: `疑似${match[1]}`, value, start: end - value.length, end }
}
