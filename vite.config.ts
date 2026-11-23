import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vite'

const require = createRequire(resolve(process.cwd(), 'package.json'))

/** RapidOCR 用的模型：mobile 版（快），server 版留给需要极限精度的场景 */
const OCR_MODELS = {
  detectionPath: 'PP-OCRv5_mobile_det_infer.onnx',
  recognitionPath: 'PP-OCRv5_mobile_rec_infer.onnx',
  dictionaryPath: 'ppocr_keys_v5.txt',
}

function copyModels() {
  try {
    const entry = require.resolve('@sanduc/ocr-models/node')
    const source = resolve(dirname(entry), 'assets')
    const target = resolve('public/models')
    mkdirSync(target, { recursive: true })

    return Object.entries(OCR_MODELS).map(([kind, file]) => {
      const from = resolve(source, file)
      const to = resolve(target, file)
      if (!existsSync(from)) {
        throw new Error(`缺少模型文件 ${file}`)
      }
      const data = readFileSync(from)
      const hash = createHash('sha256').update(data).digest('hex')
      if (!existsSync(to) || createHash('sha256').update(readFileSync(to)).digest('hex') !== hash) {
        copyFileSync(from, to)
      }
      return { kind, path: `models/${file}`, hash, size: data.length }
    })
  } catch (error) {
    throw new Error('OCR 模型复制失败', { cause: error })
  }
}

export default defineConfig(() => {
  const models = copyModels()

  return {
    plugins: [react()],
    define: {
      __OCR_MODELS__: JSON.stringify(models),
    },
    server: {
      port: 5173,
    },
    // ORT 的 wasm 是按 import.meta.url 定位的；预打包会把这个地址改坏，
    // 所以让它以源码形式参与，URL 才会被 Vite 正确重写成产物路径。
    optimizeDeps: {
      exclude: ['onnxruntime-web'],
    },
    build: {
      target: 'es2020',
    },
  }
})
