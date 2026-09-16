/**
 * Geometry that is common to every scene item, in table millimetres.
 *
 * Adding a stage 3 or 4 object means adding a branch to each of these plus one
 * to ItemView - nothing else in the app needs to know the new type exists.
 */

import type { Item, StrikePointItem, Vec } from './types'
import { quadControl } from './style'
import { POWER_ARTBOARD } from '../brand/assets'

export type Rect = { x: number; y: number; w: number; h: number }

const v = (p: Vec, dx: number, dy: number): Vec => ({ x: p.x + dx, y: p.y + dy })

/** Move an item bodily. Returns a new item; never mutates. */
export function translateItem(item: Item, dx: number, dy: number): Item {
  switch (item.type) {
    case 'ball':
    case 'text':
    case 'strikePoint':
    case 'power':
    case 'ghostBall':
      return { ...item, x: item.x + dx, y: item.y + dy }
    case 'zone':
      return { ...item, x: item.x + dx, y: item.y + dy }
    case 'arrow':
      return { ...item, points: item.points.map((p) => v(p, dx, dy)) }
    case 'line':
      return { ...item, from: v(item.from, dx, dy), to: v(item.to, dx, dy) }
    case 'ghostTrail':
      return { ...item, from: v(item.from, dx, dy), to: v(item.to, dx, dy) }
  }
}

/** Axis-aligned bounds, used to place the properties panel and to hit-test. */
export function itemBounds(item: Item, ballMm: number): Rect {
  const box = (xs: number[], ys: number[], pad = 0): Rect => {
    const x0 = Math.min(...xs) - pad
    const y0 = Math.min(...ys) - pad
    return { x: x0, y: y0, w: Math.max(...xs) + pad - x0, h: Math.max(...ys) + pad - y0 }
  }
  switch (item.type) {
    case 'ball':
      return box([item.x], [item.y], ballMm / 2)
    case 'strikePoint': {
      // with a second ball the pair is one picture, and the panel must clear it
      if (!item.companion) return box([item.x], [item.y], item.sizeMm / 2)
      const c = companionCentre(item)
      return box([item.x, c.x], [item.y, c.y], item.sizeMm / 2)
    }
    case 'power': {
      // the plate plus its +/- buttons: on the upright table those sit below
      // the plate, right where a floating panel would otherwise land
      const { w, h } = powerSize(item)
      const reach = powerButtonReach(w)
      return { x: item.x - w / 2 - reach, y: item.y - h / 2, w: w + 2 * reach, h }
    }
    case 'ghostBall':
      return box([item.x], [item.y], ballMm / 2)
    case 'text':
      // a rough box is enough: it only positions the panel
      return box([item.x], [item.y], item.size)
    case 'zone':
      return { x: item.x, y: item.y, w: item.w, h: item.h }
    case 'arrow':
      return box(item.points.map((p) => p.x), item.points.map((p) => p.y), item.width)
    case 'line':
      return box([item.from.x, item.to.x], [item.from.y, item.to.y], item.width)
    case 'ghostTrail':
      return box([item.from.x, item.to.x], [item.from.y, item.to.y], ballMm / 2)
  }
}

/** The draggable handles of an item, in draw order. */
export type Handle = { id: string; at: Vec; kind: 'end' | 'bend' | 'corner' | 'rotate' | 'resize' }

/**
 * The strength indicator, in mm. The designer's artboard is 140 x 88 against a
 * 1120-wide cloth - exactly one eighth of it - so on a 3550 mm table the
 * default plate is 444 x 279 mm.
 */
export const POWER_RATIO = POWER_ARTBOARD.h / POWER_ARTBOARD.w
export const POWER_MIN_MM = 300
export const POWER_MAX_MM = 600
export const POWER_DEFAULT_MM = 444

/** width chosen for a table of this length, kept inside the allowed range */
export function defaultPowerWidth(lengthMm: number): number {
  return Math.round(Math.min(POWER_MAX_MM, Math.max(POWER_MIN_MM, lengthMm / 8)))
}

export function powerSize(item: { widthMm: number }): { w: number; h: number } {
  const w = Math.min(POWER_MAX_MM, Math.max(POWER_MIN_MM, item.widthMm))
  return { w, h: w * POWER_RATIO }
}

