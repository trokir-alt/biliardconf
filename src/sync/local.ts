/**
 * The local library: every exercise this device knows about, in IndexedDB.
 *
 * It is a cache of the server and it is also the primary copy while there is
 * no network, which is most of the time in a billiard hall. Two rules follow
 * and everything here exists to keep them:
 *
 *  - a local edit is never overwritten by an arriving server version. The
 *    server copy is kept beside it and the user is told, because the one
 *    thing worse than a conflict is silently losing the work that caused it.
 *  - nothing is deleted outright. A delete sets `deletedAt`; the record is
 *    still here, still syncs, and comes back from the trash unchanged.
 *
 * Times: the server's clock is the only one two devices share, so the local
 * clock is corrected by the skew measured on every listing. `now()` is that
 * corrected time and is what goes into `clientUpdatedAt`.
 */

import type { Scene } from '../model/types'
import {
  type ExerciseMeta,
  DEVICE_RE,
  newDeviceId,
  newExerciseId,
  newWriteId,
} from './wire'
import { backend, type DbOp } from '../lib/db'

/** an exercise as this device holds it: the server's view plus what is ours */
export type LocalMeta = ExerciseMeta & {
  /** 1 while this device holds edits the server has not accepted */
  dirty: 0 | 1
  /** the writeId the next PUT will carry; re-minted by every commit */
  pendingWriteId: string
  /**
   * 1 when this device deliberately brought the exercise back out of the
   * trash. Only such a write raises a tombstone on the server: an ordinary
   * edit made offline must never undo a deletion done on another device.
   */
  undelete: 0 | 1
}

type Kv = { k: string; v: unknown }
const KV = {
  device: 'deviceId',
  cursor: 'cursor',
  skew: 'skew',
  migrated: 'legacyMigrated',
  writeIds: 'writeIds',
} as const

/* -------------------------------------------------------------- kv & ids */

async function kvGet<T>(k: string): Promise<T | undefined> {
  const row = await (await backend()).get<Kv>('kv', k)
  return row?.v as T | undefined
}

async function kvSet(k: string, v: unknown): Promise<void> {
  await (await backend()).write([{ put: 'kv', value: { k, v } }])
}

let cachedDevice: string | null = null

/**
 * This device's id, minted once and kept forever.
 *
 * It is not a login and identifies no person: it exists so a device can tell
 * its own writes from another device's, and so a tie between two edits made in
 * the same millisecond resolves the same way on both of them.
 */
export async function deviceId(): Promise<string> {
  if (cachedDevice) return cachedDevice
  const b = await backend()
  const chosen = await b.guarded([{ store: 'kv', key: KV.device }], ([cur]) => {
    const have = (cur as Kv | undefined)?.v
    if (typeof have === 'string' && DEVICE_RE.test(have)) return { ops: [], result: have }
    const made = newDeviceId()
    return { ops: [{ put: 'kv', value: { k: KV.device, v: made } } as DbOp], result: made }
  })
  cachedDevice = chosen ?? newDeviceId()
  return cachedDevice
}

let skew = 0

/** server clock minus this device's clock, as last measured */
export function clockSkew(): number {
  return skew
}

/** this device's clock, corrected towards the server's */
export function now(): number {
  return Date.now() + skew
}

/**
 * Fold in a fresh measurement. Only large corrections are stored: a device a
 * few seconds off does not matter, one whose clock is a day out would lose
 * every conflict it should win.
 */
export async function noteServerTime(serverNow: number, roundTripMs: number): Promise<void> {
  const measured = serverNow + Math.round(roundTripMs / 2) - Date.now()
  if (Math.abs(measured - skew) < 2000) return
  skew = measured
  await kvSet(KV.skew, skew)
}

export async function loadCursor(): Promise<number> {
  return (await kvGet<number>(KV.cursor)) ?? 0
}

export async function saveCursor(n: number): Promise<void> {
  await kvSet(KV.cursor, n)
}

/**
 * The last writeIds this device sent.
 *
 * When a PUT's answer is lost - a dropped connection, a tab closed at the
 * wrong moment - the write may well have landed. The next attempt then gets a
 * 409 against a server version that IS this device's own work. Recognising the
 * writeId is what stops the device from forking a conflict copy of itself.
 */
export async function rememberWrite(writeId: string): Promise<void> {
  const ring = ((await kvGet<string[]>(KV.writeIds)) ?? []).filter((w) => w !== writeId)
  ring.push(writeId)
  await kvSet(KV.writeIds, ring.slice(-50))
}

export async function isOwnWrite(writeId: string): Promise<boolean> {
  return ((await kvGet<string[]>(KV.writeIds)) ?? []).includes(writeId)
}

export async function initClock(): Promise<void> {
  skew = (await kvGet<number>(KV.skew)) ?? 0
}

/** false when the browser refused us a database and this session is memory-only */
export async function isDurable(): Promise<boolean> {
  return (await backend()).durable
}

/* -------------------------------------------------------------- reading */

