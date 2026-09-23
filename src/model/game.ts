/**
 * The two games the constructor draws: Russian pyramid and American pool.
 *
 * A game is a table - its size, its pockets, its rails and markings, which
 * live in model/table.ts - and a set of balls, which live in the renderer.
 * This file holds only what everything else needs to agree on: which game a
 * table is, its nominal size, and how much smaller everything else must be
 * drawn on it.
 */

import type { Game, TableConfig } from './types'

export type GameSpec = {
  id: Game
  /** as the coach reads it in the settings */
  label: string
  /** for a segmented control two buttons wide */
  short: string
  /** play field, between the cushion noses */
  lengthMm: number
  widthMm: number
  /** the one ball size the game is played with */
  ballMm: number
}

export const GAMES: Record<Game, GameSpec> = {
  pyramid: {
    id: 'pyramid',
    label: 'Русский бильярд',
    short: 'Русский',
    lengthMm: 3550,
    widthMm: 1775,
    ballMm: 67,
  },
  /**
   * The nine-foot tournament table, WPA: a playing surface of 100 x 50 inches
   * and a ball of 2 1/4 inches. It is the table the game is broadcast on and
   * the one a club's pool room is built around; seven- and eight-foot tables
   * would be a size option here, not another game.
   */
  pool: {
    id: 'pool',
    label: 'Американский пул',
    short: 'Пул',
    lengthMm: 2540,
    widthMm: 1270,
    ballMm: 57.15,
  },
}

export const GAME_ORDER: Game[] = ['pyramid', 'pool']

/**
 * Which game a table is. Every scene saved before pool existed has no `game`
 * at all, and every one of them is a pyramid table - so anything that is not
 * explicitly pool is pyramid, including a value some later build invented.
 */
export function gameOf(cfg: { game?: unknown }): Game {
  return cfg.game === 'pool' ? 'pool' : 'pyramid'
}

export const isPool = (cfg: { game?: unknown }): boolean => gameOf(cfg) === 'pool'

/**
 * How much smaller the app's fixed sizes are drawn on this table.
 *
 * Stroke widths, caption sizes and the two widgets were all tuned on the
 * pyramid table, in millimetres. The picture of a table is always fitted to
 * the same screen and the same export, so a millimetre on a pool table - 2.54 m
 * long instead of 3.55 - covers 1.4 times as many pixels: an arrow that reads
 * as a normal stroke on the pyramid comes out heavy on pool, and a large
 * caption comes out as a headline. Scaling every preset by the ratio of the
 * lengths gives a diagram the same weight on either table.
 *
 * It is the game's NOMINAL length, not the scene's: a pyramid scene saved at
 * 3556 mm must keep exactly the presets it was drawn with.
 */
export function presetScale(cfg: { game?: unknown }): number {
  return GAMES[gameOf(cfg)].lengthMm / GAMES.pyramid.lengthMm
}

/** a preset tuned on the pyramid table, as it is on this one; whole mm */
export function scaledPreset(referenceMm: number, cfg: { game?: unknown }): number {
  return Math.round(referenceMm * presetScale(cfg))
}

/**
 * The table config for `game`, keeping what is the coach's choice rather than
 * the game's: the cloth colour and whether the markings are drawn.
 *
 * A pyramid table carries no `game` key at all, so a pyramid scene written
 * now is byte for byte what it was before pool existed - an older build on
 * the coach's other device reads it exactly as it always did.
 */
export function tableFor(game: Game, from: TableConfig): TableConfig {
  const g = GAMES[game]
  const base = { lengthMm: g.lengthMm, widthMm: g.widthMm, ballMm: g.ballMm, markings: from.markings, cloth: from.cloth }
  return game === 'pool' ? { game: 'pool', ...base } : base
}
