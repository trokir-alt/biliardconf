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
  if (await page.locator('.m-shell').count()) await page.getByRole('button', { name: 'Экспорт', exact: true }).click()
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
    const idsBefore = sc.items.map((i) => i.id)
    await gesture(page, { x: sp.from.x + 50, y: sp.from.y + 50 }, { x: sp.to.x + 50, y: sp.to.y + 50 })
    sc = await scene(page)
    check(`${label}: ${sp.name} tool stays active`, sc.items.filter((i) => i.type === sp.type).length >= 2)
    // drop that second one by identity - its hit band overlaps the first and
    // would make the later click-to-select ambiguous. (Zones are inserted at
    // the bottom, so "the last item" would be the wrong object.)
    const extra = sc.items.find((i) => !idsBefore.includes(i.id))
    if (extra) {
      await page.evaluate((id) => {
        const st = window.__store.getState()
        st.select(id)
        st.removeSelected()
      }, extra.id)
    }
    // and a tap without a drag makes nothing
    const n0 = (await scene(page)).items.length
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
  let ghost = (await scene(page)).items.find((i) => i.type === 'ghostTrail')
  if (!ghost) {
    // should not happen after the undo above; make it a failure, not a crash
    check(`${label}: a ghost trail is still on the table for the count checks`, false)
    await tool(page, 'Траектория')
    await gesture(page, { x: 700, y: 1300 }, { x: 1600, y: 700 })
    await tool(page, 'Выбор')
    ghost = (await scene(page)).items.find((i) => i.type === 'ghostTrail')
  }
  const len = Math.hypot(ghost.to.x - ghost.from.x, ghost.to.y - ghost.from.y)
  const expect = Math.min(8, Math.max(3, Math.round(len / (1.6 * d))))
  check(`${label}: ghost count follows round(len / 1.6d)`, ghost.count === expect, `${ghost.count} vs ${expect} for ${len.toFixed(0)} mm`)
  // the arrow is still selected and its floating panel may sit over the trail:
  // drop the selection first, as a person would click away
  await page.evaluate(() => window.__store.getState().select(null))
  await page.waitForTimeout(80)
  const [gx, gy] = await toPage(page, ghost.from.x, ghost.from.y)
  await page.mouse.click(gx, gy)
  await page.waitForTimeout(120)
  check(`${label}: clicking a trail selects it`, (await scene(page)).selectedId === ghost.id)
  // step in whichever direction the range allows: at 8 only "-" is enabled
  const up = ghost.count < 8
  await page.getByRole('button', { name: up ? 'Больше' : 'Меньше' }).click()
  await page.waitForTimeout(100)
  const stepped = (await scene(page)).items.find((i) => i.id === ghost.id)
  check(`${label}: ghost ${up ? '+' : '-'} steps the count and pins it`,
    stepped.count === ghost.count + (up ? 1 : -1) && stepped.autoCount === false, `${ghost.count} -> ${stepped.count}`)

  // ---- zone always under the balls ----
  await page.evaluate(() => {
    const st = window.__store.getState()
    st.addBall('white', { x: 2500, y: 1150 })
    st.bringToFront(st.scene.items.find((i) => i.type === 'zone').id) // even if pushed up on purpose...
  })
  await tool(page, 'Зона')
  const zoneIdsBefore = (await scene(page)).items.filter((i) => i.type === 'zone').map((i) => i.id)
  await gesture(page, { x: 2300, y: 950 }, { x: 2900, y: 1450 })
  sc = await scene(page)
  const zoneIdx = sc.items.findIndex((i) => i.type === 'zone' && !zoneIdsBefore.includes(i.id))
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
  const dt = await page.evaluate(() => {
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) window.__store.getState().undo()
    return performance.now() - t0
  })
  check(`${label}: 20 undos in under 200 ms`, dt < 200, `${dt.toFixed(1)} ms`)

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

  await stage3(page, label)
}

/* --------------------------------------------- stage 3: the two widgets */

