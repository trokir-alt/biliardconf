/**
 * The library: which exercises exist, which one is open, and whether the work
 * has reached the server.
 *
 * It sits between the editor store, which knows only the scene on screen, and
 * the sync engine, which knows only records. Two things make this worth its
 * own file rather than more fields on the scene store:
 *
 *  - the editor writes on every frame of a drag and the library must not. A
 *    commit bumps the revision two devices compare, so it happens when the
 *    coach stops, not while they move.
 *  - hydration is asynchronous and the editor is not. The scene is already on
 *    screen, restored from the crash net, before this store has opened the
 *    database. Nothing here may overwrite a scene the coach has touched since
 *    boot - that is the one bug that would cost real work.
 */

import { create } from 'zustand'
import type { Scene } from '../model/types'
import { useStore } from './store'
import {
  type LocalMeta,
  adoptDraftOnce,
  commitLocal,
  createLocal,
  deleteLocal,
  deviceId,
  initClock,
  isDurable,
  lastOpenId,
  listMeta,
  markLegacyHandled,
  now,
  putPreview,
  readRecord,
  renameLocal,
  restoreLocal,
  setLastOpenId,
} from '../sync/local'
import { clearDraft, loadDraft, setDraftOwner, stampLegacyMigrated } from '../lib/storage'

/** how long after the last change the library takes a revision */
const COMMIT_MS = 1500

export type SyncState =
  /** everything this device holds is on the server */
  | 'synced'
  /** there is work the server has not accepted yet */
  | 'pending'
  /** the last attempt to reach the server failed */
  | 'offline'

export type LibraryState = {
  ready: boolean
  /** false when the browser refused a database: the session will not outlive the tab */
  durable: boolean
  items: LocalMeta[]
  currentId: string | null
  /** the editor holds changes the library has not taken a revision of yet */
  editorDirty: boolean
  sync: SyncState
  /** how many exercises the first connection carried up, for the report */
  uploaded: number | null
  /** set when a conflict left a second copy, so the interface can say so */
  lastConflict: string | null
  /** something the server refused and the engine cannot fix by retrying */
  lastProblem: string | null

  hydrate: () => Promise<void>
  refresh: () => Promise<void>
  /**
   * Write the editor's scene into the library now.
   * @param withPreview also capture a thumbnail. Only true at moments the
   *   coach is leaving the diagram anyway, because the capture resets the
   *   zoom to fit the whole table.
   */
  commitNow: (withPreview?: boolean) => Promise<void>
  open: (id: string) => Promise<void>
  /** the open record changed underneath us; show what arrived */
  reloadCurrent: () => Promise<void>
  createNew: () => Promise<void>
  saveAs: (title: string) => Promise<void>
  rename: (id: string, title: string) => Promise<void>
  duplicate: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  restore: (id: string) => Promise<void>
  setSync: (s: SyncState) => void
  noteUploaded: (n: number) => void
  noteConflict: (title: string | null) => void
  noteProblem: (text: string | null) => void
}

const emptyScene = (): Scene => {
  const s = useStore.getState().scene
  return { version: 1, table: { ...s.table }, items: [] }
}

/** an exercise with nothing on the table and no words is not worth a record */
const hasContent = (s: Scene): boolean =>
  s.items.length > 0 || Boolean(s.title?.trim()) || Boolean(s.note?.trim())

const titleOf = (s: Scene): string => s.title?.trim() || 'Без названия'

/**
 * How the thumbnail is taken.
 *
 * The App owns the Konva stage, so it registers the capture here rather than
 * this store reaching into the canvas. A null source - before the stage is
 * mounted, or in a test - simply means no thumbnails, never an error.
 */
let previewSource: (() => Promise<string | null>) | null = null

export function registerPreviewSource(fn: (() => Promise<string | null>) | null): void {
  previewSource = fn
}

/** JSON of the scene as last committed, so an idle tab takes no revisions */
let lastCommitted: string | null = null
let commitTimer: ReturnType<typeof setTimeout> | null = null

