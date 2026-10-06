import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { CaseResult } from '../benchmark/score'
import { scoreCase, summarize } from '../benchmark/score'
import { download } from '../core/export'
import { loadImageFile } from '../core/image'
import type { Finding } from '../detectors/suggest'
import type { EngineKind, PsmMode } from '../ocr/engine'
import type { TextLine } from '../types'

export interface AnalyzeResult {
  findings: Finding[]
  lines: TextLine[]
  mirrored: boolean
}

interface Props {
  analyze: (
    image: HTMLImageElement,
    psm?: PsmMode,
    engineKind?: EngineKind,
  ) => Promise<AnalyzeResult>
}

interface Sample {
  name: string
  image: HTMLImageElement
}

interface Detail {
  file: string
  lines: number
  mirrored: boolean
  texts: string[]
  findings: Array<{ label: string; detail: string; risk: string }>
}

function stripExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** 文件名可能带大小写差异，逐级回退地找 */
function lookup(labels: Record<string, string[]>, name: string): string[] {
  const stem = stripExt(name)
  return (
    labels[name] ??
    labels[stem] ??
    labels[name.toLowerCase()] ??
    labels[stem.toLowerCase()] ??
    []
  )
}

function isLabeled(labels: Record<string, string[]>, name: string): boolean {
  const stem = stripExt(name)
  return (
    name in labels ||
    stem in labels ||
    name.toLowerCase() in labels ||
    stem.toLowerCase() in labels
  )
}

const SAMPLE_LABELS = `{
  "shop.png": ["18967676767", "342622200206082951"],
  "code.png": []
}`

