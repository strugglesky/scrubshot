import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { zipSync } from 'fflate'
import Benchmark from './components/Benchmark'
import Dropzone from './components/Dropzone'
import Rail from './components/Rail'
import Sidebar from './components/Sidebar'
import Stage from './components/Stage'
import { baseName, download, extensionFor, renderBlob } from './core/export'
import { isImageFile, loadImageFile } from './core/image'
import { uid } from './core/uid'
import { findingToBox, findSensitive } from './detectors/suggest'
import { mergeFindings, mergeLines } from './detectors/merge'
import { pushPast } from './hooks/useHistory'
import type { OcrEngine, OcrProgress, EngineKind, PsmMode } from './ocr/engine'
import { RapidEngine } from './ocr/rapid'
import { TesseractEngine } from './ocr/tesseract'
import type { BatchItem, Box, ExportFormat, OcrState, RedactStyle, TextLine } from './types'

const MAX_ITEMS = 20

function stageLabel(status: string): string {
  if (status.includes('loading language')) return '下载识别模型（首次约 15MB）…'
  if (status.includes('loading tesseract')) return '加载识别引擎…'
  if (status.includes('initializing')) return '初始化…'
  if (status.includes('recognizing')) return '识别文字…'
  return '准备中…'
}

function stageProgress(status: string, raw: number): number {
  if (status.includes('loading language')) return 0.05 + raw * 0.25
  if (status.includes('initializing')) return 0.33
  if (status.includes('recognizing')) return 0.4 + raw * 0.6
  return 0.03
}

function uniqueKey(existing: Record<string, unknown>, name: string): string {
  if (!(name in existing)) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let index = 2
  while (`${stem}-${index}${ext}` in existing) index += 1
  return `${stem}-${index}${ext}`
}

/** 按字符数加权的平均置信度 */
function meanConfidence(lines: TextLine[]): number {
  let chars = 0
  let weighted = 0
  for (const line of lines) {
    const text = line.text.trim()
    if (text.length === 0) continue
    chars += text.length
    weighted += text.length * line.confidence
  }
  return chars > 0 ? weighted / chars : 0
}

