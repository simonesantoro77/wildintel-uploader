import { Mark, StatusIcon } from './Notice'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { Report, ReportEntry } from '../types'
import { btnOutline } from '../pages/ImportDeploymentPage'

const PER_PAGE = { grid: 8, list: 20 } as const

type Sort = 'name' | 'name-desc' | 'newest' | 'oldest'
type View = 'grid' | 'list'

const formatTaken = (iso?: string) => (iso ? iso.replace('T', ' ').slice(0, 19) : 'date unknown')

/** The picture of a failed image — or a placeholder when it can't be shown (a corrupted file, for one). */
function Thumbnail({ reportId, path, size = 'thumb', className }: { reportId: string; path: string; size?: 'thumb' | 'large'; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <div className={`flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 text-xs ${className ?? ''}`} aria-label="No preview">🖼️ no preview</div>
  }
  return <img src={api.reportImageUrl(reportId, path, size)} alt={path} loading="lazy" onError={() => setFailed(true)} className={`object-cover bg-zinc-100 dark:bg-zinc-800 ${className ?? ''}`} />
}

/** Everything the report says of one image: what failed and what passed, and a big picture. */
function ImageDetails({ report, path, onClose }: { report: Report; path: string; onClose: () => void }) {
  const entries = report.entries.filter((e) => e.identifier === path)
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Details of ${path}`} className="max-h-full w-full overflow-y-auto rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-4"
           style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="font-mono text-sm font-semibold break-all text-zinc-900 dark:text-zinc-100">{path}</h4>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{formatTaken(entries.find((e) => e.taken)?.taken)}</p>
          </div>
          <button type="button" className={`${btnOutline} !px-3 !py-1.5`} onClick={onClose}>Close</button>
        </div>
        <Thumbnail reportId={report.id} path={path} size="large" className="mt-3 w-full max-h-96 rounded" />
        <ul className="mt-3 space-y-1 text-sm">
          {entries.map((e, i) => (
            <li key={`${e.check}|${i}`} className="flex gap-2">
              <StatusIcon kind={e.status === 'ok' ? 'success' : 'warning'} className={`h-4 w-4 mt-0.5 ${e.status === 'ok' ? 'text-emerald-500' : 'text-amber-500'}`} />
              <span><strong>{report.checks[e.check]?.label ?? e.check}</strong> — <span className={e.status === 'ok' ? 'text-zinc-500 dark:text-zinc-400' : 'text-amber-700 dark:text-amber-400'}>{e.message}</span></span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** The images that failed one check: to search, filter, sort and page through, as pictures or as a list. */
export default function CheckFailures({ report, check, parent = 'Validation', onBack }: { report: Report; check: string; parent?: string; onBack: () => void }) {
  const info = report.checks[check]
  const failures = useMemo(() => report.entries.filter((e) => e.check === check && e.status === 'failed'), [report, check])
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState<Sort>('name')
  const [view, setView] = useState<View>('grid')
  const [page, setPage] = useState(1)
  const [details, setDetails] = useState<string | null>(null)

  useEffect(() => { setSearch(''); setTag(''); setPage(1) }, [check])

  const tags = useMemo(() => [...new Set(failures.map((e) => e.tag).filter((t): t is string => Boolean(t)))].sort(), [failures])
  const shown = useMemo(() => {
    const wanted = failures.filter((e) => (!tag || e.tag === tag) && e.identifier.toLowerCase().includes(search.trim().toLowerCase()))
    const byName = (a: ReportEntry, b: ReportEntry) => a.identifier.localeCompare(b.identifier, undefined, { numeric: true })
    const byDate = (a: ReportEntry, b: ReportEntry) => (a.taken ?? '').localeCompare(b.taken ?? '')
    return [...wanted].sort(sort === 'name' ? byName : sort === 'name-desc' ? (a, b) => byName(b, a) : sort === 'oldest' ? byDate : (a, b) => byDate(b, a))
  }, [failures, search, tag, sort])

  const perPage = PER_PAGE[view]
  const pages = Math.max(1, Math.ceil(shown.length / perPage))
  const current = Math.min(page, pages)
  const visible = shown.slice((current - 1) * perPage, current * perPage)
  const select = 'text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2 py-1.5'

  return (
    <section aria-label={`Failures of ${info?.label ?? check}`} className="mt-6 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
      <nav className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 mb-3" aria-label="Breadcrumb">
        <button type="button" className="hover:underline" onClick={onBack}>← {parent}</button><span aria-hidden="true">›</span><span className="text-zinc-900 dark:text-zinc-100">{info?.label ?? check}</span>
      </nav>
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <h4 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{info?.label ?? check}</h4>
        <span className="text-xs font-semibold px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
          {failures.length} failure{failures.length === 1 ? '' : 's'}
        </span>
      </div>

      {info?.scope === 'deployment' ? (
        <ul className="space-y-2 text-sm">
          {failures.map((e, i) => <li key={i} className="text-amber-700 dark:text-amber-400"><Mark kind="warning" />{e.message}</li>)}
        </ul>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <input type="search" aria-label="Search by filename" placeholder="Search by filename…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                   className={`${select} flex-1 min-w-[12rem]`} />
            <select aria-label="Filter by error" className={select} value={tag} onChange={(e) => { setTag(e.target.value); setPage(1) }}>
              <option value="">All errors</option>
              {tags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select aria-label="Sort" className={select} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="name">Name A–Z</option><option value="name-desc">Name Z–A</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option>
            </select>
            <div className="inline-flex rounded border border-zinc-300 dark:border-zinc-600 overflow-hidden" role="group" aria-label="View">
              {(['grid', 'list'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={view === v} aria-label={v === 'grid' ? 'Grid view' : 'List view'} onClick={() => { setView(v); setPage(1) }}
                        className={`px-3 py-1.5 text-sm ${view === v ? 'bg-blue-600 text-white' : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'}`}>{v === 'grid' ? '▦' : '☰'}</button>
              ))}
            </div>
          </div>

          {shown.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">No image matches.</p>}

          {view === 'grid' ? (
            <ul className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))' }}>
              {visible.map((e) => (
                <li key={e.identifier} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-2 text-xs">
                  <Thumbnail reportId={report.id} path={e.identifier} className="w-full h-28 rounded" />
                  {e.tag && <span className="inline-block mt-2 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300"><Mark kind="warning" />{e.tag}</span>}
                  <p className="mt-1.5 font-mono text-sm break-all text-zinc-900 dark:text-zinc-100">{e.identifier}</p>
                  <p className="text-zinc-500 dark:text-zinc-400">{formatTaken(e.taken)}</p>
                  <button type="button" className="mt-2 w-full rounded border border-blue-500 text-blue-600 dark:text-blue-400 py-1 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                          aria-label={`View details of ${e.identifier}`} onClick={() => setDetails(e.identifier)}>View details</button>
                </li>
              ))}
            </ul>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-zinc-500 dark:text-zinc-400"><th className="py-1 font-medium">Image</th><th className="py-1 font-medium">What failed</th><th className="py-1 font-medium">Taken</th><th /></tr></thead>
              <tbody>
                {visible.map((e) => (
                  <tr key={e.identifier} className="border-t border-zinc-200 dark:border-zinc-800 align-top">
                    <td className="py-1.5 font-mono break-all">{e.identifier}</td>
                    <td className="py-1.5 text-amber-700 dark:text-amber-400">{e.message}</td>
                    <td className="py-1.5 text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{formatTaken(e.taken)}</td>
                    <td className="py-1.5 text-right"><button type="button" className="text-blue-600 dark:text-blue-400 hover:underline" aria-label={`View details of ${e.identifier}`} onClick={() => setDetails(e.identifier)}>View details</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {pages > 1 && (
            <nav className="mt-4 flex items-center justify-center gap-1 text-sm" aria-label="Pages">
              <button type="button" className={`${btnOutline} !px-2.5 !py-1`} aria-label="Previous page" disabled={current === 1} onClick={() => setPage(current - 1)}>‹</button>
              {pageNumbers(current, pages).map((n, i) => n === null
                ? <span key={`gap${i}`} className="px-1 text-zinc-400">…</span>
                : <button key={n} type="button" aria-label={`Page ${n}`} aria-current={n === current ? 'page' : undefined} onClick={() => setPage(n)}
                          className={`px-2.5 py-1 rounded ${n === current ? 'bg-blue-600 text-white' : 'border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300'}`}>{n}</button>)}
              <button type="button" className={`${btnOutline} !px-2.5 !py-1`} aria-label="Next page" disabled={current === pages} onClick={() => setPage(current + 1)}>›</button>
            </nav>
          )}
        </>
      )}
      {details && <ImageDetails report={report} path={details} onClose={() => setDetails(null)} />}
    </section>
  )
}

/** The page buttons to show: the first, the last and a few around the current one, with gaps (null) between. */
export function pageNumbers(current: number, pages: number): (number | null)[] {
  const wanted = new Set([1, 2, current - 1, current, current + 1, pages].filter((n) => n >= 1 && n <= pages))
  const sorted = [...wanted].sort((a, b) => a - b)
  return sorted.flatMap((n, i) => (i > 0 && n - sorted[i - 1] > 1 ? [null, n] : [n]))
}