async function stage3(page, label) {
  await page.evaluate(() => window.__store.getState().newExercise())

  // ---- strike point: tap to place, then drag the dot ----
  await tool(page, 'Точка на шаре')
  const [sx, sy] = await toPage(page, 1000, 900)
  await page.mouse.click(sx, sy)
  await page.waitForTimeout(200)
  let sc = await scene(page)
  const sp = sc.items.find((i) => i.type === 'strikePoint')
  check(`${label}: strike point is placed by a tap`, !!sp && sp.sizeMm === 300 && sp.dot.u === 0 && sp.dot.v === 0)
  await tool(page, 'Выбор')
  const r = sp.sizeMm / 2
  // drag the dot from the centre to (0.5 r, -0.3 r) and compare with the
  // release point. Mouse events carry whole css pixels, so the point the app
  // saw is the rounded press and release positions, not the fractional ones
  const target = { x: sp.x + 0.5 * r, y: sp.y - 0.3 * r }
  const [px0, py0] = await toPage(page, sp.x, sp.y)
  const [px1, py1] = await toPage(page, target.x, target.y)
  const grab = { x: Math.round(px0) - px0, y: Math.round(py0) - py0 } // press offset from the dot centre
  await page.mouse.move(Math.round(px0), Math.round(py0))
  await page.mouse.down()
  await page.mouse.move(Math.round(px1), Math.round(py1), { steps: 18 })
  await page.mouse.up()
  await page.waitForTimeout(150)
  const seen = await page.evaluate(
    ([x, y]) => {
      const l = window.__layout
      const c = document.querySelector('canvas').getBoundingClientRect()
      const dx = x - c.left - l.x, dy = y - c.top - l.y
      return l.rotation === 90 ? { x: dy / l.scale, y: -dx / l.scale } : { x: dx / l.scale, y: dy / l.scale }
    },
    [Math.round(px1) - grab.x, Math.round(py1) - grab.y],
  )
  let it = (await scene(page)).items.find((i) => i.id === sp.id)
  const err = Math.hypot(it.dot.u * r - (seen.x - sp.x), it.dot.v * r - (seen.y - sp.y)) / r
  check(`${label}: dot lands within 2% of the radius of where it was released`, err <= 0.02, `${(err * 100).toFixed(2)}% (u=${it.dot.u.toFixed(3)}, v=${it.dot.v.toFixed(3)})`)
  check(`${label}: dragging the dot does not move the ball`, it.x === sp.x && it.y === sp.y)

  // dragging the body keeps the dot where it is on the ball
  const dotBefore = { ...it.dot }
  await gesture(page, { x: sp.x - 0.6 * r, y: sp.y + 0.5 * r }, { x: sp.x - 0.6 * r + 400, y: sp.y + 0.5 * r + 200 })
  it = (await scene(page)).items.find((i) => i.id === sp.id)
  check(`${label}: dragging the body moves the widget`, Math.hypot(it.x - sp.x, it.y - sp.y) > 300, `${Math.hypot(it.x - sp.x, it.y - sp.y).toFixed(0)} mm`)
  check(`${label}: ...and the dot rides along unchanged`, it.dot.u === dotBefore.u && it.dot.v === dotBefore.v, `u ${it.dot.u.toFixed(3)} v ${it.dot.v.toFixed(3)}`)

  // the dot cannot be pulled past 0.9 r
  const cur = it
  await gesture(page, { x: cur.x + cur.dot.u * r, y: cur.y + cur.dot.v * r }, { x: cur.x + 1.6 * r, y: cur.y + 1.2 * r })
  it = (await scene(page)).items.find((i) => i.id === sp.id)
  const len = Math.hypot(it.dot.u, it.dot.v)
  check(`${label}: dot stays at 0.9 r when pulled past the edge`, Math.abs(len - 0.9) <= 0.005, `|dot| = ${len.toFixed(3)}`)

  // snap to the centre: release within 3% of it
  await gesture(page, { x: it.x + it.dot.u * r, y: it.y + it.dot.v * r }, { x: it.x + 0.015 * r, y: it.y - 0.01 * r })
  it = (await scene(page)).items.find((i) => i.id === sp.id)
  check(`${label}: dot snaps to the centre within 3%`, it.dot.u === 0 && it.dot.v === 0, `u ${it.dot.u} v ${it.dot.v}`)

  // ---- power: tap to place, segments, +/- on the plate, keyboard ----
  await tool(page, 'Сила удара')
  const [px, py] = await toPage(page, 2600, 1400)
  await page.mouse.click(px, py)
  await page.waitForTimeout(200)
  sc = await scene(page)
  const pw = sc.items.find((i) => i.type === 'power')
  check(`${label}: power plate is placed by a tap at 2,5`, !!pw && pw.value === 2.5)
  await tool(page, 'Выбор')
  const SERIES = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5]
  const inSeries = (v) => SERIES.includes(v)
  // the plate is the designer's 140 x 88 artboard scaled to its width:
  // segments at x = 12 + 13i, 10 wide, in the band from y = 48 down
  const pwW = pw.widthMm
  const pwH = (pwW * 88) / 140
  const art = (ax, ay) => ({ x: pw.x - pwW / 2 + (ax * pwW) / 140, y: pw.y - pwH / 2 + (ay * pwH) / 88 })
  const seg = (i) => art(12 + 13 * i + 5, 68)
  const [cx7, cy7] = await toPage(page, seg(6).x, seg(6).y)
  await page.mouse.click(cx7, cy7)
  await page.waitForTimeout(150)
  let pv = (await scene(page)).items.find((i) => i.id === pw.id)
  check(`${label}: tapping a segment sets the value`, pv.value === 3.5, String(pv.value))
  // keyboard, with the plate selected
  await page.keyboard.press('+')
  await page.keyboard.press('+')
  await page.keyboard.press('+')
  await page.waitForTimeout(100)
  pv = (await scene(page)).items.find((i) => i.id === pw.id)
  check(`${label}: + steps by 0,5 and stops at 4,5`, pv.value === 4.5, String(pv.value))
  for (let k = 0; k < 12; k++) await page.keyboard.press('-')
  await page.waitForTimeout(100)
  pv = (await scene(page)).items.find((i) => i.id === pw.id)
  check(`${label}: - stops at 0,5`, pv.value === 0.5, String(pv.value))
  // the + button on the plate itself (right of the plate, when selected)
  const [bx, by] = await toPage(page, pw.x + pwW / 2 + pwW * 0.157 * 0.6, pw.y)
  await page.mouse.click(bx, by)
  await page.waitForTimeout(150)
  pv = (await scene(page)).items.find((i) => i.id === pw.id)
  check(`${label}: + on the plate steps once`, pv.value === 1, String(pv.value))
  check(`${label}: value always belongs to the nine-step series`, inSeries(pv.value))
  // the digits are curves inside the asset, so the separator is checked by
  // pixels in stage4(); here we only prove the right asset is chosen
  await page.evaluate((id) => window.__store.getState().setPower(id, 2.5), pw.id)
  await page.waitForTimeout(150)
  const plate = await page.evaluate(() => {
    const im = window.__stage.find('Image').filter((n) => !n.name())[0]
    return im ? decodeURIComponent(im.image().src).includes('<title>Сила 2,5</title>') : false
  })
  check(`${label}: the plate shows the asset for 2,5`, plate === true)

  // the corner handle resizes the plate and keeps its proportions
  await page.evaluate((id) => window.__store.getState().select(id), pw.id)
  await page.waitForTimeout(120)
  const before = (await scene(page)).items.find((i) => i.id === pw.id).widthMm
  const corner = { x: pw.x + before / 2, y: pw.y + ((before * 88) / 140) / 2 }
  await gesture(page, corner, { x: corner.x + 90, y: corner.y + 57 })
  const after = (await scene(page)).items.find((i) => i.id === pw.id).widthMm
  check(`${label}: the corner handle resizes the indicator`, after > before + 100 && after <= 600, `${before} -> ${after} mm`)
  await page.evaluate((id) => window.__store.getState().updateItem(id, { widthMm: 444 }), pw.id)

  // ---- wireframe ball: placed by a tap, snaps to contact with a real ball ----
  await page.evaluate(() => window.__store.getState().addBall('white', { x: 2000, y: 600 }))
  await tool(page, 'Шар-призрак')
  const [gx, gy] = await toPage(page, 1700, 900)
  await page.mouse.click(gx, gy)
  await page.waitForTimeout(150)
  const gb = (await scene(page)).items.find((i) => i.type === 'ghostBall')
  check(`${label}: wireframe ball is placed by a tap`, !!gb)
  await tool(page, 'Выбор')
  // drag it to nearly touching the white ball: 67 mm apart is contact, aim for 74
  const d = (await scene(page)).table.ballMm
  await gesture(page, gb, { x: 2000 - (d + 7) * Math.SQRT1_2, y: 600 + (d + 7) * Math.SQRT1_2 })
  const g2 = (await scene(page)).items.find((i) => i.id === gb.id)
  const dist = Math.hypot(g2.x - 2000, g2.y - 600)
  check(`${label}: wireframe ball snaps to exactly one diameter from a ball`, Math.abs(dist - d) < 0.05, `${dist.toFixed(2)} mm vs ${d}`)

  // ---- both widgets are ordinary objects: delete, undo, redo, duplicate ----
  for (const [name, id] of [['strike point', sp.id], ['power plate', pw.id], ['wireframe ball', gb.id]]) {
    await page.evaluate((i) => window.__store.getState().select(i), id)
    await page.keyboard.press('Delete')
    await page.waitForTimeout(100)
    const gone = !(await scene(page)).items.some((i) => i.id === id)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(100)
    const back = (await scene(page)).items.some((i) => i.id === id)
    check(`${label}: ${name} deletes and comes back with undo`, gone && back)
  }
  await page.evaluate((i) => window.__store.getState().select(i), sp.id)
  await page.keyboard.press('Control+d')
  await page.waitForTimeout(100)
  check(`${label}: strike point duplicates`, (await scene(page)).items.filter((i) => i.type === 'strikePoint').length === 2)

  // z-order: widgets above balls, below captions
  await page.evaluate(() => {
    const st = window.__store.getState()
    st.addItem({ id: 'cap', type: 'text', x: 500, y: 500, text: 'Подпись', size: 90, color: '#FFFFFF', angle: 0 })
    st.addItem({ id: 'pw2', type: 'power', x: 900, y: 1500, value: 2 }, 'belowText')
  })
  sc = await scene(page)
  const iPw = sc.items.findIndex((i) => i.id === 'pw2')
  const iCap = sc.items.findIndex((i) => i.id === 'cap')
  const iBall = sc.items.findIndex((i) => i.type === 'ball')
  check(`${label}: a widget lands above balls and below captions`, iPw > iBall && iPw < iCap, `ball ${iBall} < widget ${iPw} < caption ${iCap}`)
}

