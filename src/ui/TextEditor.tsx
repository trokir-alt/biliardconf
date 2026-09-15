/**
 * Editing a caption. On a desktop the field sits right over the caption on the
 * canvas; with a coarse pointer it is a modal, because a text field at the
 * bottom of a phone screen is where the keyboard is about to appear.
 */

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { mmToCss, useView } from '../state/view'

const coarse = () => {
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

export function TextEditor() {
  const editingId = useView((s) => s.editingId)
  const setEditing = useView((s) => s.setEditing)
  const item = useStore((s) => s.scene.items.find((i) => i.id === editingId))
  const view = useView()
  const ref = useRef<HTMLTextAreaElement | null>(null)
  // keyed on the caption being edited, so a fresh editor starts from its text
  const [seed, setSeed] = useState<{ id: string | null; value: string; modal: boolean }>({ id: null, value: '', modal: false })
  if (editingId !== seed.id) {
    const it = useStore.getState().scene.items.find((i) => i.id === editingId)
    setSeed({
      id: editingId,
      value: it?.type === 'text' && it.text !== 'Текст' ? it.text : '',
      modal: coarse(),
    })
  }
  const value = seed.value
  const modal = seed.modal
  const setValue = (v: string) => setSeed((s) => ({ ...s, value: v }))

  useEffect(() => {
    if (!editingId) return
    // let the field mount before grabbing focus, or iOS ignores it
    const t = setTimeout(() => {
      ref.current?.focus()
      ref.current?.select()
    }, 30)
    return () => clearTimeout(t)
  }, [editingId])

  if (!editingId || !item || item.type !== 'text') return null

  const commit = () => {
    const st = useStore.getState()
    const text = value.trim()
    if (!text) {
      // an emptied caption is a deleted caption
      st.select(item.id)
      st.removeSelected()
    } else if (text !== item.text) {
      st.updateItem(item.id, { text })
    }
    setEditing(null)
  }
  const cancel = () => {
    if (item.text === 'Текст') {
      const st = useStore.getState()
      st.select(item.id)
      st.removeSelected()
    }
    setEditing(null)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      commit()
    }
  }

  const field = (
    <textarea
      ref={ref}
      className="text-editor__field"
      value={value}
      rows={2}
      placeholder="Подпись"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKey}
      onBlur={modal ? undefined : commit}
      aria-label="Текст подписи"
    />
  )

  if (modal) {
    return (
      <div className="modal" role="dialog" aria-modal="true" aria-label="Правка подписи">
        <div className="modal__card">
          {field}
          <div className="modal__actions">
            <button type="button" className="btn" onClick={cancel}>
              Отмена
            </button>
            <button type="button" className="btn btn--primary" onClick={commit}>
              Готово
            </button>
          </div>
        </div>
      </div>
    )
  }

  const p = mmToCss(view, { x: item.x, y: item.y })
  const px = view.layout ? item.size * view.layout.scale : 16
  return (
    <div className="text-editor" style={{ left: p.x, top: p.y - px * 0.5 }}>
      {field}
    </div>
  )
}
