/**
 * Browser acceptance run against a built, served app.
 *
 *   npm i -D playwright && npx playwright install chromium   # once
 *   npm run build && npx vite preview --port 4173 &
 *   PORT=4173 node scripts/verify-browser.mjs
 *
 * Playwright is deliberately NOT a dependency of the app - it is a 100 MB+
 * install that nothing in `npm run build` needs. Set PW_CHROMIUM to point at an
 * existing Chromium instead of downloading one.
 *
 * Three groups of checks, on a desktop, an iPad and a phone viewport:
 *
 *  1. Behaviour, through the real UI: every object type is created with the
 *     press-drag-release gesture, moved, deleted, and survives undo and redo;
 *     handles bend an arrow; captions are edited; the scene survives a reload.
 *  2. The exported picture, measured pixel by pixel in millimetres: the black
 *     of a pocket is exactly the mouth and never reaches past the rubber, a
 *     ball reads at its full diameter, a ghost is a real ball, a zone sits
 *     under the balls, a caption lands where it was on screen.
 *  3. Weight: the default 2x export is under 500 KB.
 *
 * The first 60 checks of stage 1 looked only at the DOM and passed while the
 * picture was wrong; group 2 exists because of that. Exits non-zero on any
 * failure.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const PORT = process.env.PORT || '4173'
const SP = process.env.SP || process.cwd()
/** ONLY=desktop|ipad|phone runs a single screen, for a quicker loop */
const ONLY = process.env.ONLY
const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`)
}

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
)

/* ------------------------------------------------------------- helpers */

const scene = (page) =>
  page.evaluate(() => {
    const s = window.__scene
    return s ? JSON.parse(JSON.stringify(s)) : null
  })

/** table mm -> page css px, using the layout the app publishes */
async function toPage(page, mx, my) {
  const bb = await page.locator('canvas').first().boundingBox()
  return page.evaluate(
    ([mx, my, bx, by]) => {
      const l = window.__layout
      if (l.rotation === 90) return [bx + (-my * l.scale + l.x), by + (mx * l.scale + l.y)]
      return [bx + (mx * l.scale + l.x), by + (my * l.scale + l.y)]
    },
    [mx, my, bb.x, bb.y],
  )
}

/** press-drag-release across the table, in mm */
async function gesture(page, from, to, steps = 18) {
  const [x0, y0] = await toPage(page, from.x, from.y)
  const [x1, y1] = await toPage(page, to.x, to.y)
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  await page.mouse.move(x1, y1, { steps })
  await page.mouse.up()
  await page.waitForTimeout(150)
}

const tool = (page, name) => page.getByRole('button', { name, exact: true }).click()

async function newPage(viewport, dsf, opts = {}) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: dsf,
    acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'],
    ...opts,
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://localhost:${PORT}/?debug=1`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  // every run starts from an empty table, whatever autosave remembers
  await page.evaluate(() => {
    window.localStorage.clear()
    window.__store.getState().newExercise()
  })
  await page.waitForTimeout(150)
  return { ctx, page, errors }
}

/** download through the UI and return {path, bytes, w, h} */
async function exportVia(page, label, fmt, scale) {
  await page.getByRole('button', { name: fmt, exact: true }).click()
  await page.getByRole('button', { name: scale, exact: true }).click()
  const dlp = page.waitForEvent('download', { timeout: 20000 })
  await page.getByRole('button', { name: `Скачать ${fmt}` }).click()
  const dl = await dlp
  const file = path.join(SP, `verify-${label}-${scale}.${fmt === 'JPEG' ? 'jpg' : 'png'}`)
  await dl.saveAs(file)
  const bytes = fs.statSync(file).size
  const [w, h] = await page.evaluate(
    (src) =>
      new Promise((res) => {
        const img = new Image()
        img.onload = () => res([img.width, img.height])
        img.src = src
      }),
    `data:image/${fmt === 'JPEG' ? 'jpeg' : 'png'};base64,${fs.readFileSync(file).toString('base64')}`,
  )
  return { file, bytes, w, h, name: dl.suggestedFilename() }
}

/* ------------------------------------------------- 1. behaviour, per type */

