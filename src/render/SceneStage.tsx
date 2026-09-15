/**
 * The canvas. Owns the Konva stage, the mm -> px transform, pointer input and
 * the keyboard shortcuts; everything it draws comes from the store.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Group, Layer, Stage } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { buildGeometry, clampToField } from '../model/table'
import { resolveOverlap, snapPoint } from '../lib/place'
import { publishDebug } from '../lib/debug'
import { useStore } from '../state/store'
import { ItemView } from './ItemView'
import { TableView } from './TableView'
import { computeLayout, pxToMm } from './layout'

/** below this the table is turned upright, spec section 9 */
const NARROW_PX = 860

export type SceneStageProps = {
  stageRef: React.MutableRefObject<Konva.Stage | null>
}

export function SceneStage({ stageRef }: SceneStageProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  const table = useStore((s) => s.scene.table)
  const items = useStore((s) => s.scene.items)
  const selectedId = useStore((s) => s.selectedId)
  const tool = useStore((s) => s.tool)
  const orientation = useStore((s) => s.orientation)

  const g = useMemo(() => buildGeometry(table), [table])
  const layout = useMemo(
    () => computeLayout(g, orientation, box.w, box.h),
    [g, orientation, box.w, box.h],
  )

  /* ---------------------------------------------------- size + auto rotate */

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const apply = () => {
      const r = el.getBoundingClientRect()
      setBox({ w: Math.max(0, Math.floor(r.width)), h: Math.max(0, Math.floor(r.height)) })
      useStore.getState().autoOrientation(r.width < NARROW_PX && r.height > r.width ? 'vertical' : 'horizontal')
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* ------------------------------------------------------------- pointers */

  const pointerMm = useCallback(() => {
    const stage = stageRef.current
    const pos = stage?.getPointerPosition()
    if (!pos) return null
    return pxToMm(layout, pos)
  }, [layout, stageRef])

  const onStageTap = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      // a hit on a ball is handled by the ball itself and stops there
      if (e.target !== e.target.getStage()) return
      const st = useStore.getState()
      if (st.tool === 'ball-white' || st.tool === 'ball-cue') {
        const p = pointerMm()
        if (p) st.addBall(st.tool === 'ball-cue' ? 'cue' : 'white', p)
        return
      }
      st.select(null)
    },
    [pointerMm],
  )

  /* ---------------------------------------------------------------- drag */

  /** snap + push-apart, applied straight to the Konva node so the ball never
      lags a frame behind the finger */
  const settle = useCallback(
    (id: string, raw: { x: number; y: number }) => {
      const st = useStore.getState()
      const ballMm = st.scene.table.ballMm
      let p = clampToField(g, raw, ballMm)
      p = snapPoint(g, p, st.snap)
      p = clampToField(g, p, ballMm)
      p = resolveOverlap(g, st.scene.items, id, p, ballMm, st.noOverlap)
      return p
    },
    [g],
  )

  const handleDragStart = useCallback((e: KonvaEventObject<DragEvent>) => {
    const id = e.target.id()
    const st = useStore.getState()
    st.select(id)
    st.beginHistory()
  }, [])

  const handleDragMove = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      const node = e.target
      const p = settle(node.id(), { x: node.x(), y: node.y() })
      node.position(p)
      useStore.getState().dragItemTo(node.id(), p)
    },
    [settle],
  )

  const handleDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      const node = e.target
      const p = settle(node.id(), { x: node.x(), y: node.y() })
      node.position(p)
      useStore.getState().dragItemTo(node.id(), p)
    },
    [settle],
  )

  const handleSelect = useCallback((e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true
    useStore.getState().select(e.target.id())
  }, [])

  /* Inspection hook for the browser test suite; a no-op in a normal build. */
  useEffect(() => {
    publishDebug('__layout', layout)
  }, [layout])

  useEffect(() => {
    const publish = () => {
      const s = useStore.getState()
      publishDebug('__scene', { ...s.scene, selectedId: s.selectedId })
    }
    publish()
    return useStore.subscribe(publish)
  }, [])

  /* ------------------------------------------------------------ keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      const typing =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      if (typing) return
      const st = useStore.getState()
      const mod = e.ctrlKey || e.metaKey

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) st.redo()
        else st.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        st.redo()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!st.selectedId) return
        e.preventDefault()
        st.removeSelected()
        return
      }
      if (e.key === 'Escape') {
        st.select(null)
        st.setTool('select')
        return
      }
      // precise nudge: 5 mm, or 1 mm with shift (spec section 7)
      const step = e.shiftKey ? 1 : 5
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }
      const d = nudge[e.key]
      if (d && st.selectedId) {
        e.preventDefault()
        st.nudgeSelected(d[0], d[1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* -------------------------------------------------------------- render */

  const ready = box.w > 0 && box.h > 0

  return (
    <main className="stage-wrap">
      {/* the canvas gets its own measured box: the hint below is a normal flow
          item, so on a phone - where the table fills the height - it can never
          end up printed across the felt */}
      <div className="stage-wrap__canvas" ref={wrapRef}>
        {ready && (
          <Stage
            ref={stageRef}
            width={layout.stageW}
            height={layout.stageH}
            onClick={onStageTap}
            onTap={onStageTap}
          >
            <Layer
              scaleX={layout.scale}
              scaleY={layout.scale}
              x={layout.x}
              y={layout.y}
              rotation={layout.rotation}
            >
              <TableView g={g} />
              <Group>
                {items.map((item) => (
                  <ItemView
                    key={item.id}
                    item={item}
                    ballMm={table.ballMm}
                    selected={item.id === selectedId}
                    draggable
                    onSelect={handleSelect}
                    onDragStart={handleDragStart}
                    onDragMove={handleDragMove}
                    onDragEnd={handleDragEnd}
                  />
                ))}
              </Group>
            </Layer>
          </Stage>
        )}
      </div>
      <p className="stage-wrap__hint">
        {tool === 'select' ? (
          <>
            <span>Перетащите шар пальцем или мышью.</span>{' '}
            <span className="stage-wrap__keys">Стрелки - сдвиг на 5 мм, Shift - на 1 мм.</span>
          </>
        ) : (
          <span>Нажмите на стол, чтобы поставить шар.</span>
        )}
      </p>
    </main>
  )
}
