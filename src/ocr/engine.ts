import type { TextLine } from '../types'

export interface OcrProgress {
  status: string
  progress: number
}

export interface OcrResult {
  lines: TextLine[]
  /** 这张图是镜像的（识别时做了水平翻转） */
  mirrored: boolean
}

export type OcrInput = HTMLImageElement | HTMLCanvasElement

export type OcrMode = 'auto' | 'mirror'

/** 可选的识别引擎 */
export type EngineKind = 'tesseract' | 'rapid'

/**
 * Tesseract 版面分割模式。
 * '3' 自动、'6' 单块、'11' 稀疏；'tiled' 是分块识别（绕过版面分析）。
 * 截图/表单/便签没有一个通吃的值，所以做成可切换的，用评测页跑同一批图对比。
 */
export type PsmMode = '3' | '6' | '11' | 'tiled'

/**
 * OCR 引擎接口。
 *
 * 之所以第一版就抽接口：OCR 是整条链路里最不确定的一环（模型体积、
 * 中文准确率、WASM 性能）。先用 tesseract 打通交互，再换 RapidOCR，
 * 上层代码一行都不用改。
 */
export interface OcrEngine {
  init(onProgress?: (progress: OcrProgress) => void): Promise<void>
  recognize(input: OcrInput, mode?: OcrMode, psm?: PsmMode): Promise<OcrResult>
  terminate(): Promise<void>
}