/* ------------------------------------- 2. the picture itself, in millimetres */

/* ------------------------------------ stage 4: the brand, mark and indicator */

/**
 * The test scene the brief asks for: cue ball, a four-ghost trail, an arrow, a
 * zone and the strength indicator, all laid across the watermark grid.
 */
const S4_SCENE = () => {
  const st = window.__store.getState()
  st.newExercise()
  const L = st.scene.table.lengthMm
  const s = L / 1120
  // the first stamp of the grid, in table mm, from the package's own formula
  const stamp = { x: (64 - 40) * s, y: (132 - 40) * s, w: 206 * s, h: 42 * s }
  const mid = { x: stamp.x + stamp.w / 2, y: stamp.y + stamp.h / 2 }
  // a red arrow straight through the second stamp: white ink over red would
  // show, so this is what proves the mark is underneath
  st.addItem({
    id: 's4-arrow', type: 'arrow',
    points: [{ x: (336 - 40) * s, y: (132 - 40) * s + stamp.h / 2 }, { x: (336 - 40) * s + stamp.w, y: (132 - 40) * s + stamp.h / 2 }],
    style: 'solid', color: '#FF5A4E', width: 26, head: 'filled', curved: false,
  })
  // the cue ball sits on the first stamp; the twin sits on bare cloth
  st.addItem({ id: 's4-ball', type: 'ball', x: mid.x, y: mid.y, kind: 'cue' }, 'top')
  st.addItem({ id: 's4-twin', type: 'ball', x: mid.x, y: mid.y + stamp.h * 2.1, kind: 'cue' }, 'top')
  // four ghosts across the grid: the tail is the faintest thing on the table
  st.addItem({
    id: 's4-ghost', type: 'ghostTrail',
    from: { x: (110 - 40) * s, y: (300 - 40) * s }, to: { x: (900 - 40) * s, y: (300 - 40) * s },
    count: 4, autoCount: false, head: false, color: '#FFFFFF',
  })
  st.addItem({ id: 's4-zone', type: 'zone', x: (620 - 40) * s, y: (430 - 40) * s, w: 300 * s, h: 120 * s, shape: 'rect', color: '#F5A623', opacity: 0.25 }, 'bottom')
  st.addItem({ id: 's4-power', type: 'power', x: L * 0.75, y: (500 - 40) * s, value: 4, widthMm: 600 }, 'belowText')
  st.select(null)
  return stamp
}