/** other tabs of the same browser share the database; tell them to re-read */
const channel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('biliardconf.library') : null

export const useLibrary = create<LibraryState>()((set, get) => {
  const refresh = async () => {
    const items = await listMeta()
    set({ items })
    // 'offline' is the engine's to clear: a failed connection stays visible
    // until a call succeeds, however clean the local state looks
    if (get().sync !== 'offline') {
      const pending = items.some((m) => m.dirty === 1) || get().editorDirty
      set({ sync: pending ? 'pending' : 'synced' })
    }
  }

  const announce = () => {
    try {
      channel?.postMessage('changed')
    } catch {
      // a closed channel is not worth a broken save
    }
  }

  /** take a thumbnail of what is on the canvas; false when there is none */
  const capture = async (id: string, at: number): Promise<boolean> => {
    if (!previewSource) return false
    try {
      const data = await previewSource()
      if (!data) return false
      await putPreview(id, at, data)
      return true
    } catch {
      // a thumbnail is decoration; the exercise is already saved
      return false
    }
  }

  const commitNow = async (withPreview = false) => {
    if (commitTimer !== null) {
      clearTimeout(commitTimer)
      commitTimer = null
    }
    const scene = useStore.getState().scene
    const json = JSON.stringify(scene)
    const id0 = get().currentId
    if (json === lastCommitted) {
      set({ editorDirty: false })
      if (!withPreview || !id0) return
      const at = now()
      const got = await capture(id0, at)
      const meta = get().items.find((m) => m.id === id0)
      // An exercise whose thumbnail the server has never seen gets one
      // revision to publish it, and only one: a thumbnail rides on the write
      // that carries the drawing, and without a write there is nothing to
      // ride on. After that first time meta.previewAt is set and this is
      // skipped, so opening the library does not churn revisions.
      if (got && meta && meta.previewAt === 0) {
        await commitLocal({ id: id0, scene, title: titleOf(scene) })
        await refresh()
        announce()
      }
      return
    }
    let id = id0
    let at = now()
    if (!id) {
      if (!hasContent(scene)) return
      const meta = await createLocal(scene, titleOf(scene))
      id = meta.id
      at = meta.clientUpdatedAt
      set({ currentId: id })
      // the crash net now belongs to this record, and must say so before the
      // tab has any chance to go away
      setDraftOwner(id)
      await setLastOpenId(id)
    } else {
      const meta = await commitLocal({ id, scene, title: titleOf(scene) })
      at = meta.clientUpdatedAt
    }
    lastCommitted = json
    set({ editorDirty: false })
    if (withPreview) await capture(id, at)
    await refresh()
    announce()
  }

  const scheduleCommit = () => {
    if (commitTimer !== null) clearTimeout(commitTimer)
    commitTimer = setTimeout(() => {
      commitTimer = null
      void commitNow()
    }, COMMIT_MS)
  }

  const loadInto = async (id: string) => {
    const rec = await readRecord(id)
    if (!rec) return
    useStore.getState().replaceScene(rec.scene)
    lastCommitted = JSON.stringify(rec.scene)
    set({ currentId: id, editorDirty: false })
    setDraftOwner(id)
    await setLastOpenId(id)
  }

  return {
    ready: false,
    durable: true,
    items: [],
    currentId: null,
    editorDirty: false,
    sync: 'pending',
    uploaded: null,
    lastConflict: null,
    lastProblem: null,

    hydrate: async () => {
      await initClock()
      await deviceId()
      const durable = await isDurable()
      set({ durable })

      // whatever the coach was drawing is already on screen; note it now, so
      // a change made while the database opens is seen as a change
      const bootScene = useStore.getState().scene
      let touched = false
      const unsub = useStore.subscribe((s) => {
        if (s.scene !== bootScene) touched = true
      })

      const draft = loadDraft()
      let items = await listMeta()
      const alive = items.filter((m) => m.deletedAt === null)
      let opened: string | null = null

      if (draft?.id && items.some((m) => m.id === draft.id)) {
        // the crash net belongs to a known record: it is at least as new as
        // the record, because it was written after the last commit
        opened = draft.id
        set({ currentId: opened })
        setDraftOwner(opened)
        lastCommitted = null
        await commitNow()
      } else if (draft && !draft.id && hasContent(draft.scene)) {
        // a library from before this version, or an exercise never saved:
        // it becomes the first record instead of being thrown away
        const meta = await adoptDraftOnce(draft.scene, titleOf(draft.scene))
        stampLegacyMigrated()
        if (meta) {
          opened = meta.id
          lastCommitted = JSON.stringify(draft.scene)
          set({ currentId: opened })
        } else {
          // another tab adopted it first; fall through to the usual choice
          items = await listMeta()
        }
      } else if (draft && !draft.id) {
        await markLegacyHandled()
      }

      if (!opened) {
        const want = (await lastOpenId()) ?? alive[0]?.id ?? null
        const pick = alive.find((m) => m.id === want) ?? alive[0] ?? null
        if (pick && !touched) {
          await loadInto(pick.id)
          opened = pick.id
        } else if (pick) {
          // the coach started drawing while we were opening the database:
          // their work is the exercise now, and it gets its own record
          set({ currentId: null })
        }
      }

      unsub()
      set({ ready: true })
      await refresh()

      /* from here on the editor drives the library */
      // the editor's own autosave lives in App; here the library only notes
      // that a revision is owed
      useStore.subscribe((s, prev) => {
        if (s.scene === prev.scene) return
        set({ editorDirty: true, sync: get().sync === 'offline' ? 'offline' : 'pending' })
        scheduleCommit()
      })

      channel?.addEventListener('message', () => void refresh())
    },

    refresh,
    commitNow,

    reloadCurrent: async () => {
      const id = get().currentId
      // an uncommitted edit on screen outranks anything that arrives: the
      // engine already skips such records, this is the second line of defence
      if (!id || get().editorDirty) return
      await loadInto(id)
      await refresh()
    },

    open: async (id) => {
      await commitNow(true)
      await loadInto(id)
      await refresh()
    },

    createNew: async () => {
      await commitNow(true)
      useStore.getState().replaceScene(emptyScene())
      lastCommitted = JSON.stringify(useStore.getState().scene)
      set({ currentId: null, editorDirty: false })
      await setLastOpenId(null)
      clearDraft()
      await refresh()
    },

    saveAs: async (title) => {
      const scene = { ...useStore.getState().scene, title }
      useStore.getState().replaceScene(scene)
      const meta = await createLocal(scene, title || 'Без названия')
      lastCommitted = JSON.stringify(scene)
      set({ currentId: meta.id, editorDirty: false })
      setDraftOwner(meta.id)
      await setLastOpenId(meta.id)
      await refresh()
      announce()
    },

    rename: async (id, title) => {
      await renameLocal(id, title)
      if (get().currentId === id) {
        useStore.getState().setTitle(title)
        lastCommitted = JSON.stringify(useStore.getState().scene)
      }
      await refresh()
      announce()
    },

    duplicate: async (id) => {
      const rec = await readRecord(id)
      if (!rec) return
      const copy: Scene = { ...rec.scene, title: `${rec.meta.title} (копия)` }
      await createLocal(copy, copy.title!)
      await refresh()
      announce()
    },

    remove: async (id) => {
      await deleteLocal(id)
      if (get().currentId === id) {
        // the open exercise was put in the trash: leave the table clear
        useStore.getState().replaceScene(emptyScene())
        lastCommitted = JSON.stringify(useStore.getState().scene)
        set({ currentId: null, editorDirty: false })
        await setLastOpenId(null)
        clearDraft()
      }
      await refresh()
      announce()
    },

    restore: async (id) => {
      await restoreLocal(id)
      await refresh()
      announce()
    },

    setSync: (s) => set({ sync: s }),
    noteUploaded: (n) => set({ uploaded: n }),
    noteConflict: (title) => set({ lastConflict: title }),
    noteProblem: (text) => set({ lastProblem: text }),
  }
})