/** how far the +/- buttons reach past each end of the plate */
export function powerButtonReach(w: number): number {
  return w * 0.157
}
/** the strike-point ball may be resized between these */
export const STRIKE_MIN_MM = 200
export const STRIKE_MAX_MM = 500
/** where the strike ball's size handle sits, as a multiple of its radius */
export const STRIKE_HANDLE_K = 1.3

/* ------------------------------------------- the second ball at the contact */

/** the second ball's angle lands on this grid, in degrees */
export const COMPANION_STEP_DEG = 15
/** ...whenever the swing comes this close to a grid line */
export const COMPANION_SNAP_DEG = 5

/** degrees folded into [0, 360) */
export function normDeg(deg: number): number {
  const d = deg % 360
  return d < 0 ? d + 360 : d
}

/**
 * The centre of the second ball.
 *
 * Exactly one diameter from the host's centre, because both balls are drawn at
 * the same magnification and touching is the whole statement. There is no
 * second size to keep in sync and no way to end up with a gap.
 */
export function companionCentre(item: StrikePointItem): Vec {
  const a = (item.companion ? item.companion.angleDeg : 0) * (Math.PI / 180)
  return { x: item.x + item.sizeMm * Math.cos(a), y: item.y + item.sizeMm * Math.sin(a) }
}

/** Where the two balls meet: the midpoint of the line of centres. */
export function companionContact(item: StrikePointItem): Vec {
  const a = (item.companion ? item.companion.angleDeg : 0) * (Math.PI / 180)
  const r = item.sizeMm / 2
  return { x: item.x + r * Math.cos(a), y: item.y + r * Math.sin(a) }
}

/**
 * The angle a swing lands on. Whole degrees, and with the markings magnet on
 * it settles onto a 15-degree grid - the angles a coach names out loud.
 */
export function settleCompanionAngle(deg: number, magnet: boolean): number {
  const d = normDeg(deg)
  if (!magnet) return Math.round(d) % 360
  // the nearest grid line is at most half a step away, so a plain difference
  // is already the circular one - even when rounding lands on 360
  const grid = Math.round(d / COMPANION_STEP_DEG) * COMPANION_STEP_DEG
  return Math.abs(d - grid) <= COMPANION_SNAP_DEG ? normDeg(grid) : Math.round(d) % 360
}

export function itemHandles(item: Item): Handle[] {
  switch (item.type) {
    case 'arrow': {
      const a = item.points[0]
      const b = item.points[item.points.length - 1]
      const through = item.points.length === 3 ? item.points[1] : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      return [
        { id: 'a', at: a, kind: 'end' },
        { id: 'bend', at: through, kind: 'bend' },
        { id: 'b', at: b, kind: 'end' },
      ]
    }
    case 'line':
    case 'ghostTrail':
      return [
        { id: 'a', at: item.from, kind: 'end' },
        { id: 'b', at: item.to, kind: 'end' },
      ]
    case 'zone':
      return [
        { id: 'nw', at: { x: item.x, y: item.y }, kind: 'corner' },
        { id: 'ne', at: { x: item.x + item.w, y: item.y }, kind: 'corner' },
        { id: 'se', at: { x: item.x + item.w, y: item.y + item.h }, kind: 'corner' },
        { id: 'sw', at: { x: item.x, y: item.y + item.h }, kind: 'corner' },
      ]
    case 'text':
      return [{ id: 'rotate', at: { x: item.x, y: item.y - item.size * 1.5 }, kind: 'rotate' }]
    case 'power': {
      // the corner of the plate itself: the aspect is locked, so one handle
      // is the whole story
      const { w, h } = powerSize(item)
      return [{ id: 'size', at: { x: item.x + w / 2, y: item.y + h / 2 }, kind: 'resize' }]
    }
    case 'strikePoint': {
      // the size handle sits OUTSIDE the ball, at 1.3 r on the 45-degree
      // diagonal: on the rim it collided with the dot (which may go to 0.9 r)
      // and stole the drag from it
      const r = item.sizeMm * STRIKE_HANDLE_K / 2
      return [{ id: 'size', at: { x: item.x + r * Math.SQRT1_2, y: item.y + r * Math.SQRT1_2 }, kind: 'resize' }]
    }
    default:
      return []
  }
}

