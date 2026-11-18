import { useState } from 'react'
import type { ReactNode } from 'react'
import { formatLocal } from '../dateFormat'
import { spanBetween } from './DateSourcePicker'

const lockPath = <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 118 0v3" /></>
const Icon = ({ children, className = 'h-4 w-4' }: { children: ReactNode; className?: string }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className={`${className} shrink-0 fill-none stroke-current`} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)

interface Props {
  /** The visits the period is of: the one that left the camera and the one that collected its card — their sessions. None: there is nothing to say the dates come from. */
  visits: { left: string; collected: string } | null
  /** Whether the dates are the visits' — otherwise they were changed by hand. */
  fromVisits: boolean
  start: string | null
  end: string | null
  timezone: string
  /** Unlocks the dates to be typed — what the form holds. */
  onEdit: () => void
  /** Gives the dates of the visits back. */
  onRestore: () => void
  /** The form to type the start and the end in. */
  editForm: ReactNode
}

/** The recording period of a deployment: the dates of its visits, locked — a button edits them — and, unlocked, the form to type them, with a way to restore the visits' dates. */
export default function RecordingPeriod({ visits, fromVisits, start, end, timezone, onEdit, onRestore, editForm }: Props) {
  const [editing, setEditing] = useState(false)
  const duration = start && end ? spanBetween(start, end) : null
  const foot = (
    <p className="text-xs text-zinc-500 dark:text-zinc-400">
      {duration && <>Duration: <strong className="font-semibold text-zinc-700 dark:text-zinc-200">{duration}</strong> · </>}
      {timezone && <>Times are in the deployment&rsquo;s time zone, <strong className="font-semibold text-zinc-700 dark:text-zinc-200">{timezone}</strong>.</>}
    </p>
  )
  const restore = visits && (
    <button type="button" onClick={onRestore} className="inline-flex items-center gap-2 rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-3 py-1.5 text-sm text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/40">
      <Icon><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></Icon>Restore from Visits of the field work
    </button>
  )
  // with no visit there is nothing to lock: the dates are typed
  if (!visits) return <div className="rounded-xl bg-zinc-100 dark:bg-zinc-800 p-4"><p className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-200">Recording period</p>{editForm}<div className="mt-3">{foot}</div></div>

  if (editing) {
    return (
      <section aria-label="Recording period" className="rounded-2xl border-2 border-blue-500/70 bg-zinc-100 dark:bg-zinc-800/60 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h5 className="flex flex-wrap items-center gap-3 text-base font-bold text-zinc-900 dark:text-zinc-100">
            Recording period
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 px-3 py-1 text-xs font-medium text-amber-800 dark:text-amber-300"><Icon className="h-3.5 w-3.5"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 017.5-2" /></Icon>Unlocked · Custom override</span>
          </h5>
          {restore}
        </div>
        {editForm}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {foot}
          <span className="flex items-center gap-2">
            <button type="button" className="rounded-lg border border-zinc-300 dark:border-zinc-600 px-5 py-2 text-sm font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700" onClick={() => { onRestore(); setEditing(false) }}>Cancel</button>
            <button type="button" className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700" onClick={() => setEditing(false)}>Apply changes</button>
          </span>
        </div>
      </section>
    )
  }

  const box = (label: string, value: string | null, tag?: string) => (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        {tag && <span className="rounded-md bg-zinc-200 dark:bg-zinc-700 px-2 py-0.5 text-xs text-zinc-600 dark:text-zinc-300">{tag}</span>}
      </div>
      <div className="flex items-center gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white/60 dark:bg-zinc-900/60 px-4 py-3 text-base text-zinc-500 dark:text-zinc-400"><Icon className="h-4 w-4 text-zinc-400"><>{lockPath}</></Icon>{value ? formatLocal(value, timezone) : '—'}</div>
    </div>
  )
  return (
    <section aria-label="Recording period" className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/60">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-700 px-5 py-4">
        <h5 className="flex flex-wrap items-center gap-3 text-lg font-bold text-zinc-900 dark:text-zinc-100">
          Recording period
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 dark:bg-sky-950/50 px-3 py-1 text-xs font-medium text-sky-800 dark:text-sky-300"><Icon className="h-3.5 w-3.5"><>{lockPath}</></Icon>
            {fromVisits ? `Locked · Field work (${visits.left} → ${visits.collected})` : 'Locked · Custom dates'}</span>
        </h5>
        <span className="flex items-center gap-2">
          {!fromVisits && restore}
          <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-600 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  onClick={() => { onEdit(); setEditing(true) }}><Icon><path d="M16.9 3.9a2.1 2.1 0 013 3L7.6 19.2 3.5 20.5l1.3-4.1L16.9 3.9z" /></Icon>Edit dates</button>
        </span>
      </div>
      <div className="px-5 py-4">
        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
          {fromVisits
            ? <>Dates come from field work visits <strong className="font-semibold text-zinc-900 dark:text-zinc-100">{visits.left}</strong> (card left) and <strong className="font-semibold text-zinc-900 dark:text-zinc-100">{visits.collected}</strong> (card collected). Visits themselves are never modified.</>
            : <>The dates were changed by hand. The visits <strong className="font-semibold text-zinc-900 dark:text-zinc-100">{visits.left}</strong> and <strong className="font-semibold text-zinc-900 dark:text-zinc-100">{visits.collected}</strong> are never modified.</>}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {box('Start date and time', start, fromVisits ? `Visit ${visits.left}` : undefined)}
          {box('End date and time', end, fromVisits ? `Visit ${visits.collected}` : undefined)}
        </div>
        <div className="mt-4 border-t border-zinc-200 dark:border-zinc-700 pt-3">{foot}</div>
      </div>
    </section>
  )
}
