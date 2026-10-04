export interface FindingLike {
  detail: string
  label: string
  risk: string
}

export interface CaseResult {
  file: string
  expected: string[]
  hits: string[]
  misses: string[]
  found: FindingLike[]
  /** 工具报了、但没有任何标注能对上的项（可能是漏标，也可能是误报） */
  extra: FindingLike[]
  mirrored: boolean
  /** OCR 读到的文本行数。为 0 说明这张图根本没读到字，和"没找到敏感项"是两回事 */
  lines: number
}

export interface Summary {
  expected: number
  hits: number
  found: number
  extra: number
  recall: number
  precision: number
}

/** 比较前去掉空格、短横，并统一大小写：OCR 常在数字中间插空格 */
function normalize(value: string): string {
  return value.replace(/[\s-]/g, '').toLowerCase()
}

function related(expected: string, actual: string): boolean {
  if (!expected || !actual) return false
  if (actual.includes(expected)) return true
  // 反向包含：OCR 把号码截断了一部分时也算命中，但太短的片段不算
  return actual.length >= 6 && expected.includes(actual)
}

/**
 * 对单张图打分。
 *
 * 标注只写"这张图里有哪些敏感字符串"，不写坐标 —— 标注成本从画框降到打字。
 * 匹配按"值包含"而不是精确相等，因为 OCR 经常带前后缀（例如 "身份证：xxx"）。
 */
export function scoreCase(
  file: string,
  expected: string[],
  findings: FindingLike[],
  mirrored: boolean,
  lines = 0,
): CaseResult {
  const hits: string[] = []
  const misses: string[] = []
  const used = new Set<number>()

  for (const want of expected) {
    const target = normalize(want)
    const index = findings.findIndex(
      (finding, position) => !used.has(position) && related(target, normalize(finding.detail)),
    )
    if (index >= 0) {
      used.add(index)
      hits.push(want)
    } else {
      misses.push(want)
    }
  }

  const extra = findings.filter((_, position) => !used.has(position))

  return { file, expected, hits, misses, found: findings, extra, mirrored, lines }
}

export function summarize(cases: CaseResult[]): Summary {
  let expected = 0
  let hits = 0
  let found = 0
  let extra = 0

  for (const item of cases) {
    expected += item.expected.length
    hits += item.hits.length
    found += item.found.length
    extra += item.extra.length
  }

  return {
    expected,
    hits,
    found,
    extra,
    recall: expected > 0 ? hits / expected : 1,
    precision: found > 0 ? (found - extra) / found : 1,
  }
}
