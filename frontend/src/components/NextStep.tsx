import type { ReactNode } from 'react'

/** The step of the workflow that comes next, as a button that goes there — so the order of the steps is followed
 * without going back to the menu. */
export default function NextStep({ n, title, children, onGo, label }: {
  n: number
  title: string
  children?: ReactNode
  onGo?: () => void
  /** The button's text; "Go to <title>" when left out. */
  label?: string
}) {
  return (
    <div className="mt-4 rounded-xl border-2 border-blue-500 bg-blue-50 dark:bg-blue-950/30 p-4 flex items-center gap-4 flex-wrap" role="region" aria-label="Next step">
      <span className="w-10 h-10 shrink-0 rounded-full bg-blue-600 text-white flex items-center justify-center text-lg font-bold" aria-hidden="true">{n}</span>
      <div className="flex-1 min-w-48">
        <p className="text-xs uppercase tracking-wide text-blue-700 dark:text-blue-300 font-semibold">Next step</p>
        <p className="font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
        {children && <div className="text-sm text-zinc-600 dark:text-zinc-300 mt-0.5">{children}</div>}
      </div>
      {onGo && (
        <button type="button" onClick={onGo} className="px-5 py-2.5 text-sm rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors">
          {label ?? `Go to ${title}`} →
        </button>
      )}
    </div>
  )
}
