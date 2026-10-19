import type { ReactNode } from 'react'

/** One step of the page: open (its content), done (a tick, a summary and a
 * pencil button to edit it), locked (greyed, until the steps before it are done)
 * or idle (not done, but it can be opened — steps that don't depend on each
 * other). A step that runs has two more: running (a spinner, "In progress")
 * and error (a cross, "Error" — or the badge given). The content stays
 * mounted once reached, so closing a step keeps its choices. */
export default function WizardStep({ n, title, description, status, summary, canEdit, onEdit, badge, action, expanded = false, children }: {
  n: number
  title: string
  description: ReactNode
  status: 'open' | 'done' | 'locked' | 'idle' | 'running' | 'error'
  summary?: ReactNode
  canEdit: boolean
  onEdit: () => void
  /** Replaces the badge of a running or failed step. */
  badge?: string
  /** A button (or the like) at the right of the step's header. */
  action?: ReactNode
  /** A done step that keeps its content showing (the one with the results). */
  expanded?: boolean
  children?: ReactNode
}) {
  const locked = status === 'locked'
  const shown = status === 'open' || status === 'running' || status === 'error' || expanded
  const circle = {
    done: 'bg-emerald-700 text-white',
    open: 'bg-blue-600 text-white',
    running: 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300',
    error: 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400',
    locked: 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400',
    idle: 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400',
  }[status]
  const pill = 'text-xs font-medium px-2 py-0.5 rounded-full'
  return (
    <section className="py-5 border-t first:border-t-0 border-zinc-200 dark:border-zinc-700">
      <div className="flex items-start gap-3">
        <span className={`w-8 h-8 rounded-full text-sm flex items-center justify-center font-bold flex-shrink-0 ${circle}`}>
          {status === 'done'
            ? <svg role="img" aria-label="Done" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            : status === 'running'
              ? <span role="status" aria-label="In progress" className="w-4 h-4 border-2 border-blue-200 dark:border-blue-800 border-t-blue-600 dark:border-t-blue-300 rounded-full animate-spin" />
              : status === 'error'
                ? <svg role="img" aria-label="Failed" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" /></svg>
                : n}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap min-h-8">
            <h4 className={`text-base font-semibold ${locked ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-900 dark:text-zinc-100'}`}>{status === 'done' ? `${n}. ${title}` : title}</h4>
            {status === 'done' && <span className={`${pill} bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400`}>Completed</span>}
            {status === 'running' && <span className={`${pill} bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300`}>{badge ?? 'In progress'}</span>}
            {status === 'error' && <span className={`${pill} bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400`}>{badge ?? 'Error'}</span>}
          </div>
          {status === 'done' && summary && !expanded && <div className="text-sm text-zinc-600 dark:text-zinc-300 mt-1">{summary}</div>}
          {(status === 'open' || status === 'locked' || status === 'idle' || (status === 'done' && !summary && !expanded)) && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{description}</p>
          )}
        </div>
        {action}
        {status === 'idle' && (
          <button type="button" className="text-sm text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white disabled:opacity-50" disabled={!canEdit} onClick={onEdit} aria-label={`Open ${title}`}>
            Open
          </button>
        )}
        {status === 'done' && !expanded && (
          <button
            type="button" disabled={!canEdit} onClick={onEdit} aria-label={`Edit ${title}`} title="Edit"
            className="w-10 h-10 flex items-center justify-center flex-shrink-0 rounded-xl border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.9 3.9a2.1 2.1 0 013 3L7.6 19.2 3.5 20.5l1.3-4.1L16.9 3.9z" />
            </svg>
          </button>
        )}
        {locked && (
          <svg role="img" aria-label="Locked" className="w-5 h-5 mt-1 text-zinc-500 dark:text-zinc-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path strokeLinecap="round" d="M8 11V8a4 4 0 118 0v3" />
          </svg>
        )}
      </div>
      {!locked && <div className={shown ? 'mt-4 ml-11' : 'hidden'}>{children}</div>}
    </section>
  )
}
