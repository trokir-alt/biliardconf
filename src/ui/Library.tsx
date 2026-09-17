/**
 * The library: every exercise, the trash, and the daily snapshots.
 *
 * One screen for both the desktop and the phone. The layout is a grid that
 * collapses to one column, because the content is identical and a second
 * implementation of a list is a second set of bugs in it.
 *
 * Thumbnails come from whatever this device has cached. A row without one
 * shows the title and the object count instead - never a spinner, because a
 * missing picture must not make the list look like it is still loading.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLibrary } from '../state/library'
import { allPreviews, type LocalMeta, type PreviewRow } from '../sync/local'
import {
  buildBackup,
  downloadJson,
  readSnapshot,
  restoreFromSnapshot,
  snapshotDays,
  type SnapshotBody,
} from '../sync/snapshots'
import { syncNow } from '../sync/engine'
import { SyncBadge } from './SyncBadge'

type Tab = 'items' | 'trash' | 'snapshots'

const pad = (n: number) => String(n).padStart(2, '0')

function when(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const today = new Date()
  const sameDay =
    d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return sameDay ? `сегодня в ${time}` : `${pad(d.getDate())}.${pad(d.getMonth() + 1)} в ${time}`
}

const plural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ${few}`
  return `${n} ${many}`
}

function Thumb({ data, count }: { data?: string; count: number }) {
  if (data) return <img className="lib-card__thumb" src={data} alt="" loading="lazy" />
  return (
    <div className="lib-card__thumb lib-card__thumb--empty" aria-hidden="true">
      <span>{plural(count, 'объект', 'объекта', 'объектов')}</span>
    </div>
  )
}

export function Library({ onClose }: { onClose: () => void }) {
  const items = useLibrary((s) => s.items)
  const currentId = useLibrary((s) => s.currentId)
  const uploaded = useLibrary((s) => s.uploaded)
  const durable = useLibrary((s) => s.durable)
  const lastProblem = useLibrary((s) => s.lastProblem)
  const lastConflict = useLibrary((s) => s.lastConflict)
  const commitNow = useLibrary((s) => s.commitNow)
  const open = useLibrary((s) => s.open)
  const createNew = useLibrary((s) => s.createNew)
  const rename = useLibrary((s) => s.rename)
  const duplicate = useLibrary((s) => s.duplicate)
  const remove = useLibrary((s) => s.remove)
  const restore = useLibrary((s) => s.restore)
  const refresh = useLibrary((s) => s.refresh)
  const noteConflict = useLibrary((s) => s.noteConflict)
  const noteProblem = useLibrary((s) => s.noteProblem)

  const [tab, setTab] = useState<Tab>('items')
  const [query, setQuery] = useState('')
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [note, setNote] = useState<string | null>(null)

  /* the exercise on screen becomes a row here, thumbnail and all */
  useEffect(() => {
    void (async () => {
      await commitNow(true)
      const rows: PreviewRow[] = await allPreviews()
      const map: Record<string, string> = {}
      for (const r of rows) map[r.id] = r.data
      setPreviews(map)
      await refresh()
    })()
    // the notices below are shown once: the coach has read them by the time
    // they close this screen, and a banner that never goes away is furniture
    return () => {
      noteConflict(null)
      noteProblem(null)
    }
  }, [commitNow, refresh, noteConflict, noteProblem])

  const alive = useMemo(() => items.filter((m) => m.deletedAt === null), [items])
  const queued = useMemo(() => items.filter((m) => m.dirty === 1).length, [items])
  const trashed = useMemo(() => items.filter((m) => m.deletedAt !== null), [items])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? alive.filter((m) => m.title.toLowerCase().includes(q)) : alive
  }, [alive, query])

  const askRename = useCallback(
    (m: LocalMeta) => {
      const next = window.prompt('Название упражнения', m.title)
      if (next !== null) void rename(m.id, next.trim() || 'Без названия')
    },
    [rename],
  )

  const askRemove = useCallback(
    (m: LocalMeta) => {
      if (window.confirm(`Удалить «${m.title}»? Оно останется в корзине 30 дней.`)) void remove(m.id)
    },
    [remove],
  )

  const saveBackup = useCallback(async () => {
    const { body, source, serverEmpty } = await buildBackup()
    const d = new Date()
    downloadJson(body, `biliardconf-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`)
    setNote(
      serverEmpty
        ? 'На сервере пусто — выгружено с этого устройства. В файле есть диагностика обмена.'
        : source === 'server'
          ? 'Выгружено с сервера'
          : 'Сервер недоступен, выгружено с устройства',
    )
  }, [])

  return (
    <div className="library" role="dialog" aria-modal="true" aria-label="Библиотека упражнений">
      <header className="library__head">
        <h2 className="library__title">Библиотека</h2>
        <SyncBadge />
        <button type="button" className="btn btn--icon" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
      </header>

      <nav className="library__tabs" role="tablist">
        <button type="button" role="tab" className="btn seg__btn" aria-pressed={tab === 'items'} onClick={() => setTab('items')}>
          Упражнения <span className="library__count">{alive.length}</span>
        </button>
        <button type="button" role="tab" className="btn seg__btn" aria-pressed={tab === 'trash'} onClick={() => setTab('trash')}>
          Корзина <span className="library__count">{trashed.length}</span>
        </button>
        <button type="button" role="tab" className="btn seg__btn" aria-pressed={tab === 'snapshots'} onClick={() => setTab('snapshots')}>
          Снимки
        </button>
      </nav>

      {!durable && (
        <p className="library__warn">
          Браузер не дал сохранить библиотеку на устройстве. Упражнения уйдут на сервер, но локально не переживут
          закрытие вкладки.
        </p>
      )}
      {queued > 0 && (
        <p className="library__note">
          Ждёт отправки на сервер: {plural(queued, 'упражнение', 'упражнения', 'упражнений')}
        </p>
      )}
      {lastProblem && <p className="library__warn">{lastProblem}</p>}
      {lastConflict && (
        <p className="library__note">
          Это упражнение правили на двух устройствах. Обе версии на месте, вторая лежит рядом как «{lastConflict}».
        </p>
      )}
      {uploaded !== null && uploaded > 0 && (
        <p className="library__note">Перенесено на сервер: {plural(uploaded, 'упражнение', 'упражнения', 'упражнений')}</p>
      )}
      {note && <p className="library__note">{note}</p>}

      <div className="library__body">
        {tab === 'items' && (
          <>
            <div className="library__toolbar">
              <input
                className="input"
                type="search"
                placeholder="Поиск по названию"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Поиск по названию"
              />
              <button type="button" className="btn btn--primary" onClick={() => void createNew().then(onClose)}>
                Новое упражнение
              </button>
            </div>
            {shown.length === 0 ? (
              <p className="library__empty">
                {alive.length === 0 ? 'Пока пусто. Нарисуйте упражнение - оно появится здесь.' : 'Ничего не нашлось.'}
              </p>
            ) : (
              <ul className="lib-grid">
                {shown.map((m) => (
                  <li key={m.id} className={m.id === currentId ? 'lib-card is-open' : 'lib-card'}>
                    <button
                      type="button"
                      className="lib-card__main"
                      onClick={() => void open(m.id).then(onClose)}
                      title={`Открыть «${m.title}»`}
                    >
                      <Thumb data={previews[m.id]} count={m.itemCount} />
                      <span className="lib-card__title">{m.title}</span>
                      <span className="lib-card__meta">
                        {when(m.clientUpdatedAt)}
                        {m.dirty === 1 && <span className="lib-card__flag">не отправлено</span>}
                      </span>
                    </button>
                    <div className="lib-card__actions">
                      <button type="button" className="btn btn--small" onClick={() => askRename(m)}>
                        Переименовать
                      </button>
                      <button type="button" className="btn btn--small" onClick={() => void duplicate(m.id)}>
                        Дублировать
                      </button>
                      <button type="button" className="btn btn--small btn--danger" onClick={() => askRemove(m)}>
                        Удалить
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === 'trash' && (
          <>
            <p className="library__hint">Удалённое лежит здесь 30 дней, потом исчезает и с сервера.</p>
            {trashed.length === 0 ? (
              <p className="library__empty">Корзина пуста.</p>
            ) : (
              <ul className="lib-list">
                {trashed.map((m) => (
                  <li key={m.id} className="lib-row">
                    <span className="lib-row__title">{m.title}</span>
                    <span className="lib-row__meta">удалено {when(m.deletedAt ?? 0)}</span>
                    <button type="button" className="btn btn--small" onClick={() => void restore(m.id)}>
                      Восстановить
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === 'snapshots' && <Snapshots onDone={(text) => { setNote(text); void refresh(); syncNow() }} />}
      </div>

      <footer className="library__foot">
        <button type="button" className="btn" onClick={() => void saveBackup()}>
          Выгрузить в файл
        </button>
        <button type="button" className="btn" onClick={() => syncNow()}>
          Синхронизировать сейчас
        </button>
      </footer>
    </div>
  )
}

/* ------------------------------------------------------------ snapshots */

function Snapshots({ onDone }: { onDone: (text: string) => void }) {
  const [days, setDays] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const [body, setBody] = useState<SnapshotBody | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        setDays(await snapshotDays())
      } catch {
        setError('Снимки недоступны: нет связи с сервером.')
      }
    })()
  }, [])

  const openDay = useCallback(async (d: string) => {
    setDay(d)
    setBody(null)
    setPicked(new Set())
    try {
      setBody(await readSnapshot(d))
    } catch {
      setError('Не удалось прочитать снимок.')
    }
  }, [])

  const doRestore = useCallback(
    async (ids: string[] | 'all') => {
      if (!body) return
      const what = ids === 'all' ? `весь снимок за ${body.day}` : plural(ids.length, 'упражнение', 'упражнения', 'упражнений')
      if (!window.confirm(`Восстановить ${what}? Текущие версии сохранятся копиями.`)) return
      setBusy(true)
      try {
        const res = await restoreFromSnapshot(body, ids)
        onDone(
          `Восстановлено: ${res.restored}. Прежние версии сохранены копиями: ${res.parked}.`,
        )
      } finally {
        setBusy(false)
      }
    },
    [body, onDone],
  )

  if (error && !days) return <p className="library__empty">{error}</p>
  if (!days) return <p className="library__empty">Загружаю список снимков…</p>
  if (days.length === 0) return <p className="library__empty">Снимков пока нет. Первый появится следующей ночью.</p>

  return (
    <div className="snap">
      <p className="library__hint">
        Раз в сутки вся библиотека записывается целиком. Выберите дату, посмотрите состав и верните что нужно.
      </p>
      <div className="snap__days">
        {days.map((d) => (
          <button key={d} type="button" className="btn btn--small" aria-pressed={d === day} onClick={() => void openDay(d)}>
            {d}
          </button>
        ))}
      </div>
      {day && !body && <p className="library__empty">Читаю снимок за {day}…</p>}
      {body && (
        <>
          <div className="snap__head">
            <span>
              {body.day}: {plural(body.records.length, 'упражнение', 'упражнения', 'упражнений')}
            </span>
            <button type="button" className="btn btn--small" disabled={busy} onClick={() => void doRestore('all')}>
              Восстановить всё
            </button>
            <button
              type="button"
              className="btn btn--small"
              disabled={busy || picked.size === 0}
              onClick={() => void doRestore([...picked])}
            >
              Восстановить выбранные
            </button>
          </div>
          <ul className="lib-list">
            {body.records.map((r) => (
              <li key={r.id} className="lib-row">
                <label className="lib-row__pick">
                  <input
                    type="checkbox"
                    checked={picked.has(r.id)}
                    onChange={(e) => {
                      const next = new Set(picked)
                      if (e.target.checked) next.add(r.id)
                      else next.delete(r.id)
                      setPicked(next)
                    }}
                  />
                  <span className="lib-row__title">{r.title || 'Без названия'}</span>
                </label>
                <span className="lib-row__meta">
                  {plural(r.itemCount, 'объект', 'объекта', 'объектов')}
                  {r.deletedAt !== null && ' · было в корзине'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
