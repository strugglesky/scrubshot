import type { Risk } from '../types'
import { normalizeOcrText } from './normalize'
import { cnIdCard, isPrivateIp, isValidIpv4, luhn } from './validators'

export type { Risk }

export interface Match {
  ruleId: string
  label: string
  risk: Risk
  value: string
  /** 在归一化后文本中的起止位置 */
  start: number
  end: number
}

type RiskRule = Risk | ((value: string) => Risk)

interface Rule {
  id: string
  label: string
  risk: RiskRule
  pattern: RegExp
  /** 校验前先去掉分隔符：OCR 经常在数字中间插空格 */
  strip?: RegExp
  validate?: (value: string) => boolean
  /**
   * 校验不通过时仍然上报，但换成这个标签。
   * 这是"宁可多框，不可漏框"的兜底：校验位只用来判断可信度，
   * 不能用来决定"要不要让用户看见"。
   */
  soft?: { risk: Risk; label: string }
}

/**
 * 规则顺序有意义：同一段文本被多条规则命中时，靠前的规则优先。
 * 例如 18 位身份证同时满足"16-19 位数字"，必须让 cn-id 先命中。
 */
const RULES: Rule[] = [
  {
    id: 'private-key',
    label: '私钥',
    risk: 'high',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    id: 'jwt',
    label: 'JWT',
    risk: 'high',
    pattern: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
  },
  {
    id: 'api-key',
    label: 'API Key',
    risk: 'high',
    pattern:
      /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})\b/g,
  },
  {
    id: 'url-token',
    label: '带密钥的链接',
    risk: 'high',
    pattern: /[?&](?:token|key|sig|signature|code|session|password|secret)=[^\s&#"'<>]+/gi,
  },
  {
    id: 'cn-id',
    label: '身份证号',
    risk: 'high',
    // 每一位之间都允许空格/短横：OCR 会在任意位置断行断字。
    // 边界用 (?<!\d)/(?!\d) 而不是 \b，这样 "id:3426..." 这种数字紧贴字母也能命中。
    pattern: /(?<!\d)\d(?:[\s-]?\d){16}[\s-]?[\dXx](?!\d)/g,
    strip: /[\s-]/g,
    validate: cnIdCard,
    soft: { risk: 'high', label: '疑似身份证号（校验位不通过）' },
  },
  {
    id: 'bank-card',
    label: '银行卡号',
    risk: 'high',
    // 16-19 位，任意分组（4 位一组最常见，但不要假设）
    pattern: /(?<!\d)\d(?:[\s-]?\d){15,18}(?!\d)/g,
    strip: /[\s-]/g,
    validate: luhn,
    // 真实卡号都过 Luhn，但测试数据/截图里的编号常常不过。
    // 只为了精确率把它丢掉，代价是漏掉一张卡 —— 所以降级上报，不丢弃。
    soft: { risk: 'high', label: '疑似银行卡号（校验位不通过）' },
  },
  {
    id: 'password-field',
    label: '密码字段',
    risk: 'high',
    pattern: /(?:密码|口令|password|passwd|pwd)\s*[:：=]\s*\S+/gi,
  },
  {
    id: 'cn-mobile',
    label: '手机号',
    risk: 'high',
    // 注意 "1" 和 "3-9" 之间也要允许分隔符，否则 "1 8 9 6..." 这种逐位分隔会漏
    pattern: /(?<!\d)1[\s-]?[3-9](?:[\s-]?\d){9}(?!\d)/g,
    strip: /[\s-]/g,
  },
  {
    id: 'landline',
    label: '座机号',
    risk: 'medium',
    // 0 + 区号（2-3 位）+ 7-8 位号码，允许 076-42104304 这种写法
    pattern: /(?<!\d)0[\s-]?\d{2,3}[\s-]?\d{7,8}(?!\d)/g,
    strip: /[\s-]/g,
  },
  {
    id: 'long-number',
    label: '长数字（单号/流水号）',
    risk: 'medium',
    // 12-20 位纯数字：运单号、订单号、病历号、凭证号……
    // 更具体的规则（身份证、银行卡）排在前面，重叠时优先命中它们。
    pattern: /(?<!\d)\d{12,20}(?!\d)/g,
  },
  {
    id: 'email',
    label: '邮箱',
    risk: 'medium',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    id: 'ipv4',
    label: 'IP 地址',
    risk: (value: string) => (isPrivateIp(value) ? 'medium' : 'low'),
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    validate: isValidIpv4,
  },
  {
    id: 'handle',
    label: '用户名',
    risk: 'medium',
    pattern: /(?<![\w.])@[A-Za-z0-9_]{3,30}\b/g,
  },
  {
    id: 'cn-plate',
    label: '车牌号',
    risk: 'low',
    pattern: /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-HJ-NP-Z][A-HJ-NP-Z0-9]{4,5}/g,
  },
]

const RANK: Record<Risk, number> = { high: 3, medium: 2, low: 1 }

/**
 * 对一段纯文本跑全部规则。
 *
 * 纯函数、零 DOM 依赖 —— 这样既可以被单测覆盖，也能在将来的 CLI
 * 或 Worker 里复用。
 */
export function scanText(input: string): Match[] {
  const text = normalizeOcrText(input)
  if (!text) return []

  const found: Match[] = []

  for (const rule of RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const value = m[0]
      if (value) {
        const cleaned = rule.strip ? value.replace(rule.strip, '') : value
        const valid = !rule.validate || rule.validate(cleaned)

        if (valid) {
          const risk = typeof rule.risk === 'function' ? rule.risk(cleaned) : rule.risk
          found.push({
            ruleId: rule.id,
            label: rule.label,
            risk,
            value,
            start: m.index,
            end: m.index + value.length,
          })
        } else if (rule.soft) {
          found.push({
            ruleId: rule.id,
            label: rule.soft.label,
            risk: rule.soft.risk,
            value,
            start: m.index,
            end: m.index + value.length,
          })
        }
      }
      // 防止零宽匹配导致死循环
      if (re.lastIndex === m.index) re.lastIndex += 1
    }
  }

  // 高风险优先、长匹配优先；重叠的只保留一个
  found.sort((a, b) => RANK[b.risk] - RANK[a.risk] || b.value.length - a.value.length)

  const picked: Match[] = []
  for (const match of found) {
    const overlaps = picked.some((p) => match.start < p.end && p.start < match.end)
    if (!overlaps) picked.push(match)
  }

  return picked.sort((a, b) => a.start - b.start)
}