export default function Benchmark({ analyze }: Props) {
  const [samples, setSamples] = useState<Sample[]>([])
  const [labels, setLabels] = useState<Record<string, string[]> | null>(null)
  const [cases, setCases] = useState<CaseResult[]>([])
  const [details, setDetails] = useState<Detail[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [psm, setPsm] = useState<PsmMode>('3')
  const [engineKind, setEngineKind] = useState<EngineKind>('rapid')
  const [error, setError] = useState<string | null>(null)

  const imageInput = useRef<HTMLInputElement | null>(null)
  const labelInput = useRef<HTMLInputElement | null>(null)

  const addFiles = async (files: File[]) => {
    const json = files.find((file) => file.name.toLowerCase().endsWith('.json'))
    if (json) {
      try {
        const parsed = JSON.parse(await json.text()) as Record<string, unknown>
        const next: Record<string, string[]> = {}
        for (const [key, value] of Object.entries(parsed)) {
          if (Array.isArray(value)) {
            next[key] = value.filter((item): item is string => typeof item === 'string')
          }
        }
        setLabels(next)
        setError(null)
      } catch {
        setError('labels.json 解析失败，检查一下 JSON 格式')
      }
    }

    const images = files.filter((file) => file.type.startsWith('image/'))
    const loaded: Sample[] = []
    for (const file of images) {
      try {
        const doc = await loadImageFile(file)
        loaded.push({ name: doc.name, image: doc.image })
      } catch {
        setError(`「${file.name}」打不开`)
      }
    }
    if (loaded.length > 0) {
      setSamples((prev) => [...prev, ...loaded])
      setError(null)
    }
  }

  const onPickImages = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length > 0) void addFiles(files)
  }

  const onPickLabels = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length > 0) void addFiles(files)
  }

  const run = async () => {
    if (!labels) {
      setError('先导入 labels.json')
      return
    }
    if (samples.length === 0) {
      setError('先导入要评测的截图')
      return
    }

    setRunning(true)
    setError(null)
    setProgress({ done: 0, total: samples.length })

    const results: CaseResult[] = []
    const collected: Detail[] = []
    setDetails([])

    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index]
      const expected = lookup(labels, sample.name)

      try {
        const analysis = await analyze(sample.image, psm, engineKind)
        const mapped = analysis.findings.map((finding) => ({
          detail: finding.detail,
          label: finding.label,
          risk: finding.risk,
        }))

        results.push(
          scoreCase(sample.name, expected, mapped, analysis.mirrored, analysis.lines.length),
        )
        collected.push({
          file: sample.name,
          lines: analysis.lines.length,
          mirrored: analysis.mirrored,
          texts: analysis.lines.map((line) => line.text),
          findings: mapped,
        })
      } catch {
        // -1 表示"识别过程抛错了"，和"读到了 0 行"区分开
        results.push(scoreCase(sample.name, expected, [], false, -1))
        collected.push({ file: sample.name, lines: -1, mirrored: false, texts: [], findings: [] })
      }

      setCases([...results])
      setDetails([...collected])
      setProgress({ done: index + 1, total: samples.length })
    }

    setRunning(false)
  }

  const exportCsv = () => {    const rows = [
      ['file', 'expected', 'hit', 'miss', 'extra', 'lines', 'mirrored'],
      ...cases.map((item) => [
        item.file,
        String(item.expected.length),
        String(item.hits.length),
        String(item.misses.length),
        String(item.extra.length),
        String(item.lines),
        item.mirrored ? 'yes' : 'no',
      ]),
    ]
    const csv = `\uFEFF${rows.map((row) => row.join(',')).join('\n')}`
    download(new Blob([csv], { type: 'text/csv' }), 'scrubshot-benchmark.csv')
  }

  const downloadTemplate = () => {
    const template: Record<string, string[]> = {}
    for (const sample of samples) template[sample.name] = []
    download(
      new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' }),
      'labels.json',
    )
  }

  const exportDetail = () => {
    download(
      new Blob([JSON.stringify(details, null, 2)], { type: 'application/json' }),
      'scrubshot-detail.json',
    )
  }

  const summary = summarize(cases)
  const unlabeled = labels
    ? samples.filter((sample) => !isLabeled(labels, sample.name)).map((sample) => sample.name)
    : []
  const missed = cases.flatMap((item) => item.misses.map((value) => `${item.file}: ${value}`))

  return (
    <section
      className="bench"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void addFiles(Array.from(event.dataTransfer.files))
      }}
    >
      <header className="bench-head">
        <div>
          <h2>评测</h2>
          <p className="muted small">
            导入一批真实截图和一份敏感字符串清单，用当前识别流程跑一遍，算出召回率和多报率。
          </p>
        </div>
        <div className="bench-actions">
          <label className="psm" title="识别引擎">
            <span>引擎</span>
            <select
              value={engineKind}
              onChange={(event) => setEngineKind(event.target.value as EngineKind)}
            >
              <option value="tesseract">Tesseract</option>
              <option value="rapid">RapidOCR</option>
            </select>
          </label>
          <label className="psm" title="Tesseract 版面分割模式（RapidOCR 不适用）">
            <span>PSM</span>
            <select value={psm} onChange={(event) => setPsm(event.target.value as PsmMode)}>
              <option value="3">3 · 自动</option>
              <option value="6">6 · 单块</option>
              <option value="11">11 · 稀疏</option>
              <option value="tiled">分块 ×4</option>
            </select>
          </label>
          <button type="button" className="button ghost" onClick={() => imageInput.current?.click()}>
            添加截图（{samples.length}）
          </button>
          <button type="button" className="button ghost" onClick={() => labelInput.current?.click()}>
            导入 labels.json
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={downloadTemplate}
            disabled={samples.length === 0}
            title="把当前所有文件名生成一份空清单，填值即可"
          >
            生成清单模板
          </button>
          <button
            type="button"
            className="button primary"
            onClick={() => void run()}
            disabled={running || samples.length === 0}
          >
            {running ? `评测中 ${progress.done}/${progress.total}` : '开始评测'}
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={exportCsv}
            disabled={cases.length === 0}
          >
            导出 CSV
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={exportDetail}
            disabled={details.length === 0}
            title="每张图识别到的完整文本和命中项，用于排查漏检"
          >
            导出明细 JSON
          </button>
        </div>

        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={onPickImages}
        />
        <input ref={labelInput} type="file" accept="application/json,.json" hidden onChange={onPickLabels} />
      </header>

      {error && <p className="warn">⚠️ {error}</p>}

      {unlabeled.length > 0 && (
        <p className="warn">
          ⚠️ 有 {unlabeled.length} 张图不在清单里，会按「没有敏感信息」计：
          {unlabeled.slice(0, 5).join('、')}
          {unlabeled.length > 5 ? ' …' : ''}
        </p>
      )}

      {samples.length === 0 && (
        <div className="bench-empty">
          <p>先把截图拖进这个区域，再导入 labels.json。</p>
          <p className="muted small">
            清单只写「这张图里有哪些敏感字符串」，不用画框。键是文件名，值是要找的内容：
          </p>
          <pre>{SAMPLE_LABELS}</pre>
          <p className="muted small">
            文件名对不上时，会再用去掉扩展名的名字试一次。清单里没出现的图按「不该有敏感信息」计。
          </p>
        </div>
      )}

      {cases.length > 0 && (
        <>
          <div className="bench-summary">
            <div>
              <span className="bench-number">{Math.round(summary.recall * 100)}%</span>
              <span className="muted small">
                召回（{summary.hits}/{summary.expected}）
              </span>
            </div>
            <div>
              <span className="bench-number">{Math.round(summary.precision * 100)}%</span>
              <span className="muted small">
                精确（多报 {summary.extra} 处 / 共报 {summary.found} 处）
              </span>
            </div>
            <div>
              <span className="bench-number">{cases.length}</span>
              <span className="muted small">张图</span>
            </div>
          </div>

          {missed.length > 0 && (
            <div className="bench-missed">
              <h3>漏检清单</h3>
              <ul>
                {missed.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          <table className="bench-table">
            <thead>
              <tr>
                <th>文件</th>
                <th>期望</th>
                <th>命中</th>
                <th>漏检</th>
                <th>多报</th>
                <th title="OCR 读到的文本行数；0 表示这张图根本没读到字">行数</th>
                <th>镜像</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((item) => (
                <tr
                  key={item.file}
                  className={
                    item.misses.length > 0 || (item.expected.length > 0 && item.lines <= 0)
                      ? 'bad'
                      : ''
                  }
                >
                  <td>{item.file}</td>
                  <td>{item.expected.length}</td>
                  <td>{item.hits.length}</td>
                  <td>{item.misses.length}</td>
                  <td>{item.extra.length}</td>
                  <td>{item.lines < 0 ? '失败' : item.lines}</td>
                  <td>{item.mirrored ? '是' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
