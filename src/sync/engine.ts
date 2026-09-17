/**
 * The sync engine: the only code that talks to the server.
 *
 * It does two things in a loop - take what changed, then send what is ours -
 * and the whole design is about what happens when that loop is interrupted.
 *
 * - **A pull never overwrites local work.** It applies only to records this
 *   device has not touched, and it leaves the exercise on screen alone while
 *   the coach is in the middle of it. A record with local edits is left for
 *   the push, which is where conflicts are resolved with both versions in
 *   hand.
 * - **A lost answer is not a lost write.** Every write carries an id; the
 *   device remembers the last fifty it sent. When a retry comes back 409
 *   against a version that turns out to be its own earlier write, it takes it
 *   as the acknowledgement it never received instead of forking a copy of
 *   itself.
 * - **The loser of a conflict is kept.** Whichever version does not win, the
 *   device that noticed writes the other one out as a second exercise before
 *   it proceeds. The coach may find two entries; they will never find one
 *   evening's work missing.
 * - **One tab syncs.** Several tabs share one database, so they elect a single
 *   writer through the Web Locks API. The others read and repaint.
 */

import {
  type ConflictResponse,
  type ExerciseMeta,
  type ExerciseRecord,
  type ListResponse,
  conflictTitle,
  decideWinner,
} from './wire'
import {
  applyServer,
  createLocal,
  dirtyRecords,
  deviceId,
  forgetLocal,
  getPreview,
  isOwnWrite,
  loadCursor,
  markSent,
  noteServerTime,
  putPreview,
  readMeta,
  readScene,
  rebaseLocal,
  rememberWrite,
  saveCursor,
} from './local'
import { useLibrary } from '../state/library'

/** the quiet rhythm the brief asks for */
const POLL_MS = 30_000
/** right after a local change, so the other device sees it quickly */
const POLL_SOON_MS = 1_500
/** a server that is not answering is not asked every half minute */
const POLL_BACKOFF_MAX = 5 * 60_000
/** a call that has not answered by now is treated as no network */
const CALL_TIMEOUT_MS = 8_000

type Json = Record<string, unknown>

class Offline extends Error {}

/**
 * The last few exchanges, kept so a failure can be described instead of
 * guessed at.
 *
 * A write that never lands is the worst kind of bug here: the library looks
 * saved, the header can still read "synchronised", and the only evidence is
 * on the device. This ring is that evidence, and it travels in the backup
 * file the coach can send.
 */
type CallTrace = { method: string; path: string; status: number | string; ms: number }
const trace: CallTrace[] = []

export function syncTrace(): CallTrace[] {
  return trace.slice()
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? 'GET'
  const started = Date.now()
  const note = (status: number | string) => {
    trace.push({ method, path: path.replace(/ex-[0-9a-z]+-[0-9a-f]+/, 'ex-…'), status, ms: Date.now() - started })
    if (trace.length > 24) trace.shift()
  }
  try {
    const res = await fetch(path, { ...init, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) })
    note(res.status)
    return res
  } catch (e) {
    note(e instanceof Error ? e.name || 'error' : 'error')
    // a timeout, a refused connection and a dropped wifi are one thing here:
    // the server did not answer, so nothing about local state may change
    throw new Offline('no network')
  }
}

async function readJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T
  } catch {
    // the content type is the whole diagnosis: text/html here means the
    // request never reached the function and the app shell answered instead
    throw new Offline(`not-json:${res.headers.get('content-type') ?? 'без типа'}`)
  }
}

/**
 * Turn a failure into something the coach can act on.
 *
 * «Нет связи» is true but useless: it looks the same whether the hall's wifi
 * is down, the server is throwing, or the API is answering with the app's own
 * page. Those need different fixes, and only the last one is ours.
 */
function explain(reason: string): string {
  if (reason === 'no network') {
    return 'Сеть не отвечает. Работа сохраняется на устройстве и уйдёт, когда связь вернётся.'
  }
  if (reason.startsWith('not-json:')) {
    return `Сервер ответил не данными, а «${reason.slice('not-json:'.length)}». Похоже, запрос к /api не доходит до функции — это поломка на стороне сайта, работа при этом цела.`
  }
  const m = /^(list|get|put|backup) (\d+)$/.exec(reason)
  if (m) {
    const what: Record<string, string> = {
      list: 'списка изменений',
      get: 'чтения упражнения',
      put: 'записи упражнения',
      backup: 'выгрузки',
    }
    return `Сервер ответил ${m[2]} на запрос ${what[m[1]] ?? m[1]}. Работа осталась на устройстве.`
  }
  return `Обмен не удался: ${reason}. Работа осталась на устройстве.`
}

