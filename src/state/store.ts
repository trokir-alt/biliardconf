/**
 * Scene store: zustand + immer, with an undo/redo stack of whole-scene
 * snapshots capped at 50 (spec section 3).
 *
 * Because the immer middleware freezes state and shares structure, a snapshot
 * is just the previous `scene` reference - cheap to keep and cheap to restore.
 */

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { BallItem, BallKind, ClothColor, Item, Orientation, Scene, Vec } from '../model/types'
import { DEFAULT_TABLE, buildGeometry, clampToField } from '../model/table'
import { freeSpot, housePoint, newId, pyramidBalls, resolveOverlap, snapPoint } from '../lib/place'

export const HISTORY_LIMIT = 50

/** Stage 1 tools. Later stages add their own without touching anything else. */
export type Tool = 'select' | 'ball-white' | 'ball-cue'

export type AppState = {
  scene: Scene
  selectedId: string | null
  tool: Tool
  orientation: Orientation
  /** true until the user picks an orientation by hand; lets the layout rotate the table on a narrow screen */
  orientationAuto: boolean
  snap: boolean
  noOverlap: boolean
  past: Scene[]
  future: Scene[]

  /* ---- tools & view ---- */
  setTool: (tool: Tool) => void
  setOrientation: (o: Orientation) => void
  /** layout-driven rotation, ignored once the user has chosen */
  autoOrientation: (o: Orientation) => void
  toggleSnap: () => void
  toggleNoOverlap: () => void
  toggleMarkings: () => void
  setCloth: (cloth: ClothColor) => void
  setBallMm: (mm: number) => void

  /* ---- selection ---- */
  select: (id: string | null) => void

  /* ---- editing ---- */
  addBall: (kind: BallKind, at?: Vec) => void
  /** live drag: moves without touching history, snap/overlap applied */
  dragItemTo: (id: string, at: Vec) => void
  /** nudge the selection by whole millimetres, one history entry per call */
  nudgeSelected: (dx: number, dy: number) => void
  removeSelected: () => void
  clear: () => void
  rackPyramid: () => void
  replaceScene: (scene: Scene) => void

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

export const useStore = create<AppState>()(
  immer((set, get) => {
    /** push the current scene onto the undo stack and drop the redo stack */
    const beginHistory = () => {
      const { scene, past } = get()
      const trimmed = past.length >= HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT + 1) : past.slice()
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

    return {
      scene: emptyScene(),
      selectedId: null,
      tool: 'select',
      orientation: 'horizontal',
      orientationAuto: true,
      snap: true,
      noOverlap: true,
      past: [],
      future: [],

      setTool: (tool) => set((s) => void (s.tool = tool)),
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

      dragItemTo: (id, at) => {
        const g = geom()
        const { scene, snap, noOverlap } = get()
        const ballMm = scene.table.ballMm
        const item = scene.items.find((i) => i.id === id)
        if (!item || item.type !== 'ball') return
        let p = clampToField(g, at, ballMm)
        p = clampToField(g, snapPoint(g, p, snap), ballMm)
        p = resolveOverlap(g, scene.items, id, p, ballMm, noOverlap)
        set((s) => {
          const target = s.scene.items.find((i) => i.id === id)
          if (target && target.type === 'ball') {
            target.x = p.x
            target.y = p.y
          }
        })
      },

      nudgeSelected: (dx, dy) => {
        const { selectedId, scene, noOverlap } = get()
        if (!selectedId) return
        const item = scene.items.find((i) => i.id === selectedId)
        if (!item || item.type !== 'ball') return
        const g = geom()
        const ballMm = scene.table.ballMm
        let p = clampToField(g, { x: item.x + dx, y: item.y + dy }, ballMm)
        p = resolveOverlap(g, scene.items, selectedId, p, ballMm, noOverlap)
        edit((s) => {
          const target = s.scene.items.find((i) => i.id === selectedId)
          if (target && target.type === 'ball') {
            target.x = p.x
            target.y = p.y
          }
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

      clear: () => {
        if (get().scene.items.length === 0) return
        edit((s) => {
          s.scene.items = []
          s.selectedId = null
        })
      },

      rackPyramid: () => {
        const g = geom()
        const ballMm = get().scene.table.ballMm
        const items: Item[] = pyramidBalls(g, ballMm).map((p) => ({
          id: newId('ball'),
          type: 'ball',
          x: p.x,
          y: p.y,
          kind: 'white',
        }))
        const cue = housePoint(g)
        items.push({ id: newId('ball'), type: 'ball', x: cue.x, y: cue.y, kind: 'cue' })
        edit((s) => {
          s.scene.items = items
          s.selectedId = null
        })
      },

      replaceScene: (scene) =>
        edit((s) => {
          s.scene = scene
          s.selectedId = null
        }),

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
