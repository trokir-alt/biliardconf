/**
 * App shell: a toolbar and the canvas. The only logic that lives here is PNG
 * export, because that is the one action which needs the Konva stage itself.
 */

import { useCallback, useRef, useState } from 'react'
import type Konva from 'konva'
import { SceneStage } from './render/SceneStage'
import { Toolbar } from './ui/Toolbar'
import { downloadStagePng, exportFileName } from './lib/exportPng'
import { useStore } from './state/store'
import './ui/styles.css'

/**
 * "1x" means this many pixels along the long side of the picture. Tying the
 * export to a fixed reference instead of the on-screen stage size is what keeps
 * a diagram made on a phone as sharp as one made on a desktop.
 */
const EXPORT_BASE_PX = 1600

export function App() {
  const stageRef = useRef<Konva.Stage | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleExport = useCallback(async (scale: number) => {
    const stage = stageRef.current
    if (!stage) return

    // the selection ring must not end up in the picture
    useStore.getState().select(null)
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    stage.batchDraw()

    const longSide = Math.max(stage.width(), stage.height(), 1)
    const pixelRatio = (EXPORT_BASE_PX / longSide) * scale

    try {
      setError(null)
      await downloadStagePng(stage, {
        pixelRatio,
        fileName: exportFileName(useStore.getState().scene.title, new Date()),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить PNG')
    }
  }, [])

  return (
    <div className="app">
      <Toolbar onExport={handleExport} />
      <SceneStage stageRef={stageRef} />
      {error && (
        <div className="toast" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  )
}
