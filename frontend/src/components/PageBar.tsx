import type { ReactNode } from 'react'
import ResearchProjectSelect from './ResearchProjectSelect'
import { usePageTrail } from './Trail'

/** The bar under the header of the application: the title of the page at the left and the research project at the right, and under them the line of buttons, at the right. The path to the page is said by the header; what the page is for is its subtitle. */
export function DashboardBar({ icon, title, description, parent, onParent, actions, withProject = false, label = 'Dashboard actions' }: {
  icon?: ReactNode; title: string; description?: ReactNode; parent: string; onParent?: () => void; actions?: ReactNode; withProject?: boolean; label?: string
}) {
  usePageTrail({ title, parent, onParent, icon: icon ? <>{icon}</> : undefined })
  return (
    <header className="mb-6 flex flex-col gap-3">
      <div className={`flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-700 pb-3`}>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
          {description && <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
        </div>
        {withProject && <div className="shrink-0"><ResearchProjectSelect /></div>}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-end gap-2" role="group" aria-label={label}>{actions}</div>}
    </header>
  )
}
