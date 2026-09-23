import { useStore } from '../state/store'
import { gameOf } from '../model/game'
import type { Game } from '../model/types'

/** the game this scene's table is for, as a scalar a zustand selector can return */
export const useGame = (): Game => useStore((s) => gameOf(s.scene.table))
