/**
 * The Netlify function runtime, small enough to run anywhere.
 *
 * It loads the real modules from netlify/functions, reads the `config.path`
 * each one exports, and routes to them exactly as Netlify does - so what the
 * acceptance run exercises is the shipped code, not a copy of it. Blobs come
 * from scripts/blobs-fake.mjs through a module hook, so no network and no
 * account are needed.
 *
 *   node --import ./scripts/blobs-register.mjs scripts/api-server.mjs
 *
 * Two extra endpoints exist only here and never ship: /__test/reset empties
 * the store between scenarios, and /__test/daily runs the scheduled job on
 * demand instead of waiting for 03:17.
 */

import { createServer } from 'node:http'
import { readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FN_DIR = resolvePath(HERE, '..', 'netlify', 'functions')
const PORT = Number(process.env.API_PORT ?? 4181)

const routes = []
let daily = null

for (const file of readdirSync(FN_DIR).filter((f) => f.endsWith('.mts'))) {
  const mod = await import(pathToFileURL(join(FN_DIR, file)).href)
  const config = mod.config ?? {}
  if (config.schedule) {
    daily = mod.default
    continue
  }
  for (const path of [config.path].flat().filter(Boolean)) {
    routes.push({ pattern: path.split('/').filter(Boolean), handler: mod.default, file })
  }
}

// a longer pattern is more specific: /api/exercises/:id must win over /api/exercises
routes.sort((a, b) => b.pattern.length - a.pattern.length)

function match(pathname) {
  const parts = pathname.split('/').filter(Boolean)
  for (const route of routes) {
    if (route.pattern.length !== parts.length) continue
    const params = {}
    let ok = true
    for (let i = 0; i < parts.length; i++) {
      const p = route.pattern[i]
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(parts[i])
      else if (p !== parts[i]) {
        ok = false
        break
      }
    }
    if (ok) return { route, params }
  }
  return null
}

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks)
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`)

    if (url.pathname.startsWith('/__test/')) {
      const blobs = await import('./blobs-fake.mjs')
      if (url.pathname === '/__test/reset') blobs.__reset()
      else if (url.pathname === '/__test/daily') await daily?.()
      else if (url.pathname === '/__test/dump') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(blobs.__dump()))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
      return
    }

    const hit = match(url.pathname)
    if (!hit) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"error":"no-route"}')
      return
    }

    const body = await readBody(req)
    const request = new Request(url, {
      method: req.method,
      headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string'),
      body: body && body.length ? body : undefined,
    })

    try {
      const out = await hit.route.handler(request, { params: hit.params })
      const buf = Buffer.from(await out.arrayBuffer())
      const headers = {}
      out.headers.forEach((v, k) => {
        headers[k] = v
      })
      // the browser talks to this server through the vite preview proxy on a
      // different port, so the answer has to allow it
      headers['access-control-allow-origin'] = '*'
      res.writeHead(out.status, headers)
      res.end(buf)
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'crash', message: String(e?.stack ?? e) }))
    }
  })()
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`api on http://127.0.0.1:${PORT} (${routes.length} routes)`)
})
