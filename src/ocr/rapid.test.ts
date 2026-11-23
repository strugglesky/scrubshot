import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelCache } from './model-cache'
import { RAPID_MAX_SIDE, RapidEngine, scaleRectForSource } from './rapid'

const { create } = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('onnxruntime-web', () => ({ env: { wasm: {} } }))
vi.mock('@sanduc/ocr-browser', () => ({ Ocr: { create } }))

function modelFiles(fromCache = false) {
  return {
    models: { detectionPath: 'blob:det', recognitionPath: 'blob:rec', dictionaryPath: 'blob:keys' },
    fromCache,
    release: vi.fn(),
    invalidate: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  create.mockReset()
})

describe('RapidEngine initialization', () => {
  it('maps boxes from the bounded OCR image back to source coordinates', () => {
    expect(RAPID_MAX_SIDE).toBe(3000)
    expect(scaleRectForSource({ x: 100, y: 80, w: 500, h: 240 }, 0.5)).toEqual({
      x: 200,
      y: 160,
      w: 1000,
      h: 480,
    })
  })

  it('shares initialization and releases model URLs on success', async () => {
    const cache = new ModelCache([])
    const files = modelFiles()
    const load = vi.spyOn(cache, 'load').mockResolvedValue(files)
    create.mockResolvedValue({ detect: vi.fn() })
    const engine = new RapidEngine(cache)
    await Promise.all([engine.init(), engine.init()])
    await engine.init()
    expect(load).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
    expect(files.commit).toHaveBeenCalledTimes(1)
    expect(files.release).toHaveBeenCalledTimes(1)
  })

  it('invalidates failed cached files and retries with downloads exactly once', async () => {
    const cache = new ModelCache([])
    const cached = modelFiles(true)
    const fresh = modelFiles()
    const load = vi.spyOn(cache, 'load').mockResolvedValueOnce(cached).mockResolvedValueOnce(fresh)
    create.mockRejectedValueOnce(new Error('bad model')).mockResolvedValueOnce({ detect: vi.fn() })
    await new RapidEngine(cache).init()
    expect(load).toHaveBeenNthCalledWith(1, undefined, false)
    expect(load).toHaveBeenNthCalledWith(2, undefined, true)
    expect(cached.invalidate).toHaveBeenCalledTimes(1)
    expect(cached.commit).not.toHaveBeenCalled()
    expect(cached.release).toHaveBeenCalledTimes(1)
    expect(fresh.release).toHaveBeenCalledTimes(1)
    expect(fresh.commit).toHaveBeenCalledTimes(1)
  })

  it('does not redownload fresh files if initialization fails', async () => {
    const cache = new ModelCache([])
    const files = modelFiles()
    const load = vi.spyOn(cache, 'load').mockResolvedValue(files)
    create.mockRejectedValue(new Error('WASM unavailable'))
    await expect(new RapidEngine(cache).init()).rejects.toThrow('WASM unavailable')
    expect(load).toHaveBeenCalledTimes(1)
    expect(files.commit).not.toHaveBeenCalled()
    expect(files.release).toHaveBeenCalledTimes(1)
  })

  it('propagates a failed redownload attempt instead of looping', async () => {
    const cache = new ModelCache([])
    const files = modelFiles(true)
    const load = vi.spyOn(cache, 'load').mockResolvedValue(files)
    create.mockRejectedValue(new Error('bad model'))
    await expect(new RapidEngine(cache).init()).rejects.toThrow('bad model')
    expect(load).toHaveBeenCalledTimes(2)
    expect(files.release).toHaveBeenCalledTimes(2)
  })

  it('does not resurrect an instance terminated during initialization', async () => {
    const cache = new ModelCache([])
    const files = modelFiles()
    vi.spyOn(cache, 'load').mockResolvedValue(files)
    let finish!: (value: { detect: () => Promise<never[]> }) => void
    create.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const engine = new RapidEngine(cache)
    const pending = engine.init()
    const rejection = expect(pending).rejects.toThrow('已关闭')
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const termination = engine.terminate()
    finish({ detect: async () => [] })
    await rejection
    await termination
    expect(files.commit).not.toHaveBeenCalled()
    expect(files.release).toHaveBeenCalledTimes(1)
    await expect(engine.init()).rejects.toThrow('已关闭')
  })
})
