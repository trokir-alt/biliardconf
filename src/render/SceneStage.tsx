/**
 * The canvas. Owns the Konva stage, the mm -> px transform, pointer input and
 * the keyboard shortcuts; everything it draws comes from the store.
 *
 * Creation is one gesture - press, drag, release - for every linear object,
 * because two separate taps on a tablet produce stray objects and misses. The
 * gesture lives in local state as a draft and only reaches the store when it
 * is released with a real length, so an accidental tap leaves nothing behind.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Group, Layer, Stage } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Item, Vec } from '../model/types'
import { buildGeometry, clampToField } from '../model/table'
import { dragHandle, type Handle } from '../model/item'
import { DEFAULT_ZONE_COLOR, ZONE_OPACITY, ghostCount } from '../model/style'
import { newId, resolveOverlap, snapPoint } from '../lib/place'
import { publishDebug } from '../lib/debug'
import { DRAG_TOOLS, retuneGhost, useStore, type Tool } from '../state/store'
import { useView } from '../state/view'
import { ItemView } from './ItemView'
import { Handles } from './Handles'
import { TableView } from './TableView'
import { computeLayout, pxToMm } from './layout'

/** below this the table is turned upright, spec section 9 */
const NARROW_PX = 860
/** a gesture shorter than this is a tap, not an object */
const MIN_GESTURE_MM = 40

type Draft = { tool: Tool; from: Vec; to: Vec }

export type SceneStageProps = {
  stageRef: React.MutableRefObject<Konva.Stage | null>
}

