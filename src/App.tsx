/**
 * App shell: a toolbar, the canvas with its captions, and the panels that
 * float over them. The only logic that lives here is export, because that is
 * the one action which needs the Konva stage itself, and autosave, because it
 * has to outlive every component.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type Konva from 'konva'
import { SceneStage, StageHint } from './render/SceneStage'
import { Toolbar } from './ui/Toolbar'
import { Properties } from './ui/Properties'
import { TextEditor } from './ui/TextEditor'
import { NoteField, TitleField } from './ui/Captions'
import {
  copyExportToClipboard,
  downloadExport,
  exportFileName,
  type ExportFormat,
} from './lib/exportImage'
import { flushScene, saveScene } from './lib/storage'
import { useStore } from './state/store'
import { useView } from './state/view'
import { useIsMobile } from './ui/useMedia'
import { MobileShell } from './ui/mobile/MobileShell'
import './ui/styles.css'

/**
 * "1x" means this many pixels along the long side of the picture. Tying the
 * export to a fixed reference instead of the on-screen stage size is what keeps
 * a diagram made on a phone as sharp as one made on a desktop.
 */
const EXPORT_BASE_PX = 1600

export function App() {
  const stageRef = useRef<Konva.Stage | null>(null)
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)

  /* autosave: every change, 500 ms after the last one, and on the way out */
  useEffect(() => {
    let last = useStore.getState().scene
    const unsub = useStore.subscribe((s) => {
      if (s.scene !== last) {
        last = s.scene
        saveScene(s.scene)
      }
    })
    const flush = () => flushScene()
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      unsub()
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.error ? 6000 : 2500)
    return () => clearTimeout(t)
  }, [toast])

  const mobile = useIsMobile()

  /** drop the selection and the zoom, and give React two frames to redraw */
  const settle = useCallback(async () => {
    useStore.getState().select(null)
    useView.getState().resetViewport()
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  }, [])

  const pixelRatioFor = (stage: Konva.Stage, scale: number) =>
    (EXPORT_BASE_PX / Math.max(stage.width(), stage.height(), 1)) * scale

  const handleExport = useCallback(
    async (scale: number, format: ExportFormat) => {
      const stage = stageRef.current
      if (!stage) return
      await settle()
      const { title, note } = useStore.getState().scene
      try {
        const { bytes } = await downloadExport(stage, {
          pixelRatio: pixelRatioFor(stage, scale),
          format,
          title,
          note,
          fileName: exportFileName(title, new Date(), format),
        })
        setToast({ text: `Сохранено, ${Math.round(bytes / 1024)} КБ`, error: false })
      } catch (e) {
        setToast({ text: e instanceof Error ? e.message : 'Не удалось сохранить', error: true })
      }
    },
    [settle],
  )

  /* No await before clipboard.write: Safari only allows it inside the click. */
  const handleCopy = useCallback((scale: number) => {
    const stage = stageRef.current
    if (!stage) return
    useStore.getState().select(null)
    // a zoomed stage would export a crop; renderExport waits two frames for
    // React to push this reset into the layers before it reads them
    useView.getState().resetViewport()
    const { title, note } = useStore.getState().scene
    copyExportToClipboard(stage, { pixelRatio: pixelRatioFor(stage, scale), title, note })
      .then(() => setToast({ text: 'Скопировано в буфер', error: false }))
      .catch((e: unknown) =>
        setToast({ text: e instanceof Error ? e.message : 'Не удалось скопировать', error: true }),
      )
  }, [])

  if (mobile) {
    return (
      <>
        <MobileShell stageRef={stageRef} onExport={handleExport} onCopy={handleCopy} />
        {toast && (
          <div className={toast.error ? 'toast toast--error' : 'toast'} role="status" onClick={() => setToast(null)}>
            {toast.text}
          </div>
        )}
      </>
    )
  }

  return (
    <div className="app">
      <Toolbar onExport={handleExport} onCopy={handleCopy} />
      <main className="stage-wrap">
        <TitleField />
        <SceneStage stageRef={stageRef} />
        <NoteField />
        <StageHint />
        <Properties />
        <TextEditor />
      </main>
      {toast && (
        <div className={toast.error ? 'toast toast--error' : 'toast'} role="status" onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  )
}
