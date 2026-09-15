/**
 * Left-hand control panel. Plain DOM - the millimetre coordinate system of the
 * canvas stops at the Konva layer, so everything here is ordinary CSS pixels.
 *
 * Every store read is a scalar selector: zustand v5 compares snapshots by
 * identity, so returning a fresh object or array from a selector would loop.
 */

import { useState } from 'react'
import { selectCanRedo, selectCanUndo, useStore, type Tool } from '../state/store'
import { BALL_SIZES } from '../model/table'
import type { ExportFormat } from '../lib/exportImage'

export type ToolbarProps = {
  /** the parent owns the Konva stage, so export is a callback */
  onExport: (scale: number, format: ExportFormat) => void
  /** must run synchronously inside the click, see copyExportToClipboard */
  onCopy: (scale: number) => void
}

const EXPORT_SCALES = [1, 2, 3]

/* glyphs are inline vectors: an icon font from a CDN would taint the export */
const glyph = (children: React.ReactNode) => (
  <svg className="glyph" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
    {children}
  </svg>
)
const G = {
  cursor: glyph(<path d="M4 2.5 L13.5 9.2 L9.3 10 L11.4 14.4 L9.3 15.4 L7.2 11 L4 13.6 Z" fill="currentColor" />),
  white: glyph(<circle cx="9" cy="9" r="6.2" fill="#FFFFFF" stroke="rgba(0,0,0,.45)" strokeWidth="1" />),
  cue: glyph(<circle cx="9" cy="9" r="6.2" fill="#F5A623" stroke="rgba(0,0,0,.45)" strokeWidth="1" />),
  arrow: glyph(
    <>
      <path d="M3 14 L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 4 H14 V10" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>,
  ),
  ghost: glyph(
    <>
      <circle cx="4" cy="13" r="2.6" fill="currentColor" opacity=".9" />
      <circle cx="9" cy="9" r="2.6" fill="currentColor" opacity=".55" />
      <circle cx="14" cy="5" r="2.6" fill="currentColor" opacity=".25" />
    </>,
  ),
  rect: glyph(<rect x="3" y="4" width="12" height="10" rx="1.5" fill="currentColor" opacity=".35" stroke="currentColor" strokeWidth="1.5" />),
  ellipse: glyph(<ellipse cx="9" cy="9" rx="6.5" ry="5" fill="currentColor" opacity=".35" stroke="currentColor" strokeWidth="1.5" />),
  line: glyph(<path d="M3 14 L15 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 2.5" />),
  text: glyph(<path d="M4 4 H14 M9 4 V15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />),
}

const TOOLS: { id: Tool; label: string; icon: React.ReactNode }[] = [
  { id: 'select', label: 'Выбор', icon: G.cursor },
  { id: 'ball-white', label: 'Белый шар', icon: G.white },
  { id: 'ball-cue', label: 'Биток', icon: G.cue },
  { id: 'arrow', label: 'Стрелка', icon: G.arrow },
  { id: 'ghost', label: 'Траектория', icon: G.ghost },
  { id: 'line', label: 'Линия', icon: G.line },
  { id: 'zone-rect', label: 'Зона', icon: G.rect },
  { id: 'zone-ellipse', label: 'Эллипс', icon: G.ellipse },
  { id: 'text', label: 'Текст', icon: G.text },
]

export function Toolbar({ onExport, onCopy }: ToolbarProps) {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const rackPyramid = useStore((s) => s.rackPyramid)
  const newExercise = useStore((s) => s.newExercise)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const canUndo = useStore(selectCanUndo)
  const canRedo = useStore(selectCanRedo)
  const orientation = useStore((s) => s.orientation)
  const setOrientation = useStore((s) => s.setOrientation)
  const cloth = useStore((s) => s.scene.table.cloth)
  const setCloth = useStore((s) => s.setCloth)
  const ballMm = useStore((s) => s.scene.table.ballMm)
  const setBallMm = useStore((s) => s.setBallMm)
  const markings = useStore((s) => s.scene.table.markings)
  const toggleMarkings = useStore((s) => s.toggleMarkings)
  const snap = useStore((s) => s.snap)
  const toggleSnap = useStore((s) => s.toggleSnap)
  const noOverlap = useStore((s) => s.noOverlap)
  const toggleNoOverlap = useStore((s) => s.toggleNoOverlap)

  const [exportScale, setExportScale] = useState(2)
  const [format, setFormat] = useState<ExportFormat>('jpeg')

  /* the tool is sticky; tapping the active one again is the way back to select */
  const pick = (id: Tool) => setTool(tool === id && id !== 'select' ? 'select' : id)

  const askNew = () => {
    if (window.confirm('Начать новое упражнение? Стол, название и описание будут очищены.')) newExercise()
  }

  return (
    <aside className="toolbar">
      <section className="tool-group">
        <h2 className="tool-group__title">Инструменты</h2>
        <div className="tool-group__body tool-grid">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tool === t.id ? 'btn btn--tool is-active' : 'btn btn--tool'}
              aria-pressed={tool === t.id}
              onClick={() => pick(t.id)}
              title={t.label}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="tool-group">
        <h2 className="tool-group__title">Расстановка</h2>
        <div className="tool-group__body">
          <button type="button" className="btn" onClick={rackPyramid}>
            Пирамида
          </button>
          <button type="button" className="btn" onClick={askNew}>
            Новое упражнение
          </button>
        </div>
      </section>

      <section className="tool-group tool-group--export">
        <h2 className="tool-group__title">Экспорт</h2>
        <div className="tool-group__body">
          <div className="row">
            <span className="row__label">Размер</span>
            <span className="seg" role="group" aria-label="Масштаб экспорта">
              {EXPORT_SCALES.map((scale) => (
                <button
                  key={scale}
                  type="button"
                  className="btn seg__btn"
                  aria-pressed={exportScale === scale}
                  onClick={() => setExportScale(scale)}
                >
                  {scale}x
                </button>
              ))}
            </span>
          </div>
          <div className="row">
            <span className="row__label">Формат</span>
            <span className="seg" role="group" aria-label="Формат файла">
              <button type="button" className="btn seg__btn" aria-pressed={format === 'jpeg'} onClick={() => setFormat('jpeg')}>
                JPEG
              </button>
              <button type="button" className="btn seg__btn" aria-pressed={format === 'png'} onClick={() => setFormat('png')}>
                PNG
              </button>
            </span>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => onExport(exportScale, format)}>
            Скачать {format === 'jpeg' ? 'JPEG' : 'PNG'}
          </button>
          <button type="button" className="btn" onClick={() => onCopy(exportScale)}>
            Копировать в буфер
          </button>
        </div>
      </section>

      <section className="tool-group">
        <h2 className="tool-group__title">История</h2>
        <div className="tool-group__body">
          <button type="button" className="btn" onClick={undo} disabled={!canUndo}>
            <span>Отменить</span>
            <span className="btn__hint">
              <kbd>Ctrl</kbd>
              <kbd>Z</kbd>
            </span>
          </button>
          <button type="button" className="btn" onClick={redo} disabled={!canRedo}>
            <span>Вернуть</span>
            <span className="btn__hint">
              <kbd>Ctrl</kbd>
              <kbd>Shift</kbd>
              <kbd>Z</kbd>
            </span>
          </button>
        </div>
      </section>

      <section className="tool-group">
        <h2 className="tool-group__title">Стол</h2>
        <div className="tool-group__body">
          <button type="button" className="btn" aria-pressed={orientation === 'horizontal'} onClick={() => setOrientation('horizontal')}>
            Горизонтально
          </button>
          <button type="button" className="btn" aria-pressed={orientation === 'vertical'} onClick={() => setOrientation('vertical')}>
            Вертикально
          </button>

          <div className="row">
            <span className="row__label">Сукно</span>
            <span className="row__control">
              <button type="button" className="swatch" style={{ background: '#1D6FA8' }} aria-pressed={cloth === 'blue'} aria-label="Синее сукно" title="Синее сукно" onClick={() => setCloth('blue')} />
              <button type="button" className="swatch" style={{ background: '#1F6B41' }} aria-pressed={cloth === 'green'} aria-label="Зелёное сукно" title="Зелёное сукно" onClick={() => setCloth('green')} />
            </span>
          </div>

          <div className="row">
            <label className="row__label" htmlFor="ball-mm">
              Диаметр шара
            </label>
            <span className="row__control">
              <select id="ball-mm" className="select" value={ballMm} onChange={(e) => setBallMm(Number(e.target.value))}>
                {BALL_SIZES.map((mm) => (
                  <option key={mm} value={mm}>
                    {mm}
                  </option>
                ))}
              </select>
              <span className="row__unit">мм</span>
            </span>
          </div>

          <label className="switch">
            <span className="switch__label">Разметка</span>
            <input type="checkbox" className="switch__input" checked={markings} onChange={toggleMarkings} />
            <span className="switch__track">
              <span className="switch__knob" />
            </span>
          </label>
          <label className="switch">
            <span className="switch__label">Магнит к разметке</span>
            <input type="checkbox" className="switch__input" checked={snap} onChange={toggleSnap} />
            <span className="switch__track">
              <span className="switch__knob" />
            </span>
          </label>
          <label className="switch">
            <span className="switch__label">Без наложения</span>
            <input type="checkbox" className="switch__input" checked={noOverlap} onChange={toggleNoOverlap} />
            <span className="switch__track">
              <span className="switch__knob" />
            </span>
          </label>
        </div>
      </section>
    </aside>
  )
}