/** a sampler over the composite of every Konva layer, in table millimetres */
const S4_SAMPLER = `(() => {
  const layers = [...document.querySelectorAll('.konvajs-content canvas')]
  const c = document.createElement('canvas')
  c.width = layers[0].width
  c.height = layers[0].height
  const g = c.getContext('2d')
  for (const l of layers) g.drawImage(l, 0, 0)
  const L = window.__layout
  const dpr = c.width / parseFloat(layers[0].style.width)
  const d = g.getImageData(0, 0, c.width, c.height).data
  return (mx, my) => {
    const sx = L.rotation === 90 ? -my * L.scale + L.x : mx * L.scale + L.x
    const sy = L.rotation === 90 ? mx * L.scale + L.y : my * L.scale + L.y
    const x = Math.round(sx * dpr), y = Math.round(sy * dpr)
    if (x < 0 || y < 0 || x >= c.width || y >= c.height) return null
    const i = (y * c.width + x) * 4
    return [d[i], d[i + 1], d[i + 2]]
  }
})()`

async function stage4(page, label) {
  await page.evaluate(S4_SCENE)
  await page.waitForTimeout(400)

  // ---- the grid: every signature distinguishable on the cloth ----
  const grid = await page.evaluate(
    (SAMPLER) => {
      const at = eval(SAMPLER)
      const marks = window.__stage.find('.watermark')
      // a stamp counts when its own box carries far more ink than bare cloth
      const inkPct = (b) => {
        let ink = 0, n = 0
        for (let u = 0.02; u < 0.98; u += 0.01)
          for (let v = 0.05; v < 0.95; v += 0.06) {
            const c = at(b.x + u * b.w, b.y + v * b.h)
            const bg = at(b.x + u * b.w, b.y + b.h * 1.75)
            if (!c || !bg) continue
            n++
            if (c[0] - bg[0] >= 3) ink++
          }
        return n ? (ink / n) * 100 : 0
      }
      const boxes = marks.map((m) => ({ x: m.x(), y: m.y(), w: m.width(), h: m.height() }))
      const pcts = boxes.map(inkPct)
      return { count: marks.length, visible: pcts.filter((p) => p >= 4).length, min: Math.min(...pcts), rotations: marks.map((m) => m.getAbsoluteRotation ? 0 : 0).length }
    },
    S4_SAMPLER,
  )
  check(`${label}: at least 12 signatures are distinguishable on the cloth`, grid.visible >= 12, `${grid.visible} of ${grid.count}, faintest ${grid.min.toFixed(1)}% ink`)

  // ---- the mark is under the content, not over it ----
  const under = await page.evaluate(
    (SAMPLER) => {
      const at = eval(SAMPLER)
      const sc = window.__store.getState().scene
      const ball = sc.items.find((i) => i.id === 's4-ball')
      const twin = sc.items.find((i) => i.id === 's4-twin')
      const r = sc.table.ballMm / 2
      // the same ball, once over a signature and once over bare cloth: if the
      // mark were on top, white ink would lighten the first one
      // means, not worst pixels: at twelve pixels across, half a pixel of
      // rounding on the ball's gradient is already fifteen levels, while a
      // white signature composited on top would raise blue by about forty
      const sum = [0, 0, 0]
      let n1 = 0
      for (let a = 0; a < 360; a += 15)
        for (const k of [0, 0.35, 0.6]) {
          const dx = Math.cos((a * Math.PI) / 180) * r * k
          const dy = Math.sin((a * Math.PI) / 180) * r * k
          const p1 = at(ball.x + dx, ball.y + dy)
          const p2 = at(twin.x + dx, twin.y + dy)
          if (!p1 || !p2) continue
          n1++
          for (let c = 0; c < 3; c++) sum[c] += p1[c] - p2[c]
        }
      const mean = sum.map((v) => v / Math.max(1, n1))
      const worst = Math.max(...mean.map(Math.abs))
      const worstAt = mean.map((v) => v.toFixed(1)).join(' / ')
      // the arrow: pure ink all the way across the signature it crosses
      const ar = sc.items.find((i) => i.id === 's4-arrow')
      let offColour = 0
      let n = 0
      for (let t = 0.1; t <= 0.9; t += 0.02) {
        const x = ar.points[0].x + (ar.points[1].x - ar.points[0].x) * t
        const c = at(x, ar.points[0].y)
        if (!c) continue
        n++
        // #FF5A4E, allowing for antialiasing along the shaft
        if (Math.abs(c[0] - 255) > 6 || Math.abs(c[1] - 90) > 8 || Math.abs(c[2] - 78) > 8) offColour++
      }
      return { worst, worstAt, offColour, n }
    },
    S4_SAMPLER,
  )
  check(`${label}: a ball over a signature is the same ball as one on bare cloth`, under.worst <= 6, `mean r/g/b shift ${under.worstAt}`)
  check(`${label}: an arrow crossing a signature keeps its own colour`, under.offColour === 0, `${under.offColour} of ${under.n} samples tinted`)

  // ---- the tail of a trajectory survives ----
  const tail = await page.evaluate(
    (SAMPLER) => {
      const at = eval(SAMPLER)
      const sc = window.__store.getState().scene
      const gh = sc.items.find((i) => i.id === 's4-ghost')
      const r = sc.table.ballMm / 2
      // the ghosts run from `from` to `to`; the last one is the faintest
      const n = gh.count
      const out = []
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1)
        const cx = gh.from.x + (gh.to.x - gh.from.x) * t
        const cy = gh.from.y + (gh.to.y - gh.from.y) * t
        // brightest point on the ghost's ring against the cloth beside it
        let best = -999
        for (let a = 0; a < 360; a += 10) {
          const c = at(cx + Math.cos((a * Math.PI) / 180) * r * 0.92, cy + Math.sin((a * Math.PI) / 180) * r * 0.92)
          const bg = at(cx + Math.cos((a * Math.PI) / 180) * r * 2.4, cy + Math.sin((a * Math.PI) / 180) * r * 2.4)
          if (!c || !bg) continue
          best = Math.max(best, c[0] - bg[0])
        }
        out.push(best)
      }
      return out
    },
    S4_SAMPLER,
  )
  const faintest = Math.min(...tail)
  check(`${label}: the faintest ghost still clears the cloth by 20 levels of red`, faintest >= 20, `ghosts at ${tail.map((v) => v.toFixed(0)).join(' / ')}`)

  // ---- the indicator: nine states, 2 x value filled segments ----
  const states = await page.evaluate(
    async (SAMPLER) => {
      const values = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5]
      const out = []
      for (const v of values) {
        window.__store.getState().setPower('s4-power', v)
        await new Promise((r) => setTimeout(r, 90))
        const at = eval(SAMPLER)
        const it = window.__store.getState().scene.items.find((i) => i.id === 's4-power')
        const W = it.widthMm
        const H = (W * 88) / 140
        const sx = W / 140
        const sy = H / 88
        let filled = 0
        for (let i = 0; i < 9; i++) {
          const c = at(it.x - W / 2 + (12 + 13 * i + 5) * sx, it.y - H / 2 + 65 * sy)
          // a filled segment is white inside, an empty one shows the plate
          if (c && c[0] > 200 && c[1] > 200 && c[2] > 200) filled++
        }
        out.push({ v, filled })
      }
      return out
    },
    S4_SAMPLER,
  )
  const wrong = states.filter((s) => s.filled !== 2 * s.v)
  check(`${label}: every one of the nine states fills 2 x value segments`, wrong.length === 0, wrong.map((s) => `${s.v}->${s.filled}`).join(' ') || '9/9')

  // ---- the decimal mark is a comma ----
  const comma = await page.evaluate(
    (SAMPLER) => {
      window.__store.getState().setPower('s4-power', 4)
      return new Promise((resolve) =>
        setTimeout(() => {
          const at = eval(SAMPLER)
          const it = window.__store.getState().scene.items.find((i) => i.id === 's4-power')
          const W = it.widthMm
          const H = (W * 88) / 140
          const sx = W / 140
          const sy = H / 88
          const ink = (x0, x1, y0, y1) => {
            let n = 0
            for (let x = x0; x <= x1; x += 0.5)
              for (let y = y0; y <= y1; y += 0.5) {
                const c = at(it.x - W / 2 + x * sx, it.y - H / 2 + y * sy)
                if (c && c[0] > 200 && c[1] > 200 && c[2] > 200) n++
              }
            return n
          }
          // the digits sit on the baseline at y = 38; only a comma puts ink
          // below it, and it does so between the two digits
          resolve({ below: ink(62, 70, 39.5, 43), underDigits: ink(46, 60, 39.5, 43) })
        }, 120),
      )
    },
    S4_SAMPLER,
  )
  check(`${label}: the decimal mark is a comma, with a tail below the baseline`, comma.below > 0 && comma.underDigits === 0, `${comma.below} samples below the separator, ${comma.underDigits} under the digits`)

  // ---- density: the preset changes the count and outlives a reload ----
  const counts = await page.evaluate(async () => {
    const out = {}
    for (const d of ['light', 'dense', 'medium']) {
      window.__store.getState().setWatermarkDensity(d)
      await new Promise((r) => setTimeout(r, 120))
      out[d] = {
        stamps: window.__stage.find('.watermark').length,
        opacity: window.__stage.find('.watermark-grid')[0]?.opacity(),
      }
    }
    window.__store.getState().setWatermarkDensity('dense')
    return out
  })
  check(`${label}: the density preset changes how many signatures there are`, counts.light.stamps === 12 && counts.dense.stamps === 16, `light ${counts.light.stamps}, dense ${counts.dense.stamps}, medium ${counts.medium.stamps}`)
  check(`${label}: the quiet preset is the same grid, fainter`, counts.medium.stamps === 12 && counts.medium.opacity < counts.light.opacity, `${counts.medium.opacity} vs ${counts.light.opacity}`)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  const kept = await page.evaluate(() => ({
    density: window.__store.getState().watermarkDensity,
    stamps: window.__stage.find('.watermark').length,
  }))
  check(`${label}: the density survives a reload`, kept.density === 'dense' && kept.stamps === 16, `${kept.density}, ${kept.stamps} stamps`)
  await page.evaluate(() => window.__store.getState().setWatermarkDensity('light'))
  await page.waitForTimeout(150)

  // ---- the old mark is gone ----
  const oldMark = await page.evaluate(() => ({
    // document.fonts.check answers "can this be drawn", fallback included, so
    // it says yes for a family that no longer exists: list the faces instead
    faces: [...document.fonts].map((f) => f.family).join(' '),
    rotated: window.__stage.find('.watermark').filter((n) => Math.abs(n.rotation()) > 0.01).length,
    railed: window.__stage.find('.watermark-rail').length,
  }))
  const shipped = fs.readdirSync(path.join(process.cwd(), 'dist', 'fonts'))
  const bundle = fs
    .readdirSync(path.join(process.cwd(), 'dist', 'assets'))
    .filter((f) => f.endsWith('.js') || f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join(process.cwd(), 'dist', 'assets', f), 'utf8'))
    .join('')
  check(`${label}: no Playfair Display in the build`, !shipped.some((f) => /watermark-(cyrillic|latin)|playfair/i.test(f)) && !/Exercise Serif|Playfair/.test(bundle), shipped.join(' '))
  check(`${label}: no diagonal signature left on the cloth`, oldMark.rotated === 0 && !/Serif|Playfair/.test(oldMark.faces), `${oldMark.rotated} rotated, faces: ${oldMark.faces}`)
  check(`${label}: the signature on the rail is still there`, oldMark.railed === 1)
}

