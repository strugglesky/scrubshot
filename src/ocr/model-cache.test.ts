import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelAsset, ModelStore } from './model-cache'
import { IndexedDbModelStore, ModelCache } from './model-cache'

const assets: ModelAsset[] = [
  { kind: 'detectionPath', path: 'models/det.onnx', hash: 'det-v1', size: 5 },
  { kind: 'recognitionPath', path: 'models/rec.onnx', hash: 'rec-v1', size: 5 },
  { kind: 'dictionaryPath', path: 'models/keys.txt', hash: 'keys-v1', size: 5 },
]

function fixture() {
  const saved = new Map<string, Blob>()
  const store: ModelStore = {
    get: vi.fn(async (key) => saved.get(key)),
    put: vi.fn(async (key, blob) => { saved.set(key, blob) }),
    delete: vi.fn(async (key) => { saved.delete(key) }),
    prune: vi.fn(async (keys) => {
      for (const key of saved.keys()) {
        if (!keys.includes(key)) saved.delete(key)
      }
    }),
  }
  const fetcher = vi.fn<typeof fetch>(async () => new Response('model'))
  return { saved, store, fetcher, cache: new ModelCache(assets, store, fetcher) }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ModelCache', () => {
  it('does not invoke the native fetch function with a ModelCache receiver', async () => {
    const { store } = fixture()
    vi.stubGlobal('fetch', vi.fn(function (this: unknown) {
      expect(this).not.toBeInstanceOf(ModelCache)
      return Promise.resolve(new Response('model'))
    }))
    const files = await new ModelCache(assets, store).load()
    files.release()
  })

  it('persists successfully initialized files and reuses them in a new cache instance', async () => {
    const { saved, store, fetcher, cache } = fixture()
    const first = await cache.load()
    try {
      expect(first.fromCache).toBe(false)
      expect(saved.size).toBe(0)
      expect(Object.values(first.models)).toHaveLength(3)
      expect(fetcher).toHaveBeenCalledWith('/models/det.onnx?v=det-v1', { cache: 'default' })
      await first.commit()
      expect(saved.size).toBe(3)
    } finally {
      first.release()
    }
    const second = await new ModelCache(assets, store, fetcher).load()
    try {
      expect(second.fromCache).toBe(true)
      expect(fetcher).toHaveBeenCalledTimes(3)
    } finally {
      second.release()
    }
  })

  it('downloads changed versions and prunes old files only after successful initialization', async () => {
    const { saved, store, fetcher } = fixture()
    for (const asset of assets) saved.set(`${asset.path}:${asset.hash}`, new Blob(['model']))
    const updated = assets.map((asset) => asset.kind === 'detectionPath' ? { ...asset, hash: 'det-v2' } : asset)
    const files = await new ModelCache(updated, store, fetcher).load()
    try {
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(saved.has('models/det.onnx:det-v1')).toBe(true)
      await files.commit()
      expect(saved.has('models/det.onnx:det-v1')).toBe(false)
      expect(saved.has('models/det.onnx:det-v2')).toBe(true)
    } finally {
      files.release()
    }
  })

  it('downloads a replacement for a truncated cached blob', async () => {
    const { saved, fetcher, cache } = fixture()
    for (const asset of assets) saved.set(`${asset.path}:${asset.hash}`, new Blob(['model']))
    saved.set('models/det.onnx:det-v1', new Blob(['bad']))
    const files = await cache.load()
    try {
      expect(fetcher).toHaveBeenCalledTimes(1)
      await files.commit()
      expect(saved.get('models/det.onnx:det-v1')?.size).toBe(5)
    } finally {
      files.release()
    }
  })

  it('invalidates cached files and bypasses both local and HTTP caches on retry', async () => {
    const { saved, store, fetcher, cache } = fixture()
    for (const asset of assets) saved.set(`${asset.path}:${asset.hash}`, new Blob(['model']))
    const cached = await cache.load()
    await cached.invalidate()
    cached.release()
    expect(saved.size).toBe(0)
    vi.mocked(store.get).mockClear()
    const fresh = await cache.load(undefined, true)
    try {
      expect(store.get).not.toHaveBeenCalled()
      expect(fetcher).toHaveBeenCalledWith('/models/det.onnx?v=det-v1', { cache: 'reload' })
    } finally {
      fresh.release()
    }
  })

  it.each([
    [404, 'missing', 'text/plain'],
    [200, '<html>fallback</html>', 'text/html'],
    [200, 'bad', 'application/octet-stream'],
    [200, '', 'application/octet-stream'],
  ])('rejects invalid model responses (%s, %s)', async (status, body, contentType) => {
    const { cache, fetcher, store } = fixture()
    fetcher.mockResolvedValue(new Response(body, { status, headers: { 'content-type': contentType } }))
    await expect(cache.load()).rejects.toThrow(/模型/)
    expect(store.put).not.toHaveBeenCalled()
    expect(store.prune).not.toHaveBeenCalled()
  })

  it('continues without storage and reports a warning if cache reads fail', async () => {
    const { cache, store, fetcher } = fixture()
    vi.mocked(store.get).mockRejectedValue(new Error('storage denied'))
    const onProgress = vi.fn()
    const files = await cache.load(onProgress)
    try {
      await expect(files.commit()).resolves.toBeUndefined()
      expect(fetcher).toHaveBeenCalledTimes(3)
      expect(store.get).toHaveBeenCalledTimes(1)
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ warning: expect.stringContaining('未能保存') }))
    } finally {
      files.release()
    }
  })

  it('keeps downloaded models usable when cache writes fail', async () => {
    const { cache, store } = fixture()
    vi.mocked(store.put).mockRejectedValue(new Error('quota exceeded'))
    const onProgress = vi.fn()
    const files = await cache.load(onProgress)
    try {
      await expect(files.commit()).resolves.toBeUndefined()
      expect(store.prune).not.toHaveBeenCalled()
      expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ warning: expect.stringContaining('未能保存') }))
    } finally {
      files.release()
    }
  })

  it('revokes any URLs already created when URL creation fails partway through', async () => {
    const { cache } = fixture()
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:first').mockImplementationOnce(() => {
      throw new Error('URL creation failed')
    })
    await expect(cache.load()).rejects.toThrow('URL creation failed')
    expect(revoke).toHaveBeenCalledWith('blob:first')
  })
})

describe('IndexedDbModelStore', () => {
  it('rejects unavailable IndexedDB so model loading can fall back to downloads', async () => {
    vi.stubGlobal('indexedDB', undefined)
    await expect(new IndexedDbModelStore().get('model')).rejects.toThrow()
  })
})