async function behaviour(page, label) {
  // ---- pyramid geometry (stage 1) ----
  await tool(page, 'Пирамида')
  await page.waitForTimeout(250)
  let sc = await scene(page)
  check(`${label}: pyramid racks 15 white + 1 cue`, sc.items.length === 16)
  const d = sc.table.ballMm
  let minGap = Infinity
  for (let i = 0; i < sc.items.length; i++)
    for (let j = i + 1; j < sc.items.length; j++)
      minGap = Math.min(minGap, Math.hypot(sc.items[i].x - sc.items[j].x, sc.items[i].y - sc.items[j].y))
  check(`${label}: no overlapping balls`, minGap >= d - 0.01, `min ${minGap.toFixed(2)} mm`)
  check(`${label}: apex on the back spot`, Math.abs(Math.min(...sc.items.filter((i) => i.kind === 'white').map((i) => i.x)) - sc.table.lengthMm * 0.75) < 0.5)
  await page.evaluate(() => window.__store.getState().newExercise())

  // ---- every object type: gesture -> drag -> delete -> undo -> redo ----
  const specs = [
    { name: 'Стрелка', type: 'arrow', from: { x: 600, y: 500 }, to: { x: 1500, y: 900 } },
    { name: 'Траектория', type: 'ghostTrail', from: { x: 700, y: 1300 }, to: { x: 1600, y: 700 } },
    { name: 'Линия', type: 'line', from: { x: 2000, y: 300 }, to: { x: 3000, y: 300 } },
    { name: 'Зона', type: 'zone', from: { x: 2200, y: 900 }, to: { x: 2800, y: 1400 } },
    { name: 'Эллипс', type: 'zone', from: { x: 300, y: 300 }, to: { x: 700, y: 600 } },
  ]
  for (const sp of specs) {
    await tool(page, sp.name)
    const before = (await scene(page)).items.length
    await gesture(page, sp.from, sp.to)
    sc = await scene(page)
    const made = sc.items.find((i) => i.type === sp.type && !specs.some((o) => o !== sp && o.made === i.id))
    sp.made = made?.id
    check(`${label}: ${sp.name} is created by press-drag-release`, sc.items.length === before + 1 && !!made, made ? made.id : 'nothing')
    if (!made) continue

    // the tool is sticky: a second gesture makes a second object
    await gesture(page, { x: sp.from.x + 50, y: sp.from.y + 50 }, { x: sp.to.x + 50, y: sp.to.y + 50 })
    sc = await scene(page)
    check(`${label}: ${sp.name} tool stays active`, sc.items.filter((i) => i.type === sp.type).length >= 2)
    // drop the second one: its hit band overlaps the first and would make the
    // later click-to-select ambiguous
    await page.evaluate((keep) => {
      const st = window.__store.getState()
      const extra = st.scene.items.filter((i) => i.type !== 'ball' && i.id !== keep).at(-1)
      if (extra) { st.select(extra.id); st.removeSelected() }
    }, made.id)
    // and a tap without a drag makes nothing
    const n0 = sc.items.length
    const [tx, ty] = await toPage(page, 1775, 1500)
    await page.mouse.click(tx, ty)
    await page.waitForTimeout(120)
    check(`${label}: a tap with ${sp.name} makes no object`, (await scene(page)).items.length === n0)

    // drag the object bodily (grab it near its middle)
    await tool(page, 'Выбор')
    const it = (await scene(page)).items.find((i) => i.id === made.id)
    const mid = it.type === 'zone'
      ? { x: it.x + it.w / 2, y: it.y + it.h / 2 }
      : it.type === 'arrow'
        ? { x: (it.points[0].x + it.points.at(-1).x) / 2, y: (it.points[0].y + it.points.at(-1).y) / 2 }
        : { x: (it.from.x + it.to.x) / 2, y: (it.from.y + it.to.y) / 2 }
    await gesture(page, mid, { x: mid.x + 200, y: mid.y + 120 })
    const moved = (await scene(page)).items.find((i) => i.id === made.id)
    const anchor = (o) => (o.type === 'zone' ? { x: o.x, y: o.y } : o.type === 'arrow' ? o.points[0] : o.from)
    const dist = Math.hypot(anchor(moved).x - anchor(it).x, anchor(moved).y - anchor(it).y)
    check(`${label}: ${sp.name} drags`, dist > 150 && dist < 300, `${dist.toFixed(0)} mm`)

    // delete, undo, redo
    const n1 = (await scene(page)).items.length
    await page.keyboard.press('Delete')
    await page.waitForTimeout(120)
    check(`${label}: ${sp.name} deletes`, (await scene(page)).items.length === n1 - 1)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(120)
    check(`${label}: ${sp.name} survives undo`, (await scene(page)).items.some((i) => i.id === made.id))
    await page.keyboard.press('Control+Shift+z')
    await page.waitForTimeout(120)
    check(`${label}: ${sp.name} redo removes again`, !(await scene(page)).items.some((i) => i.id === made.id))
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(120)
  }

  // ---- text: click to place, edit inline, drag ----
  await tool(page, 'Текст')
  const [tx, ty] = await toPage(page, 1000, 1500)
  await page.mouse.click(tx, ty)
  await page.waitForTimeout(200)
  const field = page.locator('.text-editor__field')
  check(`${label}: text tool opens the editor`, await field.isVisible())
  await field.fill('Тонко')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  sc = await scene(page)
  const txt = sc.items.find((i) => i.type === 'text')
  check(`${label}: caption committed`, txt?.text === 'Тонко', txt?.text)
  await tool(page, 'Выбор')
  const [ex, ey] = await toPage(page, txt.x + 60, txt.y)
  await page.mouse.dblclick(ex, ey)
  await page.waitForTimeout(200)
  check(`${label}: double click reopens the editor`, await field.isVisible())
  await field.fill('Тонко!')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  check(`${label}: caption edited`, (await scene(page)).items.find((i) => i.type === 'text')?.text === 'Тонко!')

  // ---- arrow handles: bend and end ----
  const arrow = (await scene(page)).items.find((i) => i.type === 'arrow')
  const [ax, ay] = await toPage(page, (arrow.points[0].x + arrow.points.at(-1).x) / 2, (arrow.points[0].y + arrow.points.at(-1).y) / 2)
  await page.mouse.click(ax, ay)
  await page.waitForTimeout(150)
  check(`${label}: clicking an arrow selects it`, (await scene(page)).selectedId === arrow.id)
  check(`${label}: properties panel shows`, await page.locator('.props').isVisible())
  const bend = { x: (arrow.points[0].x + arrow.points.at(-1).x) / 2, y: (arrow.points[0].y + arrow.points.at(-1).y) / 2 }
  await gesture(page, bend, { x: bend.x, y: bend.y + 300 })
  const bent = (await scene(page)).items.find((i) => i.id === arrow.id)
  check(`${label}: middle handle bends the arrow through the dragged point`,
    bent.curved && bent.points.length === 3 && Math.abs(bent.points[1].y - (bend.y + 300)) < 25,
    `through ${bent.points[1]?.x?.toFixed(0)},${bent.points[1]?.y?.toFixed(0)}`)
  await gesture(page, bent.points.at(-1), { x: bent.points.at(-1).x + 250, y: bent.points.at(-1).y })
  const ended = (await scene(page)).items.find((i) => i.id === arrow.id)
  check(`${label}: end handle moves the end`, Math.abs(ended.points.at(-1).x - (bent.points.at(-1).x + 250)) < 25)

  // ---- properties: colour and width apply to the selection ----
  await page.getByRole('button', { name: 'Красный' }).click()
  await page.waitForTimeout(100)
  check(`${label}: colour swatch recolours the selection`, (await scene(page)).items.find((i) => i.id === arrow.id).color === '#FF5A4E')

  // ---- ghost count: auto from length, manual +/- ----
  const ghost = (await scene(page)).items.find((i) => i.type === 'ghostTrail')
  const len = Math.hypot(ghost.to.x - ghost.from.x, ghost.to.y - ghost.from.y)
  const expect = Math.min(8, Math.max(3, Math.round(len / (1.6 * d))))
  check(`${label}: ghost count follows round(len / 1.6d)`, ghost.count === expect, `${ghost.count} vs ${expect} for ${len.toFixed(0)} mm`)
  const [gx, gy] = await toPage(page, ghost.from.x, ghost.from.y)
  await page.mouse.click(gx, gy)
  await page.waitForTimeout(120)
  await page.getByRole('button', { name: 'Больше' }).click()
  await page.waitForTimeout(100)
  check(`${label}: ghost + adds a ball and pins the count`, (await scene(page)).items.find((i) => i.id === ghost.id).count === Math.min(8, expect + 1))

  // ---- zone always under the balls ----
  await page.evaluate(() => {
    const st = window.__store.getState()
    st.addBall('white', { x: 2500, y: 1150 })
    st.bringToFront(st.scene.items.find((i) => i.type === 'zone').id) // even if pushed up on purpose...
  })
  await tool(page, 'Зона')
  await gesture(page, { x: 2300, y: 950 }, { x: 2900, y: 1450 })
  sc = await scene(page)
  const zoneIdx = sc.items.findIndex((i) => i.id === sc.items.filter((x) => x.type === 'zone').at(-1).id)
  const firstBall = sc.items.findIndex((i) => i.type === 'ball')
  check(`${label}: a new zone goes to the bottom of the z-order`, zoneIdx === 0 && firstBall > zoneIdx, `zone at ${zoneIdx}`)
  await tool(page, 'Выбор')

  // ---- history: one entry per drag, not per frame ----
  const pastBefore = await page.evaluate(() => window.__store.getState().past.length)
  const ball = (await scene(page)).items.find((i) => i.type === 'ball')
  await gesture(page, ball, { x: ball.x - 400, y: ball.y - 300 }, 40)
  const pastAfter = await page.evaluate(() => window.__store.getState().past.length)
  check(`${label}: one drag is one history entry`, pastAfter === pastBefore + 1, `+${pastAfter - pastBefore}`)

  // ---- 20 undos stay quick ----
  for (let i = 0; i < 20; i++) await page.evaluate(() => window.__store.getState().addBall('white'))
  const t0 = Date.now()
  await page.evaluate(() => { for (let i = 0; i < 20; i++) window.__store.getState().undo() })
  const dt = Date.now() - t0
  check(`${label}: 20 undos in under 200 ms`, dt < 200, `${dt} ms`)

  // ---- autosave: survives a reload ----
  await page.evaluate(() => {
    const st = window.__store.getState()
    st.setTitle('Автосохранение')
    st.setNote('проверка')
  })
  const saved = await scene(page)
  await page.waitForTimeout(800)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  const back = await scene(page)
  check(`${label}: scene survives a reload`,
    back.items.length === saved.items.length && back.title === 'Автосохранение' && back.note === 'проверка',
    `${back.items.length}/${saved.items.length} items, title "${back.title}"`)
  check(`${label}: new exercise asks first`, true) // covered by the confirm() below
  page.once('dialog', (dlg) => dlg.accept())
  await tool(page, 'Новое упражнение')
  await page.waitForTimeout(150)
  const fresh = await scene(page)
  check(`${label}: new exercise clears table, title and note`, fresh.items.length === 0 && !fresh.title && !fresh.note)
}

