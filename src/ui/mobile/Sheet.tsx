/** A bottom sheet: the phone's answer to a side panel. */

import type { ReactNode } from 'react'

export function Sheet({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="sheet__backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="sheet__card">
        <div className="sheet__head">
          <h2 className="sheet__title">{title}</h2>
          <button type="button" className="btn btn--icon" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  )
}
