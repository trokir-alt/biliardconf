/**
 * Geometry that is common to every scene item, in table millimetres.
 *
 * Adding a stage 3 or 4 object means adding a branch to each of these plus one
 * to ItemView - nothing else in the app needs to know the new type exists.
 */

import type { Item, Vec } from './types'
import { quadControl } from './style'

export type Rect = { x: number; y: number; w: number; h: number }

const v = (p: Vec, dx: number, dy: number): Vec => ({ x: p.x + dx, y: p.y + dy })

/** Move an item bodily. Returns a new item; never mutates. */
export function translateItem(item: Item, dx: number, dy: number): Item {
  switch (item.type) {
    case 'ball':
    case 'text':
    case 'strike':
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
    case 'strike':
      return box([item.x], [item.y], 150)
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
export type Handle = { id: string; at: Vec; kind: 'end' | 'bend' | 'corner' | 'rotate' }

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
