import { useState } from 'react'
import type { ReactNode } from 'react'
import { formatDay } from '../dateFormat'
import { compact, sizeBins } from '../statistics'
import type { DailyImages, DailySequences, StatisticsRow } from '../types'

/** One column of a histogram: what it says on the axis (`tick`), in full (`label`) and its value; for the readout that floats over it, more `lines` ([name, value]) and a `list` (a heading and its items). */
export interface Column {
  key: string; tick: string | null; label: string; value: number
  lines?: [string, string][]
  list?: { heading: string; items: [string, string][] }
}

const TONES = {
  blue: { bar: 'from-blue-700/80 to-blue-500/90 border-t border-x border-blue-400/30', hover: 'from-blue-600 to-blue-400 shadow-[0_0_16px_rgba(59,130,246,0.45)]', text: 'text-blue-600 dark:text-blue-400' },
  emerald: { bar: 'from-emerald-700/80 to-emerald-500/90 border-t border-x border-emerald-400/30', hover: 'from-emerald-600 to-emerald-300 shadow-[0_0_16px_rgba(16,185,129,0.45)]', text: 'text-emerald-600 dark:text-emerald-400' },
}
const TAIL = { bar: 'from-amber-600/85 to-amber-400/95 border-t border-x border-amber-300/40', hover: 'from-amber-600 to-amber-300 shadow-[0_0_16px_rgba(245,158,11,0.5)]' }

/** A histogram: a column for each of `columns`, from one baseline, with its number above it. Point at a column, or focus it, for the readout over it; the table has them all.
 * `marker` is a dashed line along the axis (`at`, from 0 to 1) with its label — the mean —; `scale` "log" keeps a few long ones beside many short ones readable. The last
 * column of a "+" bin is the long tail, and is drawn in the amber of what is unusual. `footer` says what the axes are and sums it up. */
