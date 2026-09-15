/**
 * Scene store: zustand + immer, with an undo/redo stack of whole-scene
 * snapshots capped at 50 (spec section 3).
 *
 * Because the immer middleware freezes state and shares structure, a snapshot
 * is just the previous `scene` reference - cheap to keep and cheap to restore.
 * One user action is one snapshot: a drag pushes once on dragstart and then
 * writes without history until it ends.
 */

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type {
  ArrowHead,
  BallItem,
  BallKind,
  ClothColor,
  Item,
  Orientation,
  Scene,
  StrokeStyle,
  Vec,
} from '../model/types'
import { DEFAULT_TABLE, buildGeometry, clampToField } from '../model/table'
import { translateItem } from '../model/item'
import {
  DEFAULT_HEAD,
  DEFAULT_INK,
  DEFAULT_STROKE_WIDTH,
  DEFAULT_STYLE,
  DEFAULT_TEXT_SIZE,
  GHOST_MAX,
  GHOST_MIN,
  ghostCount,
} from '../model/style'
import { freeSpot, housePoint, newId, pyramidBalls, resolveOverlap, snapPoint } from '../lib/place'
import { loadScene } from '../lib/storage'

export const HISTORY_LIMIT = 50

/** Every tool the coach can pick. Stage 3 adds 'strike' here and nowhere else. */
export type Tool =
  | 'select'
  | 'ball-white'
  | 'ball-cue'
  | 'arrow'
  | 'ghost'
  | 'zone-rect'
  | 'zone-ellipse'
  | 'line'
  | 'text'

/** tools that are drawn with one press-drag-release gesture */
export const DRAG_TOOLS: Tool[] = ['arrow', 'ghost', 'zone-rect', 'zone-ellipse', 'line']

/** style carried from one object to the next, so a run of arrows matches */
export type DraftStyle = {
  ink: string
  width: number
  style: StrokeStyle
  head: ArrowHead
  textSize: number
}

export type AppState = {
  scene: Scene
  selectedId: string | null
  tool: Tool
  draft: DraftStyle
  orientation: Orientation
  orientationAuto: boolean
  snap: boolean
  noOverlap: boolean
  past: Scene[]
  future: Scene[]

  /* ---- tools & view ---- */
  setTool: (tool: Tool) => void
  setOrientation: (o: Orientation) => void
  autoOrientation: (o: Orientation) => void
  toggleSnap: () => void
  toggleNoOverlap: () => void
  toggleMarkings: () => void
  setCloth: (cloth: ClothColor) => void
  setBallMm: (mm: number) => void

  /* ---- draft style ---- */
  setInk: (color: string) => void
  setWidth: (mm: number) => void
  setStyle: (style: StrokeStyle) => void
  setHead: (head: ArrowHead) => void
  setTextSize: (mm: number) => void

  /* ---- selection ---- */
  select: (id: string | null) => void

  /* ---- editing ---- */
  addBall: (kind: BallKind, at?: Vec) => void
  /** a zone always lands at the bottom: it belongs under the balls, not over */
  addItem: (item: Item, atBottom?: boolean) => void
  /** one history entry; for property changes and finished edits */
  updateItem: (id: string, patch: Partial<Item>) => void
  /** no history entry; for the frames of a drag */
  updateItemLive: (id: string, patch: Partial<Item>) => void
  moveItemBy: (id: string, dx: number, dy: number) => void
  dragItemTo: (id: string, at: Vec) => void
  nudgeSelected: (dx: number, dy: number) => void
  removeSelected: () => void
  duplicateSelected: () => void
  bringToFront: (id: string) => void
  sendToBack: (id: string) => void
  adjustGhostCount: (id: string, delta: number) => void
  clear: () => void
  newExercise: () => void
  rackPyramid: () => void
  replaceScene: (scene: Scene) => void

  /* ---- exercise ---- */
  setTitle: (title: string) => void
  setNote: (note: string) => void

  /* ---- history ---- */
  beginHistory: () => void
  undo: () => void
  redo: () => void
}

const emptyScene = (): Scene => ({
  version: 1,
  table: { ...DEFAULT_TABLE },
  items: [],
})

/** a saved scene if there is a good one, otherwise a clean table */
const initialScene = (): Scene => {
  try {
    return loadScene() ?? emptyScene()
  } catch {
    return emptyScene()
  }
}