export default function App() {
  const [items, setItems] = useState<BatchItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [style, setStyle] = useState<RedactStyle>('solid')
  const [preview, setPreview] = useState(false)
  const [format, setFormat] = useState<ExportFormat>('png')
  const [quality, setQuality] = useState(0.92)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'editor' | 'bench'>('editor')

  const engineRef = useRef<OcrEngine | null>(null)
  const engineKindRef = useRef<EngineKind>('rapid')
  const queueRef = useRef<Array<{ id: string; image: HTMLImageElement; mirror?: boolean }>>([])
  const drainingRef = useRef(false)

  const active = items.find((item) => item.id === activeId) ?? null
  const boxes = active?.boxes ?? []

  const updateItem = useCallback((id: string, patch: (item: BatchItem) => BatchItem) => {
    setItems((prev) => prev.map((item) => (item.id === id ? patch(item) : item)))
  }, [])

  const ensureEngine = useCallback(
    async (kind: EngineKind, onProgress?: (progress: OcrProgress) => void) => {
      if (!engineRef.current || engineKindRef.current !== kind) {
        void engineRef.current?.terminate()
        engineRef.current = kind === 'rapid' ? new RapidEngine() : new TesseractEngine()
        engineKindRef.current = kind
      }
      await engineRef.current.init(onProgress)
      return engineRef.current
    },
    [],
  )

  const analyze = useCallback(
    async (
      image: HTMLImageElement,
      onProgress?: (progress: OcrProgress) => void,
      forceMirror = false,
      psm?: PsmMode,
      engineKind: EngineKind = 'rapid',
    ) => {
      // 新引擎起不来时退回 Tesseract，保证工具本身仍然可用
      let engine: OcrEngine
      try {
        engine = await ensureEngine(engineKind, onProgress)
      } catch (error) {
        setError(error instanceof Error ? `RapidOCR 启动失败：${error.message}` : 'RapidOCR 启动失败，已退回 Tesseract')
        engine = await ensureEngine('tesseract', onProgress)
      }

      let chosen = await engine.recognize(image, forceMirror ? 'mirror' : 'auto', psm)
      let findings = findSensitive(chosen.lines)
      let lines = chosen.lines

      // 自动判据看的是"整页质量"。照片类图片里整页大多是噪声，平均分上不去，
      // 但真正敏感的那一行可能是读对的。
      // 所以再加一条检测层兜底：没找到东西、但有文字、置信度又偏低 → 反方向再试一次。
      if (
        !forceMirror &&
        !chosen.mirrored &&
        findings.length === 0 &&
        chosen.lines.length >= 3 &&
        meanConfidence(chosen.lines) < 55
      ) {
        const retry = await engine.recognize(image, 'mirror', psm)
        const retryFindings = findSensitive(retry.lines)
        // 只有真的找到高风险项才切换，避免被一个偶然的邮箱匹配带偏
        if (retryFindings.some((finding) => finding.risk === 'high')) {
          chosen = retry
          findings = retryFindings
          lines = retry.lines
        }
      }

      // 整图识别会跳过表格/便签的整块版面，分块识别会切断跨块的长号码 —— 两者失败点互补。
      // 只在"几乎没找到东西 + OCR 自己也不自信"时多花 4 倍时间再跑一遍分块，
      // 干净截图（置信度高）不会触发。
      if (
        !forceMirror &&
        psm !== 'tiled' &&
        findings.length < 2 &&
        lines.length >= 3 &&
        meanConfidence(lines) < 55
      ) {
        const tiled = await engine.recognize(image, 'auto', 'tiled')
        const tiledFindings = findSensitive(tiled.lines)
        if (tiledFindings.length > 0) {
          findings = mergeFindings(findings, tiledFindings)
          lines = mergeLines(lines, tiled.lines)
        }
      }

      return { findings, lines, mirrored: chosen.mirrored }
    },
    [ensureEngine],
  )

  const processOne = useCallback(
    async (job: { id: string; image: HTMLImageElement; mirror?: boolean }) => {
      updateItem(job.id, (item) => ({
        ...item,
        status: 'running',
        progress: 0.02,
        message: '准备识别模型…',
        error: undefined,
      }))

      try {
        const analysis = await analyze(
          job.image,
          (progress) => {
            updateItem(job.id, (item) =>
              item.status === 'running'
                ? {
                    ...item,
                    progress: stageProgress(progress.status, progress.progress),
                    message: stageLabel(progress.status),
                  }
                : item,
            )
          },
          job.mirror,
        )

        const flagged = new Set(analysis.findings.map((finding) => finding.line))
        const lines = analysis.lines.map((line) => ({ ...line, flagged: flagged.has(line) }))
        const autoBoxes = analysis.findings.map(findingToBox)

        updateItem(job.id, (item) => ({
          ...item,
          status: 'done',
          progress: 1,
          message: undefined,
          error: undefined,
          mirrored: analysis.mirrored,
          lines,
          // 保留用户手画的框，只替换自动识别的结果
          boxes: [...item.boxes.filter((box) => box.origin !== 'auto'), ...autoBoxes],
        }))
      } catch {
        updateItem(job.id, (item) => ({
          ...item,
          status: 'error',
          progress: 0,
          message: undefined,
          error: '识别失败，可以手动补框',
        }))
      }
    },
    [analyze, updateItem],
  )

  const drain = useCallback(async () => {
    if (drainingRef.current) return
    drainingRef.current = true
    try {
      while (queueRef.current.length > 0) {
        const job = queueRef.current.shift()
        if (!job) break
        await processOne(job)
      }
    } finally {
      drainingRef.current = false
      // 收尾时如果又有新任务进来（上面 while 刚好跑完），补一次
      if (queueRef.current.length > 0) void drain()
    }
  }, [processOne])

  const addFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter(isImageFile)
      if (images.length === 0) {
        setError('只支持图片文件（PNG / JPEG / WebP / GIF 首帧）')
        return
      }

      const room = MAX_ITEMS - items.length
      if (room <= 0) {
        setError(`一次最多处理 ${MAX_ITEMS} 张，先移除几张再试`)
        return
      }

      setError(null)

      for (const file of images.slice(0, room)) {
        try {
          const doc = await loadImageFile(file)
          const item: BatchItem = {
            ...doc,
            id: uid(),
            boxes: [],
            past: [],
            future: [],
            lines: [],
            status: 'queued',
            progress: 0,
          }
          setItems((prev) => [...prev, item])
          queueRef.current.push({ id: item.id, image: doc.image })
          setActiveId(item.id)
        } catch {
          setError(`「${file.name}」打不开`)
        }
      }

      void drain()
    },
    [items.length, drain],
  )

  const removeItem = useCallback(
    (id: string) => {
      queueRef.current = queueRef.current.filter((job) => job.id !== id)
      setItems((prev) => prev.filter((item) => item.id !== id))
      setActiveId((current) => {
        if (current !== id) return current
        const remaining = items.filter((item) => item.id !== id)
        return remaining.length > 0 ? remaining[remaining.length - 1].id : null
      })
    },
    [items],
  )

  const rerun = useCallback(
    (mirror: boolean) => {
      if (!active) return
      updateItem(active.id, (item) => ({
        ...item,
        status: 'queued',
        progress: 0,
        message: mirror ? '排队中（按镜像识别）…' : '排队中…',
        error: undefined,
      }))
      queueRef.current.push({ id: active.id, image: active.image, mirror })
      void drain()
    },
    [active, updateItem, drain],
  )

  const setBoxes = useCallback(
    (next: Box[] | ((prev: Box[]) => Box[])) => {
      if (!activeId) return
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== activeId) return item
          const value =
            typeof next === 'function' ? (next as (prev: Box[]) => Box[])(item.boxes) : next
          if (value === item.boxes) return item
          return { ...item, boxes: value, past: pushPast(item.past, item.boxes), future: [] }
        }),
      )
    },
    [activeId],
  )

  const undo = useCallback(() => {
    if (!activeId) return
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== activeId || item.past.length === 0) return item
        const previous = item.past[item.past.length - 1]
        return {
          ...item,
          boxes: previous,
          past: item.past.slice(0, -1),
          future: [item.boxes, ...item.future],
        }
      }),
    )
  }, [activeId])

  const redo = useCallback(() => {
    if (!activeId) return
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== activeId || item.future.length === 0) return item
        const next = item.future[0]
        return {
          ...item,
          boxes: next,
          past: pushPast(item.past, item.boxes),
          future: item.future.slice(1),
        }
      }),
    )
  }, [activeId])

  useEffect(() => {
    setSelectedId(null)
  }, [activeId])

  useEffect(() => {
    return () => {
      void engineRef.current?.terminate()
    }
  }, [])

  // Ctrl/⌘ + V：截图后的最高频入口
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData
      if (!data) return
      for (let index = 0; index < data.items.length; index += 1) {
        const item = data.items[index]
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            event.preventDefault()
            void addFiles([file])
            return
          }
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addFiles])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

      const mod = event.metaKey || event.ctrlKey

      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault()
        setBoxes((previous) => previous.filter((box) => box.id !== selectedId))
        setSelectedId(null)
        return
      }
      if (event.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, setBoxes, undo, redo])

  const handleExport = useCallback(async () => {
    if (!active) return
    setExporting(true)
    try {
      const enabled = active.boxes.filter((box) => box.enabled !== false)
      const blob = await renderBlob(
        active.image,
        active.width,
        active.height,
        enabled,
        style,
        format,
        quality,
      )
      download(blob, `${baseName(active.name)}_redacted.${extensionFor(format)}`)
      setError(null)
    } catch {
      setError('导出失败，换一种格式再试')
    } finally {
      setExporting(false)
    }
  }, [active, style, format, quality])

  const handleExportAll = useCallback(async () => {
    if (items.length === 0) return
    setExporting(true)
    try {
      const files: Record<string, Uint8Array> = {}
      for (const item of items) {
        const enabled = item.boxes.filter((box) => box.enabled !== false)
        const blob = await renderBlob(
          item.image,
          item.width,
          item.height,
          enabled,
          style,
          format,
          quality,
        )
        const name = uniqueKey(files, `${baseName(item.name)}_redacted.${extensionFor(format)}`)
        files[name] = new Uint8Array(await blob.arrayBuffer())
      }
      // level 0 = 只打包不压缩：图片本身已经是压缩过的，deflate 只会白烧 CPU
      const zipped = zipSync(files, { level: 0 })
      download(new Blob([zipped], { type: 'application/zip' }), 'scrubshot.zip')
      setError(null)
    } catch {
      setError('批量导出失败')
    } finally {
      setExporting(false)
    }
  }, [items, style, format, quality])

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    // 评测视图有自己的拖拽区，别把图塞进编辑队列
    if (view === 'bench') return
    void addFiles(Array.from(event.dataTransfer.files))
  }

  const ocr: OcrState = active
    ? {
        status: active.status,
        progress: active.progress,
        message: active.error ?? active.message,
      }
    : { status: 'idle', progress: 0 }

  const queued = items.filter((item) => item.status === 'queued').length
  const activeCount = boxes.filter((box) => box.enabled !== false).length

  return (
    <div className="app" onDragOver={handleDragOver} onDrop={handleDrop}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <h1>Scrubshot</h1>
          <span className="brand-tag">截图脱敏 · 全部本地处理</span>
        </div>
        <div className="topbar-right">
          <span className="muted small">
            v0.1 · W3{queued > 0 ? ` · ${queued} 张排队中` : ''}
          </span>
          <button
            type="button"
            className="button ghost small"
            onClick={() => setView(view === 'bench' ? 'editor' : 'bench')}
          >
            {view === 'bench' ? '返回编辑' : '评测'}
          </button>
        </div>
      </header>

      {error && <div className="banner">{error}</div>}

      {view === 'bench' ? (
        <main className="bench-area">
          <Benchmark analyze={(image, psm, kind) => analyze(image, undefined, false, psm, kind)} />
        </main>
      ) : (
      <main className={`layout ${items.length > 0 ? 'with-rail' : ''}`}>
        {items.length > 0 && (
          <Rail
            items={items}
            activeId={activeId}
            onSelect={setActiveId}
            onRemove={removeItem}
          />
        )}

        <section className="canvas-area">
          {active ? (
            <Stage
              image={active.image}
              width={active.width}
              height={active.height}
              boxes={boxes}
              style={style}
              preview={preview}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={setBoxes}
            />
          ) : (
            <Dropzone onPick={(files) => void addFiles(files)} />
          )}
        </section>

        <Sidebar
          hasImage={Boolean(active)}
          boxes={boxes}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRemove={(id) => {
            setBoxes((previous) => previous.filter((box) => box.id !== id))
            setSelectedId((current) => (current === id ? null : current))
          }}
          onToggle={(id) =>
            setBoxes((previous) =>
              previous.map((box) =>
                box.id === id ? { ...box, enabled: box.enabled === false } : box,
              ),
            )
          }
          onToggleAll={(enabled) =>
            setBoxes((previous) => previous.map((box) => ({ ...box, enabled })))
          }
          onClear={() => setBoxes([])}
          style={style}
          onStyleChange={setStyle}
          preview={preview}
          onPreviewChange={setPreview}
          format={format}
          onFormatChange={setFormat}
          quality={quality}
          onQualityChange={setQuality}
          onExport={handleExport}
          onExportAll={handleExportAll}
          itemCount={items.length}
          exporting={exporting}
          canUndo={Boolean(active && active.past.length > 0)}
          canRedo={Boolean(active && active.future.length > 0)}
          onUndo={undo}
          onRedo={redo}
          ocr={ocr}
          onRunOcr={() => rerun(false)}
          onRunMirror={() => rerun(true)}
          mirrored={active?.mirrored}
          lines={active?.lines ?? []}
        />
      </main>
      )}

      <footer className="statusbar">
        <span>
          {active
            ? `${active.name} · ${active.width} × ${active.height}`
            : '等待图片'}
        </span>
        <span className="muted">
          {active ? `${activeCount} 处待打码 · ` : ''}
          拖拽画框 · Delete 删除 · Ctrl+Z 撤销
        </span>
      </footer>
    </div>
  )
}