export async function listMeta(): Promise<LocalMeta[]> {
  const all = await (await backend()).getAll<LocalMeta>('meta')
  return all.sort((a, b) => b.clientUpdatedAt - a.clientUpdatedAt)
}

export async function readMeta(id: string): Promise<LocalMeta | undefined> {
  return (await backend()).get<LocalMeta>('meta', id)
}

export async function readScene(id: string): Promise<Scene | undefined> {
  const row = await (await backend()).get<{ id: string; scene: Scene }>('scenes', id)
  return row?.scene
}

export async function readRecord(id: string): Promise<{ meta: LocalMeta; scene: Scene } | null> {
  const [meta, scene] = await Promise.all([readMeta(id), readScene(id)])
  if (!meta || !scene) return null
  return { meta, scene }
}

/** everything waiting to go up, oldest edit first so the queue keeps its order */
export async function dirtyRecords(): Promise<LocalMeta[]> {
  const all = await (await backend()).getAll<LocalMeta>('meta')
  return all.filter((m) => m.dirty === 1).sort((a, b) => a.clientUpdatedAt - b.clientUpdatedAt)
}

/* -------------------------------------------------------------- writing */

const countItems = (scene: Scene): number => scene.items.length

function metaOps(meta: LocalMeta, scene: Scene | null): DbOp[] {
  const ops: DbOp[] = [{ put: 'meta', value: meta as unknown as Record<string, unknown> }]
  if (scene) ops.push({ put: 'scenes', value: { id: meta.id, scene } })
  return ops
}

/**
 * Write the editor's current state into the library.
 *
 * Called on commit, not on keystroke: `rev` belongs to the server and
 * `clientUpdatedAt` decides conflicts, so ticking either one per character
 * would make every pause in typing look like a separate edit to the other
 * device. The editor's own autosave is a different, cheaper thing.
 */
export async function commitLocal(args: {
  id: string
  scene: Scene
  title: string
}): Promise<LocalMeta> {
  const b = await backend()
  const dev = await deviceId()
  const at = now()
  const written = await b.guarded([{ store: 'meta', key: args.id }], ([cur]) => {
    const prev = cur as LocalMeta | undefined
    const meta: LocalMeta = {
      id: args.id,
      rev: prev?.rev ?? 0,
      deviceId: dev,
      clientUpdatedAt: at,
      updatedAt: prev?.updatedAt ?? 0,
      // committing an exercise that sits in the trash takes it back out:
      // the coach edited it, which is as clear an undelete as there is
      deletedAt: null,
      title: args.title,
      writeId: prev?.writeId ?? '',
      itemCount: countItems(args.scene),
      previewAt: prev?.previewAt ?? 0,
      dirty: 1,
      pendingWriteId: newWriteId(),
      // editing something that sits in the trash is as clear a request to
      // bring it back as pressing the button would be
      undelete: prev?.deletedAt != null || prev?.undelete === 1 ? 1 : 0,
    }
    return { ops: metaOps(meta, args.scene), result: meta }
  })
  return written!
}

/** A brand new exercise, born dirty so the engine takes it up. */
export async function createLocal(scene: Scene, title: string): Promise<LocalMeta> {
  return commitLocal({ id: newExerciseId(now()), scene, title })
}

/** Sets the tombstone. The body stays: the trash is this, and sync needs it. */
export async function deleteLocal(id: string): Promise<void> {
  const b = await backend()
  const dev = await deviceId()
  const at = now()
  await b.guarded([{ store: 'meta', key: id }], ([cur]) => {
    const prev = cur as LocalMeta | undefined
    if (!prev || prev.deletedAt !== null) return null
    const meta: LocalMeta = {
      ...prev,
      deviceId: dev,
      clientUpdatedAt: at,
      deletedAt: at,
      dirty: 1,
      pendingWriteId: newWriteId(),
      undelete: 0,
    }
    return { ops: metaOps(meta, null), result: meta }
  })
}

export async function restoreLocal(id: string): Promise<void> {
  const b = await backend()
  const dev = await deviceId()
  const at = now()
  await b.guarded([{ store: 'meta', key: id }], ([cur]) => {
    const prev = cur as LocalMeta | undefined
    if (!prev || prev.deletedAt === null) return null
    const meta: LocalMeta = {
      ...prev,
      deviceId: dev,
      clientUpdatedAt: at,
      deletedAt: null,
      dirty: 1,
      pendingWriteId: newWriteId(),
      undelete: 1,
    }
    return { ops: metaOps(meta, null), result: meta }
  })
}

export async function renameLocal(id: string, title: string): Promise<void> {
  const rec = await readRecord(id)
  if (!rec) return
  await commitLocal({ id, scene: rec.scene, title })
}

/**
 * Take a version that came down from the server.
 *
 * `guard` is what protects work in progress: the caller passes the state it
 * decided against, and the write only lands if nothing changed underneath in
 * the meantime. A record that went dirty while the response was in flight is
 * left alone for the conflict path to handle.
 */
