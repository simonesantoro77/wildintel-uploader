import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Dashboard'
import { formatPeriod } from '../dateFormat'
import { burstProfile, compareMetrics, earlierRevisions, poolOf, referencesOf, revisionName, revisionReference, trendOf } from '../statistics'
import type { Reference, Trend } from '../statistics'
import type { FieldDeployment, StatisticsMetrics, StatisticsRow } from '../types'

const wallIso = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 19)
const n1 = (v: number, digits = 1) => v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
const signed = (v: number, digits = 1) => `${v > 0 ? '+' : ''}${n1(v, digits)}`

/** The tone of a trend: its chip, and its icon. */
export const TREND_TONE: Record<Trend, { chip: string; icon: ReactNode }> = {
  baseline: { chip: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/35', icon: <><path d="M12 2l10 5-10 5L2 7z" /><path d="M2 12l10 5 10-5" /></> },
  higher: { chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40', icon: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" /> },
  stable: { chip: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/40', icon: <path d="M5 12h14" /> },
  peak: { chip: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/45', icon: <><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></> },
  lower: { chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40', icon: <path d="M3 7l6 6 4-4 8 8M15 17h6v-6" /> },
  drop: { chip: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/45', icon: <path d="M3 7l6 6 4-4 8 8M15 17h6v-6" /> },
}

type Base = 'previous' | 'history' | 'peers' | 'global'
const REFERENCES: Record<Base, string> = { previous: 'Previous revision', history: 'Mean of the previous revisions', peers: 'Rest of the revision', global: 'Project mean' }
const REFERENCE_NOTES: Record<Base, string> = { previous: 'The revision before, of this location', history: 'All the earlier ones of this location', peers: 'The other deployments of this revision', global: 'Every other one known' }

const EVOLUTION: { key: keyof StatisticsMetrics; label: string; digits: number }[] = [
  { key: 'images_per_day', label: 'Images per day', digits: 1 },
  { key: 'image_count', label: 'Images', digits: 0 },
  { key: 'sequence_count', label: 'Sequences', digits: 0 },
  { key: 'days', label: 'Length (days)', digits: 1 },
  { key: 'sequence_max', label: 'Longest sequence', digits: 0 },
]

const NOTES: Record<Trend, string> = {
  peak: 'has an extraordinary increase (over +45%), which suggests a concentration of animals or a very sensitive sensor',
  higher: 'shows a sustained rise in activity',
  stable: 'keeps a steady rate, within ±12%',
  lower: 'has a moderate fall in the images a day',
  drop: 'has a sharp fall (below −35%): worth checking the camera angle, the batteries or changes in the habitat',
  baseline: 'is the first revision of its location, so it sets the baseline',
}

/** The comparison of a deployment with what went before it — the revisions before it of its location, or the other deployments —: the six metrics side by side, how its
 * location evolved, and how its bursts compare. Opened from the state of a row; the arrows go to the deployment before and after it. */
export default function StatisticsComparator({ rows, id, field, onNavigate, onClose }: {
  rows: StatisticsRow[]; id: string; field: FieldDeployment | undefined; onNavigate: (id: string) => void; onClose: () => void
}) {
  const row = rows.find((r) => r.deployment_id === id)
  const index = rows.findIndex((r) => r.deployment_id === id)
  const references = useMemo(() => (row ? referencesOf(row, rows) : []), [row, rows])
  const [reference, setReference] = useState<Reference>('previous')
  const [metric, setMetric] = useState<keyof StatisticsMetrics>('images_per_day')

  // the reference a deployment starts from: its previous revision, or the rest of its revision when it is the first
  const first = references[0]
  useEffect(() => { if (first) setReference(first === 'previous' ? 'previous' : 'peers') }, [id, first])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!row) return null

  const before = earlierRevisions(row)
  const specific = reference.startsWith('revision:') ? before.find((r) => `revision:${r.deployment_id}` === reference) : undefined
  const active: Reference = specific ? reference : references.includes(reference) ? reference : references[0]
  const pool = poolOf(row, rows, active)
  const trend = trendOf(row, rows)
  const compared = compareMetrics(row.metrics, pool.metrics)
  const perDay = compared.find((c) => c.key === 'images_per_day')!
  const sequences = compared.find((c) => c.key === 'sequence_count')!
  const bursts = burstProfile([row.metrics]).map((b, i) => ({ ...b, reference: burstProfile(pool.metrics)[i].percent }))
  const evolution = EVOLUTION.find((e) => e.key === metric)!
  const history = row.revisions.map((r) => ({ revision: r.revision, id: r.deployment_id, value: (r.metrics[metric] as number | null) ?? 0, mine: r.deployment_id === id }))
  const top = Math.max(...history.map((h) => h.value), 1)
  const topBurst = Math.max(...bursts.flatMap((b) => [b.percent, b.reference]), 1)
  const prevRow = index > 0 ? rows[index - 1] : null, nextRow = index < rows.length - 1 ? rows[index + 1] : null
  const m = row.metrics
  const chip = TREND_TONE[trend.trend].chip
  const failed = Object.values(row.checks).filter((c) => !c.skipped && !c.ok)   // what Postvalidation found outside the tolerance

  const nav = 'flex items-center gap-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-950/60 px-2.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35'
  const card = 'rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50'
  const diagnostic = trend.trend === 'baseline'
    ? `${row.deployment_id} ${NOTES.baseline}: ${n1(m.images_per_day ?? 0)} images a day and ${n1(m.sequence_count, 0)} sequences. Against ${pool.label.toLowerCase().startsWith('mean') ? pool.label.charAt(0).toLowerCase() + pool.label.slice(1) : pool.label} it is ${signed(perDay.percent)}% in the images a day.`
    : `Against ${pool.label} (${n1(perDay.reference)} images a day), this deployment ${NOTES[trend.trend]} (${signed(perDay.percent)}% in the images a day and ${signed(sequences.percent)}% in the sequences).`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-3 sm:p-5" role="dialog" aria-modal="true" aria-label={`Compare ${id}`}>
      <button type="button" aria-label="Close the comparison" tabIndex={-1} className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative my-auto flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl">
        <div className="flex shrink-0 flex-col gap-3 border-b border-zinc-200 dark:border-zinc-700 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-start gap-3 sm:items-center">
            <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
              <Icon path={<><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 0 1 2 2v7M6 9v12" /></>} className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h5 className="font-mono text-base font-semibold text-zinc-900 dark:text-zinc-100">Compare: {id}</h5>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${chip}`}>
                  <Icon path={TREND_TONE[trend.trend].icon} className="h-3.5 w-3.5" />{trend.label}{trend.trend !== 'baseline' && <span className="font-mono">({signed(trend.percent)}%)</span>}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                Site <span className="font-mono text-blue-600 dark:text-blue-400">{row.location}</span>{field?.card ? ` · SD ${field.card}` : ''}
                {m.first_image !== null && m.last_image !== null ? ` · ${formatPeriod(wallIso(m.first_image), wallIso(m.last_image))}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-center">
            <button type="button" className={nav} disabled={!prevRow} onClick={() => prevRow && onNavigate(prevRow.deployment_id)} aria-label="Previous deployment">‹ <span>Previous</span></button>
            <button type="button" className={nav} disabled={!nextRow} onClick={() => nextRow && onNavigate(nextRow.deployment_id)} aria-label="Next deployment"><span>Next</span> ›</button>
            <button type="button" aria-label="Close" className="ml-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-950/60 p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white" onClick={onClose}>
              <Icon path={<path d="M6 6l12 12M18 6L6 18" />} className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-6 overflow-y-auto p-5 sm:p-6">
          <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
            <div className={`${card} flex flex-col justify-center p-4 lg:col-span-7`}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">Automatic reading</p>
              <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{diagnostic}</p>
              {failed.length > 0 && (
                <ul className="mt-3 space-y-0.5 border-t border-zinc-200 dark:border-zinc-700 pt-3 text-xs text-amber-700 dark:text-amber-400" aria-label={`Why ${id} is to review`}>
                  {failed.map((c) => <li key={c.message}>• {c.message}</li>)}
                </ul>
              )}
            </div>
            <div className={`${card} flex flex-col justify-between gap-2.5 p-4 lg:col-span-5`}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Compared with</p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2" role="group" aria-label="What it is compared with">
                {(references.filter((r): r is Base => !r.startsWith('revision:'))).map((r) => (
                  <button key={r} type="button" aria-pressed={active === r} onClick={() => setReference(r)}
                          className={`rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${active === r ? 'border-blue-500 bg-blue-500/15 font-medium text-zinc-900 dark:text-white' : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'}`}>
                    <span className="block">{REFERENCES[r]}</span>
                    <span className="block text-[10px] opacity-75">{REFERENCE_NOTES[r]}</span>
                  </button>
                ))}
              </div>
              {before.length > 0 && (
                <label className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-xs ${specific ? 'border-blue-500 bg-blue-500/15 font-medium text-zinc-900 dark:text-white' : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400'}`}>
                  <span>A revision of {row.location}</span>
                  <select aria-label={`A revision of ${row.location} to compare with`} value={specific ? specific.deployment_id : ''} onChange={(e) => e.target.value && setReference(revisionReference(e.target.value))}
                          className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-0.5 font-mono text-[11px] text-zinc-900 dark:text-zinc-100">
                    <option value="">Pick one…</option>
                    {before.map((r) => <option key={r.deployment_id} value={r.deployment_id}>{revisionName(r.revision)}</option>)}
                  </select>
                </label>
              )}
            </div>
          </div>

          <div className={`${card} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">The six metrics side by side</p>
              <div className="flex items-center gap-4 text-[11px]">
                <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-blue-500" /><span className="font-mono font-medium">{id}</span></span>
                <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-slate-500" /><span className="text-zinc-500 dark:text-zinc-400">{pool.label}</span></span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs" aria-label={`Comparison of ${id} with ${pool.label}`}>
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    <th scope="col" className="px-4 py-2.5">Metric</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Now</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Reference</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Difference</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Change</th>
                    <th scope="col" className="w-48 px-4 py-2.5">Proportion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {compared.map((c) => {
                    const max = Math.max(c.current, c.reference, 1)
                    const up = c.percent > 2, down = c.percent < -2
                    return (
                      <tr key={c.key} className="hover:bg-zinc-100/70 dark:hover:bg-zinc-800/40">
                        <th scope="row" className="px-4 py-3 text-left font-medium">{c.label}</th>
                        <td className="px-3 py-3 text-right font-mono font-bold text-blue-600 dark:text-blue-400">{n1(c.current, c.digits)} <span className="text-[10px] font-normal text-zinc-500 dark:text-zinc-400">{c.unit}</span></td>
                        <td className="px-3 py-3 text-right font-mono text-zinc-600 dark:text-zinc-300">{n1(c.reference, c.digits)} <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{c.unit}</span></td>
                        <td className="px-3 py-3 text-right font-mono">{signed(c.diff, c.digits)}</td>
                        <td className="px-3 py-3 text-right">
                          <span className={`inline-block rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${up ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : down ? 'border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300' : 'border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300'}`}>{signed(c.percent)}%</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700/60"><div style={{ width: `${(c.current / max) * 100}%` }} className="h-full rounded-full bg-blue-500" /></div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700/60"><div style={{ width: `${(c.reference / max) * 100}%` }} className="h-full rounded-full bg-slate-500" /></div>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className={`${card} flex flex-col justify-between p-4`}>
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h6 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Evolution of {row.location}</h6>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">From its first revision to this one — press an earlier one to compare with it</p>
                </div>
                <select aria-label="Metric of the evolution" value={String(metric)} onChange={(e) => setMetric(e.target.value as keyof StatisticsMetrics)}
                        className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1 text-xs text-zinc-900 dark:text-zinc-100">
                  {EVOLUTION.map((e) => <option key={String(e.key)} value={String(e.key)}>{e.label}</option>)}
                </select>
              </div>
              <div role="group" aria-label={`${evolution.label} of ${row.location}, by revision`} className="flex h-44 items-end justify-around gap-4 border-b border-zinc-300 dark:border-zinc-700 px-4 pb-2 pt-6">
                {history.map((h) => {
                  const pressed = !h.mine && active === revisionReference(h.id) || (!h.mine && active === 'previous' && h.id === before[before.length - 1]?.deployment_id)
                  const bar = (
                    <>
                      <span className={`mb-1.5 font-mono text-xs ${h.mine ? 'font-bold text-blue-600 dark:text-blue-400' : 'text-zinc-600 dark:text-zinc-300'}`}>{n1(h.value, evolution.digits)}</span>
                      <div style={{ height: `${Math.max((h.value / top) * 100, 8)}%` }}
                           className={`w-full max-w-[68px] rounded-t-lg border-x border-t transition-all duration-200 ${h.mine ? 'border-blue-300/50 bg-gradient-to-t from-blue-600 to-blue-400 shadow-[0_0_18px_rgba(37,99,235,0.45)]' : pressed ? 'border-slate-300 bg-slate-500 dark:bg-slate-400' : 'border-zinc-400/40 bg-zinc-300 dark:border-zinc-600 dark:bg-zinc-700 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-600'}`} />
                      <span className={`mt-2 font-mono text-xs font-semibold ${h.mine ? 'text-zinc-900 dark:text-white' : 'text-zinc-500 dark:text-zinc-400'}`}>{revisionName(h.revision)}</span>
                    </>
                  )
                  return h.mine
                    ? <div key={h.id} role="img" aria-label={`${revisionName(h.revision)}: ${n1(h.value, evolution.digits)}`} className="group flex h-full flex-1 flex-col items-center justify-end">{bar}</div>
                    : <button key={h.id} type="button" aria-pressed={pressed} aria-label={`${revisionName(h.revision)}: ${n1(h.value, evolution.digits)}. Compare with it`} title={`Compare with ${revisionName(h.revision)}`} onClick={() => setReference(revisionReference(h.id))}
                              className="group flex h-full flex-1 cursor-pointer flex-col items-center justify-end">{bar}</button>
                })}
              </div>
            </div>

            <div className={`${card} flex flex-col justify-between p-4`}>
              <div className="mb-4 flex items-start justify-between gap-2">
                <div>
                  <h6 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Bursts: now against the reference</h6>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Share of the sequences by how many images they have</p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-[10px]">
                  <span className="flex items-center gap-1"><span aria-hidden="true" className="h-2 w-2 rounded-sm bg-emerald-500" />Now</span>
                  <span className="flex items-center gap-1"><span aria-hidden="true" className="h-2 w-2 rounded-sm bg-slate-500" />Reference</span>
                </div>
              </div>
              <div role="group" aria-label="Profile of the bursts" className="flex h-44 items-end gap-2.5 border-b border-zinc-300 dark:border-zinc-700 px-2 pb-2 pt-6">
                {bursts.map((b) => (
                  <div key={b.label} role="img" aria-label={`${b.label} images: ${n1(b.percent)}% now, ${n1(b.reference)}% in the reference`} className="flex h-full flex-1 flex-col items-center justify-end">
                    <span className="mb-1 font-mono text-[9px] text-emerald-700 dark:text-emerald-300">{n1(b.percent, 0)}%</span>
                    <div className="flex h-full w-full items-end justify-center gap-1">
                      <div style={{ height: `${Math.max((b.percent / topBurst) * 100, b.percent > 0 ? 4 : 0)}%` }} className="w-1/2 max-w-[18px] rounded-t bg-gradient-to-t from-emerald-600 to-emerald-400" />
                      <div style={{ height: `${Math.max((b.reference / topBurst) * 100, b.reference > 0 ? 4 : 0)}%` }} className="w-1/2 max-w-[18px] rounded-t bg-slate-500/80" />
                    </div>
                    <span className="mt-2 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{b.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-zinc-200 dark:border-zinc-700 px-6 py-3.5">
          <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{pool.sub}</span>
          <button type="button" className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700" onClick={onClose}>Close the comparison</button>
        </div>
      </div>
    </div>
  )
}
