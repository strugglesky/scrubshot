import type { OcrProgress } from './engine'

export type ModelPaths = {
  detectionPath: string
  recognitionPath: string
  dictionaryPath: string
}

export interface ModelAsset {
  kind: keyof ModelPaths
  path: string
  hash: string
  size: number
}

export interface ModelStore {
  get(key: string): Promise<Blob | undefined>
  put(key: string, blob: Blob): Promise<void>
  delete(key: string): Promise<void>
  prune(keys: string[]): Promise<void>
}

export class IndexedDbModelStore implements ModelStore {
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('scrubshot-ocr-models', 1)
      let settled = false
      const timer = setTimeout(() => {
        settled = true
        reject(new Error('模型缓存打开超时'))
      }, 5000)
      const fail = (error: Error) => {
        settled = true
        clearTimeout(timer)
        reject(error)
      }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('assets')) {
          request.result.createObjectStore('assets')
        }
      }
      request.onblocked = () => fail(new Error('模型缓存被其他页面阻塞'))
      request.onerror = () => fail(request.error ?? new Error('模型缓存不可用'))
      request.onsuccess = () => {
        clearTimeout(timer)
        if (settled) {
          request.result.close()
          return
        }
        request.result.onversionchange = () => request.result.close()
        resolve(request.result)
      }
    })
  }

  private async transact<Result>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<Result>,
  ): Promise<Result> {
    const database = await this.open()
    try {
      return await new Promise<Result>((resolve, reject) => {
        const transaction = database.transaction('assets', mode)
        const request = action(transaction.objectStore('assets'))
        transaction.oncomplete = () => resolve(request.result)
        transaction.onabort = () => reject(transaction.error ?? new Error('模型缓存事务失败'))
        transaction.onerror = () => reject(transaction.error ?? new Error('模型缓存事务失败'))
      })
    } finally {
      database.close()
    }
  }

  get(key: string): Promise<Blob | undefined> {
    return this.transact('readonly', (store) => store.get(key))
  }

  async put(key: string, blob: Blob): Promise<void> {
    await this.transact('readwrite', (store) => store.put(blob, key))
  }

  async delete(key: string): Promise<void> {
    await this.transact('readwrite', (store) => store.delete(key))
  }

  async prune(keys: string[]): Promise<void> {
    const existing = await this.transact('readonly', (store) => store.getAllKeys())
    const obsolete = existing.filter((key) => !keys.includes(String(key)))
    await Promise.all(obsolete.map((key) => this.delete(String(key))))
  }
}

export class ModelCache {
  constructor(
    private assets: readonly ModelAsset[] = __OCR_MODELS__,
    private store: ModelStore = new IndexedDbModelStore(),
    private fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async load(onProgress?: (progress: OcrProgress) => void, bypassCache = false) {
    let warning: string | undefined
    let storageAvailable = true
    let status = 'reading cache'
    let progress = 0
    const report = () => onProgress?.({ status, progress, warning })
    const cacheFailure = () => {
      storageAvailable = false
      warning = '本次可用，未能保存本地缓存；下次可能需要重新下载'
      report()
    }
    report()
    const loaded: Array<{ asset: ModelAsset; key: string; blob: Blob; cached: boolean }> = []
    const total = this.assets.reduce((sum, asset) => sum + asset.size, 0)
    let completed = 0
    for (const asset of this.assets) {
      const key = `${asset.path}:${asset.hash}`
      let blob: Blob | undefined
      if (!bypassCache && storageAvailable) {
        try {
          blob = await this.store.get(key)
        } catch {
          cacheFailure()
        }
      }
      const cached = blob instanceof Blob && blob.size === asset.size
      if (!cached) {
        status = 'loading language'
        report()
        const response = await this.fetcher(`${import.meta.env.BASE_URL}${asset.path}?v=${asset.hash}`, {
          cache: bypassCache ? 'reload' : 'default',
        })
        if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
          throw new Error(`模型下载失败：${asset.path}（${response.status}）`)
        }
        blob = await response.blob()
        if (blob.size !== asset.size || blob.size === 0) {
          throw new Error(`模型文件不完整：${asset.path}`)
        }
      }
      loaded.push({ asset, key, blob: blob!, cached })
      completed += asset.size
      progress = total > 0 ? completed / total : 0
      report()
    }

    const urls: string[] = []
    const models = {} as ModelPaths
    try {
      for (const file of loaded) {
        const url = URL.createObjectURL(file.blob)
        urls.push(url)
        models[file.asset.kind] = url
      }
    } catch (error) {
      urls.forEach((url) => URL.revokeObjectURL(url))
      throw error
    }

    return {
      models,
      fromCache: loaded.some((file) => file.cached),
      release: () => urls.forEach((url) => URL.revokeObjectURL(url)),
      invalidate: async () => {
        if (!storageAvailable) return
        try {
          await Promise.all(loaded.filter((file) => file.cached).map((file) => this.store.delete(file.key)))
        } catch {
          cacheFailure()
        }
      },
      commit: async () => {
        if (!storageAvailable) return
        try {
          for (const file of loaded) {
            if (!file.cached) await this.store.put(file.key, file.blob)
          }
          await this.store.prune(loaded.map((file) => file.key))
        } catch {
          cacheFailure()
        }
      },
    }
  }
}
