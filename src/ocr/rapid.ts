import * as ort from 'onnxruntime-web'
import type { Rect, TextLine } from '../types'
import type { OcrEngine, OcrInput, OcrProgress, OcrResult } from './engine'

/**
 * RapidOCR（PP-OCR 检测 + 识别）适配器。
 *
 * 和 Tesseract 的根本差别：它先用文本检测网络把每一行文字框出来，再逐行识别。
 * 不依赖"版面分析"去猜哪块是正文，所以表格、便签、票据这类排版不会整块被跳过。
 *
 * 依赖 @sanduc/ocr-browser，其真实契约（读源码确认过）：
 *   Ocr.create({ modelsBasePath }) -> { detect(dataUrl) }
 *   detect() 直接返回数组：[{ text, mean, box: [[x,y], ...] }]
 */

interface RawLine {
  text?: string
  mean?: number
  confidence?: number
  score?: number
  box?: unknown
  bbox?: unknown
  points?: unknown
}

type RapidInstance = { detect?: (input: unknown) => Promise<unknown> }

export class RapidEngine implements OcrEngine {
  private instance: RapidInstance | null = null

  async init(onProgress?: (progress: OcrProgress) => void): Promise<void> {
    if (this.instance) return

    // 单线程：多线程需要 cross-origin isolation（COOP/COEP），静态托管往往配不了，
    // 而开了线程反而会直接失败。
    // wasm 不走 CDN，由 ORT 按 import.meta.url 解析到构建产物里 —— 断网可用。
    ort.env.wasm.numThreads = 1

    onProgress?.({ status: 'loading language', progress: 0.05 })

    const module = (await import('@sanduc/ocr-browser')) as Record<string, unknown>
    const candidate =
      (module.Ocr as { create?: (options: Record<string, unknown>) => Promise<unknown> } | undefined) ??
      (module.default as { create?: (options: Record<string, unknown>) => Promise<unknown> } | undefined)

    if (!candidate || typeof candidate.create !== 'function') {
      throw new Error(`RapidOCR 导出结构不符：${Object.keys(module).join(' / ') || '空模块'}`)
    }

    onProgress?.({ status: 'initializing', progress: 0.2 })

    // 显式给出三个模型路径，不走它的自动探测。
    // 探测逻辑是 HEAD + response.ok，而 Vite dev server 对不存在的文件会返回
    // index.html（200 OK），于是它会把"没复制的 server 模型"当成存在，
    // GET 回来一份 HTML 去喂 protobuf —— 报 "protobuf parsing failed"。
    const created = (await candidate.create({
      models: {
        detectionPath: '/models/PP-OCRv5_mobile_det_infer.onnx',
        recognitionPath: '/models/PP-OCRv5_mobile_rec_infer.onnx',
        dictionaryPath: '/models/ppocr_keys_v5.txt',
      },
    })) as RapidInstance
    if (typeof created.detect !== 'function') {
      throw new Error(`RapidOCR 实例缺少 detect()：${Object.keys(created).join(' / ')}`)
    }

    this.instance = created
  }

  async recognize(input: OcrInput): Promise<OcrResult> {
    if (!this.instance?.detect) throw new Error('RapidOCR 未初始化')

    const result = (await this.instance.detect(toDataUrl(input))) as unknown
    const raw = Array.isArray(result) ? result : (result as { lines?: unknown })?.lines

    if (!Array.isArray(raw)) {
      throw new Error(`RapidOCR 返回结构不符：${Object.keys((result ?? {}) as object).join(' / ')}`)
    }

    const lines: TextLine[] = []

    for (const item of raw as RawLine[]) {
      const rect = toRect(item.box ?? item.bbox ?? item.points)
      const text = (item.text ?? '').replace(/\s+/g, ' ').trim()
      if (!rect || !text || rect.w <= 0 || rect.h <= 0) continue

      const rawConfidence = Number(item.mean ?? item.confidence ?? item.score ?? 0)
      // 有的实现给 0–1，有的给 0–100，统一成 0–100
      const confidence = rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence

      lines.push({ ...rect, text, confidence, words: [] })
    }

    return { lines, mirrored: false }
  }

  async terminate(): Promise<void> {
    this.instance = null
  }
}

/** 把点集或扁平坐标数组转成包围盒 */
function toRect(points: unknown): Rect | null {
  if (!Array.isArray(points) || points.length === 0) return null

  const pairs: Array<[number, number]> = []

  if (Array.isArray(points[0])) {
    for (const point of points as unknown[]) {
      if (Array.isArray(point) && point.length >= 2) {
        pairs.push([Number(point[0]), Number(point[1])])
      }
    }
  } else {
    const flat = points as number[]
    for (let index = 0; index + 1 < flat.length; index += 2) {
      pairs.push([Number(flat[index]), Number(flat[index + 1])])
    }
  }

  const valid = pairs.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  if (valid.length === 0) return null

  const xs = valid.map(([x]) => x)
  const ys = valid.map(([, y]) => y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)

  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

function toDataUrl(input: OcrInput): string {
  if (input instanceof HTMLCanvasElement) return input.toDataURL('image/png')

  const canvas = document.createElement('canvas')
  canvas.width = input.naturalWidth
  canvas.height = input.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 2D 画布')
  ctx.drawImage(input, 0, 0)
  return canvas.toDataURL('image/png')
}
