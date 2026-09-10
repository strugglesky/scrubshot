import type { Doc } from '../types'

const THUMB_MAX = 160

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

export function loadImageFile(file: File): Promise<Doc> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.decoding = 'async'

    image.onload = () => {
      void (async () => {
        // 等解码真正完成再交出去：decoding='async' 时 load 事件可能早于解码，
        // 提前 drawImage 会画出一张空白图，而 OCR 只会返回 0 行、不报错。
        try {
          await image.decode()
        } catch {
          // 解码失败就走下面的尺寸检查
        }

        if (!image.naturalWidth || !image.naturalHeight) {
          URL.revokeObjectURL(url)
          reject(new Error('图片尺寸为 0'))
          return
        }

        // 注意：这里**不** revoke。浏览器在内存吃紧时会丢弃已解码的位图，
        // 之后需要重新解码；如果对象 URL 已经释放，这张图就永久变成空白了。
        // 单次会话里几十张图总共几 MB，不值得为它冒这个风险。
        resolve({
          image,
          width: image.naturalWidth,
          height: image.naturalHeight,
          name: file.name || 'screenshot.png',
          thumb: makeThumb(image),
          size: file.size,
        })
      })()
    }

    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('无法解码这张图片'))
    }

    image.src = url
  })
}

function makeThumb(image: HTMLImageElement): string {
  const longest = Math.max(image.naturalWidth, image.naturalHeight)
  const scale = longest > THUMB_MAX ? THUMB_MAX / longest : 1
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, width, height)

  try {
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}
