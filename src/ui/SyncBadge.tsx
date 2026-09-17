/**
 * Has the work reached the server?
 *
 * The coach has to be able to answer that at a glance before they close the
 * tablet, so the three states the brief names are shown in words, not as a
 * coloured dot that needs explaining.
 */

import { useLibrary } from '../state/library'

const TEXT: Record<string, string> = {
  synced: 'Синхронизировано',
  pending: 'Есть несохранённое',
  offline: 'Нет связи',
}

export function SyncBadge({ compact = false }: { compact?: boolean }) {
  const sync = useLibrary((s) => s.sync)
  const durable = useLibrary((s) => s.durable)
  const label = durable ? TEXT[sync] : 'Хранилище недоступно'
  const state = durable ? sync : 'offline'
  return (
    <span className={`sync sync--${state}`} role="status" title={label}>
      <span className="sync__dot" aria-hidden="true" />
      {!compact && <span className="sync__text">{label}</span>}
    </span>
  )
}