export const useStore = create<AppState>()(
  immer((set, get) => {
    /** push the current scene onto the undo stack and drop the redo stack */
    const beginHistory = () => {
      const { scene, past } = get()
      const trimmed =
        past.length >= HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT + 1) : past.slice()
      trimmed.push(scene)
      set((s) => {
        s.past = trimmed
        s.future = []
      })
    }

    /** every mutation that should be undoable goes through here */
    const edit = (recipe: (s: AppState) => void) => {
      beginHistory()
      set(recipe)
    }

    const geom = () => buildGeometry(get().scene.table)

    const patchItem = (s: AppState, id: string, patch: Partial<Item>) => {
      const i = s.scene.items.findIndex((it) => it.id === id)
      if (i === -1) return
      s.scene.items[i] = { ...s.scene.items[i], ...patch } as Item
    }

    return {
      scene: initialScene(),
      selectedId: null,
      tool: 'select',
      draft: {
        ink: DEFAULT_INK,
        width: DEFAULT_STROKE_WIDTH,
        style: DEFAULT_STYLE,
        head: DEFAULT_HEAD,
        textSize: DEFAULT_TEXT_SIZE,
      },
      orientation: 'horizontal',
      orientationAuto: true,
      snap: true,
      noOverlap: true,
      past: [],
      future: [],

      setTool: (tool) =>
        set((s) => {
          s.tool = tool
          if (tool !== 'select') s.selectedId = null
        }),
      setOrientation: (o) =>
        set((s) => {
          s.orientation = o
          s.orientationAuto = false
        }),
      autoOrientation: (o) =>
        set((s) => {
          if (s.orientationAuto) s.orientation = o
        }),
      toggleSnap: () => set((s) => void (s.snap = !s.snap)),
      toggleNoOverlap: () => set((s) => void (s.noOverlap = !s.noOverlap)),

      toggleMarkings: () =>
        edit((s) => {
          s.scene.table.markings = !s.scene.table.markings
        }),
      setCloth: (cloth) =>
        edit((s) => {
          s.scene.table.cloth = cloth
        }),
      setBallMm: (mm) =>
        edit((s) => {
          s.scene.table.ballMm = mm
        }),

      /* the draft style also retargets the current selection, which is what a
         coach means by picking a colour while something is selected */
      setInk: (color) => {
        set((s) => void (s.draft.ink = color))
        const id = get().selectedId
        if (id) get().updateItem(id, { color } as Partial<Item>)
      },
      setWidth: (mm) => {
        set((s) => void (s.draft.width = mm))
        const id = get().selectedId
        if (id) get().updateItem(id, { width: mm } as Partial<Item>)
      },
      setStyle: (style) => {
        set((s) => void (s.draft.style = style))
        const id = get().selectedId
        if (id) get().updateItem(id, { style } as Partial<Item>)
      },
      setHead: (head) => {
        set((s) => void (s.draft.head = head))
        const id = get().selectedId
        if (!id) return
        const item = get().scene.items.find((i) => i.id === id)
        if (item?.type === 'ghostTrail') get().updateItem(id, { head: head !== 'none' } as Partial<Item>)
        else if (item?.type === 'arrow') get().updateItem(id, { head } as Partial<Item>)
      },
      setTextSize: (mm) => {
        set((s) => void (s.draft.textSize = mm))
        const id = get().selectedId
        if (id) get().updateItem(id, { size: mm } as Partial<Item>)
      },

      select: (id) => set((s) => void (s.selectedId = id)),

      addBall: (kind, at) => {
        const g = geom()
        const { scene, noOverlap } = get()
        const ballMm = scene.table.ballMm
        const wanted = at ?? { x: g.lengthMm / 2, y: g.widthMm / 2 }
        const p = freeSpot(g, scene.items, ballMm, clampToField(g, wanted, ballMm), noOverlap)
        const ball: BallItem = { id: newId('ball'), type: 'ball', x: p.x, y: p.y, kind }
        edit((s) => {
          s.scene.items.push(ball)
          s.selectedId = ball.id
        })
      },

      addItem: (item, atBottom = false) =>
        edit((s) => {
          if (atBottom) s.scene.items.unshift(item)
          else s.scene.items.push(item)
          s.selectedId = item.id
        }),

      updateItem: (id, patch) => edit((s) => patchItem(s, id, patch)),
      updateItemLive: (id, patch) => set((s) => patchItem(s, id, patch)),

      moveItemBy: (id, dx, dy) =>
        set((s) => {
          const i = s.scene.items.findIndex((it) => it.id === id)
          if (i === -1) return
          s.scene.items[i] = translateItem(s.scene.items[i], dx, dy)
        }),

      dragItemTo: (id, at) => {
        const g = geom()
        const { scene, snap, noOverlap } = get()
        const ballMm = scene.table.ballMm
        const item = scene.items.find((i) => i.id === id)
        if (!item || item.type !== 'ball') return
        let p = clampToField(g, at, ballMm)
        p = clampToField(g, snapPoint(g, p, snap), ballMm)
        p = resolveOverlap(g, scene.items, id, p, ballMm, noOverlap)
        set((s) => patchItem(s, id, { x: p.x, y: p.y } as Partial<Item>))
      },

      nudgeSelected: (dx, dy) => {
        const { selectedId, scene, noOverlap } = get()
        if (!selectedId) return
        const item = scene.items.find((i) => i.id === selectedId)
        if (!item) return
        if (item.type === 'ball') {
          const g = geom()
          const ballMm = scene.table.ballMm
          let p = clampToField(g, { x: item.x + dx, y: item.y + dy }, ballMm)
          p = resolveOverlap(g, scene.items, selectedId, p, ballMm, noOverlap)
          edit((s) => patchItem(s, selectedId, { x: p.x, y: p.y } as Partial<Item>))
          return
        }
        edit((s) => {
          const i = s.scene.items.findIndex((it) => it.id === selectedId)
          if (i !== -1) s.scene.items[i] = translateItem(s.scene.items[i], dx, dy)
        })
      },

      removeSelected: () => {
        const { selectedId } = get()
        if (!selectedId) return
        edit((s) => {
          s.scene.items = s.scene.items.filter((i) => i.id !== selectedId)
          s.selectedId = null
        })
      },

      duplicateSelected: () => {
        const { selectedId, scene } = get()
        const item = scene.items.find((i) => i.id === selectedId)
        if (!item) return
        const copy = { ...translateItem(item, 90, 90), id: newId(item.type) } as Item
        edit((s) => {
          s.scene.items.push(copy)
          s.selectedId = copy.id
        })
      },

      bringToFront: (id) =>
        edit((s) => {
          const i = s.scene.items.findIndex((it) => it.id === id)
          if (i === -1) return
          const [it] = s.scene.items.splice(i, 1)
          s.scene.items.push(it)
        }),

      sendToBack: (id) =>
        edit((s) => {
          const i = s.scene.items.findIndex((it) => it.id === id)
          if (i === -1) return
          const [it] = s.scene.items.splice(i, 1)
          s.scene.items.unshift(it)
        }),

      adjustGhostCount: (id, delta) => {
        const item = get().scene.items.find((i) => i.id === id)
        if (!item || item.type !== 'ghostTrail') return
        const count = Math.min(GHOST_MAX, Math.max(GHOST_MIN, item.count + delta))
        get().updateItem(id, { count, autoCount: false } as Partial<Item>)
      },

      clear: () => {
        if (get().scene.items.length === 0) return
        edit((s) => {
          s.scene.items = []
          s.selectedId = null
        })
      },

      newExercise: () =>
        edit((s) => {
          s.scene.items = []
          s.scene.title = undefined
          s.scene.note = undefined
          s.selectedId = null
        }),

      rackPyramid: () => {
        const g = geom()
        const ballMm = get().scene.table.ballMm
        const balls: Item[] = pyramidBalls(g, ballMm).map((p) => ({
          id: newId('ball'),
          type: 'ball',
          x: p.x,
          y: p.y,
          kind: 'white',
        }))
        const cue = housePoint(g)
        balls.push({ id: newId('ball'), type: 'ball', x: cue.x, y: cue.y, kind: 'cue' })
        edit((s) => {
          // keep everything that is not a ball: the drawing survives a re-rack
          s.scene.items = [...s.scene.items.filter((i) => i.type !== 'ball'), ...balls]
          s.selectedId = null
        })
      },

      replaceScene: (scene) =>
        edit((s) => {
          s.scene = scene
          s.selectedId = null
        }),

      setTitle: (title) =>
        set((s) => void (s.scene.title = title.trim() === '' ? undefined : title)),
      setNote: (note) => set((s) => void (s.scene.note = note.trim() === '' ? undefined : note)),

      beginHistory,

      undo: () => {
        const { past, future, scene } = get()
        if (past.length === 0) return
        const prev = past[past.length - 1]
        set((s) => {
          s.past = past.slice(0, -1)
          s.future = [...future, scene].slice(-HISTORY_LIMIT)
          s.scene = prev
          s.selectedId = null
        })
      },

      redo: () => {
        const { past, future, scene } = get()
        if (future.length === 0) return
        const next = future[future.length - 1]
        set((s) => {
          s.future = future.slice(0, -1)
          s.past = [...past, scene].slice(-HISTORY_LIMIT)
          s.scene = next
          s.selectedId = null
        })
      },
    }
  })
)

export const selectCanUndo = (s: AppState) => s.past.length > 0
export const selectCanRedo = (s: AppState) => s.future.length > 0

/** Recomputes a trail's ball count from its length, unless it was set by hand. */
export function retuneGhost(item: Item, ballMm: number): Partial<Item> | null {
  if (item.type !== 'ghostTrail' || !item.autoCount) return null
  const len = Math.hypot(item.to.x - item.from.x, item.to.y - item.from.y)
  return { count: ghostCount(len, ballMm) } as Partial<Item>
}
