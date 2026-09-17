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

/** every write ever made, so no two ETags can collide */
let writes = 0

/**
 * Key fragments hidden from list() — the harness's way of reproducing the one
 * thing this fake cannot have: a listing that lags behind the writes.
 * On Netlify a marker can take up to a minute to show up in list() even
 * though reading the blob itself is strongly consistent.
 */
let hiddenFromList = []

/**
 * Whether list() is blind: answers "nothing here" for every prefix, always,
 * with no error - which is what the live site did.
 *
 * Writes returned 200, keyed reads returned the bodies they had just written,
 * the probe key that /api/health writes and reads back worked, and every
 * listing of every prefix reported an empty store holding nine exercises. The
 * cause was never established from outside, and that is the lesson: a listing
 * can answer "empty" for a full store without an error, and no caller can tell
 * that apart from an empty library. So the harness can turn it on, and the
 * acceptance run insists the product still works with it on.
 */
let blindList = false

/**
 * Whether conditional writes are refused outright.
 *
 * The catalogue is kept safe under two writers by a compare-and-swap against
 * the ETag, and whether the live platform honours `if-match` is something
 * /api/health now measures rather than assumes. This switch is the other half
 * of that: if it does NOT honour it, the coach must still be able to save.
 */
let refuseConditional = false

/** harness only: make every conditional write fail the condition */
export function __refuseConditional(on = true) {
  refuseConditional = on
}

/** harness only: make keys containing this fragment invisible to list() */
export function __hideFromList(fragment) {
  hiddenFromList.push(fragment)
}

/** harness only: reproduce the live site's listing, which saw nothing */
export function __blindList(on = true) {
  blindList = on
}

export function __showAll() {
  hiddenFromList = []
  blindList = false
  refuseConditional = false
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
    if (blindList) return { blobs: [], directories: [] }
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

  /**
   * Write, honouring the two conditional forms the catalogue depends on.
   *
   * `onlyIfMatch` is a compare-and-swap against the ETag; `onlyIfNew` is a
   * create-if-absent. Both answer { modified: false } when refused rather than
   * throwing, exactly as the real client reports them. The catalogue is one
   * blob that two devices write, so a fake that applied every write regardless
   * would let a lost update pass the acceptance run.
   */
  async set(key, body, { metadata, onlyIfMatch, onlyIfNew } = {}) {
    const row = this.data.get(key)
    const conditional = onlyIfMatch !== undefined || onlyIfNew === true
    if (conditional && refuseConditional) return { modified: false }
    if (onlyIfMatch !== undefined && (!row || row.etag !== onlyIfMatch)) return { modified: false }
    if (onlyIfNew && row) return { modified: false }
    const buf =
      body instanceof ArrayBuffer
        ? Buffer.from(body)
        : ArrayBuffer.isView(body)
          ? Buffer.from(body.buffer, body.byteOffset, body.byteLength)
          : Buffer.from(String(body), 'utf8')
    // a counter and not the clock: two writes inside one millisecond must not
    // share an ETag, or a compare-and-swap would accept a stale base
    const etag = `"e${++writes}"`
    this.data.set(key, { body: buf, metadata: metadata ?? {}, etag })
    return { etag, modified: true }
  }

  async setJSON(key, value, opts = {}) {
    return this.set(key, JSON.stringify(value), opts)
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
  blindList = false
  refuseConditional = false
}

/**
 * harness only: remove one key from every store.
 *
 * It exists to reproduce the state the live site was left in - every exercise
 * present under its own key, and nothing that enumerates them - so the run can
 * prove the catalogue rebuilds itself from what the devices offer.
 */
export function __drop(key) {
  for (const store of stores.values()) store.data.delete(key)
}

/** harness only: what is in the store, for assertions */
export function __dump() {
  const out = {}
  for (const [name, store] of stores) {
    out[name] = [...store.data.keys()].sort()
  }
  return out
}
