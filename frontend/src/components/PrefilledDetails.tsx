import type { ReactNode } from 'react'

const Icon = ({ children, className = 'h-4 w-4' }: { children: ReactNode; className?: string }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className={`${className} shrink-0 fill-none stroke-current`} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)
const lock = <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 118 0v3" /></>
const bold = 'font-semibold text-zinc-900 dark:text-zinc-100'

interface Props {
  /** The previous deployment of the location that gave some of the details — its id and how many fields it gave — if there is one. */
  previous: { id: string; fields: number } | null
  /** The visit that gave some — its session, when it was made and how many fields it gave — if there is one. */
  visit: { session: string; when: string; fields: number } | null
  /** Locked while they are as the sources say them; unlocked, they can be edited by hand. */
  locked: boolean
  onEdit: () => void
  /** Gives back what the sources say. */
  onRestore: () => void
}

/** What is said of the details that were filled in from the previous deployment and the visit — the sections of the details come under it. */
export default function PrefilledDetails({ previous, visit, locked, onEdit, onRestore }: Props) {
  const from = [previous && `Previous deployment (${previous.id})`, visit && `Visit ${visit.session}`].filter(Boolean).join(' & ')
  return (
    <section aria-label="Pre-filled details" className={`mb-4 rounded-2xl border ${locked ? 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/60' : 'border-2 border-blue-500/70 bg-zinc-100 dark:bg-zinc-800/60'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-700 px-5 py-4">
        <h5 className="flex flex-wrap items-center gap-3 text-lg font-bold text-zinc-900 dark:text-zinc-100">
          Pre-filled details
          {locked
            ? <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 dark:bg-sky-950/50 px-3 py-1 text-xs font-medium text-sky-800 dark:text-sky-300"><Icon className="h-3.5 w-3.5">{lock}</Icon>Locked · {from}</span>
            : <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 px-3 py-1 text-xs font-medium text-amber-800 dark:text-amber-300"><Icon className="h-3.5 w-3.5"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 017.5-2" /></Icon>Unlocked · Edited by hand</span>}
        </h5>
        {locked
          ? <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-600 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={onEdit}><Icon><path d="M16.9 3.9a2.1 2.1 0 013 3L7.6 19.2 3.5 20.5l1.3-4.1L16.9 3.9z" /></Icon>Edit details</button>
          : <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-3 py-1.5 text-sm text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/40" onClick={onRestore}><Icon><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></Icon>Restore the pre-filled details</button>}
      </div>
      <div className="px-5 py-4">
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
          Data comes from {previous && <>previous deployment <strong className={bold}>{previous.id}</strong></>}{previous && visit && ' and '}{visit && <>field work visit <strong className={bold}>{visit.session}</strong> ({visit.when})</>}. Original records are never modified.
        </p>
        <div className="flex flex-wrap gap-2">
          {previous && <span className="inline-flex items-center gap-2 rounded-lg bg-zinc-200/70 dark:bg-zinc-800 px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-300"><Icon className="h-3.5 w-3.5">{lock}</Icon>Previous deployment: {previous.id} ({previous.fields} {previous.fields === 1 ? 'field' : 'fields'})</span>}
          {visit && <span className="inline-flex items-center gap-2 rounded-lg bg-zinc-200/70 dark:bg-zinc-800 px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-300"><Icon className="h-3.5 w-3.5">{lock}</Icon>Field work visit: {visit.session} ({visit.fields} {visit.fields === 1 ? 'field' : 'fields'})</span>}
        </div>
      </div>
    </section>
  )
}