export async function applyServer(
  meta: ExerciseMeta,
  scene: Scene | null,
  guard: { requireClean: boolean } = { requireClean: true },
): Promise<'applied' | 'skipped'> {
  const b = await backend()
  const res = await b.guarded([{ store: 'meta', key: meta.id }], ([cur]) => {
    const prev = cur as LocalMeta | undefined
    if (prev && guard.requireClean && prev.dirty === 1) return null
    // an older revision arriving late must not undo a newer one
    if (prev && prev.rev > meta.rev) return null
    const next: LocalMeta = {
      ...meta,
      dirty: 0,
      pendingWriteId: '',
      undelete: 0,
      // the server's stamp is taken as-is: what THIS device has cached is
      // the previews row's own stamp, and the two are compared, not merged
      previewAt: meta.previewAt,
    }
    const ops = metaOps(next, scene)
    // a tombstone from the server frees the drawing; the metadata stays so
    // the record cannot come back from another device's stale cache
    if (meta.deletedAt !== null) ops.push({ del: 'scenes', key: meta.id })
    return { ops, result: 'applied' as const }
  })
  return res ?? 'skipped'
}

/**
 * The server accepted this device's write.
 *
 * If the user has edited again since it was sent, the record stays dirty and
 * only the server's bookkeeping is taken - the new edits are the next write.
 */
export async function markSent(
  id: string,
  server: ExerciseMeta,
  sentClientUpdatedAt: number,
): Promise<void> {
  const b = await backend()
  await b.guarded([{ store: 'meta', key: id }], ([cur]) => {
    const prev = cur as LocalMeta | undefined
    if (!prev) return null
    const stillSame = prev.clientUpdatedAt === sentClientUpdatedAt
    const next: LocalMeta = {
      ...prev,
      rev: server.rev,
      updatedAt: server.updatedAt,
      writeId: server.writeId,
      deletedAt: stillSame ? server.deletedAt : prev.deletedAt,
      dirty: stillSame ? 0 : 1,
      undelete: stillSame ? 0 : prev.undelete,
    }
    return { ops: metaOps(next, null), result: next }
  })
}

/** A record the server says is gone for good: the sweeper took the body. */
export async function forgetLocal(id: string): Promise<void> {
  await (await backend()).write([
    { del: 'meta', key: id },
    { del: 'scenes', key: id },
    { del: 'previews', key: id },
  ])
}

/* ------------------------------------------------------------- previews */

export type PreviewRow = { id: string; at: number; data: string }

export async function putPreview(id: string, at: number, data: string): Promise<void> {
  await (await backend()).write([{ put: 'previews', value: { id, at, data } }])
}

export async function getPreview(id: string): Promise<PreviewRow | undefined> {
  return (await backend()).get<PreviewRow>('previews', id)
}

export async function allPreviews(): Promise<PreviewRow[]> {
  return (await backend()).getAll<PreviewRow>('previews')
}

/** the server moved on and our edits must be re-based onto its revision */
export async function rebaseLocal(id: string, rev: number, updatedAt: number): Promise<void> {
  const b = await backend()
  await b.guarded([{ store: 'meta', key: id }], ([cur]) => {
    const prev = cur as LocalMeta | undefined
    if (!prev) return null
    return { ops: metaOps({ ...prev, rev, updatedAt }, null), result: rev }
  })
}

/**
 * Turn the autosaved draft into a library record, but only once.
 *
 * Two tabs opening at the same moment both find the same localStorage scene
 * and both want to adopt it. The guard key is read and written inside the one
 * transaction that creates the record, so the second tab sees the first tab's
 * mark and stands down instead of minting a twin.
 */
export async function adoptDraftOnce(scene: Scene, title: string): Promise<LocalMeta | null> {
  const b = await backend()
  const dev = await deviceId()
  const at = now()
  return b.guarded([{ store: 'kv', key: KV.migrated }], ([cur]) => {
    if ((cur as Kv | undefined)?.v) return null
    const meta: LocalMeta = {
      id: newExerciseId(at),
      rev: 0,
      deviceId: dev,
      clientUpdatedAt: at,
      updatedAt: 0,
      deletedAt: null,
      title,
      writeId: '',
      itemCount: countItems(scene),
      previewAt: 0,
      dirty: 1,
      pendingWriteId: newWriteId(),
      undelete: 0,
    }
    return {
      ops: [...metaOps(meta, scene), { put: 'kv', value: { k: KV.migrated, v: at } } as DbOp],
      result: meta,
    }
  })
}

/** mark the legacy slot handled without adopting it (it held nothing worth keeping) */
export async function markLegacyHandled(): Promise<void> {
  await kvSet(KV.migrated, now())
}

export async function lastOpenId(): Promise<string | null> {
  return (await kvGet<string>('lastOpenId')) ?? null
}

export async function setLastOpenId(id: string | null): Promise<void> {
  await kvSet('lastOpenId', id)
}
