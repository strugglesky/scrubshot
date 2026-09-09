export type RedactStyle = 'solid' | 'blur' | 'pixelate'

export type ExportFormat = 'png' | 'jpeg' | 'webp'

export type Risk = 'high' | 'medium' | 'low'

export type BoxOrigin = 'manual' | 'auto'

export type ItemStatus = 'queued' | 'running' | 'done' | 'error'

/** 归一化矩形：w、h 恒为正，坐标单位为原图像素。 */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Box extends Rect {
  id: string
  /** 预留：将来支持每个框单独设置打码样式 */
  style?: RedactStyle
  origin?: BoxOrigin
  /** 命中的规则名，例如"手机号" */
  label?: string
  /** 命中的具体文本，用于在清单里让人核对 */
  detail?: string
  risk?: Risk
  /** false 表示"仅提示、不打码" */
  enabled?: boolean
}

export interface Pt {
  x: number
  y: number
}

export type Handle = 'nw' | 'ne' | 'sw' | 'se'

export interface Doc {
  image: HTMLImageElement
  width: number
  height: number
  name: string
  /** 数据 URL 缩略图，供左侧队列使用（对象 URL 在加载后就释放了） */
  thumb: string
  /** 原始文件字节数 */
  size: number
}

/** 队列里的一张图：自带打码框、识别文本和撤销栈。 */
export interface BatchItem extends Doc {
  id: string
  boxes: Box[]
  past: Box[][]
  future: Box[][]
  lines: ScannedLine[]
  status: ItemStatus
  progress: number
  /** 识别时判断这张图是镜像的，已做水平翻转 */
  mirrored?: boolean
  message?: string
  error?: string
}

/** OCR 识别出的一个词（带独立包围盒）。 */
export interface OcrWord extends Rect {
  text: string
  confidence: number
}

/** OCR 输出的一行文字（已归一化为原图坐标）。 */
export interface TextLine extends Rect {
  text: string
  confidence: number
  /**
   * 词级包围盒。截图里一行可能横跨整个界面（左边文件树 + 右边编辑器），
   * 只靠行 bbox 会框住整条带子，必须下沉到词。
   */
  words: OcrWord[]
}

/** 带上"是否命中规则"标记的文本行，用于界面上展示识别全貌。 */
export interface ScannedLine extends TextLine {
  flagged: boolean
}

export interface OcrState {
  status: 'idle' | ItemStatus
  progress: number
  message?: string
}
