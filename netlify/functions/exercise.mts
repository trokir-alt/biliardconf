/**
 * One exercise: read it, write it, or lay a tombstone on it.
 *
 * The write rules are where the coach's work is kept or lost, so they are
 * spelled out rather than implied:
 *
 * - A write carries the rev it is based on. A mismatch is a 409 with what the
 *   server holds, and the client decides - it never loses silently.
 * - A tombstone is never cleared by an ordinary write. An edit that was made
 *   offline still lands, but it lands UNDER the tombstone, so a deletion on
 *   one device cannot be undone by a stale edit on another. Only an explicit
 *   `undelete` raises it.
 * - A missing key with a non-zero base rev is terminal, not a chance to
 *   recreate. The sweeper leaves a headstone; without that rule a device that
 *   was off for a month would resurrect everything it still had cached.
 */

import type { Config, Context } from '@netlify/functions'
import {
  ID_RE,
  KEY,
  MAX_BODY_BYTES,
  type DeleteBody,
  type ExerciseMeta,
  type ExerciseRecord,
  type PutBody,
} from '../../src/sync/wire.ts'
import { fail, json, now, openStore } from '../lib/store.mts'

type Store = ReturnType<typeof openStore>

/** the metadata a blob carries, small enough to read without the body */
type BlobMeta = { rev: number; updatedAt: number; deletedAt: number | null; changedKey: string }

/** writes the record, moves its marker, and answers with the new metadata */
async function commit(store: Store, id: string, meta: ExerciseMeta, scene: unknown, prev: string | null) {
  const changedKey = KEY.changed(meta.updatedAt, id)
  const record: ExerciseRecord = { ...meta, scene: scene as ExerciseRecord['scene'] }
  const blobMeta: BlobMeta = { rev: meta.rev, updatedAt: meta.updatedAt, deletedAt: meta.deletedAt, changedKey }
  await store.setJSON(KEY.exercise(id), record, { metadata: blobMeta })
  // the marker's body IS the metadata, so a listing never touches the record
  await store.setJSON(changedKey, meta)
  // the old marker would otherwise answer a later ?since= with a stale rev
  if (prev && prev !== changedKey) await store.delete(prev)
  return meta
}

export default async (req: Request, context: Context) => {
  const id = String(context.params?.id ?? '')
  if (!ID_RE.test(id)) return fail(400, 'bad-id')
  const store = openStore()
  const key = KEY.exercise(id)

  if (req.method === 'GET') {
    const hit = await store.getWithMetadata(key, { type: 'json' })
    if (!hit) return fail(404, 'not-found')
    return json({ record: hit.data, now: now() })
  }

  if (req.method !== 'PUT' && req.method !== 'DELETE') return fail(405, 'method')

  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) return fail(413, 'too-large', { limit: MAX_BODY_BYTES })
  let body: PutBody | DeleteBody
  try {
    body = JSON.parse(raw)
  } catch {
    return fail(400, 'bad-json')
  }
  if (typeof body?.baseRev !== 'number' || typeof body?.deviceId !== 'string' || typeof body?.writeId !== 'string') {
    return fail(400, 'bad-body')
  }

  const cur = await store.getWithMetadata(key, { type: 'json' })
  const curMeta = (cur?.metadata ?? null) as BlobMeta | null

  if (!cur) {
    // a body that is gone for good must never come back through a stale device
    const grave = await store.getMetadata(KEY.grave(id))
    if (grave) return fail(410, 'gone', { id, sweptAt: (grave.metadata as { sweptAt?: number })?.sweptAt ?? 0 })
    if (body.baseRev !== 0) return fail(410, 'gone', { id, sweptAt: 0 })
    if (req.method === 'DELETE') return fail(404, 'not-found')
  } else if (body.baseRev !== curMeta!.rev) {
    return json({ error: 'conflict', server: (cur.data as ExerciseRecord) && metaOf(cur.data as ExerciseRecord), now: now() }, 409)
  }

  const at = Math.max(now(), (curMeta?.updatedAt ?? 0) + 1)
  const put = body as PutBody
  const wasDeleted = curMeta?.deletedAt ?? null
  const meta: ExerciseMeta = {
    id,
    rev: (curMeta?.rev ?? 0) + 1,
    deviceId: body.deviceId,
    clientUpdatedAt: Number(body.clientUpdatedAt) || at,
    updatedAt: at,
    deletedAt: req.method === 'DELETE' ? at : put.undelete ? null : wasDeleted,
    title: req.method === 'DELETE' ? String((cur?.data as ExerciseRecord)?.title ?? '') : String(put.title ?? ''),
    writeId: body.writeId,
    itemCount: req.method === 'DELETE'
      ? Number((cur?.data as ExerciseRecord)?.itemCount ?? 0)
      : Array.isArray(put.scene?.items)
        ? put.scene.items.length
        : 0,
    previewRev: Number((cur?.data as ExerciseRecord)?.previewRev ?? 0),
  }
  const scene = req.method === 'DELETE' ? (cur?.data as ExerciseRecord)?.scene : put.scene
  if (req.method === 'PUT' && (!scene || typeof scene !== 'object')) return fail(400, 'bad-scene')

  await commit(store, id, meta, scene, curMeta?.changedKey ?? null)
  return json({ meta, now: now() })
}

function metaOf(r: ExerciseRecord): ExerciseMeta {
  const { scene: _scene, ...meta } = r
  return meta
}

export const config: Config = { path: '/api/exercises/:id', region: 'fra' }
