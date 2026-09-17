/**
 * A stand-in for @netlify/blobs, for running the real functions locally.
 *
 * It implements only what netlify/functions actually calls, and it implements
 * it the way the documented API behaves - list() answers with keys and etags
 * and NOTHING else, which is the constraint the change-feed design exists to
 * work around. A fake that quietly returned metadata here would let a broken
 * design pass the acceptance run and fail in production.
 *
 * Node resolves '@netlify/blobs' to this file through scripts/blobs-hook.mjs,
 * so the functions under test are the unmodified ones that ship.
 */

const stores = new Map()

/**
 * Key fragments hidden from list() — the harness's way of reproducing the one
 * thing this fake cannot have: a listing that lags behind the writes.
 * On Netlify a marker can take up to a minute to show up in list() even
 * though reading the blob itself is strongly consistent.
 */
let hiddenFromList = []

/** harness only: make keys containing this fragment invisible to list() */
export function __hideFromList(fragment) {
  hiddenFromList.push(fragment)
}

export function __showAll() {
  hiddenFromList = []
}

class FakeStore {
  constructor(name) {
    this.name = name
    this.data = new Map()
    /** the consistency the store was OPENED with, which list() cares about */
    this.storeConsistency = undefined
  }

  /**
   * List, including the platform's sharpest edge.
   *
   * A store opened with `consistency: 'strong'` sends listings to the uncached
   * edge endpoint, which does not serve listings: it answers 404, and the real
   * client turns a 404 into an EMPTY RESULT with no error. Writes and keyed
   * reads keep working, so everything looks healthy while every listing claims
   * the store is empty. That cost a day of the coach's time, so the fake does
   * it too - reintroduce store-level strong consistency and the two-device
   * check fails here instead of in production.
   */
  async list({ prefix = '' } = {}) {
    if (this.storeConsistency === 'strong') return { blobs: [], directories: [] }
    const blobs = []
    for (const [key, row] of this.data) {
      if (!key.startsWith(prefix)) continue
      if (hiddenFromList.some((f) => key.includes(f))) continue
      blobs.push({ key, etag: row.etag })
    }
    return { blobs, directories: [] }
  }

  async get(key, { type = 'text' } = {}) {
    const row = this.data.get(key)
    if (!row) return null
    if (type === 'json') return JSON.parse(Buffer.from(row.body).toString('utf8'))
    if (type === 'arrayBuffer') {
      return row.body.buffer.slice(row.body.byteOffset, row.body.byteOffset + row.body.byteLength)
    }
    return Buffer.from(row.body).toString('utf8')
  }

  async getWithMetadata(key, opts = {}) {
    const row = this.data.get(key)
    if (!row) return null
    return { data: await this.get(key, opts), etag: row.etag, metadata: row.metadata }
  }

  async getMetadata(key) {
    const row = this.data.get(key)
    if (!row) return null
    return { etag: row.etag, metadata: row.metadata }
  }

  async set(key, body, { metadata } = {}) {
    const buf =
      body instanceof ArrayBuffer
        ? Buffer.from(body)
        : ArrayBuffer.isView(body)
          ? Buffer.from(body.buffer, body.byteOffset, body.byteLength)
          : Buffer.from(String(body), 'utf8')
    this.data.set(key, { body: buf, metadata: metadata ?? {}, etag: `"${Date.now()}-${this.data.size}"` })
  }

  async setJSON(key, value, opts = {}) {
    await this.set(key, JSON.stringify(value), opts)
  }

  async delete(key) {
    this.data.delete(key)
  }
}

function pick(options = {}) {
  const name = typeof options === 'string' ? options : (options.name ?? 'default')
  if (!stores.has(name)) stores.set(name, new FakeStore(name))
  const store = stores.get(name)
  store.storeConsistency = typeof options === 'string' ? undefined : options.consistency
  return store
}

export function getStore(options) {
  return pick(options)
}

export function getDeployStore(options) {
  return pick(options)
}

/** harness only: start from nothing between scenarios */
export function __reset() {
  stores.clear()
  hiddenFromList = []
}

/** harness only: what is in the store, for assertions */
export function __dump() {
  const out = {}
  for (const [name, store] of stores) {
    out[name] = [...store.data.keys()].sort()
  }
  return out
}