export function Columns({ name, title, subtitle, badge, controls, columns, unit, header, scale = 'linear', marker, tone = 'blue', footer, labels = 'auto', flat = false }: {
  name: string; title: string; subtitle?: string; badge?: string; controls?: ReactNode
  columns: Column[]; unit: [string, string]; header: [string, string]
  scale?: 'linear' | 'log'; marker?: { at: number; label: string }; tone?: keyof typeof TONES
  footer?: { left: ReactNode; right?: ReactNode }
  /** The number over each column: "auto" leaves it out when there are many columns, "always" puts it over all — smaller. */
  labels?: 'auto' | 'always'
  /** No card of its own: it is inside one. */
  flat?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const top = Math.max(...columns.map((c) => c.value), 0)
  const max = Math.max(top, 1)
  const log = scale === 'log'
  const height = (v: number) => (v <= 0 ? 0 : Math.max(((log ? Math.log10(v + 1) / Math.log10(max + 1) : v / max) * 100), 4))
  const mid = log ? Math.round(Math.sqrt(max)) : Math.round(max / 2)
  const noun = (n: number) => (n === 1 ? unit[0] : unit[1])
  const many = columns.length > 16
  const dense = many && labels === 'auto'                // many columns: no number over each, and little air between them
  const gap = dense ? 'gap-px' : many ? 'gap-1' : 'gap-2 sm:gap-3'
  const tail = (c: Column) => c.tick !== null && c.tick.endsWith('+') && c.value > 0
  const colors = TONES[tone]
  const side = (i: number) => (i < columns.length / 4 ? 'left-0' : i > (columns.length * 3) / 4 ? 'right-0' : 'left-1/2 -translate-x-1/2')

  return (
    <div className={flat ? 'py-2' : 'break-inside-avoid rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm'}>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h5 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h5>
            {badge && <span className="rounded border border-blue-300/60 dark:border-blue-700/50 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 font-mono text-[11px] text-blue-700 dark:text-blue-300">{badge}</span>}
          </div>
          {subtitle && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
        </div>
        {controls && <div className="flex flex-wrap items-center gap-2 print:hidden">{controls}</div>}
      </div>

      {columns.length === 0 ? <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">Nothing to draw.</p> : (
        <div className="relative select-none pb-2 pt-7" role="group" aria-label={name}>
          <div className={`relative flex h-56 items-end ${gap} border-b border-zinc-300 dark:border-zinc-700 pl-9 pr-2`}>
            <div className="pointer-events-none absolute inset-y-0 left-0 flex flex-col justify-between font-mono text-[10px] text-zinc-500 dark:text-zinc-400" aria-hidden="true">
              <span>{max.toLocaleString('en-US')}</span><span>{mid.toLocaleString('en-US')}</span><span>0</span>
            </div>
            <div className="pointer-events-none absolute left-9 right-2 top-0 border-t border-dashed border-zinc-200 dark:border-zinc-800" />
            <div className="pointer-events-none absolute left-9 right-2 top-1/2 border-t border-dashed border-zinc-200 dark:border-zinc-800" />
            {marker && (
              <div style={{ left: `calc(2.25rem + (100% - 2.75rem) * ${marker.at})` }} aria-label={marker.label} className="pointer-events-none absolute inset-y-0 z-10 border-l-2 border-dashed border-sky-500/80">
                <div className="-translate-x-1/2 -translate-y-6 whitespace-nowrap rounded border border-sky-400/60 bg-sky-100 dark:bg-sky-950/90 px-2 py-0.5 font-mono text-[10px] font-semibold text-sky-800 dark:text-sky-300 shadow">{marker.label}</div>
              </div>
            )}
            {columns.map((c, i) => {
              const on = hover === i
              const fill = tail(c) ? TAIL : colors
              return (
                <div key={c.key} role="img" aria-label={`${c.label}: ${c.value} ${noun(c.value)}`} tabIndex={0} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                     className="relative flex h-full flex-1 cursor-pointer flex-col items-center justify-end outline-none">
                  {!dense && c.value > 0 && <span className={`mb-1 font-mono ${many ? 'text-[9px]' : 'text-[10px]'} ${tail(c) ? 'font-bold text-amber-600 dark:text-amber-400' : on ? 'font-bold text-zinc-900 dark:text-white' : 'text-zinc-500 dark:text-zinc-400'}`}>{many ? compact(c.value) : c.value.toLocaleString('en-US')}</span>}
                  <div style={{ height: `${height(c.value)}%` }} className={`w-full max-w-[6rem] rounded-t-md bg-gradient-to-t transition-all duration-200 ${on ? fill.hover : fill.bar}`} />
                  {on && (
                    <div className={`pointer-events-none absolute bottom-full z-20 mb-3 w-56 rounded-xl border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-950/95 p-3 text-left shadow-2xl ${side(i)}`}>
                      <p className={`font-mono text-xs font-semibold ${tail(c) ? 'text-amber-600 dark:text-amber-400' : colors.text}`}>{c.label}</p>
                      <p className="mt-1.5 text-xs font-bold text-zinc-900 dark:text-white">{c.value.toLocaleString('en-US')} {noun(c.value)}</p>
                      {c.lines?.map(([k, v]) => <p key={k} className="mt-1 flex justify-between gap-2 text-xs"><span className="text-zinc-500 dark:text-zinc-400">{k}:</span><span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">{v}</span></p>)}
                      {c.list && c.list.items.length > 0 && (
                        <div className="mt-2 space-y-1 border-t border-zinc-200 dark:border-zinc-700 pt-2">
                          <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{c.list.heading}</p>
                          {c.list.items.map(([k, v]) => <p key={k} className="flex justify-between gap-2 font-mono text-[10px]"><span className="truncate">{k}</span><span className="text-emerald-600 dark:text-emerald-400">{v}</span></p>)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className={`mt-2 flex ${gap} pl-9 pr-2`} aria-hidden="true">
            {columns.map((c, i) => (
              <div key={c.key} className={`relative h-4 flex-1 text-center font-mono text-[10px] ${hover === i ? 'font-semibold text-zinc-900 dark:text-white' : tail(c) ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                {c.tick !== null && <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">{c.tick}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {footer && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 dark:border-zinc-700 pt-3 text-xs">
          <span className="text-zinc-500 dark:text-zinc-400">{footer.left}</span>
          {footer.right && <span className="font-mono text-[11px] text-sky-700 dark:text-sky-400">{footer.right}</span>}
        </div>
      )}
      <details className="mt-2 text-xs print:hidden">
        <summary className="cursor-pointer text-blue-600 dark:text-blue-400">Table</summary>
        <table className="mt-2 text-sm" aria-label={`${name}, as a table`}>
          <thead><tr className="text-left text-xs text-zinc-500 dark:text-zinc-400"><th scope="col" className="py-1 pr-6 font-medium">{header[0]}</th><th scope="col" className="py-1 text-right font-medium">{header[1]}</th></tr></thead>
          <tbody>{columns.map((c) => <tr key={c.key}><td className="py-0.5 pr-6">{c.label}</td><td className="py-0.5 text-right">{c.value.toLocaleString('en-US')}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  )
}

/** About eight dates along the axis, whatever the number of days: the others have none. */
function dayColumns<T extends { date: string }>(days: T[], value: (d: T) => number): Column[] {
  const every = Math.ceil(days.length / 8)
  return days.map((d, i) => ({ key: d.date, tick: i % every === 0 ? formatDay(d.date, false) : null, label: formatDay(d.date), value: value(d) }))
}

const none = (what: string) => <p className="py-3 text-sm text-zinc-500 dark:text-zinc-400">{what}</p>

/** The images of each calendar day of a deployment: a column for each day, the days with none empty. */
export function ImagesPerDay({ row }: { row: StatisticsRow }) {
  const daily: DailyImages[] = row.metrics.daily ?? []
  if (daily.length === 0) return none('This deployment has no dated images.')
  const peak = Math.max(...daily.map((d) => d.images))
  return (
    <Columns flat name={`Images per day of ${row.deployment_id}`} title="Images of each day" unit={['image', 'images']} header={['Day', 'Images']} columns={dayColumns(daily, (d) => d.images)}
             subtitle={`${daily.length} ${daily.length === 1 ? 'day' : 'days'} from ${formatDay(daily[0].date)} to ${formatDay(daily[daily.length - 1].date)}, up to ${peak.toLocaleString('en-US')} in a day.`} />
  )
}

/** The sequences of a deployment: how many began each calendar day, and how many there are of each size. */
export function SequencesOfDeployment({ row }: { row: StatisticsRow }) {
  const perDay: DailySequences[] = row.metrics.sequences_daily ?? []
  if (perDay.length === 0) return none('This deployment has no dated images, so it has no sequences.')
  const sizes = sizeBins([row])
  return (
    <div className="space-y-2">
      <Columns flat name={`Sequences per day of ${row.deployment_id}`} title="Sequences that began each day" unit={['sequence', 'sequences']} header={['Day', 'Sequences']} columns={dayColumns(perDay, (d) => d.sequences)}
               subtitle={`${row.metrics.sequence_count.toLocaleString('en-US')} in ${perDay.length} ${perDay.length === 1 ? 'day' : 'days'}.`} />
      <Columns flat name={`Sequences by size of ${row.deployment_id}`} title="Sequences by size" subtitle="How many sequences have each number of images." unit={['sequence', 'sequences']} header={['Images in the sequence', 'Sequences']}
               columns={sizes.map((b) => ({ key: b.label, tick: b.label, label: `${b.label} ${b.label === '1' ? 'image' : 'images'} per sequence`, value: b.sequences }))} />
    </div>
  )
}
