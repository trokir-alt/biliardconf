/**
 * Left-hand control panel. Plain DOM - the millimetre coordinate system of the
 * canvas stops at the Konva layer, so everything here is ordinary CSS pixels.
 *
 * Every store read is a scalar selector: zustand v5 compares snapshots by
 * identity, so returning a fresh object or array from a selector would loop.
 */

import { useState } from 'react'
import { selectCanRedo, selectCanUndo, useStore } from '../state/store'
import { BALL_SIZES } from '../model/table'

export type ToolbarProps = {
  /** the parent owns the Konva stage, so export is a callback */
  onExport: (pixelRatio: number) => void
}

const EXPORT_SCALES = [1, 2, 3]

/** glyphs are inline vectors: an external icon font would taint the export */
function GlyphCursor() {
  return (
    <svg className="glyph" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path d="M4 2.5 L13.5 9.2 L9.3 10 L11.4 14.4 L9.3 15.4 L7.2 11 L4 13.6 Z" fill="currentColor" />
    </svg>
  )
}

function GlyphBall({ fill }: { fill: string }) {
  return (
    <svg className="glyph" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <circle cx="9" cy="9" r="6.2" fill={fill} stroke="rgba(0,0,0,.45)" strokeWidth="1" />
    </svg>
  )
}

export function Toolbar({ onExport }: ToolbarProps) {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const selectedId = useStore((s) => s.selectedId)
  const rackPyramid = useStore((s) => s.rackPyramid)
  const removeSelected = useStore((s) => s.removeSelected)
  const clear = useStore((s) => s.clear)
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

  const toolClass = (value: typeof tool) => (value === tool ? 'btn btn--tool is-active' : 'btn btn--tool')

  const askClear = () => {
    if (window.confirm('Очистить стол?')) clear()
  }

  return (
    <aside className="toolbar">
      <section className="tool-group">
        <h2 className="tool-group__title">Инструменты</h2>
        <div className="tool-group__body">
          <button
            type="button"
            className={toolClass('select')}
            aria-pressed={tool === 'select'}
            onClick={() => setTool('select')}
          >
            <GlyphCursor />
            <span>Выбор</span>
          </button>
          <button
            type="button"
            className={toolClass('ball-white')}
            aria-pressed={tool === 'ball-white'}
            onClick={() => setTool('ball-white')}
          >
            <GlyphBall fill="#FFFFFF" />
            <span>Белый шар</span>
          </button>
          <button
            type="button"
            className={toolClass('ball-cue')}
            aria-pressed={tool === 'ball-cue'}
            onClick={() => setTool('ball-cue')}
          >
            <GlyphBall fill="#F5A623" />
            <span>Биток</span>
          </button>
        </div>
      </section>

      <section className="tool-group">
        <h2 className="tool-group__title">Расстановка</h2>
        <div className="tool-group__body">
          <button type="button" className="btn" onClick={rackPyramid}>
            Пирамида
          </button>
          <button type="button" className="btn" onClick={removeSelected} disabled={selectedId === null}>
            Удалить
          </button>
          <button type="button" className="btn" onClick={askClear}>
            Очистить
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
          <button type="button" className="btn btn--primary" onClick={() => onExport(exportScale)}>
            Скачать PNG
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
          <button
            type="button"
            className="btn"
            aria-pressed={orientation === 'horizontal'}
            onClick={() => setOrientation('horizontal')}
          >
            Горизонтально
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={orientation === 'vertical'}
            onClick={() => setOrientation('vertical')}
          >
            Вертикально
          </button>

          <div className="row">
            <span className="row__label">Сукно</span>
            <span className="row__control">
              <button
                type="button"
                className="swatch"
                style={{ background: '#1D6FA8' }}
                aria-pressed={cloth === 'blue'}
                aria-label="Синее сукно"
                title="Синее сукно"
                onClick={() => setCloth('blue')}
              />
              <button
                type="button"
                className="swatch"
                style={{ background: '#1F6B41' }}
                aria-pressed={cloth === 'green'}
                aria-label="Зелёное сукно"
                title="Зелёное сукно"
                onClick={() => setCloth('green')}
              />
            </span>
          </div>

          <div className="row">
            <label className="row__label" htmlFor="ball-mm">
              Диаметр шара
            </label>
            <span className="row__control">
              <select
                id="ball-mm"
                className="select"
                value={ballMm}
                onChange={(e) => setBallMm(Number(e.target.value))}
              >
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
