import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vite'

const require = createRequire(resolve(process.cwd(), 'package.json'))

/** RapidOCR 用的模型：mobile 版（快），server 版留给需要极限精度的场景 */
const OCR_MODELS = [
  'PP-OCRv5_mobile_det_infer.onnx',
  'PP-OCRv5_mobile_rec_infer.onnx',
  'ppocr_keys_v5.txt',
]

function copyModels() {
  try {
    const entry = require.resolve('@sanduc/ocr-models/node')
    const source = resolve(dirname(entry), 'assets')
    const target = resolve('public/models')
    mkdirSync(target, { recursive: true })

    for (const file of OCR_MODELS) {
      const from = resolve(source, file)
      const to = resolve(target, file)
      if (!existsSync(from)) {
        console.warn(`[scrubshot] 缺少模型文件 ${file}`)
        continue
      }
      if (existsSync(to)) continue
      copyFileSync(from, to)
    }
  } catch (error) {
    console.warn('[scrubshot] OCR 模型复制失败，RapidOCR 将不可用', error)
  }
}

export default defineConfig(() => {
  copyModels()

  return {
    plugins: [react()],
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
