/**
 * Properties of the selected object. Floats next to it on a desktop and sits
 * in a strip at the bottom of the screen on a phone; the CSS decides which.
 *
 * Only the controls that mean something for the selected type are shown - a
 * caption has no stroke width and a zone has no arrowhead.
 */

import { useMemo } from 'react'
import { useStore } from '../state/store'
import { mmToCss, useView } from '../state/view'
import { itemBounds } from '../model/item'
import { INK, STROKE_WIDTHS, TEXT_SIZES } from '../model/style'
import { formatPower } from '../model/item'
import { useIsMobile } from './useMedia'

export function Properties() {
  const selectedId = useStore((s) => s.selectedId)
  const item = useStore((s) => s.scene.items.find((i) => i.id === s.selectedId))
  const ballMm = useStore((s) => s.scene.table.ballMm)
  const tool = useStore((s) => s.tool)
  const view = useView()
  const mobile = useIsMobile()

  const pos = useMemo(() => {
    if (!item || !view.layout) return null
    const b = itemBounds(item, ballMm)
    // anchor under the object's bounding box, in css px inside .stage-wrap
    const corners = [
      mmToCss(view, { x: b.x, y: b.y }),
      mmToCss(view, { x: b.x + b.w, y: b.y }),
      mmToCss(view, { x: b.x, y: b.y + b.h }),
      mmToCss(view, { x: b.x + b.w, y: b.y + b.h }),
    ]
    const ys = corners.map((c) => c.y)
    // on a phone: is the object in the lower half of the canvas?
    const mid = view.stageTop + view.layout.stageH / 2
    return {
      left: Math.min(...corners.map((c) => c.x)),
      top: Math.max(...ys) + 12,
      low: (Math.min(...ys) + Math.max(...ys)) / 2 > mid,
    }
  }, [item, ballMm, view])

  if (!item || !selectedId || tool !== 'select') return null
  const st = useStore.getState()
  const t = item.type

  const hasColor = t !== 'ball'
  const hasWidth = t === 'arrow' || t === 'line'
  const hasStyle = t === 'arrow' || t === 'line'
  const hasHead = t === 'arrow'
  const hasGhost = t === 'ghostTrail'
  const hasText = t === 'text'
  const hasZone = t === 'zone'
  const hasBall = t === 'ball'
  const hasStrike = t === 'strikePoint'
  const hasPower = t === 'power'

  const color = 'color' in item ? item.color : null

  return (
    <div
      className={mobile && pos?.low ? 'props props--top' : 'props'}
      role="toolbar"
      aria-label="Свойства объекта"
      style={pos ? { left: pos.left, top: pos.top } : undefined}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {hasColor && (
        <div className="props__row">
          {INK.map((c) => (
            <button
              key={c.id}
              type="button"
              className="swatch swatch--sm"
              style={{ background: c.value }}
              aria-pressed={color === c.value}
              aria-label={c.label}
              title={c.label}
              onClick={() => st.setInk(c.value)}
            />
          ))}
        </div>
      )}

      {hasBall && (
        <div className="props__row">
          <span className="seg">
            <button type="button" className="btn seg__btn" aria-pressed={item.kind === 'white'} onClick={() => st.updateItem(item.id, { kind: 'white' })}>
              Белый
            </button>
            <button type="button" className="btn seg__btn" aria-pressed={item.kind === 'cue'} onClick={() => st.updateItem(item.id, { kind: 'cue' })}>
              Биток
            </button>
          </span>
          <input
            className="input input--sm"
            type="text"
            maxLength={2}
            placeholder="№"
            aria-label="Подпись на шаре"
            value={item.label ?? ''}
            onChange={(e) => st.updateItemLive(item.id, { label: e.target.value.trim() || undefined })}
            onBlur={() => st.beginHistory()}
          />
        </div>
      )}

      {(hasWidth || hasStyle || hasHead) && (
        <div className="props__row">
          {hasWidth && (
            <span className="seg" role="group" aria-label="Толщина">
              {STROKE_WIDTHS.map((w) => (
                <button key={w} type="button" className="btn seg__btn" aria-pressed={'width' in item && item.width === w} onClick={() => st.setWidth(w)} title={`${w} мм`}>
                  <span className="stroke-sample" style={{ height: Math.max(2, w / 3) }} />
                </button>
              ))}
            </span>
          )}
          {hasStyle && (
            <span className="seg" role="group" aria-label="Стиль линии">
              <button type="button" className="btn seg__btn" aria-pressed={'style' in item && item.style === 'solid'} onClick={() => st.setStyle('solid')}>
                ━
              </button>
              <button type="button" className="btn seg__btn" aria-pressed={'style' in item && item.style === 'dashed'} onClick={() => st.setStyle('dashed')}>
                ╍
              </button>
            </span>
          )}
          {hasHead && (
            <span className="seg" role="group" aria-label="Наконечник">
              <button type="button" className="btn seg__btn" aria-pressed={item.head === 'end'} onClick={() => st.setHead('end')} title="В конце">
                →
              </button>
              <button type="button" className="btn seg__btn" aria-pressed={item.head === 'both'} onClick={() => st.setHead('both')} title="С обеих сторон">
                ↔
              </button>
              <button type="button" className="btn seg__btn" aria-pressed={item.head === 'none'} onClick={() => st.setHead('none')} title="Без наконечника">
                —
              </button>
            </span>
          )}
        </div>
      )}

      {hasGhost && (
        <div className="props__row">
          <span className="props__label">Шаров</span>
          <span className="seg" role="group" aria-label="Число шаров">
            <button type="button" className="btn seg__btn" onClick={() => st.adjustGhostCount(item.id, -1)} disabled={item.count <= 3} aria-label="Меньше">
              −
            </button>
            <span className="seg__value" aria-live="polite">
              {item.count}
            </span>
            <button type="button" className="btn seg__btn" onClick={() => st.adjustGhostCount(item.id, 1)} disabled={item.count >= 8} aria-label="Больше">
              +
            </button>
          </span>
          <label className="switch switch--inline">
            <span className="switch__label">Стрелка</span>
            <input type="checkbox" className="switch__input" checked={item.head} onChange={() => st.updateItem(item.id, { head: !item.head })} />
            <span className="switch__track">
              <span className="switch__knob" />
            </span>
          </label>
        </div>
      )}

      {hasZone && (
        <div className="props__row">
          <span className="seg" role="group" aria-label="Форма зоны">
            <button type="button" className="btn seg__btn" aria-pressed={item.shape === 'rect'} onClick={() => st.updateItem(item.id, { shape: 'rect' })}>
              Прямоугольник
            </button>
            <button type="button" className="btn seg__btn" aria-pressed={item.shape === 'ellipse'} onClick={() => st.updateItem(item.id, { shape: 'ellipse' })}>
              Эллипс
            </button>
          </span>
        </div>
      )}

      {hasText && (
        <div className="props__row">
          <span className="seg" role="group" aria-label="Размер текста">
            {TEXT_SIZES.map((sz, i) => (
              <button key={sz} type="button" className="btn seg__btn" aria-pressed={item.size === sz} onClick={() => st.setTextSize(sz)} title={`${sz} мм`}>
                {['S', 'M', 'L'][i]}
              </button>
            ))}
          </span>
          <button type="button" className="btn" onClick={() => useView.getState().setEditing(item.id)}>
            Изменить текст
          </button>
        </div>
      )}

      {hasStrike && (
        <div className="props__row">
          <span className="props__label">Размер</span>
          <span className="seg" role="group" aria-label="Размер шара">
            {[200, 300, 400, 500].map((mm) => (
              <button key={mm} type="button" className="btn seg__btn" aria-pressed={item.sizeMm === mm} onClick={() => st.setStrikeSize(item.id, mm)}>
                {mm}
              </button>
            ))}
          </span>
          <button type="button" className="btn" onClick={() => st.resetDot(item.id)} disabled={item.dot.u === 0 && item.dot.v === 0}>
            Точку в центр
          </button>
        </div>
      )}

      {hasPower && (
        <div className="props__row">
          <span className="props__label">Сила</span>
          <span className="seg" role="group" aria-label="Сила удара">
            <button type="button" className="btn seg__btn" onClick={() => st.adjustPower(item.id, -1)} disabled={item.value <= 0.5} aria-label="Слабее">
              −
            </button>
            <span className="seg__value" aria-live="polite">
              {formatPower(item.value)}
            </span>
            <button type="button" className="btn seg__btn" onClick={() => st.adjustPower(item.id, 1)} disabled={item.value >= 4.5} aria-label="Сильнее">
              +
            </button>
          </span>
        </div>
      )}

      {mobile && (
        <div className="props__row props__row--nudge" aria-label="Сдвиг на 5 мм">
          <button type="button" className="btn btn--icon" onClick={() => st.nudgeSelected(-5, 0)} aria-label="Влево 5 мм">←</button>
          <button type="button" className="btn btn--icon" onClick={() => st.nudgeSelected(0, -5)} aria-label="Вверх 5 мм">↑</button>
          <button type="button" className="btn btn--icon" onClick={() => st.nudgeSelected(0, 5)} aria-label="Вниз 5 мм">↓</button>
          <button type="button" className="btn btn--icon" onClick={() => st.nudgeSelected(5, 0)} aria-label="Вправо 5 мм">→</button>
          <span className="props__label">5 мм</span>
        </div>
      )}

      <div className="props__row">
        <button type="button" className="btn btn--icon" onClick={() => st.bringToFront(item.id)} title="На передний план" aria-label="На передний план">
          ⬆
        </button>
        <button type="button" className="btn btn--icon" onClick={() => st.sendToBack(item.id)} title="На задний план" aria-label="На задний план">
          ⬇
        </button>
        <button type="button" className="btn" onClick={() => st.duplicateSelected()} title="Ctrl+D">
          Дублировать
        </button>
        <button type="button" className="btn btn--danger" onClick={() => st.removeSelected()} title="Delete">
          Удалить
        </button>
      </div>
    </div>
  )
}
