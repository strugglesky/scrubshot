import * as ort from 'onnxruntime-web'
import type { Rect, TextLine } from '../types'
import type { OcrEngine, OcrInput, OcrProgress, OcrResult } from './engine'
import { ModelCache } from './model-cache'

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

/** OCR 不需要保留原图的全部像素；限制输入可避免超大 Canvas 和 Data URL 触发浏览器 OOM。 */
export const RAPID_MAX_SIDE = 3000

export class RapidEngine implements OcrEngine {
  private instance: RapidInstance | null = null
  private pending: Promise<void> | null = null
  private terminated = false

  constructor(private cache = new ModelCache()) {}

  async init(onProgress?: (progress: OcrProgress) => void): Promise<void> {
    if (this.terminated) throw new Error('RapidOCR 已关闭')
    if (this.instance) return
    if (!this.pending) {
      this.pending = this.initialize(onProgress).finally(() => {
        this.pending = null
      })
    }
    await this.pending
  }

  private async initialize(onProgress?: (progress: OcrProgress) => void): Promise<void> {
    // 单线程：多线程需要 cross-origin isolation（COOP/COEP），静态托管往往配不了，
    // 而开了线程反而会直接失败。
    // wasm 不走 CDN，由 ORT 按 import.meta.url 解析到构建产物里 —— 断网可用。
    ort.env.wasm.numThreads = 1

    onProgress?.({ status: 'loading engine', progress: 0 })

    const module = (await import('@sanduc/ocr-browser')) as Record<string, unknown>
    const candidate =
      (module.Ocr as { create?: (options: Record<string, unknown>) => Promise<unknown> } | undefined) ??
      (module.default as { create?: (options: Record<string, unknown>) => Promise<unknown> } | undefined)

    if (!candidate || typeof candidate.create !== 'function') {
      throw new Error(`RapidOCR 导出结构不符：${Object.keys(module).join(' / ') || '空模块'}`)
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const files = await this.cache.load(onProgress, attempt > 0)
      try {
        if (this.terminated) throw new Error('RapidOCR 已关闭')
        onProgress?.({ status: 'initializing', progress: 0 })
        const created = (await candidate.create({ models: files.models })) as RapidInstance
        if (typeof created.detect !== 'function') {
          throw new Error(`RapidOCR 实例缺少 detect()：${Object.keys(created).join(' / ')}`)
        }
        if (this.terminated) throw new Error('RapidOCR 已关闭')
        await files.commit()
        if (this.terminated) throw new Error('RapidOCR 已关闭')
        this.instance = created
        return
      } catch (error) {
        if (this.terminated || attempt > 0 || !files.fromCache) throw error
        await files.invalidate()
      } finally {
        files.release()
      }
    }
  }

  async recognize(input: OcrInput): Promise<OcrResult> {
    if (!this.instance?.detect) throw new Error('RapidOCR 未初始化')

    const prepared = toDataUrl(input)
    const result = (await this.instance.detect(prepared.dataUrl)) as unknown
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

      lines.push({ ...scaleRectForSource(rect, prepared.scale), text, confidence, words: [] })
    }

    return { lines, mirrored: false }
  }

  async terminate(): Promise<void> {
    this.terminated = true
    await this.pending?.catch(() => undefined)
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

export function scaleRectForSource(rect: Rect, scale: number): Rect {
  return {
    x: rect.x / scale,
    y: rect.y / scale,
    w: rect.w / scale,
    h: rect.h / scale,
  }
}

function toDataUrl(input: OcrInput): { dataUrl: string; scale: number } {
  const sourceWidth = input instanceof HTMLImageElement ? input.naturalWidth : input.width
  const sourceHeight = input instanceof HTMLImageElement ? input.naturalHeight : input.height
  const longest = Math.max(sourceWidth, sourceHeight)
  const scale = longest > RAPID_MAX_SIDE ? RAPID_MAX_SIDE / longest : 1
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))

  if (input instanceof HTMLCanvasElement && scale === 1) {
    return { dataUrl: input.toDataURL('image/png'), scale }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 2D 画布')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(input, 0, 0, width, height)
  return { dataUrl: canvas.toDataURL('image/png'), scale }
}