/* ----------------------------------------------------------------- pull */

async function fetchRecord(id: string): Promise<ExerciseRecord | null> {
  const res = await call(`/api/exercises/${id}`)
  if (res.status === 404 || res.status === 410) return null
  if (!res.ok) throw new Offline(`GET ${res.status}`)
  const body = await readJson<{ record: ExerciseRecord }>(res)
  return body.record ?? null
}

/** true when the exercise is open in the editor and not yet committed */
function heldByEditor(id: string): boolean {
  const lib = useLibrary.getState()
  return lib.currentId === id && lib.editorDirty
}

/** true while this device has never had a successful exchange */
let firstConnection = true
/** cleared once this run of the app has listed the library from the beginning */
let reconciled = false

/**
 * How far back to look behind the cursor on every poll.
 *
 * The change feed is a listing, and a listing on Netlify Blobs is eventually
 * consistent - a marker can take up to a minute to appear even when a read of
 * the blob itself is strongly consistent. A cursor that only moves forward
 * therefore has a hole in it: if device B lists while A's marker is still
 * propagating, B's cursor advances past A's timestamp, and when A's marker
 * finally appears it is already older than the cursor and is filtered out
 * FOREVER. The exercise exists on the server and neither device ever sees it.
 *
 * The local stand could never catch this: its store is a Map, so a write is
 * visible the instant it happens. Five minutes is five times the propagation
 * the platform documents, and re-reading a few markers costs nothing.
 */
const CURSOR_OVERLAP_MS = 5 * 60_000

async function pull(): Promise<boolean> {
  const stored = await loadCursor()
  if (stored > 0) firstConnection = false
  // the first exchange after the app starts lists everything: whatever any
  // hole swallowed comes back, so the library heals itself on the next visit
  const since = reconciled ? Math.max(0, stored - CURSOR_OVERLAP_MS) : 0
  const started = Date.now()
  const res = await call(`/api/exercises?since=${since}`)
  if (!res.ok) throw new Offline(`list ${res.status}`)
  const body = await readJson<ListResponse>(res)
  await noteServerTime(body.now, Date.now() - started)

  let changed = false

  /** take one exercise from the listing, scene and thumbnail included */
  const take = async (meta: ExerciseMeta): Promise<boolean> => {
    const local = await readMeta(meta.id)
    // ours to push, not to take: the answer to a local edit is the 409 path
    if (local?.dirty === 1) return false
    if (local && local.rev >= meta.rev) return false
    if (heldByEditor(meta.id)) return false

    if (meta.deletedAt !== null) return (await applyServer(meta, null)) === 'applied'

    const record = await fetchRecord(meta.id)
    if (!record) return false
    const { scene, ...serverMeta } = record
    const applied = (await applyServer(serverMeta as ExerciseMeta, scene)) === 'applied'
    if (applied && useLibrary.getState().currentId === meta.id) {
      // the coach is looking at this one; show them what arrived
      await useLibrary.getState().reloadCurrent()
    }
    if (serverMeta.previewAt > 0) await fetchPreview(meta.id, serverMeta.previewAt)
    return applied
  }

  // A device meeting the library for the first time fetches every exercise
  // one by one, and one by one over a hall's wifi is a minute of waiting.
  // Six at a time, because they are independent - each is its own key - and
  // because more than that just queues inside the browser anyway.
  const BATCH = 6
  for (let i = 0; i < body.items.length; i += BATCH) {
    const done = await Promise.all(body.items.slice(i, i + BATCH).map(take))
    if (done.some(Boolean)) changed = true
  }

  // never let the cursor run ahead of the stored one: a listing that came
  // back short must not move the mark backwards either
  await saveCursor(Math.max(stored, body.cursor))
  reconciled = true
  if (changed) await useLibrary.getState().refresh()
  // a cut-short page means the rest is waiting and should not sit for 30 s
  return body.more
}