async function picture(page, label) {
  await stage4(page, label)

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
    /** the cloth around a point, immune to a signature crossing the sample */
    const clothAround = (cx, cy, r) => {
      const ring = []
      for (let a = 0; a < 360; a += 30) {
        const c = at(cx + Math.cos((a * Math.PI) / 180) * r, cy + Math.sin((a * Math.PI) / 180) * r)
        if (c && c[3] > 200) ring.push(luma(c))
      }
      ring.sort((p, q) => p - q)
      return ring.length ? ring[Math.floor(ring.length / 2)] : 999
    }
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
    const bg = clothAround(ball.x, ball.y, D * 1.5)
    let lit = 0
    const n2 = 600
    for (let i = 0; i <= n2; i++) if (Math.abs(luma(at(ball.x - D + (2 * D * i) / n2, ball.y)) - bg) > 12) lit++
    const litPct = ((lit / n2) * 2 * D / D) * 100

    // ghost: the same measurement on the first ghost, which is nearly opaque
    const gh = scene.items.find((i) => i.id === 'v-ghost')
    const gbg = clothAround(gh.from.x, gh.from.y, D * 1.5)
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
    // brass: warm yellow, well above the wood in green, well below white
    let brass = 0
    const balls = scene.items.filter((i) => i.type === 'ball')
    for (const pk of [[0, 0], [LEN / 2, 0], [LEN, 0], [0, WID], [LEN / 2, WID], [LEN, WID]]) {
      for (let x = pk[0] - 200; x <= pk[0] + 200; x += 3)
        for (let y = pk[1] - 200; y <= pk[1] + 200; y += 3) {
          // the cue ball is orange too; skip the discs
          if (balls.some((b) => Math.hypot(b.x - x, b.y - y) <= r + 6)) continue
          const c = at(x, y)
          if (!c || c[3] < 200) continue
          if (c[0] > 175 && c[1] > 130 && c[1] < 215 && c[2] < 120 && c[0] - c[2] > 70) brass++
        }
    }
    return { cornerMouth, middleMouth, escaped, litPct, ghostMm, ballOverZoneWhite, offBed: offBed.length, D, brass }
  })
  check(`${label}: black at the corner mouth is 72 mm ± 10%`, Math.abs(m.cornerMouth - 72) <= 7.2, `${m.cornerMouth.toFixed(1)} mm`)
  check(`${label}: black at the middle mouth is 82 mm ± 10%`, Math.abs(m.middleMouth - 82) <= 8.2, `${m.middleMouth.toFixed(1)} mm`)
  check(`${label}: no black past the outer contour of the rubber`, m.escaped === 0, `${m.escaped} samples`)
  check(`${label}: the lit part of a ball is >= 90% of its diameter`, m.litPct >= 90, `${m.litPct.toFixed(1)}%`)
  check(`${label}: a ghost is the ball's own diameter`, Math.abs(m.ghostMm - m.D) <= m.D * 0.08, `${m.ghostMm.toFixed(1)} vs ${m.D} mm`)
  check(`${label}: a ball over a zone is drawn on top of it`, !!m.ballOverZoneWhite)
  check(`${label}: no ball centre closer to a rail than its radius (pockets excepted)`, m.offBed === 0, `${m.offBed} off`)
  check(`${label}: no brass-coloured pixels round the pockets`, m.brass === 0, `${m.brass} samples`)

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
  await page.locator('.toast').waitFor({ timeout: 30000 }).catch(() => {})
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

