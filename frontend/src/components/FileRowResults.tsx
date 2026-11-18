import { Fragment, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ActiveFilters, ChevronCell, DetailLine, DetailsRow, MetricsSection, ProgressCard, RevisionSelection, RowOptions, TABLE, TableCard, TableFooter, TableToolbar } from './DashboardParts'
import { Icon, StateCard } from './Dashboard'
import IconButton, { ICON_PATHS } from './IconButton'
import { plural } from './SessionResults'
import { formatLocal } from '../dateFormat'
import SidePanel from './SidePanel'

export interface FileRow {
  row: number
  site: string
  /** The revision the row says it is of, when it says. */
  session?: string
  /** The day and the time (HH:MM) of the visit the row says, when it says and they are valid. */
  date?: string
  time?: string
  /** What the row does, as the dashboard of visits says it (Revision + Desinstallation + Installation); as the file wrote it when it is not valid. */
  actions?: string
  result: 'ok' | 'problem' | 'already_kept' | 'new_site' | 'ignored'
  /** The kind of error — what the rows that share it have in common. Empty for a row that is fine. */
  label?: string
  message: string
  /** What is odd in a row that is added — said, not refused: the visit is kept as the file wrote it. */
  warnings?: string[]
  /** What the row says, by the field of a visit each cell is of — with the defaults filled in. */
  data?: Record<string, string>
}

/** What the pill of a row says, and its colours: ready to add, skipped (already kept, or ignored) or an error — which one it is, its errors tell. */
/** A row that is added, with something odd in it to check. */
const warned = (r: FileRow) => r.result === 'ok' && (r.warnings?.length ?? 0) > 0
const badgeOf = (r: FileRow) => (r.result === 'ok' ? (warned(r) ? 'Add · to check' : 'Add') : r.result === 'already_kept' ? 'Skipped / Existing' : r.result === 'ignored' ? 'Skipped / Ignored' : 'Error')
/** One colour for each thing a row can be, the same in the figures, the filters, the pills and the tables: ready is green, skipped (already kept, ignored) is amber and an error is red. */
type Tone = 'ready' | 'skipped' | 'errors'
const toneKey = (r: FileRow): Tone => (r.result === 'ok' ? 'ready' : r.result === 'already_kept' || r.result === 'ignored' ? 'skipped' : 'errors')
const TONES: Record<Tone, { text: string; pill: string; row: string }> = {
  ready: { text: 'text-emerald-700 dark:text-emerald-400', pill: 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300', row: 'bg-emerald-50 dark:bg-emerald-950/30' },
  skipped: { text: 'text-amber-700 dark:text-amber-400', pill: 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300', row: 'bg-amber-50 dark:bg-amber-950/30' },
  errors: { text: 'text-red-700 dark:text-red-400', pill: 'border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300', row: 'bg-red-50 dark:bg-red-950/30' },
}
/** The colour a row is told in: what it is, but amber for a row that is added with something to check. */
const shownTone = (r: FileRow): Tone => (warned(r) ? 'skipped' : toneKey(r))
const toneOf = (r: FileRow) => TONES[shownTone(r)].pill
const kindOf = (r: FileRow) => (warned(r) ? 'To check' : r.label || 'Problem')
/** What is wrong with a row, as it is said of it: its message, or what is odd in it. */
const saidOf = (r: FileRow) => (warned(r) ? r.warnings!.join(' ') : r.message)

/** How many rows a page of the table has. */
const PER_PAGE = 10

type SortKey = 'row' | 'site' | 'visit' | 'actions' | 'date' | 'status'
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'row', label: 'Row' }, { key: 'visit', label: 'Visit' }, { key: 'site', label: 'Site ID' }, { key: 'actions', label: 'Actions' }, { key: 'date', label: 'When' }, { key: 'status', label: 'Status' },
]

type Filter = 'all' | 'ready' | 'skipped' | 'errors'
/** What a filter keeps — the figures at the top apply them: the rows to add (ready), those left out because they are already kept or ignored (skipped), and those with a problem or a site that is not a location (errors). */
const FILTERS: { value: Filter; keeps: (r: FileRow) => boolean }[] = [
  { value: 'all', keeps: () => true },
  { value: 'ready', keeps: (r) => toneKey(r) === 'ready' },
  { value: 'skipped', keeps: (r) => toneKey(r) === 'skipped' },
  { value: 'errors', keeps: (r) => toneKey(r) === 'errors' },
]

