import { describe, expect, it, vi } from 'vitest'
import type { OcrEngine, OcrProgress } from './engine'
import { EngineManager } from './manager'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((finish) => { resolve = finish })
  return { promise, resolve }
}

function makeEngine(init: OcrEngine['init'] = async () => undefined): OcrEngine {
  return {
    init: vi.fn(init),
    recognize: vi.fn(async () => ({ lines: [], mirrored: false })),
    terminate: vi.fn(async () => undefined),
  }
}

describe('EngineManager', () => {
  it('shares initialization between preload and recognition and broadcasts progress', async () => {
    const gate = deferred()
    let report!: (progress: OcrProgress) => void
    const engine = makeEngine(async (onProgress) => {
      report = onProgress!
      report({ status: 'reading cache', progress: 0 })
      await gate.promise
    })
    const create = vi.fn(() => engine)
    const manager = new EngineManager(create)
    const state = vi.fn()
    manager.subscribe(state)
    const preload = manager.ensure('rapid')
    await Promise.resolve()
    const progress = vi.fn()
    const recognition = manager.ensure('rapid', progress)
    expect(progress).toHaveBeenCalledWith({ status: 'reading cache', progress: 0 })
    report({ status: 'initializing', progress: 0 })
    gate.resolve()
    expect(await preload).toBe(engine)
    expect(await recognition).toBe(engine)
    expect(await manager.ensure('rapid')).toBe(engine)
    expect(create).toHaveBeenCalledTimes(1)
    expect(engine.init).toHaveBeenCalledTimes(1)
    expect(state).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready' }))
    await manager.dispose()
  })

  it('retains cache warnings after the model becomes ready', async () => {
    const manager = new EngineManager(() => makeEngine(async (onProgress) => {
      onProgress?.({ status: 'loading language', progress: 1, warning: '缓存不可用' })
      onProgress?.({ status: 'initializing', progress: 0 })
    }))
    const state = vi.fn()
    manager.subscribe(state)
    await manager.ensure('rapid')
    expect(state).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready', warning: '缓存不可用' }))
    await manager.dispose()
  })

  it('creates a fresh engine after a failed attempt without loading the fallback in the background', async () => {
    const failed = makeEngine(async () => { throw new Error('offline') })
    const success = makeEngine()
    const create = vi.fn().mockReturnValueOnce(failed).mockReturnValueOnce(success)
    const manager = new EngineManager(create)
    const state = vi.fn()
    manager.subscribe(state)
    await expect(manager.ensure('rapid')).rejects.toThrow('offline')
    expect(failed.terminate).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
    expect(state).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error' }))
    expect(await manager.ensure('rapid')).toBe(success)
    await manager.dispose()
  })

  it('survives StrictMode effect cleanup and setup without starting another engine', async () => {
    const engine = makeEngine()
    const manager = new EngineManager(() => engine)
    const releaseFirst = manager.retain()
    const first = manager.ensure('rapid')
    releaseFirst()
    const releaseSecond = manager.retain()
    const second = manager.ensure('rapid')
    await Promise.all([first, second])
    expect(engine.init).toHaveBeenCalledTimes(1)
    expect(engine.terminate).not.toHaveBeenCalled()
    releaseSecond()
    await vi.waitFor(() => expect(engine.terminate).toHaveBeenCalledTimes(1))
  })

  it('does not publish readiness or return an engine when disposed during initialization', async () => {
    const gate = deferred()
    const engine = makeEngine(() => gate.promise)
    const manager = new EngineManager(() => engine)
    const state = vi.fn()
    manager.subscribe(state)
    const pending = manager.ensure('rapid')
    await Promise.resolve()
    const rejection = expect(pending).rejects.toThrow('已关闭')
    const disposed = manager.dispose()
    gate.resolve()
    await rejection
    await disposed
    expect(engine.terminate).toHaveBeenCalledTimes(1)
    expect(state.mock.calls.some(([value]) => value.status === 'ready')).toBe(false)
    await expect(manager.ensure('rapid')).rejects.toThrow('已关闭')
  })

  it('retains both engines when switching without terminating an in-flight preload', async () => {
    const gate = deferred()
    const rapid = makeEngine(() => gate.promise)
    const tesseract = makeEngine()
    const manager = new EngineManager((kind) => kind === 'rapid' ? rapid : tesseract)
    const preload = manager.ensure('rapid')
    expect(await manager.ensure('tesseract')).toBe(tesseract)
    expect(rapid.terminate).not.toHaveBeenCalled()
    gate.resolve()
    expect(await preload).toBe(rapid)
    expect(await manager.ensure('rapid')).toBe(rapid)
    const progress = vi.fn()
    await manager.ensure('tesseract', progress)
    expect(tesseract.init).toHaveBeenLastCalledWith(progress)
    await manager.dispose()
    expect(rapid.terminate).toHaveBeenCalledTimes(1)
    expect(tesseract.terminate).toHaveBeenCalledTimes(1)
  })
})