/** best effort: a missing thumbnail is a placeholder, never an error */
async function fetchPreview(id: string, at: number): Promise<void> {
  const have = await getPreview(id)
  if (have && have.at >= at) return
  try {
    const res = await call(`/api/previews/${id}?at=${at}`)
    if (!res.ok) return
    const buf = await res.arrayBuffer()
    if (buf.byteLength === 0) return
    let bin = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    await putPreview(id, at, `data:image/jpeg;base64,${btoa(bin)}`)
  } catch {
    // offline, or the thumbnail is simply not there yet
  }
}

/* ----------------------------------------------------------------- push */

/**
 * Send everything this device holds that the server has not accepted.
 *
 * Returns how many records went up, which the first connection reports as
 * "so many exercises transferred".
 */
async function push(): Promise<number> {
  const dev = await deviceId()
  let sent = 0
  for (const m of await dirtyRecords()) {
    // an exercise created and deleted while offline never reached anyone:
    // there is nothing to tombstone and nobody to tell
    if (m.deletedAt !== null && m.rev === 0) {
      await forgetLocal(m.id)
      continue
    }
    const deleting = m.deletedAt !== null
    const scene = deleting ? null : await readScene(m.id)
    if (!deleting && !scene) continue

    let previewAt = 0
    if (!deleting) {
      const shot = await getPreview(m.id)
      if (shot && shot.at > 0) {
        previewAt = await uploadPreview(m.id, shot.at, shot.data)
      }
    }

    await rememberWrite(m.pendingWriteId)
    const res = await call(`/api/exercises/${m.id}`, {
      method: deleting ? 'DELETE' : 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        deleting
          ? { baseRev: m.rev, deviceId: dev, writeId: m.pendingWriteId, clientUpdatedAt: m.clientUpdatedAt }
          : {
              baseRev: m.rev,
              clientUpdatedAt: m.clientUpdatedAt,
              deviceId: dev,
              writeId: m.pendingWriteId,
              title: m.title,
              scene,
              previewAt,
              undelete: m.undelete === 1,
            },
      ),
    })

    if (res.ok) {
      const body = await readJson<{ meta: ExerciseMeta }>(res)
      await markSent(m.id, body.meta, m.clientUpdatedAt)
      sent++
      continue
    }
    if (res.status === 409) {
      const body = await readJson<ConflictResponse>(res)
      await resolve(m.id, body.server)
      continue
    }
    if (res.status === 410 || res.status === 404) {
      await handleGone(m.id)
      continue
    }
    if (res.status === 413) {
      // retrying will not make the diagram smaller. It stays dirty, which is
      // right - the work is here - but the coach has to be told why, or the
      // header says "not sent" forever with no reason given.
      useLibrary
        .getState()
        .noteProblem(`«${m.title}» слишком большое для сервера и осталось только на этом устройстве.`)
      continue
    }
    throw new Offline(`put ${res.status}`)
  }
  return sent
}

async function uploadPreview(id: string, at: number, dataUrl: string): Promise<number> {
  try {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const res = await call(`/api/previews/${id}?at=${at}`, {
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg' },
      body: bytes,
    })
    return res.ok ? at : 0
  } catch {
    // the exercise itself matters; its thumbnail can wait for the next write
    return 0
  }
}

/* ------------------------------------------------------------ conflicts */

/** The server holds a different revision than the one our write was based on. */
async function resolve(id: string, server: ExerciseMeta): Promise<void> {
  const local = await readMeta(id)
  if (!local) return

  // the answer we never got: this version IS our earlier write
  if (await isOwnWrite(server.writeId)) {
    await markSent(id, server, server.clientUpdatedAt)
    return
  }

  const winner = decideWinner(
    { clientUpdatedAt: local.clientUpdatedAt, deviceId: local.deviceId },
    server,
  )

  // a delete has no content to lose: if the other device's edit is newer, the
  // exercise simply stays alive and this device takes their version
  if (local.deletedAt !== null && winner === 'theirs') {
    const record = await fetchRecord(id)
    if (record) {
      const { scene, ...meta } = record
      await applyServer(meta as ExerciseMeta, scene, { requireClean: false })
    }
    return
  }

  if (winner === 'mine') {
    // our version will overwrite theirs, so theirs is written out first
    const record = await fetchRecord(id)
    if (record && record.deletedAt === null) {
      const copy = await createLocal(
        { ...record.scene, title: conflictTitle(record.title, record.updatedAt) },
        conflictTitle(record.title, record.updatedAt),
      )
      useLibrary.getState().noteConflict(copy.title)
    }
    // re-based on what the server actually holds; the next pass sends ours
    await rebaseLocal(id, server.rev, server.updatedAt)
    return
  }

  // theirs stands: ours becomes the second copy, and is pushed as a new record
  const mine = await readScene(id)
  if (mine) {
    const title = conflictTitle(local.title, local.clientUpdatedAt)
    const copy = await createLocal({ ...mine, title }, title)
    useLibrary.getState().noteConflict(copy.title)
  }
  const record = await fetchRecord(id)
  if (record) {
    const { scene, ...meta } = record
    await applyServer(meta as ExerciseMeta, scene, { requireClean: false })
  } else {
    await applyServer(server, null, { requireClean: false })
  }
}