const FILTER_LABEL: Record<Filter, string> = { all: 'All rows', ready: 'Ready', skipped: 'Skipped / Existing', errors: 'With problems' }

/** What became of each row of a file that is read, laid out like the results of the checks of the deployments: the figures, and the rows — each with what
 * went wrong in it — or, by error, each kind of error with the rows that have it, to pick one and see them. */
export default function FileRowResults({ rows: allRows, labels = {} }: {
  rows: FileRow[]
  /** The name of each field of a visit, as it is shown beside what the row says of it. */
  labels?: Record<string, string>
}) {
  const [view, setView] = useState<'row' | 'error'>('row')
  // The revision picked, '' for all of them: the figures and the table are of its rows only.
  const [revision, setRevision] = useState('')
  const [revisionsOpen, setRevisionsOpen] = useState(true)
  const [metricsOpen, setMetricsOpen] = useState(true)
  const rows = revision ? allRows.filter((r) => r.session === revision) : allRows
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const isFlagged = (r: FileRow) => r.result !== 'ok' || warned(r)
  const flagged = rows.filter(isFlagged)
  // The row that is open, and what is shown of it: what it says (its contents) or what is wrong with it (its errors). The first row with errors starts open.
  const [opened, setOpened] = useState<{ row: number; panel: 'contents' | 'errors' } | null>(flagged[0] ? { row: flagged[0].row, panel: 'errors' } : null)
  const [picked, setPicked] = useState<string | null>(null)
  // the row whose eye was pressed: what it says, and what is wrong with it, in a panel at the right
  const [side, setSide] = useState<FileRow | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'row', descending: false })

  const keeps = FILTERS.find((f) => f.value === filter)!.keeps
  // The search: every word typed is somewhere in the row — its number, site, visit, actions, when, what became of it, or what is wrong with it.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (r: FileRow) => {
    const text = [r.row, r.site, r.session, r.actions, r.date, r.time, badgeOf(r), isFlagged(r) ? kindOf(r) : '', r.message, ...(r.warnings ?? [])].join(' ').toLowerCase()
    return words.every((w) => text.includes(w))
  }
  const shown = rows.filter(keeps).filter(matches)
  const sortValue = (r: FileRow, key: SortKey) => (key === 'row' ? r.row : key === 'site' ? r.site.toLowerCase() : key === 'visit' ? r.session ?? '' : key === 'actions' ? r.actions ?? '' : key === 'date' ? `${r.date ?? ''} ${r.time ?? ''}`.trim() : badgeOf(r))
  const sorted = [...shown].sort((a, b) => {
    const x = sortValue(a, sort.key), y = sortValue(b, sort.key)
    const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
    return (sort.descending ? -order : order) || a.row - b.row
  })
  // The table goes ten rows at a time; it starts again from the first page when what it shows changes.
  useEffect(() => setPage(1), [filter, query, sort.key, sort.descending])
  const pages = Math.max(1, Math.ceil(sorted.length / PER_PAGE))
  const current = Math.min(page, pages)
  const onPage = sorted.slice((current - 1) * PER_PAGE, current * PER_PAGE)
  const goTo = (n: number) => { setPage(n); setOpened(null) }
  const shownFlagged = shown.filter(isFlagged)
  const kinds = [...new Set(shownFlagged.map(kindOf))].map((kind) => { const of = shownFlagged.filter((r) => kindOf(r) === kind); return { kind, rows: of, tone: shownTone(of[0]) } })

  // The revisions the file has, newest first — there may be many: the squares are the latest and the older ones are picked from a list.
  const number = (id: string) => Number(id.replace(/\D/g, '')) || 0
  const revisions = [...new Set(allRows.map((r) => r.session).filter((x): x is string => Boolean(x)))].sort((a, b) => number(b) - number(a) || b.localeCompare(a))
  const spanOf = (of: FileRow[]) => { const days = of.map((r) => r.date).filter((d): d is string => Boolean(d)).sort(); return days.length === 0 ? undefined : days[0] === days[days.length - 1] ? days[0] : `${days[0]} → ${days[days.length - 1]}` }
  const clean = (of: FileRow[]) => of.filter((r) => toneKey(r) !== 'errors').length
  const count = (tone: Tone) => rows.filter((r) => toneKey(r) === tone).length
  // The figures of the top: what was read, and what became of it — the colours of the filters and the pills.
  const squares: { filter: Filter; label: string; note: string; count: number; tone: string; badge: string; icon: ReactNode }[] = [
    { filter: 'all', label: 'Rows read', note: 'Every row of the file', count: rows.length, tone: 'text-blue-600 dark:text-blue-400', badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300', icon: <Icon path={<><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></>} className="h-5 w-5" /> },
    { filter: 'ready', label: 'Ready', note: 'New visits', count: count('ready'), tone: TONES.ready.text, badge: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300', icon: <Icon path={<><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></>} className="h-5 w-5" /> },
    { filter: 'skipped', label: 'Skipped / Existing', note: 'Unchanged', count: count('skipped'), tone: TONES.skipped.text, badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300', icon: <Icon path={<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>} className="h-5 w-5" /> },
    { filter: 'errors', label: 'With problems', note: 'Needs attention', count: count('errors'), tone: TONES.errors.text, badge: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300', icon: <Icon path={<><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5M12 16h.01" /></>} className="h-5 w-5" /> },
  ]
  const fine = rows.length - count('errors')

  return (
    <div className="mt-4 mb-5">
      {revisions.length > 0 && (
        <RevisionSelection open={revisionsOpen} onToggle={() => setRevisionsOpen(!revisionsOpen)} hint="Select one to filter the rows of the file"
          all={{ label: 'All revisions', note: `${allRows.length} ${allRows.length === 1 ? 'row' : 'rows'}`, percent: allRows.length ? Math.round((clean(allRows) / allRows.length) * 100) : 0 }} value={revision}
          revisions={revisions.map((id) => { const of = allRows.filter((r) => r.session === id); return { id, label: id, note: `${clean(of)} of ${of.length} ok`, dates: spanOf(of), complete: of.every((r) => toneKey(r) !== 'errors') } })}
          onPick={(id) => { setRevision(id); setPage(1); setOpened(null); setPicked(null) }} />
      )}
      {/* the figures are the filters: the one pressed keeps those rows — pressed again, all of them */}
      <MetricsSection label="Rows by result" open={metricsOpen} onToggle={() => setMetricsOpen(!metricsOpen)} hint="Click a card to filter the table by result">
        <ProgressCard percent={rows.length ? Math.round((fine / rows.length) * 100) : 0} done={fine} total={rows.length} barLabel="Rows without problems"
          caption={`${count('errors')} ${count('errors') === 1 ? 'row' : 'rows'} with problems`}
          segments={(['ready', 'skipped', 'errors'] as Tone[]).map((t) => ({ width: rows.length ? (count(t) / rows.length) * 100 : 0, className: t === 'ready' ? 'bg-emerald-500' : t === 'skipped' ? 'bg-amber-500' : 'bg-red-500' }))} />
        {squares.map((q) => (
          <StateCard key={q.label} label={q.label} note={q.note} count={q.count} tone={q.tone} badge={q.badge} icon={q.icon} pressed={filter === q.filter}
                     onPress={() => { setFilter(filter === q.filter ? 'all' : q.filter); setOpened(null) }} />
        ))}
      </MetricsSection>

      <TableCard label="Results of the file">
        <TableToolbar searchLabel="Search the rows" placeholder="Search by row, site, visit, action…" text={query} onText={(t) => { setQuery(t); setOpened(null) }}
          choice={{ label: 'Group by', value: view, onChange: (v) => { setView(v as 'row' | 'error'); setOpened(null) }, options: [{ value: 'row', label: 'Row' }, { value: 'error', label: 'Error' }], all: null }}
          onReset={() => { setQuery(''); setFilter('all'); setRevision(''); setView('row'); setSort({ key: 'row', descending: false }); setOpened(null); setPicked(null) }} />
        <ActiveFilters
          filters={[{ label: `Revision: ${revision || 'All'}`, tone: 'blue' }, { label: `Group by: ${view === 'row' ? 'Row' : 'Error'}`, tone: 'blue' }, { label: `Show: ${FILTER_LABEL[filter]}`, tone: 'green' }, ...(query.trim() ? [{ label: `Search: ${query.trim()}`, tone: 'blue' as const }] : [])]}
          summary={`${shown.length} of ${rows.length} rows match`} />

        {view === 'error' ? (
          kinds.length === 0 ? <p className="px-4 py-4 text-sm text-zinc-600 dark:text-zinc-400">No row has errors.</p> : (
            <div className="overflow-x-auto">
              <table className={TABLE.table} aria-label="Errors of the file">
                <thead className={TABLE.head}>
                  <tr>
                    <th scope="col" className="w-10 px-2 py-3"><span className="sr-only">Details</span></th>
                    {['Error', 'Rows'].map((h) => <th key={h} scope="col" className={TABLE.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody className={TABLE.body}>
                  {kinds.map(({ kind, rows: of, tone }) => (
                    <Fragment key={kind}>
                      <tr className={TABLE.row(picked === kind)}>
                        <ChevronCell open={picked === kind} label={`the rows with ${kind}`} onToggle={() => setPicked(picked === kind ? null : kind)} />
                        <td className={`px-4 py-3 font-semibold ${TONES[tone].text}`}>{kind}</td>
                        <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{plural(of.length, 'row', 'rows')}</td>
                      </tr>
                      {picked === kind && (
                        <DetailsRow colSpan={3}>
                          <table className="w-full text-sm" aria-label={`Rows with ${kind}`}>
                            <thead className="text-xs text-zinc-500 dark:text-zinc-400">
                              <tr>{['Row', 'Revision', 'Site', 'What went wrong'].map((h) => <th key={h} scope="col" className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                              {of.map((r) => (
                                <tr key={r.row} className="align-top">
                                  <td className="px-3 py-2 font-mono">{r.row}</td>
                                  <td className="px-3 py-2 font-mono">{r.session || '—'}</td>
                                  <td className="px-3 py-2 font-mono">{r.site || '—'}</td>
                                  <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{saidOf(r)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </DetailsRow>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className={TABLE.table} aria-label="Rows of the file">
                <thead className={TABLE.head}>
                  <tr>
                    <th scope="col" className="w-10 px-2 py-3"><span className="sr-only">Details</span></th>
                    {COLUMNS.map((c) => (
                      <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.descending ? 'descending' : 'ascending') : 'none'} className={TABLE.th}>
                        <button type="button" aria-label={`Sort by ${c.label}`} className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => setSort((now) => ({ key: c.key, descending: now.key === c.key && !now.descending }))}>
                          {c.label}
                          <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-3.5 w-3.5 fill-none stroke-current ${sort.key === c.key ? 'text-blue-500' : 'text-zinc-400 dark:text-zinc-600'}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            {sort.key === c.key ? (sort.descending ? <path d="M12 5v14M6 13l6 6 6-6" /> : <path d="M12 19V5M6 11l6-6 6 6" />) : <path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4" />}
                          </svg>
                        </button>
                      </th>
                    ))}
                    <th scope="col" className="px-4 py-3"><span className="sr-only">Options</span></th>
                  </tr>
                </thead>
                <tbody className={TABLE.body}>
                  {onPage.map((r) => {
                    const panel = opened?.row === r.row ? opened.panel : null
                    const name = `Row ${r.row}`
                    return (
                      <Fragment key={r.row}>
                        <tr className={TABLE.row(panel !== null)}>
                          {/* the chevron opens the details of the row — what is wrong with it, when something is; what it says, when it is fine — and marks it while they are open, as in the dashboard */}
                          <ChevronCell open={panel !== null} label={isFlagged(r) ? `the errors of ${name}` : `the contents of ${name}`}
                                       onToggle={() => (panel ? setOpened(null) : setOpened({ row: r.row, panel: isFlagged(r) ? 'errors' : 'contents' }))} />
                          <td className="whitespace-nowrap px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-100">{r.row}</td>
                          <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-zinc-900 dark:text-zinc-200">{r.session || '—'}</td>
                          <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-zinc-900 dark:text-zinc-200">{r.site || '—'}</td>
                          <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{r.actions || '—'}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-zinc-700 dark:text-zinc-300">{r.date ? formatLocal(r.time ? `${r.date}T${r.time}` : r.date) : '—'}</td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${toneOf(r)}`}>
                              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
                              {badgeOf(r)}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <RowOptions label={`Options of ${name}`}>
                              <IconButton compact label={`View the contents of ${name}`} title="View what the row says" expanded={side?.row === r.row} onClick={() => setSide(r)} path={ICON_PATHS.view} />
                            </RowOptions>
                          </td>
                        </tr>
                        {panel && (
                          <DetailsRow colSpan={COLUMNS.length + 2}>
                            {panel === 'errors' ? (
                              <table className="w-full text-sm" aria-label={`Problems of ${name}`}>
                                <thead className="text-xs text-zinc-500 dark:text-zinc-400">
                                  <tr>{['Error', 'What went wrong'].map((h) => <th key={h} scope="col" className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                                  {/* a row that is not added says what is wrong; one that is, each thing to check in it */}
                                  {(warned(r) ? r.warnings! : [r.message]).map((message, i) => (
                                    <tr key={i} className="align-top">
                                      <td className={`px-3 py-2 font-semibold ${TONES[shownTone(r)].text}`}>{kindOf(r)}</td>
                                      <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{message}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <>
                                {r.result === 'ok' && r.message && <p className="mb-3 text-xs text-zinc-600 dark:text-zinc-400">{r.message}</p>}
                                {Object.keys(r.data ?? {}).length > 0 ? (
                                  <dl aria-label={`Contents of ${name}`} className="grid grid-cols-1 gap-x-8 gap-y-2 text-xs md:grid-cols-2">
                                    {Object.entries(r.data!).map(([field, value]) => (
                                      <DetailLine key={field} name={labels[field] ?? field} kind="mono">{value}</DetailLine>
                                    ))}
                                  </dl>
                                ) : <p className="text-sm text-zinc-600 dark:text-zinc-400">The row has no contents.</p>}
                              </>
                            )}
                          </DetailsRow>
                        )}
                      </Fragment>
                    )
                  })}
                  {sorted.length === 0 && <tr><td colSpan={COLUMNS.length + 2} className="px-4 py-3 text-zinc-500 dark:text-zinc-400">No row matches.</td></tr>}
                </tbody>
              </table>
            </div>
            {sorted.length > 0 && (
              <TableFooter from={(current - 1) * PER_PAGE + 1} to={Math.min(current * PER_PAGE, sorted.length)} total={sorted.length} noun="rows" page={current} pages={pages} onPage={goTo} />
            )}
          </>
        )}
      </TableCard>
      {side && (
        <SidePanel label={`Details of row ${side.row}`} title={`Row ${side.row}`} subtitle={[side.session, side.site].filter(Boolean).join(' · ') || undefined} onClose={() => setSide(null)}>
          {(isFlagged(side) || warned(side)) && (
            <section aria-label={`Problems of row ${side.row}`} className="mb-4">
              <h5 className={`mb-2 text-sm font-semibold ${TONES[shownTone(side)].text}`}>{kindOf(side)}</h5>
              <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
                {(warned(side) ? side.warnings! : [side.message]).map((message, i) => <li key={i}>{message}</li>)}
              </ul>
            </section>
          )}
          {side.result === 'ok' && side.message && !warned(side) && <p className="mb-3 text-xs text-zinc-600 dark:text-zinc-400">{side.message}</p>}
          {Object.keys(side.data ?? {}).length > 0 ? (
            <dl aria-label={`Contents of row ${side.row}`} className="grid grid-cols-1 gap-y-2 text-xs">
              {Object.entries(side.data!).map(([field, value]) => (
                <DetailLine key={field} name={labels[field] ?? field} kind="mono">{value}</DetailLine>
              ))}
            </dl>
          ) : <p className="text-sm text-zinc-600 dark:text-zinc-400">The row has no contents.</p>}
        </SidePanel>
      )}
    </div>
  )
}
