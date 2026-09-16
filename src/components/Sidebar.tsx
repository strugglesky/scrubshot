import type { Box, ExportFormat, OcrState, RedactStyle, Risk, ScannedLine } from '../types'

interface Props {
  hasImage: boolean
  boxes: Box[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onRemove: (id: string) => void
  onToggle: (id: string) => void
  onToggleAll: (enabled: boolean) => void
  onClear: () => void
  style: RedactStyle
  onStyleChange: (style: RedactStyle) => void
  preview: boolean
  onPreviewChange: (value: boolean) => void
  format: ExportFormat
  onFormatChange: (format: ExportFormat) => void
  quality: number
  onQualityChange: (value: number) => void
  onExport: () => void
  onExportAll: () => void
  itemCount: number
  exporting: boolean
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  ocr: OcrState
  onRunOcr: () => void
  onRunMirror: () => void
  mirrored?: boolean
  lines: ScannedLine[]
}

const STYLES: Array<{ id: RedactStyle; name: string; note: string }> = [
  { id: 'solid', name: '涂黑', note: '推荐 · 不可还原' },
  { id: 'blur', name: '模糊', note: '可被还原' },
  { id: 'pixelate', name: '像素化', note: '可被还原' },
]

const FORMATS: ExportFormat[] = ['png', 'jpeg', 'webp']

const RISK_TEXT: Record<Risk, string> = {
  high: '高风险：默认打码',
  medium: '中风险：建议核对',
  low: '低风险：仅提示',
}

export default function Sidebar(props: Props) {
  const active = props.boxes.filter((box) => box.enabled !== false).length
  const running = props.ocr.status === 'running'
  const waiting = props.ocr.status === 'queued'
  const busy = running || waiting

  const emptyText = busy
    ? waiting
      ? '排队中，前面还有图片在识别…'
      : '正在识别…'
    : props.ocr.status === 'done'
      ? '没找到明显的敏感信息。仍建议自己扫一眼，或手动补框。'
      : '在图上拖拽即可画框。'

  return (
    <aside className="sidebar">
      <section className="panel">
        <div className="panel-head">
          <h3>区域</h3>
          <span className="muted small">
            {active} / {props.boxes.length}
          </span>
        </div>

        {busy && (
          <div className="ocr">
            <div className="ocr-line">
              {running && <span className="spinner" />}
              {props.ocr.message ?? (waiting ? '排队中…' : '识别中…')}
            </div>
            {running && (
              <div className="progress">
                <div style={{ width: `${Math.round(props.ocr.progress * 100)}%` }} />
              </div>
            )}
          </div>
        )}

        {props.ocr.status === 'error' && <p className="warn">⚠️ {props.ocr.message}</p>}

        {props.boxes.length === 0 ? (
          <p className="empty">{emptyText}</p>
        ) : (
          <ul className="box-list">
            {props.boxes.map((box, index) => {
              const off = box.enabled === false
              return (
                <li
                  key={box.id}
                  className={`${box.id === props.selectedId ? 'selected' : ''} ${off ? 'off' : ''}`}
                  onClick={() => props.onSelect(box.id)}
                  role="presentation"
                >
                  <input
                    type="checkbox"
                    className="tick"
                    checked={!off}
                    title={off ? '不打码，仅提示' : '打码'}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => props.onToggle(box.id)}
                  />
                  {box.risk ? (
                    <span className={`chip ${box.risk}`} title={RISK_TEXT[box.risk]} />
                  ) : (
                    <span className="badge">{index + 1}</span>
                  )}
                  <div className="item-body">
                    <span className="item-label">{box.label ?? '手动区域'}</span>
                    <span className="item-detail">
                      {box.detail ?? `${Math.round(box.w)} × ${Math.round(box.h)}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="remove"
                    onClick={(event) => {
                      event.stopPropagation()
                      props.onRemove(box.id)
                    }}
                    aria-label="删除这个区域"
                  >
                    ×
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {props.lines.length > 0 && (
          <details className="raw">
            <summary>识别到的文字（{props.lines.length} 行）</summary>
            <ol>
              {props.lines.map((line, index) => (
                <li
                  key={`${index}-${Math.round(line.x)}-${Math.round(line.y)}`}
                  className={line.flagged ? 'hit' : ''}
                  title={`置信度 ${Math.round(line.confidence)}`}
                >
                  <span className="line-text">{line.text}</span>
                  <span className="line-conf">{Math.round(line.confidence)}</span>
                </li>
              ))}
            </ol>
          </details>
        )}

        {props.mirrored && (
          <p className="hint">🔁 判定为镜像图，已水平翻转后识别，框已换算回原图坐标。</p>
        )}

        <div className="row-buttons">
          <button
            type="button"
            onClick={() => props.onRunOcr()}
            disabled={!props.hasImage || busy}
          >
            {busy ? '识别中…' : '重新识别'}
          </button>
          <button
            type="button"
            onClick={() => props.onRunMirror()}
            disabled={!props.hasImage || busy}
            title="按水平镜像再识别一次"
          >
            镜像识别
          </button>
          <button
            type="button"
            onClick={() => props.onToggleAll(true)}
            disabled={props.boxes.length === 0}
          >
            全部启用
          </button>
          <button
            type="button"
            onClick={() => props.onToggleAll(false)}
            disabled={props.boxes.length === 0}
          >
            全部停用
          </button>
          <button type="button" onClick={props.onClear} disabled={props.boxes.length === 0}>
            清空
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>打码样式</h3>
          <div className="undo-group">
            <button
              type="button"
              onClick={props.onUndo}
              disabled={!props.canUndo}
              title="撤销 (Ctrl+Z)"
            >
              ↶
            </button>
            <button
              type="button"
              onClick={props.onRedo}
              disabled={!props.canRedo}
              title="重做 (Ctrl+Shift+Z)"
            >
              ↷
            </button>
          </div>
        </div>

        <div className="segmented">
          {STYLES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={props.style === option.id ? 'active' : ''}
              onClick={() => props.onStyleChange(option.id)}
              disabled={!props.hasImage}
            >
              <span>{option.name}</span>
              <small>{option.note}</small>
            </button>
          ))}
        </div>

        {props.style !== 'solid' && (
          <p className="warn">
            ⚠️ 模糊和像素化都可能被算法部分还原。只有涂黑是真的把信息删掉了。
          </p>
        )}

        <label className="switch">
          <input
            type="checkbox"
            checked={props.preview}
            onChange={(event) => props.onPreviewChange(event.target.checked)}
            disabled={!props.hasImage}
          />
          <span>预览最终效果</span>
        </label>
      </section>

      <section className="panel">
        <h3>导出</h3>
        <div className="format-row">
          {FORMATS.map((item) => (
            <button
              key={item}
              type="button"
              className={props.format === item ? 'active' : ''}
              onClick={() => props.onFormatChange(item)}
              disabled={!props.hasImage}
            >
              {item.toUpperCase()}
            </button>
          ))}
        </div>

        {props.format !== 'png' && (
          <label className="quality">
            <span>质量 {Math.round(props.quality * 100)}</span>
            <input
              type="range"
              min={0.5}
              max={1}
              step={0.01}
              value={props.quality}
              onChange={(event) => props.onQualityChange(Number(event.target.value))}
            />
          </label>
        )}

        <button
          type="button"
          className="button primary"
          onClick={props.onExport}
          disabled={!props.hasImage || props.exporting}
        >
          {props.exporting ? '导出中…' : `导出 ${props.format.toUpperCase()}`}
        </button>

        {props.itemCount > 1 && (
          <button
            type="button"
            className="button ghost"
            onClick={props.onExportAll}
            disabled={props.exporting}
          >
            导出全部（{props.itemCount} 张，zip）
          </button>
        )}

        <p className="hint">导出时重新编码，EXIF、GPS 与缩略图都会被清除。</p>
      </section>
    </aside>
  )
}
