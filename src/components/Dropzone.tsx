import { useRef } from 'react'
import type { ChangeEvent, MouseEvent } from 'react'
import { isImageFile } from '../core/image'

interface Props {
  onPick: (files: File[]) => void
}

export default function Dropzone({ onPick }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const openPicker = () => inputRef.current?.click()

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter(isImageFile)
    if (files.length > 0) onPick(files)
    event.target.value = ''
  }

  const handleButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    openPicker()
  }

  return (
    <div className="dropzone" onClick={openPicker} role="presentation">
      <div className="dropzone-key">Ctrl V</div>
      <h2>把截图拖进来，或直接粘贴</h2>
      <p>支持一次拖多张。图片不会离开你的浏览器。</p>
      <button type="button" className="button ghost" onClick={handleButtonClick}>
        选择文件
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={handleChange}
      />
    </div>
  )
}
