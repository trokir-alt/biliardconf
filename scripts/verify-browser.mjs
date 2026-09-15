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
 * It drives the real UI on a desktop, an iPad and a phone viewport and checks
 * the things that are easy to break and expensive to notice late: the pyramid
 * geometry, that no two balls overlap, undo/redo, the millimetre nudges, the
 * rotated table still being draggable, and that the exported PNG is really the
 * resolution the UI promised. Exits non-zero if any check fails.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const PORT = process.env.PORT || '4173'
const SP = process.env.SP || process.cwd()
const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`)
}

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
)

/** read the live scene out of the running app */
const scene = (page) =>
  page.evaluate(() => {
    const s = window.__scene
    return s ? JSON.parse(JSON.stringify(s)) : null
  })

async function run(viewport, dsf, label) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dsf, acceptDownloads: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://localhost:${PORT}/?debug=1`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)

  // ---- pyramid ----
  await page.getByRole('button', { name: 'Пирамида' }).click()
  await page.waitForTimeout(300)
  let sc = await scene(page)
  check(`${label}: pyramid racks 15 white + 1 cue`,
    sc && sc.items.length === 16 &&
    sc.items.filter((i) => i.kind === 'white').length === 15 &&
    sc.items.filter((i) => i.kind === 'cue').length === 1,
    sc ? `items=${sc.items.length}` : 'no scene')

  // no ball overlaps another, and every ball is on the field
  const d = sc.table.ballMm
  let minGap = Infinity
  for (let i = 0; i < sc.items.length; i++)
    for (let j = i + 1; j < sc.items.length; j++) {
      const a = sc.items[i], b = sc.items[j]
      minGap = Math.min(minGap, Math.hypot(a.x - b.x, a.y - b.y))
    }
  check(`${label}: no overlapping balls`, minGap >= d - 0.01, `min centre distance ${minGap.toFixed(2)}mm vs ${d}mm`)
  const onField = sc.items.every(
    (i) => i.x >= d / 2 - 0.01 && i.x <= sc.table.lengthMm - d / 2 + 0.01 &&
           i.y >= d / 2 - 0.01 && i.y <= sc.table.widthMm - d / 2 + 0.01)
  check(`${label}: every ball on the play field`, onField)

  // apex on the back spot, triangle opening away from the house
  const xs = sc.items.filter((i) => i.kind === 'white').map((i) => i.x)
  const apexX = Math.min(...xs)
  check(`${label}: pyramid apex on the back spot`,
    Math.abs(apexX - sc.table.lengthMm * 0.75) < 0.5, `apex x=${apexX.toFixed(1)} vs ${sc.table.lengthMm * 0.75}`)
  const cue = sc.items.find((i) => i.kind === 'cue')
  check(`${label}: cue ball inside the house`, cue.x < sc.table.lengthMm * 0.25, `cue x=${cue.x.toFixed(1)}`)

  // ---- undo / redo ----
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(200)
  check(`${label}: undo empties the table`, (await scene(page)).items.length === 0)
  await page.keyboard.press('Control+Shift+z')
  await page.waitForTimeout(200)
  check(`${label}: redo restores it`, (await scene(page)).items.length === 16)

  // ---- add a ball by clicking the table ----
  await page.getByRole('button', { name: 'Белый шар' }).click()
  const bb = await page.locator('canvas').first().boundingBox()
  await page.mouse.click(bb.x + bb.width * 0.3, bb.y + bb.height * 0.3)
  await page.waitForTimeout(250)
  check(`${label}: click adds a ball`, (await scene(page)).items.length === 17)

  // clicking an existing ball must NOT stack another on top of it
  const before = (await scene(page)).items.length
  await page.mouse.click(bb.x + bb.width * 0.3, bb.y + bb.height * 0.3)
  await page.waitForTimeout(250)
  const after = (await scene(page)).items.length
  check(`${label}: clicking an existing ball does not stack`, after === before, `${before} -> ${after}`)

  // ---- drag ----
  await page.getByRole('button', { name: 'Выбор' }).click()
  const pre = (await scene(page)).items[16]
  await page.mouse.move(bb.x + bb.width * 0.3, bb.y + bb.height * 0.3)
  await page.mouse.down()
  await page.mouse.move(bb.x + bb.width * 0.45, bb.y + bb.height * 0.65, { steps: 24 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  const post = (await scene(page)).items.find((i) => i.id === pre.id)
  check(`${label}: dragging moves the ball`, Math.hypot(post.x - pre.x, post.y - pre.y) > 100,
    `moved ${Math.hypot(post.x - pre.x, post.y - pre.y).toFixed(0)}mm`)

  // ---- keyboard nudge ----
  const n0 = (await scene(page)).items.find((i) => i.id === pre.id)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(150)
  const n1 = (await scene(page)).items.find((i) => i.id === pre.id)
  check(`${label}: arrow nudges 5 mm`, Math.abs(n1.x - n0.x - 5) < 0.01, `dx=${(n1.x - n0.x).toFixed(3)}`)
  await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(150)
  const n2 = (await scene(page)).items.find((i) => i.id === pre.id)
  check(`${label}: shift+arrow nudges 1 mm`, Math.abs(n2.x - n1.x - 1) < 0.01, `dx=${(n2.x - n1.x).toFixed(3)}`)

  // ---- delete ----
  const cnt = (await scene(page)).items.length
  await page.keyboard.press('Delete')
  await page.waitForTimeout(200)
  check(`${label}: Delete removes the selection`, (await scene(page)).items.length === cnt - 1)

  // ---- table settings ----
  await page.getByLabel('Диаметр шара').selectOption('68')
  await page.waitForTimeout(200)
  check(`${label}: ball diameter setting applies`, (await scene(page)).table.ballMm === 68)
  await page.getByRole('button', { name: 'Зелёное сукно' }).click()
  await page.waitForTimeout(200)
  check(`${label}: green cloth applies`, (await scene(page)).table.cloth === 'green')
  await page.getByRole('button', { name: 'Синее сукно' }).click()
  await page.waitForTimeout(150)

  const wasMarkings = (await scene(page)).table.markings
  await page.getByText('Разметка').click()
  await page.waitForTimeout(200)
  check(`${label}: markings toggle`, (await scene(page)).table.markings === !wasMarkings)
  await page.getByText('Разметка').click()
  await page.waitForTimeout(150)

  // ---- orientation ----
  // a portrait viewport auto-rotates the table, so start from a known state
  await page.getByRole('button', { name: 'Горизонтально' }).click()
  await page.waitForTimeout(400)
  const beforeSize = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    return { w: parseFloat(c.style.width), h: parseFloat(c.style.height) }
  })
  await page.getByRole('button', { name: 'Вертикально' }).click()
  await page.waitForTimeout(400)
  const afterSize = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    return { w: parseFloat(c.style.width), h: parseFloat(c.style.height) }
  })
  check(`${label}: vertical orientation flips the stage`,
    (beforeSize.w > beforeSize.h) !== (afterSize.w > afterSize.h),
    `${beforeSize.w}x${beforeSize.h} -> ${afterSize.w}x${afterSize.h}`)

  // a ball must still be draggable after the rotation
  const sc2 = await scene(page)
  const target = sc2.items[0]
  const bb2 = await page.locator('canvas').first().boundingBox()
  const toPx = await page.evaluate(
    ([mx, my]) => {
      const l = window.__layout
      if (l.rotation === 90) return [-my * l.scale + l.x, mx * l.scale + l.y]
      return [mx * l.scale + l.x, my * l.scale + l.y]
    },
    [target.x, target.y],
  )
  await page.mouse.move(bb2.x + toPx[0], bb2.y + toPx[1])
  await page.mouse.down()
  await page.mouse.move(bb2.x + toPx[0] + 40, bb2.y + toPx[1] + 40, { steps: 16 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  const moved = (await scene(page)).items.find((i) => i.id === target.id)
  check(`${label}: drag still works when the table is upright`,
    Math.hypot(moved.x - target.x, moved.y - target.y) > 10,
    `moved ${Math.hypot(moved.x - target.x, moved.y - target.y).toFixed(0)}mm`)
  await page.getByRole('button', { name: 'Горизонтально' }).click()
  await page.waitForTimeout(300)

  // ---- clear (confirm dialog) ----
  page.once('dialog', (dlg) => dlg.accept())
  await page.getByRole('button', { name: 'Очистить' }).click()
  await page.waitForTimeout(250)
  check(`${label}: clear empties the table`, (await scene(page)).items.length === 0)

  // ---- export at every scale ----
  await page.getByRole('button', { name: 'Пирамида' }).click()
  await page.waitForTimeout(300)
  const dims = {}
  for (const scale of ['1x', '2x', '3x']) {
    await page.getByRole('button', { name: scale, exact: true }).click()
    const dlp = page.waitForEvent('download', { timeout: 20000 })
    await page.getByRole('button', { name: 'Скачать PNG' }).click()
    const dl = await dlp
    const path = `${SP}/verify-${label}-${scale}.png`
    await dl.saveAs(path)
    const size = fs.statSync(path).size
    const dim = await page.evaluate(
      (p) =>
        new Promise((res) => {
          const img = new Image()
          img.onload = () => res([img.width, img.height])
          img.src = p
        }),
      `data:image/png;base64,${fs.readFileSync(path).toString('base64')}`,
    )
    dims[scale] = dim
    check(`${label}: export ${scale} -> ${dl.suggestedFilename()}`,
      size > 20000 && dim[0] > 400 && dim[1] > 200,
      `${dim[0]}x${dim[1]}px, ${(size / 1024).toFixed(0)}KB`)
  }
  // 1x means a fixed reference width, so 2x and 3x must really be 2x and 3x of
  // it. A hard cap on pixelRatio silently breaks this and the coach's picture
  // arrives at whatever size their screen happened to be.
  const long1x = Math.max(dims['1x'][0], dims['1x'][1])
  check(`${label}: 1x export is a fixed reference width`, Math.abs(long1x - 1600) <= 2,
    `long side ${long1x}px`)
  for (const [scale, factor] of [['2x', 2], ['3x', 3]]) {
    const ratio = dims[scale][0] / dims['1x'][0]
    check(`${label}: export ${scale} really is ${factor}x`, Math.abs(ratio - factor) < 0.05,
      `${dims[scale][0]}x${dims[scale][1]}px = ${ratio.toFixed(2)}x of 1x`)
  }
  // the selection ring must not be baked into the export
  check(`${label}: nothing selected at export time`, (await scene(page)).selectedId === null)

  check(`${label}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

/** narrow layout: the toolbar moves to the bottom, so only smoke-test it */
async function runPhone() {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    acceptDownloads: true,
    hasTouch: true,
    isMobile: true,
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://localhost:${PORT}/?debug=1`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  const upright = await page.evaluate(() => window.__layout.rotation === 90)
  check('phone: table auto-rotates upright', upright)

  await page.getByRole('button', { name: 'Пирамида' }).click()
  await page.waitForTimeout(400)
  check('phone: pyramid racks', (await scene(page)).items.length === 16)

  // touch drag
  const sc = await scene(page)
  const t = sc.items[0]
  const bb = await page.locator('canvas').first().boundingBox()
  const px = await page.evaluate(
    ([mx, my]) => {
      const l = window.__layout
      return l.rotation === 90 ? [-my * l.scale + l.x, mx * l.scale + l.y] : [mx * l.scale + l.x, my * l.scale + l.y]
    },
    [t.x, t.y],
  )
  await page.touchscreen.tap(bb.x + px[0], bb.y + px[1])
  await page.waitForTimeout(200)
  check('phone: tap selects a ball', (await scene(page)).selectedId === t.id)

  const dlp = page.waitForEvent('download', { timeout: 20000 })
  await page.getByRole('button', { name: 'Скачать PNG' }).click()
  const dl = await dlp
  const path = `${SP}/verify-phone-2x.png`
  await dl.saveAs(path)
  check('phone: export produces a usable png', fs.statSync(path).size > 20000,
    `${(fs.statSync(path).size / 1024).toFixed(0)}KB`)

  // the page itself must not scroll while the canvas is being dragged
  const ta = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    return [c, c.parentElement, c.parentElement.parentElement].map((e) => getComputedStyle(e).touchAction)
  })
  check('phone: canvas opts out of browser touch gestures', ta.every((v) => v === 'none'), `touch-action: ${ta.join(' / ')}`)

  check('phone: no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

await run({ width: 1440, height: 900 }, 2, 'desktop')
await run({ width: 1024, height: 1366 }, 2, 'ipad-portrait')
await runPhone()

await browser.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:\n' + failed.map((f) => ' - ' + f.name + (f.detail ? ' :: ' + f.detail : '')).join('\n'))
  process.exit(1)
}