/**
 * The server says this id is gone for good - swept after its tombstone
 * expired. Anything still held here that was never sent is re-created under a
 * new id rather than thrown away with it.
 */
async function handleGone(id: string): Promise<void> {
  const local = await readMeta(id)
  const scene = await readScene(id)
  if (local && scene && local.dirty === 1 && local.deletedAt === null) {
    await createLocal(scene, local.title)
  }
  await forgetLocal(id)
}

/* ----------------------------------------------------------------- loop */

let running = false
/** completed exchanges, so a caller can tell a fresh one from a stale state */
let cycles = 0
let wakeUp: (() => void) | null = null
let nextDelay = POLL_MS
/** a wake asked for while a pass was already running, to be honoured after it */
let wakeAsked = false

/** ask the loop to run now instead of at its next tick */
export function syncNow(): void {
  wakeAsked = true
  nextDelay = POLL_SOON_MS
  // null while a pass is in flight; the flag above is what carries the ask
  wakeUp?.()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    wakeUp = () => {
      clearTimeout(t)
      wakeUp = null
      resolve()
    }
  })
}

async function cycle(): Promise<void> {
  const lib = useLibrary.getState()
  try {
    let more = await pull()
    // two passes: the first resolves conflicts and mints the copies they
    // leave, the second sends those copies without waiting half a minute
    const wasFirst = firstConnection
    let sent = await push()
    if ((await dirtyRecords()).length > 0) sent += await push()
    // only the very first connection reports a transfer: after that an upload
    // is just a save, and calling it "перенесено" would be noise
    if (wasFirst && sent > 0 && lib.uploaded === null) lib.noteUploaded(sent)
    firstConnection = false
    while (more) more = await pull()
    lib.setSync('synced')
    lib.noteProblem(null)
    cycles++
    await lib.refresh()
    // a change made while this pass ran is not made to wait half a minute
    nextDelay = wakeAsked ? POLL_SOON_MS : POLL_MS
  } catch (e) {
    if (!(e instanceof Offline)) throw e
    lib.setSync('offline')
    lib.noteProblem(explain(e.message))
    cycles++
    nextDelay = Math.min(POLL_BACKOFF_MAX, Math.max(POLL_MS, nextDelay * 2))
  }
}

async function loop(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    wakeAsked = false
    await cycle()
    if (signal.aborted) return
    await sleep(nextDelay)
  }
}

/**
 * Start syncing, as the one tab that does.
 *
 * `navigator.locks` holds the promise until the tab goes away, so the lock is
 * released by the browser even if the tab is killed - no stale flag in storage
 * that would leave a library with nobody syncing it.
 */
export function startSync(): () => void {
  if (running) return () => {}
  running = true
  const ctl = new AbortController()

  const run = async () => {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      await navigator.locks.request('biliardconf.sync', { signal: ctl.signal }, async () => {
        await loop(ctl.signal)
      })
    } else {
      await loop(ctl.signal)
    }
  }
  void run().catch(() => {
    // the lock was taken from us, or the tab is going away
  })

  const online = () => syncNow()
  const visible = () => {
    if (document.visibilityState === 'visible') syncNow()
  }
  window.addEventListener('online', online)
  document.addEventListener('visibilitychange', visible)

  return () => {
    running = false
    ctl.abort()
    wakeUp?.()
    window.removeEventListener('online', online)
    document.removeEventListener('visibilitychange', visible)
  }
}

/** how many exchanges have finished; used by the acceptance run to wait */
export function syncCycles(): number {
  return cycles
}

/** the backup file the settings screen offers: everything, from the server */
export async function fetchBackup(): Promise<Json> {
  const res = await call('/api/backup')
  if (!res.ok) throw new Offline(`backup ${res.status}`)
  return readJson<Json>(res)
}
