/**
 * The contract between the editor, the server functions and the acceptance
 * harness. All three import THIS file and nothing else for these shapes.
 *
 * It exists because the alternative was tried on paper and failed: three
 * places each grew their own envelope, their own id format and their own
 * comparator, and the id one machine minted was the id the other rejected.
 * A wire format with two definitions is a wire format with none.
 *
 * Node's type stripping lets the .mts functions import this .ts file straight,
 * so the server validates against the very constants the client writes with.
 */

import type { Scene } from '../model/types'

/* ------------------------------------------------------------------- ids */

/**
 * An exercise id: a millisecond stamp in base36 for rough ordering, then
 * randomness so two devices offline never mint the same one. The server
 * validates against this exact expression, so widen both or neither.
 */
export const ID_RE = /^ex-[0-9a-z]{6,12}-[0-9a-f]{12}$/
export const DEVICE_RE = /^dev-[0-9a-f]{12}$/

function hex(bytes: number): string {
  const a = new Uint8Array(bytes)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(a)
  else for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function newExerciseId(nowMs: number): string {
  return `ex-${nowMs.toString(36)}-${hex(6)}`
}

export function newDeviceId(): string {
  return `dev-${hex(6)}`
}

/** a fresh id for one write, so a device can recognise its own landed PUT */
export function newWriteId(): string {
  return hex(8)
}

/* --------------------------------------------------------------- records */

/**
 * Everything about an exercise except its drawing. This is what a listing
 * returns and what lives in the blob's metadata, so it must stay small.
 */
export type ExerciseMeta = {
  id: string
  /** bumped once per COMMIT, never per keystroke; the server is the referee */
  rev: number
  /** who wrote this revision */
  deviceId: string
  /** the device's clock at the commit, corrected by its measured skew */
  clientUpdatedAt: number
  /** the SERVER's clock when it accepted the write - the only comparable one */
  updatedAt: number
  /** a tombstone, in server time; null means alive */
  deletedAt: number | null
  title: string
  /** the id of the write that produced this revision, for echo detection */
  writeId: string
  /** how many objects the diagram holds, so a listing can show something */
  itemCount: number
  /**
   * The `clientUpdatedAt` of the scene the thumbnail shows, or 0 for none.
   *
   * A device's own clock and not the rev, because the thumbnail is captured
   * on the device, from its live canvas, before the server has given the
   * write a revision number. Another device compares it against what it has
   * cached and fetches only when it is behind.
   */
  previewAt: number
}

/** A whole exercise: its metadata and the diagram itself. */
export type ExerciseRecord = ExerciseMeta & { scene: Scene }

/* ----------------------------------------------------------------- calls */

export type PutBody = {
  /** the rev this write is based on; 0 creates */
  baseRev: number
  clientUpdatedAt: number
  deviceId: string
  writeId: string
  title: string
  scene: Scene
  /** the stamp of the thumbnail this device uploaded just before the write */
  previewAt?: number
  /** only an explicit raise brings a tombstoned record back */
  undelete?: boolean
}

export type DeleteBody = {
  baseRev: number
  deviceId: string
  writeId: string
  clientUpdatedAt: number
}

export type ListResponse = {
  /** the server's clock, so a device can measure its own skew */
  now: number
  /** the mark to send as `since` next time */
  cursor: number
  items: ExerciseMeta[]
  /** true when the answer was cut at the page size and more is waiting */
  more: boolean
}

export type ConflictResponse = {
  error: 'conflict'
  /** what the server holds right now */
  server: ExerciseMeta
  now: number
}

export type GoneResponse = { error: 'gone'; id: string; sweptAt: number }

/**
 * What POST /api/exercises sends: the ids this device believes the server
 * already holds.
 *
 * It is how the catalogue heals. An exercise written before the catalogue
 * existed - or one dropped from it by a write that failed halfway - is still
 * in the store under its own key, but nothing enumerates it. The device that
 * has it cached knows its id, so it offers the id and the server folds the
 * record back into the catalogue with a keyed read. Nothing is created from
 * this: an id with no body behind it is ignored.
 */
export type HealBody = { ids: string[] }

/** the catalogue blob: the whole library's metadata, in one keyed read */
export type Catalog = { version: 1; updatedAt: number; items: ExerciseMeta[] }

/* ------------------------------------------------------------- the rules */

/** a body larger than this is refused outright, with a readable error */
export const MAX_BODY_BYTES = 1_000_000
/** how long a tombstone is kept before the sweeper takes the body */
export const TOMBSTONE_DAYS = 30
/** how many daily snapshots are kept */
export const SNAPSHOT_KEEP = 30
/** the most metadata rows one listing will answer with */
export const LIST_PAGE = 500

/**
 * Who wins when the same exercise was edited on two devices.
 *
 * The later edit wins, measured on the SERVER's clock where possible and on
 * the device's corrected clock otherwise. A tie falls to the larger deviceId -
 * arbitrary, but the same arbitrary answer on both devices, which is the
 * property that matters: both must reach the same verdict without talking,
 * or they mint conflict copies of each other forever.
 *
 * The loser is never discarded by this function; the caller keeps it.
 */
export function decideWinner(
  mine: { clientUpdatedAt: number; deviceId: string },
  theirs: { clientUpdatedAt: number; deviceId: string },
): 'mine' | 'theirs' {
  if (mine.clientUpdatedAt !== theirs.clientUpdatedAt) {
    return mine.clientUpdatedAt > theirs.clientUpdatedAt ? 'mine' : 'theirs'
  }
  return mine.deviceId > theirs.deviceId ? 'mine' : 'theirs'
}

/** «конфликт: Выход на свояка, 17.09 в 14:05» */
export function conflictTitle(title: string, at: number): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `конфликт: ${title || 'Без названия'}, ${p(d.getDate())}.${p(d.getMonth() + 1)} в ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** «копия перед восстановлением: …» - what a snapshot restore parks aside */
export function beforeRestoreTitle(title: string, at: number): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `копия перед восстановлением: ${title || 'Без названия'}, ${p(d.getDate())}.${p(d.getMonth() + 1)}`
}

/* --------------------------------------------------------------- the keys */

export const KEY = {
  exercise: (id: string) => `exercises/${id}`,
  preview: (id: string) => `previews/${id}`,
  /**
   * The catalogue: every exercise's metadata in ONE blob, read by key.
   *
   * The change feed used to be built by listing the `changed/` keys. On the
   * live site that listing answered "empty" for a store that demonstrably held
   * the exercises - writes returned 200, keyed reads returned the bodies, and
   * every listing said there was nothing there. A feed that depends on a call
   * which can silently answer "nothing" cannot be trusted with the coach's
   * library, so the feed is a keyed read now: the one kind of call the live
   * site has been shown to answer correctly.
   */
  catalog: 'catalog',
  /** which days have a snapshot - a listing of `snapshots/` by another name */
  days: 'snapshot-days',
  /**
   * The change feed. The key carries the server time, so a listing can answer
   * "what changed since" from the KEYS ALONE - no metadata read per record.
   * That matters: list() returns only { key, etag }, so the obvious reading of
   * the brief costs one request per exercise on every poll.
   */
  changed: (updatedAt: number, id: string) => `changed/${String(updatedAt).padStart(15, '0')}-${id}`,
  snapshot: (day: string) => `snapshots/${day}`,
  /** a headstone for a body the sweeper took, so it can never be recreated */
  grave: (id: string) => `graveyard/${id}`,
}

/** the id out of a changed/ key, or null if the key is not one */
export function parseChangedKey(key: string): { updatedAt: number; id: string } | null {
  const m = /^changed\/(\d{15})-(.+)$/.exec(key)
  if (!m) return null
  const id = m[2]
  if (!ID_RE.test(id)) return null
  return { updatedAt: Number(m[1]), id }
}

/** YYYY-MM-DD in UTC, the key a daily snapshot is filed under */
export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