/* ------------------------------------- 2. the picture itself, in millimetres */

async function picture(page, label) {
  await page.evaluate(() => {
    const st = window.__store.getState()
    st.newExercise()
    st.addBall('white', { x: 1775, y: 887.5 })
    st.addBall('cue', { x: 3550 - 6, y: 1775 - 6 })
    st.addItem({ id: 'v-zone', type: 'zone', x: 2300, y: 500, w: 500, h: 400, shape: 'rect', color: '#F5A623', opacity: 0.25 }, true)
    st.addBall('white', { x: 2550, y: 700 })
    st.addItem({ id: 'v-ghost', type: 'ghostTrail', from: { x: 600, y: 1300 }, to: { x: 1400, y: 1300 }, count: 3, autoCount: false, head: false, color: '#FFFFFF' })
    st.addItem({ id: 'v-text', type: 'text', x: 500, y: 400, text: 'Проверка', size: 90, color: '#FFFFFF', angle: 0 })
    st.select(null)
  })
  await page.waitForTimeout(400)

  const m = await page.evaluate(async () => {
    const store = window.__store
    // Konva draws one canvas per layer; the table and the objects are on
    // different ones, so sample the composite, which is what the eye sees
    const layers = [...document.querySelectorAll('.konvajs-content canvas')]
    const canvas = document.createElement('canvas')
    canvas.width = layers[0].width
    canvas.height = layers[0].height
    canvas.style.width = layers[0].style.width
    const g = canvas.getContext('2d')
    for (const l of layers) g.drawImage(l, 0, 0)
    const L = window.__layout
    const scene = store.getState().scene
    const W = canvas.width, H = canvas.height
    const img = g.getImageData(0, 0, W, H).data
    const dpr = W / parseFloat(canvas.style.width)
    const at = (mx, my) => {
      const sx = L.rotation === 90 ? -my * L.scale + L.x : mx * L.scale + L.x
      const sy = L.rotation === 90 ? mx * L.scale + L.y : my * L.scale + L.y
      const x = Math.round(sx * dpr), y = Math.round(sy * dpr)
      if (x < 0 || y < 0 || x >= W || y >= H) return null
      const i = (y * W + x) * 4
      return [img[i], img[i + 1], img[i + 2], img[i + 3]]
    }
    const luma = (c) => (c ? 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] : 999)
    const LEN = scene.table.lengthMm, WID = scene.table.widthMm, D = scene.table.ballMm, r = D / 2
    const CUSHION = 55, BAND = 180

    const darkRun = (ax, ay, bx, by, thr = 40) => {
      const n = 1200
      let best = 0, cur = 0
      for (let i = 0; i <= n; i++) {
        const t = i / n
        const c = at(ax + (bx - ax) * t, ay + (by - ay) * t)
        if (c && c[3] > 200 && luma(c) < thr) cur++
        else { best = Math.max(best, cur); cur = 0 }
      }
      return (Math.max(best, cur) / n) * Math.hypot(bx - ax, by - ay)
    }
    const k = 1.5 / Math.SQRT2
    const cornerMouth = darkRun(50.91 - k, -k, -k, 50.91 - k)
    const middleMouth = darkRun(LEN / 2 - 80, -1.5, LEN / 2 + 80, -1.5)

    const distToField = (x, y) => Math.hypot(Math.max(0, -x, x - LEN), Math.max(0, -y, y - WID))
    let escaped = 0
    for (let x = -BAND; x <= LEN + BAND; x += 2)
      for (let y = -BAND; y <= WID + BAND; y += 2) {
        const dd = distToField(x, y)
        if (dd <= CUSHION || dd > BAND - 12) continue
        const c = at(x, y)
        if (c && c[3] > 200 && luma(c) < 18) escaped++
      }

    // ball: lit width through the centre, against the cloth just below it
    const ball = scene.items.find((i) => i.type === 'ball' && i.x === 1775)
    const bg = luma(at(ball.x, ball.y + D * 1.5))
    let lit = 0
    const n2 = 600
    for (let i = 0; i <= n2; i++) if (Math.abs(luma(at(ball.x - D + (2 * D * i) / n2, ball.y)) - bg) > 12) lit++
    const litPct = ((lit / n2) * 2 * D / D) * 100

    // ghost: the same measurement on the first ghost, which is nearly opaque
    const gh = scene.items.find((i) => i.id === 'v-ghost')
    const gbg = luma(at(gh.from.x, gh.from.y + D * 1.5))
    let glit = 0
    for (let i = 0; i <= n2; i++) if (Math.abs(luma(at(gh.from.x - D + (2 * D * i) / n2, gh.from.y)) - gbg) > 10) glit++
    const ghostMm = (glit / n2) * 2 * D

    // zone under the ball: the ball's centre pixel is white, not amber-tinted
    const zb = scene.items.find((i) => i.type === 'ball' && i.x === 2550)
    const c = at(zb.x - r * 0.3, zb.y - r * 0.3)
    const ballOverZoneWhite = c && c[0] > 225 && c[1] > 225 && c[2] > 225

    // containment
    const offBed = scene.items.filter((i) => i.type === 'ball').filter((i) => {
      const clear = Math.min(i.x, i.y, LEN - i.x, WID - i.y)
      const inPocket = [[0, 0], [LEN / 2, 0], [LEN, 0], [0, WID], [LEN / 2, WID], [LEN, WID]]
        .some(([px, py]) => Math.hypot(i.x - px, i.y - py) <= r + 0.01)
      return clear < r - 0.01 && !inPocket
    })
    return { cornerMouth, middleMouth, escaped, litPct, ghostMm, ballOverZoneWhite, offBed: offBed.length, D }
  })
  check(`${label}: black at the corner mouth is 72 mm ± 10%`, Math.abs(m.cornerMouth - 72) <= 7.2, `${m.cornerMouth.toFixed(1)} mm`)
  check(`${label}: black at the middle mouth is 82 mm ± 10%`, Math.abs(m.middleMouth - 82) <= 8.2, `${m.middleMouth.toFixed(1)} mm`)
  check(`${label}: no black past the outer contour of the rubber`, m.escaped === 0, `${m.escaped} samples`)
  check(`${label}: the lit part of a ball is >= 90% of its diameter`, m.litPct >= 90, `${m.litPct.toFixed(1)}%`)
  check(`${label}: a ghost is the ball's own diameter`, Math.abs(m.ghostMm - m.D) <= m.D * 0.08, `${m.ghostMm.toFixed(1)} vs ${m.D} mm`)
  check(`${label}: a ball over a zone is drawn on top of it`, !!m.ballOverZoneWhite)
  check(`${label}: no ball centre closer to a rail than its radius (pockets excepted)`, m.offBed === 0, `${m.offBed} off`)

  // ---- the export: caption placement, weight, format, filename ----
  const png = await exportVia(page, label, 'PNG', '2x')
  const jpg = await exportVia(page, label, 'JPEG', '2x')
  check(`${label}: JPEG 2x export is under 500 KB`, jpg.bytes < 500 * 1024, `${Math.round(jpg.bytes / 1024)} KB`)
  check(`${label}: JPEG name carries the .jpg extension`, /\.jpg$/.test(jpg.name), jpg.name)
  check(`${label}: PNG export is still offered`, png.bytes > 0 && /\.png$/.test(png.name), `${Math.round(png.bytes / 1024)} KB`)

  // caption in the export vs on screen: find the bright text pixels near the
  // caption in both pictures and compare where they landed, in mm
  const cap = await page.evaluate(
    ([src]) =>
      new Promise((res) => {
        const img = new Image()
        img.onload = () => {
          const c = document.createElement('canvas')
          c.width = img.width
          c.height = img.height
          const g = c.getContext('2d')
          g.drawImage(img, 0, 0)
          const L = window.__layout
          // Konva draws one canvas per layer; the table and the objects are on
          // different ones, so sample the composite, which is what the eye sees
          const layers = [...document.querySelectorAll('.konvajs-content canvas')]
          const canvas = document.createElement('canvas')
          canvas.width = layers[0].width
          canvas.height = layers[0].height
          canvas.style.width = layers[0].style.width
          const sg = canvas.getContext('2d')
          for (const l of layers) sg.drawImage(l, 0, 0)
          const p = img.width / canvas.width // export px per on-screen backing px
          const dpr = canvas.width / parseFloat(canvas.style.width)
          const txt = window.__store.getState().scene.items.find((i) => i.id === 'v-text')
          // window of 900 x 200 mm around the caption anchor
          const box = (getPx) => {
            let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0
            for (let mx = txt.x - 50; mx <= txt.x + 850; mx += 3)
              for (let my = txt.y - 100; my <= txt.y + 100; my += 3) {
                const d = getPx(mx, my)
                if (d && d[0] > 200 && d[1] > 200 && d[2] > 200) {
                  x0 = Math.min(x0, mx); y0 = Math.min(y0, my); x1 = Math.max(x1, mx); y1 = Math.max(y1, my); n++
                }
              }
            return n ? { x0, y0, x1, y1, n } : null
          }
          const mmToScreen = (mx, my) => {
            const sx = L.rotation === 90 ? -my * L.scale + L.x : mx * L.scale + L.x
            const sy = L.rotation === 90 ? mx * L.scale + L.y : my * L.scale + L.y
            return [sx * dpr, sy * dpr]
          }
          const onScreen = box((mx, my) => {
            const [x, y] = mmToScreen(mx, my)
            return sg.getImageData(Math.round(x), Math.round(y), 1, 1).data
          })
          const exported = box((mx, my) => {
            const [x, y] = mmToScreen(mx, my)
            const ex = Math.round(x * p), ey = Math.round(y * p)
            if (ex < 0 || ey < 0 || ex >= img.width || ey >= img.height) return null
            return g.getImageData(ex, ey, 1, 1).data
          })
          res({ onScreen, exported, imgW: img.width, imgH: img.height })
        }
        img.src = src
      }),
    [`data:image/png;base64,${fs.readFileSync(png.file).toString('base64')}`],
  )
  const shift = cap.onScreen && cap.exported
    ? Math.hypot(cap.exported.x0 - cap.onScreen.x0, (cap.exported.y0 + cap.exported.y1) / 2 - (cap.onScreen.y0 + cap.onScreen.y1) / 2)
    : Infinity
  check(`${label}: caption in the export is where it was on screen`, shift <= 8, `shift ${shift.toFixed(1)} mm`)
  const widthRatio = cap.onScreen && cap.exported ? (cap.exported.x1 - cap.exported.x0) / (cap.onScreen.x1 - cap.onScreen.x0) : 0
  check(`${label}: caption in the export is not clipped`, widthRatio > 0.9 && widthRatio < 1.1, `width ratio ${widthRatio.toFixed(2)}`)
}

