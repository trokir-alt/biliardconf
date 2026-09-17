/**
 * IndexedDB, hand-written.
 *
 * A wrapper library would be one more dependency for four object stores and
 * five operations, so this file does it directly. It exposes a deliberately
 * narrow surface - get, getAll, an all-or-nothing write, and one read-then-
 * decide - because that is exactly what the library layer needs and every
 * extra shape is one more way for a transaction to be used wrongly.
 *
 * The rule inside a transaction: await NOTHING except an IndexedDB request of
 * that same transaction. A transaction stays alive only while requests keep
 * coming; one await on a timer, a fetch or an unrelated promise closes it and
 * the writes after it are lost. Every function here obeys that rule.
 *
 * Storage can also be gone entirely - private mode, a locked-down browser, a
 * quota refusal. That is not a crash: `memoryBackend` stands in, the app keeps
 * working for the session, and `durable` is false so the interface can say so.
 * A coach mid-diagram must never be shown a broken page because the browser
 * refused a database.
 */

const DB_NAME = 'biliardconf'
const DB_VERSION = 1

export type StoreName = 'meta' | 'scenes' | 'previews' | 'kv'
const STORES: StoreName[] = ['meta', 'scenes', 'previews', 'kv']

/** one change to the database; a write lands all of them or none */
export type DbOp =
  | { put: StoreName; value: Record<string, unknown> }
  | { del: StoreName; key: string }

export interface Backend {
  /** false when the data lives only in this tab's memory */
  readonly durable: boolean
  get<T>(store: StoreName, key: string): Promise<T | undefined>
  getAll<T>(store: StoreName): Promise<T[]>
  /** all ops in one transaction */
  write(ops: DbOp[]): Promise<void>
  /**
   * Read, then decide, then write - inside ONE transaction.
   *
   * This is what makes the migration safe: another tab opening at the same
   * moment reads the same guard key, and only one of the two gets to write.
   * Returns what `decide` chose, or null when it chose nothing.
   */
  guarded<T>(
    reads: { store: StoreName; key: string }[],
    decide: (values: unknown[]) => { ops: DbOp[]; result: T } | null,
  ): Promise<T | null>
  close(): void
}

/* ------------------------------------------------------------ indexeddb */

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('idb request failed'))
  })
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let r: IDBOpenDBRequest
    try {
      r = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (e) {
      reject(e)
      return
    }
    r.onupgradeneeded = () => {
      const db = r.result
      for (const name of STORES) {
        if (db.objectStoreNames.contains(name)) continue
        const key = name === 'kv' ? 'k' : 'id'
        const os = db.createObjectStore(name, { keyPath: key })
        // the sync engine asks "what is waiting to go up" on every drain, and
        // that question must not cost a scan of the whole library
        if (name === 'meta') os.createIndex('by-dirty', 'dirty')
      }
    }
    r.onsuccess = () => {
      const db = r.result
      // another tab upgrading means this tab's code is stale: let go rather
      // than hold the old version open and block it forever
      db.onversionchange = () => db.close()
      resolve(db)
    }
    r.onerror = () => reject(r.error ?? new Error('indexedDB.open failed'))
    r.onblocked = () => reject(new Error('indexedDB blocked by another tab'))
  })
}

function idbBackend(db: IDBDatabase): Backend {
  const run = <T>(
    names: StoreName[],
    mode: IDBTransactionMode,
    body: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction
      try {
        tx = db.transaction(names, mode)
      } catch (e) {
        reject(e)
        return
      }
      let value: T
      let settled = false
      tx.oncomplete = () => resolve(value)
      tx.onerror = () => {
        if (!settled) reject(tx.error ?? new Error('idb transaction failed'))
      }
      tx.onabort = () => {
        if (!settled) reject(tx.error ?? new Error('idb transaction aborted'))
      }
      body(tx).then(
        (v) => {
          value = v
        },
        (e: unknown) => {
          settled = true
          try {
            tx.abort()
          } catch {
            // already finished; the rejection below is the whole answer
          }
          reject(e)
        },
      )
    })

  return {
    durable: true,
    get: <T,>(store: StoreName, key: string) =>
      run([store], 'readonly', (tx) => req<T>(tx.objectStore(store).get(key) as IDBRequest<T>)),
    getAll: <T,>(store: StoreName) =>
      run([store], 'readonly', (tx) => req<T[]>(tx.objectStore(store).getAll() as IDBRequest<T[]>)),
    write: (ops) => {
      if (ops.length === 0) return Promise.resolve()
      const names = [...new Set(ops.map((o) => ('put' in o ? o.put : o.del)))]
      return run(names, 'readwrite', async (tx) => {
        for (const op of ops) {
          if ('put' in op) tx.objectStore(op.put).put(op.value)
          else tx.objectStore(op.del).delete(op.key)
        }
        // the ops above are queued on the transaction; oncomplete is the
        // acknowledgement, and run() resolves on it
      })
    },
    guarded: (reads, decide) => {
      const names = [...new Set<StoreName>([...reads.map((r) => r.store), ...STORES])]
      return run(names, 'readwrite', async (tx) => {
        const values: unknown[] = []
        for (const r of reads) values.push(await req(tx.objectStore(r.store).get(r.key)))
        const chosen = decide(values)
        if (!chosen) return null
        for (const op of chosen.ops) {
          if ('put' in op) tx.objectStore(op.put).put(op.value)
          else tx.objectStore(op.del).delete(op.key)
        }
        return chosen.result
      })
    },
    close: () => db.close(),
  }
}

/* --------------------------------------------------------------- memory */

/** Everything the real backend does, for a session, in a Map. */
export function memoryBackend(): Backend {
  const data = new Map<StoreName, Map<string, unknown>>()
  for (const s of STORES) data.set(s, new Map())
  const keyOf = (store: StoreName, v: Record<string, unknown>) =>
    String(store === 'kv' ? v.k : v.id)
  // stored values are cloned in and out, so a caller holding a reference
  // cannot reach in and change what is "saved" behind the layer's back
  const clone = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T))
  const apply = (ops: DbOp[]) => {
    for (const op of ops) {
      if ('put' in op) data.get(op.put)!.set(keyOf(op.put, op.value), clone(op.value))
      else data.get(op.del)!.delete(op.key)
    }
  }
  return {
    durable: false,
    get: <T,>(store: StoreName, key: string) =>
      Promise.resolve(clone(data.get(store)!.get(key)) as T | undefined),
    getAll: <T,>(store: StoreName) => Promise.resolve([...data.get(store)!.values()].map(clone) as T[]),
    write: (ops) => {
      apply(ops)
      return Promise.resolve()
    },
    guarded: (reads, decide) => {
      const values = reads.map((r) => clone(data.get(r.store)!.get(r.key)))
      const chosen = decide(values)
      if (!chosen) return Promise.resolve(null)
      apply(chosen.ops)
      return Promise.resolve(chosen.result)
    },
    close: () => {},
  }
}

/* ----------------------------------------------------------------- open */

let opening: Promise<Backend> | null = null

/**
 * The backend for this tab. Opened once; a failure downgrades to memory
 * rather than propagating, because there is no useful thing the caller could
 * do with the error that this file cannot do better.
 */
export function backend(): Promise<Backend> {
  if (opening) return opening
  opening = (async () => {
    if (typeof indexedDB === 'undefined') return memoryBackend()
    try {
      return idbBackend(await openDb())
    } catch {
      return memoryBackend()
    }
  })()
  return opening
}

/** tests only: drop the cached handle so the next call opens again */
export function resetBackendForTests(): void {
  opening = null
}