/** Apply a handle drag. Returns a patch for the item, or null if nothing moved. */
export function dragHandle(item: Item, handleId: string, to: Vec): Partial<Item> | null {
  switch (item.type) {
    case 'arrow': {
      const pts = item.points.slice()
      const a = pts[0]
      const b = pts[pts.length - 1]
      if (handleId === 'a') return { points: pts.length === 3 ? [to, pts[1], b] : [to, b] } as Partial<Item>
      if (handleId === 'b') return { points: pts.length === 3 ? [a, pts[1], to] : [a, to] } as Partial<Item>
      if (handleId === 'bend') return { points: [a, to, b], curved: true } as Partial<Item>
      return null
    }
    case 'line':
      return handleId === 'a' ? ({ from: to } as Partial<Item>) : ({ to } as Partial<Item>)
    case 'ghostTrail':
      return handleId === 'a' ? ({ from: to } as Partial<Item>) : ({ to } as Partial<Item>)
    case 'zone': {
      const x0 = handleId === 'nw' || handleId === 'sw' ? to.x : item.x
      const y0 = handleId === 'nw' || handleId === 'ne' ? to.y : item.y
      const x1 = handleId === 'ne' || handleId === 'se' ? to.x : item.x + item.w
      const y1 = handleId === 'se' || handleId === 'sw' ? to.y : item.y + item.h
      return {
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        w: Math.abs(x1 - x0),
        h: Math.abs(y1 - y0),
      } as Partial<Item>
    }
    case 'text': {
      const angle = (Math.atan2(to.y - item.y, to.x - item.x) * 180) / Math.PI + 90
      return { angle: Math.round(angle) } as Partial<Item>
    }
    case 'power': {
      // the handle rides the corner, so the drag distance is the half
      // diagonal; the locked aspect turns it back into a width
      const d = Math.hypot(to.x - item.x, to.y - item.y)
      const width = (2 * d) / Math.hypot(1, POWER_RATIO)
      return { widthMm: Math.round(Math.min(POWER_MAX_MM, Math.max(POWER_MIN_MM, width))) } as Partial<Item>
    }
    case 'strikePoint': {
      const size = (2 * Math.hypot(to.x - item.x, to.y - item.y)) / STRIKE_HANDLE_K
      return { sizeMm: Math.round(Math.min(STRIKE_MAX_MM, Math.max(STRIKE_MIN_MM, size))) } as Partial<Item>
    }
    default:
      return null
  }
}

/** Points of the quadratic an arrow follows, for both drawing and hit-testing. */
export function arrowCurve(points: Vec[]): { a: Vec; c: Vec | null; b: Vec } {
  const a = points[0]
  const b = points[points.length - 1]
  if (points.length < 3) return { a, c: null, b }
  return { a, c: quadControl(a, points[1], b), b }
}

/** the dot may not leave this fraction of the radius */
export const DOT_LIMIT = 0.9
/** magnet to the centre and to the two axes, as a fraction of the radius */
export const DOT_SNAP = 0.03

/**
 * Where the dot lands when dragged to `p` (in the ball's own mm frame, origin
 * at the centre): clamped to 0.9 r, snapped to the centre or an axis within 3%.
 */
export function settleDot(p: Vec, radiusMm: number): { u: number; v: number } {
  let u = p.x / radiusMm
  let v = p.y / radiusMm
  const len = Math.hypot(u, v)
  if (len > DOT_LIMIT) {
    u = (u / len) * DOT_LIMIT
    v = (v / len) * DOT_LIMIT
  }
  if (Math.hypot(u, v) <= DOT_SNAP) return { u: 0, v: 0 }
  if (Math.abs(u) <= DOT_SNAP) u = 0
  if (Math.abs(v) <= DOT_SNAP) v = 0
  return { u, v }
}

/** "2,5", "3" - a coach's scale is written with a comma and no trailing zero */
export function formatPower(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',')
}
