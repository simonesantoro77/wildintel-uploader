import type { ReactNode } from 'react'
import { formatDay } from '../dateFormat'

/** Where the period of a deployment comes from: Epicollect5, the collection's timestamp log, the images' EXIF data — in that order of
 * preference — or typed by hand, the only one that lets it be edited. */
export type DateSource = 'exif' | 'epicollect' | 'log' | 'manual'
export const SOURCE_ORDER: DateSource[] = ['epicollect', 'log', 'exif', 'manual']
export const SOURCE_LABELS: Record<DateSource, string> = { exif: 'Camera metadata (EXIF)', epicollect: 'Epicollect5', log: 'Timestamp log file', manual: 'Manual entry' }

export interface Period { start: string | null; end: string | null }

const asUtc = (local: string) => Date.parse(`${local.slice(0, 19)}Z`)

/** "1 day 45 min" — the span between two local date-times (their offsets are ignored: both are in the same timezone). */
export function spanBetween(from: string, to: string): string | null {
  const ms = asUtc(to) - asUtc(from)
  if (!Number.isFinite(ms)) return null
  const minutes = Math.round(Math.abs(ms) / 60000)
  const days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), mins = minutes % 60
  const parts = [days && `${days} ${days === 1 ? 'day' : 'days'}`, hours && `${hours} h`, mins && `${mins} min`].filter(Boolean)
  return parts.length ? parts.join(' ') : '0 min'
}

/** "Starts 2 min before the first photo and ends 4 min after the last." — a period against the one the photos say. */
export function against(period: Period, exif: Period): string | null {
  if (!period.start || !period.end || !exif.start || !exif.end) return null
  const startsBefore = asUtc(exif.start) >= asUtc(period.start), endsAfter = asUtc(period.end) >= asUtc(exif.end)
  return `Starts ${spanBetween(period.start, exif.start)} ${startsBefore ? 'before' : 'after'} the first photo and ends ${spanBetween(exif.end, period.end)} ${endsAfter ? 'after' : 'before'} the last.`
}

const periodText = (p: Period) => (p.start ? `${formatDay(p.start)}, ${p.start.slice(11, 16)} → ${p.end ? `${formatDay(p.end)}, ${p.end.slice(11, 16)}` : '…'}` : '')

export interface SourceOption {
  source: DateSource
  title: string
  hint: string
  /** What the source found; null when it found nothing. Unused by the manual one. */
  period: Period | null
}

interface Props {
  /** Tells the radio groups of several deployments apart. */
  name: string
  options: SourceOption[]
  value: DateSource | undefined
  onPick: (source: DateSource) => void
  /** The period taken, and the timezone it is in. */
  start: string | null
  end: string | null
  timezone: string
  /** What the manual source shows in the period's place: the form to type it in. */
  manualForm: ReactNode
}

/** The sources of a period, each showing what it found so they can be compared, and the period taken below — typed when it is by hand. */
export default function DateSourcePicker({ name, options, value, onPick, start, end, timezone, manualForm }: Props) {
  const duration = start && end ? spanBetween(start, end) : null
  return (
    <div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">Pick one. Each option shows what it found, so you can compare.</p>
      <div role="radiogroup" aria-label={`Date source of ${name}`} className="space-y-2">
        {options.map((o) => {
          const found = o.source === 'manual' || o.period !== null
          const selected = value === o.source
          return (
            <label key={o.source} className={`block rounded-xl border px-4 py-3 ${selected ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-zinc-200 dark:border-zinc-700'} ${found ? 'cursor-pointer' : 'opacity-60'}`}>
              <span className="flex items-start gap-3">
                <input type="radio" className="mt-1" name={`date-source-${name}`} aria-label={SOURCE_LABELS[o.source]} checked={selected} disabled={!found} onChange={() => onPick(o.source)} />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{o.title}</span>
                    {o.source !== 'manual' && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${found ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'}`}>{found ? 'Found' : 'Nothing found'}</span>
                    )}
                  </span>
                  {o.period && <span className="block mt-1 font-mono text-xs text-zinc-800 dark:text-zinc-200">{periodText(o.period)}</span>}
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{o.hint}</span>
                </span>
              </span>
            </label>
          )
        })}
      </div>
      <div className="mt-4 rounded-xl bg-zinc-100 dark:bg-zinc-800 p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Recording period</p>
          {value && <span className="rounded-full bg-blue-100 dark:bg-blue-900/40 px-2.5 py-0.5 text-xs font-medium text-blue-800 dark:text-blue-300">Dates from: {SOURCE_LABELS[value]}</span>}
        </div>
        {value === 'manual' ? manualForm : (
          <>
            <div className="grid grid-cols-2 gap-4 text-zinc-900 dark:text-zinc-100">
              <div><span className="block text-xs text-zinc-500 dark:text-zinc-400">Start date and time</span><span className="text-base font-semibold">{start ? `${formatDay(start)}, ${start.slice(11, 16)}` : '—'}</span></div>
              <div><span className="block text-xs text-zinc-500 dark:text-zinc-400">End date and time</span><span className="text-base font-semibold">{end ? `${formatDay(end)}, ${end.slice(11, 16)}` : '—'}</span></div>
            </div>
            {duration && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Duration: {duration}</p>}
          </>
        )}
        {timezone && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Times are in the deployment&rsquo;s time zone, {timezone}.</p>}
      </div>
    </div>
  )
}
