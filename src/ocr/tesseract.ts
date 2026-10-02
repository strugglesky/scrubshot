import { PSM, createWorker } from 'tesseract.js'
import type { OcrEngine, OcrInput, OcrMode, OcrProgress, OcrResult, PsmMode } from './engine'
import type { RawBox, RawLine, RawPage, RawWord } from './mapping'
import { mapPage } from './mapping'

const LANGUAGES = 'chi_sim+eng'

/** OCR 前把图放大一些，截图里的 12-14px 小字直接识别率很低。 */
const MAX_SIDE = 3000
const UPSCALE = 2

/** 平均置信度低于这个值，就怀疑方向不对，试一次水平翻转 */
const RETRY_SCORE = 60
/** 翻转后必须比原来明显更好，才认定"原图是镜像的"，避免短文本误判 */
const RETRY_MARGIN = 10
const RETRY_MIN = 15

const PSM_BY_MODE: Record<Exclude<PsmMode, 'tiled'>, PSM> = {
  '3': PSM.AUTO,
  '6': PSM.SINGLE_BLOCK,
  '11': PSM.SPARSE_TEXT,
}

/** 分块识别的切分方式 */
const TILE_COLS = 2
const TILE_ROWS = 2
/** 相邻块的重叠比例，避免正好切在文字上 */
const TILE_OVERLAP = 0.08
const TILE_MIN_SIDE = 40

/** 不依赖 tesseract.js 是否导出 Worker 类型，直接从 factory 推导 */
type TesseractWorker = Awaited<ReturnType<typeof createWorker>>

export class TesseractEngine implements OcrEngine {
  private worker: TesseractWorker | null = null
  private currentPsm: PsmMode | null = null
  /** 每次 init 都更新，避免第二次识别时进度回调还指向旧的 runId */
  private onProgress: ((progress: OcrProgress) => void) | undefined

  async init(onProgress?: (progress: OcrProgress) => void): Promise<void> {
    this.onProgress = onProgress
    if (this.worker) return
    this.worker = await createWorker(LANGUAGES, 1, {
      logger: (message: { status: string; progress: number }) => {
        this.onProgress?.({ status: message.status, progress: message.progress ?? 0 })
      },
    })
  }

  private async applyPsm(psm: Exclude<PsmMode, 'tiled'>): Promise<void> {
    if (this.currentPsm === psm || !this.worker) return
    this.currentPsm = psm
    await this.worker.setParameters({ tessedit_pageseg_mode: PSM_BY_MODE[psm] })
  }

  async recognize(input: OcrInput, mode: OcrMode = 'auto', psm?: PsmMode): Promise<OcrResult> {
    if (!this.worker) throw new Error('OCR 引擎尚未初始化')

    const tiled = psm === 'tiled'
    if (psm && psm !== 'tiled') await this.applyPsm(psm)
    if (tiled) await this.applyPsm('6')

    const width = input instanceof HTMLImageElement ? input.naturalWidth : input.width
    const base = prepare(input)
    const run = (canvas: HTMLCanvasElement) =>
      tiled ? this.runTiled(canvas) : this.run(canvas)

    if (mode === 'mirror') {
      const page = await run(flip(base.canvas))
      return { lines: mapPage(page, base.scale, true, width), mirrored: true }
    }

    const forward = await run(base.canvas)
    const forwardScore = scoreOf(forward)

    // 分块本身就是兜底手段，不再叠加镜像重试（否则一次要跑 8 遍）
    if (tiled || forwardScore >= RETRY_SCORE) {
      return { lines: mapPage(forward, base.scale, false, width), mirrored: false }
    }

    // 置信度不高：怀疑是镜像图，翻转后再试一次
    const flipped = await run(flip(base.canvas))
    const flippedScore = scoreOf(flipped)

    // 内容量也要看：翻转后只剩一两行时不能算"更好"，否则会挑一个几乎空白的结果
    const enoughContent = flipped.lines.length >= Math.max(2, forward.lines.length * 0.6)

    if (enoughContent && flippedScore >= RETRY_MIN && flippedScore >= forwardScore + RETRY_MARGIN) {
      return { lines: mapPage(flipped, base.scale, true, width), mirrored: true }
    }

    return { lines: mapPage(forward, base.scale, false, width), mirrored: false }
  }

  /**
   * 分块识别：切成 2×2（带重叠）分别识别，再把坐标移回整图。
   *
   * 目的是绕过 Tesseract 的版面分析——它会在表单/便签这类"线条+留白"的构图上
   * 把整块区域判成表格或图形然后跳过。块足够小的时候，它只会当成普通文本块读。
   */
  private async runTiled(canvas: HTMLCanvasElement): Promise<RawPage> {
    const tileWidth = Math.ceil(canvas.width / TILE_COLS)
    const tileHeight = Math.ceil(canvas.height / TILE_ROWS)
    const padX = Math.round(tileWidth * TILE_OVERLAP)
    const padY = Math.round(tileHeight * TILE_OVERLAP)

    const lines: RawLine[] = []
    const words: RawWord[] = []

    for (let row = 0; row < TILE_ROWS; row += 1) {
      for (let col = 0; col < TILE_COLS; col += 1) {
        const sx = Math.max(0, col * tileWidth - padX)
        const sy = Math.max(0, row * tileHeight - padY)
        const ex = Math.min(canvas.width, (col + 1) * tileWidth + padX)
        const ey = Math.min(canvas.height, (row + 1) * tileHeight + padY)
        const w = ex - sx
        const h = ey - sy
        if (w < TILE_MIN_SIDE || h < TILE_MIN_SIDE) continue

        const tile = document.createElement('canvas')
        tile.width = w
        tile.height = h
        const ctx = tile.getContext('2d')
        if (!ctx) continue
        ctx.drawImage(canvas, sx, sy, w, h, 0, 0, w, h)

        const page = await this.run(tile)
        for (const line of page.lines) {
          lines.push({ ...line, bbox: shiftBox(line.bbox, sx, sy) })
        }
        for (const word of page.words) {
          words.push({ ...word, bbox: shiftBox(word.bbox, sx, sy) })
        }
      }
    }

    return { lines: dedupeLines(lines), words }
  }