export function SceneStage({ stageRef }: SceneStageProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [draft, setDraft] = useState<Draft | null>(null)
  const dragging = useRef(false)
  /** running delta of a non-ball drag; the store is only written on release */
  const dragStartPos = useRef<Vec | null>(null)

  const table = useStore((s) => s.scene.table)
  const items = useStore((s) => s.scene.items)
  const selectedId = useStore((s) => s.selectedId)
  const tool = useStore((s) => s.tool)
  const orientation = useStore((s) => s.orientation)
  const setEditing = useView((s) => s.setEditing)

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
      useStore
        .getState()
        .autoOrientation(r.width < NARROW_PX && r.height > r.width ? 'vertical' : 'horizontal')
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* tell the DOM side (properties panel, text editor) where the canvas is */
  useEffect(() => {
    const stage = stageRef.current
    const wrap = wrapRef.current?.closest('.stage-wrap')
    if (!stage || !wrap) return
    const c = stage.container().getBoundingClientRect()
    const w = wrap.getBoundingClientRect()
    useView.getState().setView(layout, c.left - w.left, c.top - w.top)
  }, [layout, stageRef, box.w, box.h])

  /* Inspection hook for the browser test suite; a no-op in a normal build. */
  useEffect(() => {
    publishDebug('__layout', layout)
    // the very nodes the export renders, so a test can read a caption's text
    publishDebug('__stage', stageRef.current)
  }, [layout, stageRef])

  useEffect(() => {
    publishDebug('__store', useStore)
    const publish = () => {
      const s = useStore.getState()
      publishDebug('__scene', { ...s.scene, selectedId: s.selectedId })
    }
    publish()
    return useStore.subscribe(publish)
  }, [])

  /* ------------------------------------------------------------- pointers */

  const pointerMm = useCallback(() => {
    const stage = stageRef.current
    const pos = stage?.getPointerPosition()
    if (!pos) return null
    return pxToMm(layout, pos)
  }, [layout, stageRef])

  /** snap + push-apart for a ball, applied straight to the node so it never
      lags a frame behind the finger */
  const settleBall = useCallback(
    (id: string, raw: Vec) => {
      const st = useStore.getState()
      const ballMm = st.scene.table.ballMm
      let p = clampToField(g, raw, ballMm)
      p = clampToField(g, snapPoint(g, p, st.snap), ballMm)
      p = resolveOverlap(g, st.scene.items, id, p, ballMm, st.noOverlap)
      return p
    },
    [g],
  )

  const snapPt = useCallback(
    (p: Vec) => snapPoint(g, p, useStore.getState().snap),
    [g],
  )

  /* the press: start a gesture, place a caption, or just clear the selection */
  const onPointerDown = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (e.target !== e.target.getStage()) return
      const st = useStore.getState()
      const p = pointerMm()
      if (!p) return
      if (DRAG_TOOLS.includes(st.tool)) {
        e.evt.preventDefault()
        const from = snapPt(p)
        dragging.current = true
        setDraft({ tool: st.tool, from, to: from })
        return
      }
      if (st.tool === 'strike' || st.tool === 'power' || st.tool === 'ghost-ball') {
        const id = newId(st.tool)
        const item: Item =
          st.tool === 'strike'
            ? { id, type: 'strikePoint', x: p.x, y: p.y, sizeMm: 300, dot: { u: 0, v: 0 } }
            : st.tool === 'power'
              ? { id, type: 'power', x: p.x, y: p.y, value: 2.5 }
              : { id, type: 'ghostBall', x: p.x, y: p.y }
        // widgets sit above the balls and arrows, below the captions
        st.addItem(item, st.tool === 'ghost-ball' ? 'top' : 'belowText')
        return
      }
      if (st.tool === 'text') {
        const item: Item = {
          id: newId('text'),
          type: 'text',
          x: p.x,
          y: p.y,
          text: 'Текст',
          size: st.draft.textSize,
          color: st.draft.ink,
          angle: 0,
        }
        st.addItem(item)
        setEditing(item.id)
        return
      }
    },
    [pointerMm, snapPt, setEditing],
  )

  const onPointerMove = useCallback(() => {
    if (!dragging.current) return
    const p = pointerMm()
    if (!p) return
    setDraft((d) => (d ? { ...d, to: p } : d))
  }, [pointerMm])

  /** release: commit the draft if it is long enough to be an object */
  const finishGesture = useCallback(
    (raw: Vec | null) => {
      if (!dragging.current) return
      dragging.current = false
      setDraft((d) => {
        if (!d) return null
        const st = useStore.getState()
        const to = raw ? snapPt(raw) : d.to
        const len = Math.hypot(to.x - d.from.x, to.y - d.from.y)
        const isZone = d.tool === 'zone-rect' || d.tool === 'zone-ellipse'
        const big = isZone
          ? Math.abs(to.x - d.from.x) >= MIN_GESTURE_MM && Math.abs(to.y - d.from.y) >= MIN_GESTURE_MM
          : len >= MIN_GESTURE_MM
        if (!big) return null
        const ds = st.draft
        let item: Item
        switch (d.tool) {
          case 'arrow':
            item = {
              id: newId('arrow'),
              type: 'arrow',
              points: [d.from, to],
              style: ds.style,
              color: ds.ink,
              width: ds.width,
              head: ds.head,
              curved: false,
            }
            break
          case 'line':
            item = {
              id: newId('line'),
              type: 'line',
              from: d.from,
              to,
              style: ds.style,
              color: ds.ink,
              width: ds.width,
            }
            break
          case 'ghost':
            item = {
              id: newId('ghost'),
              type: 'ghostTrail',
              from: d.from,
              to,
              count: ghostCount(len, st.scene.table.ballMm),
              autoCount: true,
              head: ds.head !== 'none',
              color: ds.ink,
            }
            break
          default:
            item = {
              id: newId('zone'),
              type: 'zone',
              x: Math.min(d.from.x, to.x),
              y: Math.min(d.from.y, to.y),
              w: Math.abs(to.x - d.from.x),
              h: Math.abs(to.y - d.from.y),
              shape: d.tool === 'zone-ellipse' ? 'ellipse' : 'rect',
              color: ds.ink === '#FFFFFF' ? DEFAULT_ZONE_COLOR : ds.ink,
              opacity: ZONE_OPACITY,
            }
        }
        // a zone belongs under the balls, never over them
        st.addItem(item, isZone ? 'bottom' : 'top')
        return null
      })
    },
    [snapPt],
  )

  const onPointerUp = useCallback(() => finishGesture(pointerMm()), [finishGesture, pointerMm])

  /* the pointer can leave the canvas mid-gesture; finish on the window instead */
  useEffect(() => {
    const end = () => finishGesture(null)
    window.addEventListener('mouseup', end)
    window.addEventListener('touchend', end)
    return () => {
      window.removeEventListener('mouseup', end)
      window.removeEventListener('touchend', end)
    }
  }, [finishGesture])

  /* a plain click on empty cloth: add a ball, or drop the selection */
  const onStageTap = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (e.target !== e.target.getStage()) return
      const st = useStore.getState()
      if (st.tool === 'ball-white' || st.tool === 'ball-cue') {
        const p = pointerMm()
        if (p) st.addBall(st.tool === 'ball-cue' ? 'cue' : 'white', p)
        return
      }
      if (st.tool === 'select') st.select(null)
    },
    [pointerMm],
  )

  /* ---------------------------------------------------------- item drags */

  const handleDragStart = useCallback((e: KonvaEventObject<DragEvent>) => {
    const node = e.target
    const st = useStore.getState()
    st.select(node.id())
    st.beginHistory()
    dragStartPos.current = { x: node.x(), y: node.y() }
  }, [])

  const handleDragMove = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      const node = e.target
      if (node.name() === 'ghostBall') {
        useStore.getState().dragGhostBallTo(node.id(), { x: node.x(), y: node.y() })
        const it = useStore.getState().scene.items.find((i) => i.id === node.id())
        if (it && it.type === 'ghostBall') node.position({ x: it.x, y: it.y })
        return
      }
      if (node.name() !== 'ball') return // other items just ride the group offset
      const p = settleBall(node.id(), { x: node.x(), y: node.y() })
      node.position(p)
      useStore.getState().dragItemTo(node.id(), p)
    },
    [settleBall],
  )

  const handleDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      const node = e.target
      const st = useStore.getState()
      if (node.name() === 'ghostBall') {
        st.dragGhostBallTo(node.id(), { x: node.x(), y: node.y() })
        const it = st.scene.items.find((i) => i.id === node.id())
        if (it && it.type === 'ghostBall') node.position({ x: it.x, y: it.y })
        return
      }
      if (node.name() === 'ball') {
        const p = settleBall(node.id(), { x: node.x(), y: node.y() })
        node.position(p)
        st.dragItemTo(node.id(), p)
        return
      }
      // one write for the whole drag, then the group goes back to the origin
      const start = dragStartPos.current ?? { x: 0, y: 0 }
      st.moveItemBy(node.id(), node.x() - start.x, node.y() - start.y)
      node.position({ x: 0, y: 0 })
      dragStartPos.current = null
    },
    [settleBall],
  )

  const handleSelect = useCallback((e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true
    const st = useStore.getState()
    if (st.tool !== 'select') return
    // the handler sits on the group; find its id whichever child was hit
    let node: Konva.Node | null = e.target
    while (node && !node.id()) node = node.getParent()
    if (node) st.select(node.id())
  }, [])

  const handleEdit = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      let node: Konva.Node | null = e.target
      while (node && !node.id()) node = node.getParent()
      const id = node?.id()
      const item = useStore.getState().scene.items.find((i) => i.id === id)
      if (item?.type === 'text') setEditing(item.id)
    },
    [setEditing],
  )

  /* --------------------------------------------------------- handle drags */

  const onHandleStart = useCallback(() => {
    useStore.getState().beginHistory()
  }, [])

  const onHandleMove = useCallback(
    (h: Handle, e: KonvaEventObject<DragEvent>) => {
      const st = useStore.getState()
      const item = st.scene.items.find((i) => i.id === st.selectedId)
      if (!item) return
      const node = e.target
      const p = snapPt({ x: node.x(), y: node.y() })
      const patch = dragHandle(item, h.id, p)
      if (patch) st.updateItemLive(item.id, patch)
    },
    [snapPt],
  )

  const onHandleEnd = useCallback(
    (h: Handle, e: KonvaEventObject<DragEvent>) => {
      onHandleMove(h, e)
      const st = useStore.getState()
      const item = st.scene.items.find((i) => i.id === st.selectedId)
      if (!item) return
      const tune = retuneGhost(item, st.scene.table.ballMm)
      if (tune) st.updateItemLive(item.id, tune)
    },
    [onHandleMove],
  )

  /* ------------------------------------------------------------ keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLElement && el.isContentEditable)
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
      if (mod && e.key.toLowerCase() === 'd') {
        if (!st.selectedId) return
        e.preventDefault()
        st.duplicateSelected()
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
      // strength plate: plus and minus step the scale
      if (st.selectedId && (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_')) {
        const it = st.scene.items.find((i) => i.id === st.selectedId)
        if (it?.type === 'power') {
          e.preventDefault()
          st.adjustPower(it.id, e.key === '+' || e.key === '=' ? 1 : -1)
          return
        }
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
  const selecting = tool === 'select'
  const selected = items.find((i) => i.id === selectedId)

  /** the gesture in progress, drawn like the object it is about to become */
  const preview = useMemo<Item | null>(() => {
    if (!draft) return null
    const { from, to } = draft
    const st = useStore.getState()
    const ds = st.draft
    switch (draft.tool) {
      case 'arrow':
        return { id: 'draft', type: 'arrow', points: [from, to], style: ds.style, color: ds.ink, width: ds.width, head: ds.head, curved: false }
      case 'line':
        return { id: 'draft', type: 'line', from, to, style: ds.style, color: ds.ink, width: ds.width }
      case 'ghost':
        return {
          id: 'draft',
          type: 'ghostTrail',
          from,
          to,
          count: ghostCount(Math.hypot(to.x - from.x, to.y - from.y), table.ballMm),
          autoCount: true,
          head: ds.head !== 'none',
          color: ds.ink,
        }
      default:
        return {
          id: 'draft',
          type: 'zone',
          x: Math.min(from.x, to.x),
          y: Math.min(from.y, to.y),
          w: Math.abs(to.x - from.x),
          h: Math.abs(to.y - from.y),
          shape: draft.tool === 'zone-ellipse' ? 'ellipse' : 'rect',
          color: ds.ink === '#FFFFFF' ? DEFAULT_ZONE_COLOR : ds.ink,
          opacity: ZONE_OPACITY,
        }
    }
  }, [draft, table.ballMm])

  const noop = useCallback(() => {}, [])

  return (
    <div className="stage-wrap__canvas" ref={wrapRef}>
      {ready && (
        <Stage
          ref={stageRef}
          width={layout.stageW}
          height={layout.stageH}
          onMouseDown={onPointerDown}
          onTouchStart={onPointerDown}
          onMouseMove={onPointerMove}
          onTouchMove={onPointerMove}
          onMouseUp={onPointerUp}
          onTouchEnd={onPointerUp}
          onClick={onStageTap}
          onTap={onStageTap}
        >
          {/* The table is static, so it gets a layer of its own: Konva redraws
              per layer, and without this every frame of a drag repaints sixty
              gradient-and-shadow shapes that never change. On a tablet that is
              the difference between a drag that follows the finger and one
              that stutters. Both layers carry the same mm -> px transform. */}
          <Layer
            listening={false}
            scaleX={layout.scale}
            scaleY={layout.scale}
            x={layout.x}
            y={layout.y}
            rotation={layout.rotation}
          >
            <TableView g={g} />
          </Layer>
          <Layer
            scaleX={layout.scale}
            scaleY={layout.scale}
            x={layout.x}
            y={layout.y}
            rotation={layout.rotation}
          >
            {/* while drawing, nothing underneath may catch the gesture */}
            <Group listening={selecting}>
              {items.map((item) => (
                <ItemView
                  key={item.id}
                  item={item}
                  ballMm={table.ballMm}
                  selected={item.id === selectedId}
                  draggable={selecting}
                  onSelect={handleSelect}
                  onDragStart={handleDragStart}
                  onDragMove={handleDragMove}
                  onDragEnd={handleDragEnd}
                  onEdit={handleEdit}
                />
              ))}
            </Group>
            {preview && (
              <Group listening={false} opacity={0.8}>
                <ItemView
                  item={preview}
                  ballMm={table.ballMm}
                  selected={false}
                  draggable={false}
                  onSelect={noop}
                  onDragStart={noop}
                  onDragMove={noop}
                  onDragEnd={noop}
                />
              </Group>
            )}
            {selecting && selected && selected.type !== 'ball' && selected.type !== 'ghostBall' && (
              <Handles
                item={selected}
                scale={layout.scale}
                onDragStart={onHandleStart}
                onDragMove={onHandleMove}
                onDragEnd={onHandleEnd}
              />
            )}
          </Layer>
        </Stage>
    )}
    </div>
  )
}

/** One line under the table saying what the current tool does. */
export function StageHint() {
  const tool = useStore((s) => s.tool)
  if (tool === 'select')
    return (
      <p className="stage-wrap__hint">
        <span>Перетащите объект. Двойной клик по тексту - правка.</span>{' '}
        <span className="stage-wrap__keys">Стрелки - сдвиг на 5 мм, Shift - на 1 мм, Ctrl+D - дубль.</span>
      </p>
    )
  if (tool === 'ball-white' || tool === 'ball-cue')
    return <p className="stage-wrap__hint">Нажмите на стол, чтобы поставить шар.</p>
  if (tool === 'text') return <p className="stage-wrap__hint">Нажмите на стол, чтобы поставить подпись.</p>
  if (tool === 'strike' || tool === 'power' || tool === 'ghost-ball')
    return <p className="stage-wrap__hint">Нажмите на стол, чтобы поставить виджет. Потом его можно тянуть.</p>
  return (
    <p className="stage-wrap__hint">
      Нажмите и протяните по столу. Инструмент остаётся активным, Esc - выход.
    </p>
  )
}
