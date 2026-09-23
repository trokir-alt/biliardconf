/**
 * The controls that depend on which game the table is for: the game itself,
 * the racks it can be set up with, and - for a selected ball on pool - which
 * of the fifteen it is. Shared by the desktop panel, the phone's sheet and the
 * properties panel, so the three can never disagree.
 */

import { useStore } from '../state/store'
import { GAMES, GAME_ORDER } from '../model/game'
import { poolBall } from '../model/theme'
import type { BallItem } from '../model/types'
import type { PoolRack } from '../lib/place'
import { useGame } from './useGame'

export function GamePicker({ id = 'game' }: { id?: string }) {
  const game = useGame()
  const setGame = useStore((s) => s.setGame)
  return (
    <div className="row row--stack">
      <span className="row__label" id={`${id}-label`}>
        Игра
      </span>
      <span className="seg seg--wide" role="group" aria-labelledby={`${id}-label`}>
        {GAME_ORDER.map((g) => (
          <button
            key={g}
            type="button"
            className="btn seg__btn"
            aria-pressed={game === g}
            title={GAMES[g].label}
            onClick={() => setGame(g)}
          >
            {GAMES[g].short}
          </button>
        ))}
      </span>
    </div>
  )
}

const POOL_RACK_BUTTONS: { rack: PoolRack; label: string }[] = [
  { rack: 8, label: 'Восьмёрка' },
  { rack: 9, label: 'Девятка' },
  { rack: 10, label: 'Десятка' },
]

/** the racks of the current game; `after` runs once one is set, to close a sheet */
export function RackButtons({ after }: { after?: () => void }) {
  const game = useGame()
  const rackPyramid = useStore((s) => s.rackPyramid)
  const rackPool = useStore((s) => s.rackPool)
  if (game === 'pyramid') {
    return (
      <button
        type="button"
        className="btn"
        onClick={() => {
          rackPyramid()
          after?.()
        }}
      >
        Пирамида
      </button>
    )
  }
  return (
    <div className="rack-row" role="group" aria-label="Расстановка пула">
      {POOL_RACK_BUTTONS.map((b) => (
        <button
          key={b.rack}
          type="button"
          className="btn"
          onClick={() => {
            rackPool(b.rack)
            after?.()
          }}
        >
          {b.label}
        </button>
      ))}
    </div>
  )
}

/** one ball of the picker, drawn in CSS the way the canvas draws it */
function PickBall({ n }: { n: number | null }) {
  const look = n === null ? null : poolBall(n)
  const cls = look?.stripe ? 'ballpick__ball ballpick__ball--stripe' : 'ballpick__ball'
  return (
    <span className={cls} style={{ ['--c' as string]: look ? look.colour : '#FFFFFF' }}>
      {n !== null && <span className="ballpick__num">{n}</span>}
    </span>
  )
}

/**
 * Which ball this is on a pool table: the cue ball or one of the fifteen.
 * Two rows of eight, cue ball first, so the solids and the stripes each read
 * as a line of their own.
 */
export function PoolBallPicker({ item }: { item: BallItem }) {
  const setBallNumber = useStore((s) => s.setBallNumber)
  const isCue = item.kind === 'cue'
  const cells: (number | null)[] = [null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
  return (
    <div className="ballpick" role="group" aria-label="Какой шар">
      {cells.map((n) => (
        <button
          key={n ?? 'cue'}
          type="button"
          className="ballpick__btn"
          aria-pressed={n === null ? isCue : !isCue && item.number === n}
          aria-label={n === null ? 'Биток' : `Шар ${n}`}
          title={n === null ? 'Биток' : `Шар ${n}`}
          onClick={() => setBallNumber(item.id, n ?? 'cue')}
        >
          <PickBall n={n} />
        </button>
      ))}
    </div>
  )
}