  private async run(canvas: HTMLCanvasElement): Promise<RawPage> {
    const worker = this.worker
    if (!worker) throw new Error('OCR 引擎尚未初始化')

    // 显式要 blocks，否则拿不到词级包围盒
    const result = await worker.recognize(canvas, {}, { text: true, blocks: true })
    const data = result.data as unknown as { lines?: RawPage['lines']; words?: RawPage['words'] }
    return { lines: data.lines ?? [], words: data.words ?? [] }
  }

  async terminate(): Promise<void> {
    await this.worker?.terminate()
    this.worker = null
  }
}

function prepare(input: OcrInput): { canvas: HTMLCanvasElement; scale: number } {
  const width = input instanceof HTMLImageElement ? input.naturalWidth : input.width
  const height = input instanceof HTMLImageElement ? input.naturalHeight : input.height
  const longest = Math.max(width, height)
  const scale = Math.min(UPSCALE, Math.max(1, MAX_SIDE / longest))

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 2D 画布')

  // 透明背景会让 OCR 读到一片黑，先铺白
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(input, 0, 0, canvas.width, canvas.height)

  // 深色主题截图（开发者截图里很常见）：反色后再识别
  if (isDark(ctx.canvas)) {
    ctx.globalCompositeOperation = 'difference'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.globalCompositeOperation = 'source-over'
  }

  // 表格线/横格线会让版面分析把整块区域判成"表格"然后跳过。
  // 擦掉贯穿整幅图的直线，剩下的就是普通文字。
  removeRules(canvas)

  return { canvas, scale }
}

/**
 * 把横贯/纵贯整幅图的深色直线涂白。
 *
 * 判定标准是"这一行（列）有超过 60% 的像素是暗的"——文字行远达不到这个比例，
 * 表格边框和便签横线则几乎 100%。擦掉后 Tesseract 不再把它们当表格处理。
 */
function removeRules(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const { width, height } = canvas
  if (width < 8 || height < 8) return

  const image = ctx.getImageData(0, 0, width, height)
  const data = image.data

  const lumaAt = (x: number, y: number): number => {
    const index = (y * width + x) * 4
    return 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
  }

  // 用中位亮度定"墨色"阈值。白纸上表格线是浅灰（约 150），暗照片整体偏暗；
  // 固定阈值 100 既漏掉浅灰表格线，又会在暗图上把整张纸误判成墨。
  const samples: number[] = []
  const stride = 7
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      samples.push(lumaAt(x, y))
    }
  }
  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)] ?? 255
  const inkThreshold = Math.max(40, median - 70)

  const isDarkPixel = (x: number, y: number): boolean => lumaAt(x, y) < inkThreshold

  const paintWhite = (x: number, y: number): void => {
    const index = (y * width + x) * 4
    data[index] = 255
    data[index + 1] = 255
    data[index + 2] = 255
    data[index + 3] = 255
  }

  for (let y = 0; y < height; y += 1) {
    let count = 0
    for (let x = 0; x < width; x += 1) {
      if (isDarkPixel(x, y)) count += 1
    }
    if (count > width * 0.6) {
      for (let x = 0; x < width; x += 1) paintWhite(x, y)
    }
  }

  for (let x = 0; x < width; x += 1) {
    let count = 0
    for (let y = 0; y < height; y += 1) {
      if (isDarkPixel(x, y)) count += 1
    }
    if (count > height * 0.6) {
      for (let y = 0; y < height; y += 1) paintWhite(x, y)
    }
  }

  ctx.putImageData(image, 0, 0)
}

/** 水平翻转一份画布（不动原画布，因为正向结果可能还要用） */
function flip(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height

  const ctx = canvas.getContext('2d')
  if (!ctx) return source

  ctx.translate(canvas.width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(source, 0, 0)
  return canvas
}

/** 把分块内的坐标平移回整图坐标 */
function shiftBox(box: RawBox, dx: number, dy: number): RawBox {
  return { x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy }
}

/** 重叠区域会被两块各读一遍，按"文本 + 位置分桶"去重 */
function dedupeLines(lines: RawLine[]): RawLine[] {
  const seen = new Set<string>()
  const result: RawLine[] = []

  for (const line of lines) {
    const key = `${line.text}|${Math.round(line.bbox.x0 / 24)}|${Math.round(line.bbox.y0 / 24)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(line)
  }

  return result
}

/** 按字符数加权的平均置信度：一行 1 个字的 90 分不该压过 40 个字的 80 分。 */
function scoreOf(page: RawPage): number {
  let chars = 0
  let weighted = 0

  for (const line of page.lines) {
    const text = (line.text ?? '').trim()
    if (text.length === 0) continue
    chars += text.length
    weighted += text.length * (line.confidence ?? 0)
  }

  return chars > 0 ? weighted / chars : 0
}

function isDark(source: HTMLCanvasElement): boolean {
  const sample = document.createElement('canvas')
  sample.width = 32
  sample.height = 32
  const ctx = sample.getContext('2d')
  if (!ctx) return false

  ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, 32, 32)
  const { data } = ctx.getImageData(0, 0, 32, 32)

  let sum = 0
  for (let index = 0; index < data.length; index += 4) {
    sum += 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
  }
  return sum / (32 * 32) < 96
}