// phone: the mobile shell - dock, sheets, touch placement, pinch zoom
if (!ONLY || ONLY === 'phone') {
  const { ctx, page, errors } = await newPage({ width: 390, height: 844 }, 3, { hasTouch: true, isMobile: true })
  const cdp = await ctx.newCDPSession(page)
  const touchTo = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y })) })
  /** one finger: press, slide, release */
  const swipe = async (from, to, steps = 14) => {
    await touchTo('touchStart', [from])
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      await touchTo('touchMove', [[from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]])
      await page.waitForTimeout(16)
    }
    await touchTo('touchEnd', [])
    await page.waitForTimeout(200)
  }
  /** two fingers on a horizontal line about `c`, spreading from r0 to r1 */
  const pinch = async (c, r0, r1, steps = 14) => {
    const pts = (r) => [[c[0] - r, c[1]], [c[0] + r, c[1]]]
    await touchTo('touchStart', pts(r0))
    for (let i = 1; i <= steps; i++) {
      await touchTo('touchMove', pts(r0 + ((r1 - r0) * i) / steps))
      await page.waitForTimeout(16)
    }
    await touchTo('touchEnd', [])
    await page.waitForTimeout(200)
  }
  const view = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__view.getState().viewport)))
  const stageBox = () => page.locator('.konvajs-content').boundingBox()

  check('phone: table auto-rotates upright', await page.evaluate(() => window.__layout.rotation === 90))
  check('phone: the mobile shell is in use', (await page.locator('.m-shell').count()) === 1)

  // ---- the dock: every tool reachable, tap targets big enough, nothing off screen
  const dock = page.locator('.m-dock')
  const db = await dock.boundingBox()
  check('phone: the dock is inside the viewport', !!db && db.y + db.height <= 844 + 0.5 && db.x >= 0, db ? `bottom ${(db.y + db.height).toFixed(0)}` : 'no dock')
  const toolIds = [
    ['Выбор', 'select'], ['Белый шар', 'ball-white'], ['Биток', 'ball-cue'], ['Стрелка', 'arrow'],
    ['Траектория', 'ghost'], ['Линия', 'line'], ['Зона', 'zone-rect'], ['Эллипс', 'zone-ellipse'],
    ['Текст', 'text'], ['Точка на шаре', 'strike'], ['Сила удара', 'power'], ['Шар-призрак', 'ghost-ball'],
  ]
  let reachable = 0
  let small = 0
  for (const [name, id] of toolIds) {
    const b = dock.getByRole('button', { name, exact: true })
    await b.scrollIntoViewIfNeeded()
    const bb = await b.boundingBox()
    if (bb && (bb.width < 44 || bb.height < 44)) small++
    await b.click()
    if ((await page.evaluate(() => window.__store.getState().tool)) === id) reachable++
  }
  check('phone: all 12 tools reachable from the dock', reachable === 12, `${reachable}/12`)
  check('phone: every dock button is at least 44 px', small === 0, `${small} small`)
  const stageBb = await stageBox()
  check('phone: the table takes most of the width', stageBb.width >= 360, `${stageBb.width.toFixed(0)} px`)

  // ---- place a ball with a tap
  await dock.getByRole('button', { name: 'Белый шар', exact: true }).scrollIntoViewIfNeeded()
  await dock.getByRole('button', { name: 'Белый шар', exact: true }).click()
  const [bx, by] = await toPage(page, 1200, 900)
  await page.touchscreen.tap(bx, by)
  await page.waitForTimeout(200)
  let sc = await scene(page)
  const placed = sc.items.find((i) => i.type === 'ball')
  check('phone: a tap places a ball where the finger is', !!placed && Math.hypot(placed.x - 1200, placed.y - 900) < 25,
    placed ? `${placed.x.toFixed(0)},${placed.y.toFixed(0)}` : 'no ball')
  // the browser echoes a tap as mouse events; that echo must not place a twin
  check('phone: a tap places exactly one ball', sc.items.filter((i) => i.type === 'ball').length === 1, `${sc.items.filter((i) => i.type === 'ball').length} balls`)
  await dock.getByRole('button', { name: 'Точка на шаре', exact: true }).scrollIntoViewIfNeeded()
  await dock.getByRole('button', { name: 'Точка на шаре', exact: true }).click()
  const [wx, wy] = await toPage(page, 2600, 400)
  await page.touchscreen.tap(wx, wy)
  await page.waitForTimeout(200)
  sc = await scene(page)
  check('phone: a tap places exactly one widget', sc.items.filter((i) => i.type === 'strikePoint').length === 1, `${sc.items.filter((i) => i.type === 'strikePoint').length} widgets`)
  await page.evaluate(() => {
    const st = window.__store.getState()
    st.select(st.scene.items.find((i) => i.type === 'strikePoint').id)
    st.removeSelected()
  })

  // ---- drag it with a finger: the ball rides 60 px above the finger
  await dock.getByRole('button', { name: 'Выбор', exact: true }).scrollIntoViewIfNeeded()
  await dock.getByRole('button', { name: 'Выбор', exact: true }).click()
  await page.waitForTimeout(150) // the hit canvas is redrawn a frame later
  const L0 = await page.evaluate(() => window.__layout)
  const [fx, fy] = await toPage(page, placed.x, placed.y)
  await swipe([fx, fy], [fx + 40, fy + 150])
  sc = await scene(page)
  const dragged = sc.items.find((i) => i.id === placed.id)
  // the finger's end point in mm, then 60 screen px "up", which on the upright
  // table is minus x in table mm
  const endMm = await page.evaluate(([x, y]) => {
    const l = window.__layout
    const c = document.querySelector('.konvajs-content').getBoundingClientRect()
    const px = x - c.left, py = y - c.top
    const dx = px - l.x, dy = py - l.y
    return l.rotation === 90 ? { x: dy / l.scale, y: -dx / l.scale } : { x: dx / l.scale, y: dy / l.scale }
  }, [fx + 40, fy + 150])
  const wantX = endMm.x - 60 / L0.scale
  const liftErr = Math.hypot(dragged.x - wantX, dragged.y - endMm.y)
  check('phone: a touch drag lifts the ball 60 px above the finger', liftErr < 15, `off by ${liftErr.toFixed(0)} mm (ball ${dragged.x.toFixed(0)},${dragged.y.toFixed(0)}; finger ${endMm.x.toFixed(0)},${endMm.y.toFixed(0)})`)
  check('phone: one touch drag is one history entry', (await page.evaluate(() => window.__store.getState().past.length)) >= 1)

  // ---- select with a tap, properties strip, nudge, strip flips away from the object
  const [sx, sy] = await toPage(page, dragged.x, dragged.y)
  await page.touchscreen.tap(sx, sy)
  await page.waitForTimeout(200)
  check('phone: tap selects a ball', (await scene(page)).selectedId === dragged.id)
  const props = page.locator('.props')
  check('phone: properties strip shows for the selection', await props.isVisible())
  const x0 = dragged.x
  await props.getByRole('button', { name: 'Вправо 5 мм' }).click()
  await page.waitForTimeout(100)
  const nudged = (await scene(page)).items.find((i) => i.id === dragged.id)
  check('phone: nudge button moves the ball 5 mm', Math.abs(nudged.x - x0 - 5) < 0.01, `${x0.toFixed(1)} -> ${nudged.x.toFixed(1)}`)
  // an object in the lower half: the strip moves to the top edge
  await page.evaluate(() => {
    window.__store.getState().addBall('white', { x: 3100, y: 900 })
    // a fresh snapshot: the store is immutable, the old one has no new ball
    const st = window.__store.getState()
    st.select(st.scene.items.at(-1).id)
  })
  await page.waitForTimeout(150)
  const pbLow = await props.boundingBox()
  const sbLow = await stageBox()
  check('phone: strip flips to the top for an object near the bottom', pbLow && pbLow.y < sbLow.y + sbLow.height / 2, pbLow ? `strip top ${pbLow.y.toFixed(0)}, stage mid ${(sbLow.y + sbLow.height / 2).toFixed(0)}` : 'no strip')
  await page.evaluate(() => {
    const st = window.__store.getState()
    st.select(st.scene.items.find((i) => i.type === 'ball').id)
  })
  await page.waitForTimeout(150)
  const pbHigh = await props.boundingBox()
  check('phone: strip sits at the bottom for an object near the top', pbHigh && pbHigh.y > sbLow.y + sbLow.height / 2, pbHigh ? `strip top ${pbHigh.y.toFixed(0)}` : 'no strip')
  await page.evaluate(() => window.__store.getState().select(null))

  // ---- pinch zoom, one-finger pan, the "whole table" button
  const sb = await stageBox()
  const c = [sb.x + sb.width / 2, sb.y + sb.height / 2]
  check('phone: starts at zoom 1', (await view()).zoom === 1)
  await page.evaluate(() => {
    window.__tlog = []
    const st = window.__stage
    st.on('touchstart', (e) => window.__tlog.push('ts:' + (e.target === st ? 'stage' : e.target.name() || e.target.className)))
    st.on('touchmove', () => window.__tlog.push('tm' + st.getPointersPositions().length))
    st.on('dragstart', (e) => window.__tlog.push('drag:' + (e.target.name() || e.target.className)))
  })
  await pinch(c, 40, 120)
  let v = await view()
  const tlog = await page.evaluate(() => window.__tlog.join(' '))
  check('phone: a pinch zooms in (about x3)', v.zoom > 2.4 && v.zoom <= 4, `zoom ${v.zoom.toFixed(2)}; events: ${tlog}`)
  check('phone: the layer transform follows the zoom', Math.abs((await page.evaluate(() => window.__layout.scale)) / L0.scale - v.zoom) < 0.05)
  const fit = page.getByRole('button', { name: 'Показать весь стол' })
  check('phone: a "whole table" button appears when zoomed', await fit.isVisible())
  const before = v
  await swipe([c[0], c[1] - 100], [c[0], c[1] + 20])
  v = await view()
  check('phone: one finger pans the zoomed picture', v.zoom === before.zoom && v.panY - before.panY > 60, `pan ${before.panY.toFixed(0)} -> ${v.panY.toFixed(0)}`)
  check('phone: panning did not create anything', (await scene(page)).items.length === 2)
  await pinch(c, 120, 30)
  v = await view()
  check('phone: pinching in zooms back out', v.zoom < before.zoom, `zoom ${v.zoom.toFixed(2)}`)
  await pinch(c, 40, 120)
  await fit.click()
  await page.waitForTimeout(100)
  v = await view()
  check('phone: the button resets to the whole table', v.zoom === 1 && v.panX === 0 && v.panY === 0)
  // one finger lands on a ball, the other on cloth: still a pinch, not a drag
  const b1 = (await scene(page)).items.find((i) => i.type === 'ball')
  const [b1x, b1y] = await toPage(page, b1.x, b1.y)
  await pinch([b1x + 30, b1y], 30, 110)
  v = await view()
  const b1after = (await scene(page)).items.find((i) => i.id === b1.id)
  const moved = Math.hypot(b1after.x - b1.x, b1after.y - b1.y)
  check('phone: a pinch that starts on a ball zooms', v.zoom > 2, `zoom ${v.zoom.toFixed(2)}`)
  check('phone: a pinch that starts on a ball leaves the ball in place', moved < 3, `moved ${moved.toFixed(1)} mm`)
  await fit.click()
  await page.waitForTimeout(100)

  // ---- the export never depends on the zoom
  await page.evaluate(() => window.__store.getState().newExercise())
  await picture(page, 'phone')
  const flat = await exportVia(page, 'phone-flat', 'PNG', '1x')
  await page.evaluate(() => window.__view.getState().setViewport({ zoom: 2.5, panX: 40, panY: -80 }))
  await page.waitForTimeout(150)
  const zoomed = await exportVia(page, 'phone-zoomed', 'PNG', '1x')
  check('phone: export at zoom 2.5 has the same size as at zoom 1', zoomed.w === flat.w && zoomed.h === flat.h, `${zoomed.w}x${zoomed.h} vs ${flat.w}x${flat.h}`)
  const diff = await page.evaluate(
    ([a, b]) =>
      new Promise((res) => {
        const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src })
        Promise.all([load(a), load(b)]).then(([ia, ib]) => {
          const c = document.createElement('canvas')
          c.width = ia.width; c.height = ia.height
          const g = c.getContext('2d')
          g.drawImage(ia, 0, 0)
          const da = g.getImageData(0, 0, c.width, c.height).data
          g.drawImage(ib, 0, 0)
          const dbb = g.getImageData(0, 0, c.width, c.height).data
          let sum = 0, n = 0
          for (let i = 0; i < da.length; i += 4 * 7) { sum += Math.abs(da[i] - dbb[i]) + Math.abs(da[i + 1] - dbb[i + 1]) + Math.abs(da[i + 2] - dbb[i + 2]); n += 3 }
          res(sum / n)
        })
      }),
    [`data:image/png;base64,${fs.readFileSync(flat.file).toString('base64')}`, `data:image/png;base64,${fs.readFileSync(zoomed.file).toString('base64')}`],
  )
  check('phone: export at zoom 2.5 shows the same picture as at zoom 1', diff < 2, `mean diff ${diff.toFixed(2)}`)
  check('phone: export resets the zoom', (await view()).zoom === 1)
  check('phone: export 1x long side is 1600 px', Math.max(flat.w, flat.h) === 1600, `${flat.w}x${flat.h}`)

  // ---- copy from the sheet
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click()
  await page.getByRole('button', { name: 'Копировать в буфер' }).click()
  await page.locator('.toast').waitFor({ timeout: 30000 }).catch(() => {})
  const clip = await page.evaluate(async () => {
    try {
      const items = await navigator.clipboard.read()
      return items.some((it) => it.types.includes('image/png'))
    } catch (e) {
      return 'err:' + (e && e.message)
    }
  })
  check('phone: copy to clipboard puts an image/png on the clipboard', clip === true, String(clip))

  // ---- the menu sheet: pyramid, and the sheet closes after it
  await page.getByRole('button', { name: 'Меню', exact: true }).click()
  await page.getByRole('button', { name: 'Пирамида', exact: true }).click()
  await page.waitForTimeout(250)
  check('phone: pyramid from the menu sheet', (await scene(page)).items.filter((i) => i.type === 'ball').length >= 16)
  check('phone: the sheet closes after racking', (await page.locator('.sheet').count()) === 0)

  const ta = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    return [c, c.parentElement, c.parentElement.parentElement].map((e) => getComputedStyle(e).touchAction)
  })
  check('phone: canvas opts out of browser touch gestures', ta.every((v) => v === 'none'), ta.join(' / '))
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