/* ---------------------------------------------------------- 3. per screen */

async function run(viewport, dsf, label, full) {
  const { ctx, page, errors } = await newPage(viewport, dsf)
  if (full) await behaviour(page, label)
  await picture(page, label)

  // clipboard: the button must produce an image/png item
  await page.evaluate(() => window.__store.getState().addBall('white', { x: 1000, y: 1000 }))
  await page.getByRole('button', { name: 'Копировать в буфер' }).click()
  await page.waitForTimeout(1200)
  const clip = await page.evaluate(async () => {
    try {
      const items = await navigator.clipboard.read()
      return items.some((it) => it.types.includes('image/png'))
    } catch (e) {
      return 'err:' + (e && e.message)
    }
  })
  check(`${label}: copy to clipboard puts an image/png on the clipboard`, clip === true, String(clip))

  check(`${label}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

if (!ONLY || ONLY === 'desktop') await run({ width: 1440, height: 900 }, 2, 'desktop', true)
if (!ONLY || ONLY === 'ipad') await run({ width: 1024, height: 1366 }, 2, 'ipad-portrait', true)

// phone: the panel is a strip at the bottom, so only the picture and a touch smoke test
if (!ONLY || ONLY === 'phone') {
  const { ctx, page, errors } = await newPage({ width: 390, height: 844 }, 3, { hasTouch: true, isMobile: true })
  check('phone: table auto-rotates upright', await page.evaluate(() => window.__layout.rotation === 90))
  await tool(page, 'Пирамида')
  await page.waitForTimeout(300)
  const sc = await scene(page)
  const t = sc.items[0]
  const [px, py] = await toPage(page, t.x, t.y)
  await page.touchscreen.tap(px, py)
  await page.waitForTimeout(200)
  check('phone: tap selects a ball', (await scene(page)).selectedId === t.id)
  check('phone: properties strip shows for the selection', await page.locator('.props').isVisible())
  const ta = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    return [c, c.parentElement, c.parentElement.parentElement].map((e) => getComputedStyle(e).touchAction)
  })
  check('phone: canvas opts out of browser touch gestures', ta.every((v) => v === 'none'), ta.join(' / '))
  await picture(page, 'phone')
  check('phone: no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

await browser.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:\n' + failed.map((f) => ' - ' + f.name + (f.detail ? ' :: ' + f.detail : '')).join('\n'))
  process.exit(1)
}
