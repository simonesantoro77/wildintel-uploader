import type { ReactNode } from 'react'
import { usePageTrail } from './Trail'

/** The space of every page around what it says: the same distance from the header of the application, and the same sides. */
export const PAGE_CLASS = 'mx-auto max-w-[1100px] px-4 py-8'

/** The title of a page, the same in all of them: 22 px, semibold, what it says under it, its buttons at the right and a subtle line under them all. */
export function PageTitle({ title, description, actions, label = 'Dashboard actions' }: { title: string; description?: ReactNode; actions?: ReactNode; label?: string }) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200/70 dark:border-zinc-800/80 pb-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-snug">{title}</h1>
        {description && <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-end gap-2" role="group" aria-label={label}>{actions}</div>}
    </header>
  )
}

/** The bar under the header of the application: the title of the page. The path to the page and the research project are in the header. */
export function DashboardBar({ icon, title, description, parent, onParent, actions, label = 'Dashboard actions' }: {
  icon?: ReactNode; title: string; description?: ReactNode; parent: string; onParent?: () => void; actions?: ReactNode; label?: string
}) {
  usePageTrail({ title, parent, onParent, icon: icon ? <>{icon}</> : undefined })
  return <PageTitle title={title} description={description} actions={actions} label={label} />
}
