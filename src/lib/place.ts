/**
 * Placement maths, all in table millimetres.
 *
 * Every function here is pure (bar `newId`'s counter) so the store can call it
 * during a drag, sixty times a second, without allocating a scene or touching
 * React. Nothing in this file knows about pixels or Konva.
 */

import type { Item, Vec } from '../model/types'
import type { TableGeometry } from '../model/table'
import { clampToField } from '../model/table'

/** magnet radius for snapping, spec section 7 */
export const SNAP_MM = 20

/** the push-apart overshoots contact by this much, so a resolved pair stays apart */
const EPS_MM = 0.05

/** push-apart iterations; a packed corner may still overlap, that is accepted */
const RELAX_PASSES = 12

/**
 * Golden angle. Escaping exactly coincident centres along it spreads a stack of
 * balls into a rosette instead of a line, and it is deterministic, so a render
 * of the same scene always lands in the same place.
 */
const GOLDEN_ANGLE = 2.399963229728653

/** required centre-to-centre distance; one definition for every test in here */
const minDist = (ballMm: number): number => ballMm + EPS_MM

/* -------------------------------------------------------------------- ids */

let idCounter = 0

/**
 * Collision-free unique id, e.g. `newId('ball')` -> `ball-3f2a91c`.
 *
 * The counter alone already guarantees uniqueness inside a session; the random
 * part only keeps ids from two different sessions apart when scenes are merged
 * by copy-paste or by loading a saved file.
 */
export function newId(prefix: string): string {
  idCounter += 1
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : null
  const rnd = uuid ? uuid.slice(0, 6) : Math.random().toString(36).slice(2, 8)
  return `${prefix}-${rnd}${idCounter.toString(36)}`
}

/* ------------------------------------------------------------------ snap */

const near = (a: Vec, b: Vec): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= SNAP_MM

/**
 * Magnet to the table markings and to the pocket drop points. Point targets win
 * over axis targets: landing a ball on the back spot matters more than lining it
 * up with the centre line.
 */
export function snapPoint(g: TableGeometry, p: Vec, enabled: boolean): Vec {
  if (!enabled) return p

  for (const s of g.spots) if (near(p, s)) return { x: s.x, y: s.y }
  for (const pocket of g.pockets) if (near(p, pocket.at)) return { x: pocket.at.x, y: pocket.at.y }

  // no point target in range: snap the axes independently
  let x = p.x
  let y = p.y
  for (const line of g.crossLines) {
    if (Math.abs(p.x - line.from.x) <= SNAP_MM) {
      x = line.from.x
      break
    }
  }
  if (Math.abs(p.y - g.longLine.from.y) <= SNAP_MM) y = g.longLine.from.y
  return { x, y }
}

/* --------------------------------------------------------------- overlap */

/** Fixed discs the moving point has to stay clear of. */
function obstacles(items: Item[], movingId: string | null): Vec[] {
  const out: Vec[] = []
  for (const item of items) {
    if (item.type !== 'ball' || item.id === movingId) continue
    out.push({ x: item.x, y: item.y })
  }
  return out
}

/** True when `p` clears every disc in `discs`, by the same rule resolveOverlap enforces. */
function isFree(discs: Vec[], p: Vec, ballMm: number): boolean {
  const min = minDist(ballMm)
  for (const d of discs) {
    if (Math.hypot(p.x - d.x, p.y - d.y) < min) return false
  }
  return true
}

/**
 * Soft push-apart: only the moving point moves, the rest of the rack stays put.
 * Clamping after each pass can re-create an overlap in a fully packed corner, so
 * the loop is budgeted and simply returns the best it reached.
 */
export function resolveOverlap(
  g: TableGeometry,
  items: Item[],
  movingId: string | null,
  p: Vec,
  ballMm: number,
  enabled: boolean,
): Vec {
  if (!enabled) return p

  const discs = obstacles(items, movingId)
  if (discs.length === 0) return p

  const min = minDist(ballMm)
  let cur = { x: p.x, y: p.y }

  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    let moved = false
    for (let i = 0; i < discs.length; i++) {
      const d = discs[i]
      const dx = cur.x - d.x
      const dy = cur.y - d.y
      const dist = Math.hypot(dx, dy)
      if (dist >= min) continue
      if (dist < 1e-6) {
        // exactly coincident: there is no direction to push along, so pick one
        // from the index and land straight on the contact circle
        const a = (i * GOLDEN_ANGLE) % (Math.PI * 2)
        cur = { x: d.x + Math.cos(a) * min, y: d.y + Math.sin(a) * min }
        moved = true
        continue
      }
      const push = (min - dist) / dist
      cur = { x: cur.x + dx * push, y: cur.y + dy * push }
      moved = true
    }
    cur = clampToField(g, cur, ballMm)
    if (!moved) break
  }

  return cur
}

/* -------------------------------------------------------------- free spot */

/** Rings sample this many angles; enough to find a gap without being costly. */
const RING_ANGLES = 12

/**
 * Nearest free spot to `preferred` for a newly added ball. Spirals outward so a
 * repeated "add ball" lays balls next to each other instead of stacking them.
 */
export function freeSpot(
  g: TableGeometry,
  items: Item[],
  ballMm: number,
  preferred: Vec,
  enabled: boolean,
): Vec {
  if (!enabled) return preferred

  const discs = obstacles(items, null)
  const start = clampToField(g, preferred, ballMm)
  if (isFree(discs, start, ballMm)) return start

  const step = ballMm * 0.75
  const maxR = g.lengthMm / 3
  for (let r = step; r <= maxR; r += step) {
    for (let k = 0; k < RING_ANGLES; k++) {
      const a = (k / RING_ANGLES) * Math.PI * 2
      const cand = { x: start.x + Math.cos(a) * r, y: start.y + Math.sin(a) * r }
      // only accept a candidate that is genuinely on the field, not one clamped
      // onto the rail, or the spiral would pile balls along the cushion
      const clamped = clampToField(g, cand, ballMm)
      if (clamped.x !== cand.x || clamped.y !== cand.y) continue
      if (isFree(discs, cand, ballMm)) return cand
    }
  }
  return start
}

/* ---------------------------------------------------------------- pyramid */

/**
 * The 15 balls of a Russian pyramid, apex first, row by row.
 *
 * The apex sits on the back centre spot and the triangle opens away from the
 * house (which is the low-x quarter), so rows run towards +x. The small gap on
 * top of the geometric pitch keeps the anti-overlap pass from nudging a freshly
 * racked pyramid apart.
 */
export function pyramidBalls(g: TableGeometry, ballMm: number): Vec[] {
  const gap = 0.15
  const rowPitch = (ballMm * Math.sqrt(3)) / 2 + gap
  const sideStep = ballMm + gap
  const apex = g.spots[2]
  const cy = g.widthMm / 2

  const out: Vec[] = []
  for (let row = 0; row < 5; row++) {
    const x = apex.x + row * rowPitch
    for (let k = 0; k <= row; k++) {
      out.push({ x, y: cy + (k - row / 2) * sideStep })
    }
  }
  return out
}

/** Where the cue ball goes when racking: the middle of the house. */
export function housePoint(g: TableGeometry): Vec {
  return { x: g.houseLineX / 2, y: g.widthMm / 2 }
}
