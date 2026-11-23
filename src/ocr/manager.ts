import type { EngineKind, OcrEngine, OcrProgress } from './engine'

export interface ModelState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  message: string
  warning?: string
}

interface EngineEntry {
  engine: OcrEngine
  pending: Promise<OcrEngine> | null
  ready: boolean
  progress?: OcrProgress
  listeners: Set<(progress: OcrProgress) => void>
}

export class EngineManager {
  private entries = new Map<EngineKind, EngineEntry>()
  private listeners = new Set<(state: ModelState) => void>()
  private disposed = false
  private leases = 0
  private state: ModelState = { status: 'idle', message: '模型准备中…' }

  constructor(private create: (kind: EngineKind) => OcrEngine) {}

  retain(): () => void {
    this.leases += 1
    return () => {
      this.leases -= 1
      queueMicrotask(() => {
        if (this.leases === 0) void this.dispose()
      })
    }
  }

  subscribe(listener: (state: ModelState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  private publish(state: ModelState): void {
    if (this.disposed) return
    this.state = state
    this.listeners.forEach((listener) => listener(state))
  }

  async ensure(kind: EngineKind, onProgress?: (progress: OcrProgress) => void): Promise<OcrEngine> {
    if (this.disposed) throw new Error('OCR 引擎已关闭')
    let entry = this.entries.get(kind)
    if (!entry) {
      entry = { engine: this.create(kind), pending: null, ready: false, listeners: new Set() }
      this.entries.set(kind, entry)
    }
    const current = entry
    if (onProgress) {
      current.listeners.add(onProgress)
      if (current.progress) onProgress(current.progress)
    }
    try {
      if (current.ready) {
        if (kind === 'tesseract') await current.engine.init(onProgress)
        return current.engine
      }
      if (!current.pending) {
        if (kind === 'rapid') this.publish({ status: 'loading', message: '模型准备中…' })
        current.pending = Promise.resolve().then(async () => {
          try {
            await current.engine.init((progress) => {
              current.progress = progress
              if (this.disposed) return
              current.listeners.forEach((listener) => listener(progress))
              if (kind === 'rapid') {
                const message = progress.status === 'reading cache'
                  ? '读取本地模型…'
                  : progress.status === 'loading language'
                    ? '下载识别模型…'
                    : '初始化识别引擎…'
                this.publish({ status: 'loading', message, warning: progress.warning ?? this.state.warning })
              }
            })
            if (this.disposed) throw new Error('OCR 引擎已关闭')
            current.ready = true
            if (kind === 'rapid') {
              this.publish({ status: 'ready', message: '模型已就绪', warning: this.state.warning })
            }
            return current.engine
          } catch (error) {
            if (kind === 'rapid') {
              this.publish({
                status: 'error',
                message: `模型加载失败：${error instanceof Error ? error.message : '请重试'}`,
              })
            }
            if (!this.disposed) {
              this.entries.delete(kind)
              await current.engine.terminate().catch(() => undefined)
            }
            throw error
          } finally {
            current.pending = null
          }
        })
      }
      const engine = await current.pending
      if (kind === 'tesseract') await engine.init(onProgress)
      return engine
    } finally {
      if (onProgress) current.listeners.delete(onProgress)
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.listeners.clear()
    const entries = [...this.entries.values()]
    this.entries.clear()
    await Promise.all(entries.map(async (entry) => {
      await entry.pending?.catch(() => undefined)
      await entry.engine.terminate().catch(() => undefined)
      entry.listeners.clear()
    }))
  }
}
