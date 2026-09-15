/**
 * The exercise title above the table and the note below it, edited in place.
 * Both go into the exported picture and the title into the file name; without
 * them five exported files in a chat are indistinguishable.
 */

import { useStore } from '../state/store'

export function TitleField() {
  const title = useStore((s) => s.scene.title ?? '')
  const setTitle = useStore((s) => s.setTitle)
  return (
    <input
      className="caption caption--title"
      type="text"
      value={title}
      placeholder="Название упражнения"
      aria-label="Название упражнения"
      maxLength={80}
      onChange={(e) => setTitle(e.target.value)}
    />
  )
}

export function NoteField() {
  const note = useStore((s) => s.scene.note ?? '')
  const setNote = useStore((s) => s.setNote)
  return (
    <textarea
      className="caption caption--note"
      value={note}
      placeholder="Описание: что отрабатываем, на что смотреть (1–3 строки)"
      aria-label="Описание упражнения"
      rows={2}
      maxLength={300}
      onChange={(e) => setNote(e.target.value)}
    />
  )
}
