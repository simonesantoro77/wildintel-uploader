import { useTrail } from '../components/Trail'
import { ArrowIcon, LineIcon, MENU_ICONS as ICONS, taskCard } from '../components/TaskCard'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Task } from '../types'

export type MenuAction = 'register' | 'import' | 'upload'
export type MenuDashboard = 'visits' | 'deployments' | 'uploads' | 'statistics'

/** What the menu does: each is one click from the action. */
const ACTIONS: { value: MenuAction; icon: string; title: string; subtitle: string; description: string }[] = [
  { value: 'register', icon: 'visits', title: 'Register visits', subtitle: 'Record the visits to the camera traps', description: 'Who went, when, to which site and what was done. They can be registered one by one, or in batch mode from files.' },
  { value: 'import', icon: 'deployment', title: 'Create deployments', subtitle: 'Import the images collected in a visit', description: 'Pick the closed visits whose images you have and create their deployments: one, several at once, or one after another.' },
  { value: 'upload', icon: 'upload', title: 'Upload deployment', subtitle: 'Upload deployments to public repositories', description: 'Send a deployment kept on this computer to a repository, such as Trapper.' },
]

/** The dashboards and the statistics, in a card of their own. */
const DASHBOARDS: { value: MenuDashboard; title: string; description: string; icon: ReactNode }[] = [
  { value: 'visits', title: 'Visit dashboard', description: 'Which visits were made, which have the camera out or the card collected, and which are still to do.', icon: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></> },
  { value: 'deployments', title: 'Deployments dashboard', description: 'The deployments the visits say: which are created, which are not yet, and which are uploaded.', icon: <path d="M18 20V10M12 20V4M6 20v-6" /> },
  { value: 'uploads', title: 'Uploads dashboard', description: 'Which deployments and revisions are in a repository and which are still to be uploaded.', icon: <path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9M12 12v9M8 16l4-4 4 4" /> },
  { value: 'statistics', title: 'Statistics', description: 'The deployments of a revision against the previous ones of their locations.', icon: <path d="M3 3v18h18M7 15l4-4 3 3 5-6" /> },
]

interface Props {
  /** The actions: register visits, import deployments, upload a deployment. */
  onAction: (action: MenuAction) => void
  /** The dashboards and the statistics. */
  onDashboard: (dashboard: MenuDashboard) => void
  /** The rest of the tasks: the utilities. */
  onChoose: (task: Task) => void
}

/** The card of an action: its icon with its title beside it, a subtitle under the title, and under both a longer description. */
function ActionCard({ icon, title, subtitle, description, onClick }: { icon: ReactNode; title: string; subtitle: string; description: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`${taskCard} flex flex-col items-stretch gap-4 p-5 text-left`}>
      <span className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"><LineIcon size={20}>{icon}</LineIcon></span>
        <span className="min-w-0 flex-1">
          <strong className="block text-base text-zinc-900 dark:text-zinc-100">{title}</strong>
          <span className="block text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</span>
        </span>
        <span className="text-zinc-500 dark:text-zinc-400"><ArrowIcon /></span>
      </span>
      <span className="text-base leading-relaxed text-zinc-700 dark:text-zinc-300">{description}</span>
    </button>
  )
}

export default function MenuPage({ onAction, onDashboard, onChoose }: Props) {
  // the dashboards are folded away until the card is opened
  const [dashboardsOpen, setDashboardsOpen] = useState(false)
  useTrail([{ label: 'Menu', icon: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></> }])
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">What do you want to do?</h1>
        <p className="text-zinc-500 dark:text-zinc-400 text-sm">Choose one of the following.</p>
      </div>
      <nav aria-label="Typical workflow" className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 px-4 py-3">
        <span className="inline-flex items-center gap-2 rounded-full bg-blue-100 dark:bg-blue-950/50 px-4 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-300">
          <LineIcon><path d="M3 12h4l3-8 4 16 3-8h4" /></LineIcon>Typical workflow
        </span>
        <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {ACTIONS.map((a, i) => (
            <li key={a.value} className="flex items-center gap-3">
              {i > 0 && <span aria-hidden="true" className="text-zinc-400"><ArrowIcon /></span>}
              <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950/60 text-xs font-semibold text-blue-700 dark:text-blue-300">{i + 1}</span>
              <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"><LineIcon size={16}>{ICONS[a.icon]}</LineIcon></span>
              {a.title}
            </li>
          ))}
        </ol>
      </nav>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {ACTIONS.map((t) => <ActionCard key={t.value} icon={ICONS[t.icon]} title={t.title} subtitle={t.subtitle} description={t.description} onClick={() => onAction(t.value)} />)}
        <section aria-label="Dashboards and statistics" className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-5">
          <button type="button" aria-expanded={dashboardsOpen} onClick={() => setDashboardsOpen((o) => !o)} className="flex w-full flex-col items-stretch gap-4 text-left">
            <span className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300"><LineIcon size={20}><path d="M18 20V10M12 20V4M6 20v-6" /></LineIcon></span>
              <span className="min-w-0 flex-1">
                <strong className="block text-base text-zinc-900 dark:text-zinc-100">Dashboards and statistics</strong>
                <span className="block text-sm text-zinc-500 dark:text-zinc-400">How far everything is</span>
              </span>
              <span className={`text-zinc-500 dark:text-zinc-400 transition-transform ${dashboardsOpen ? 'rotate-90' : ''}`}><ArrowIcon /></span>
            </span>
            <span className="text-base leading-relaxed text-zinc-700 dark:text-zinc-300">The visits, the deployments and the uploads, with which are done and which are still to do, and the statistics that compare the deployments with the previous revisions.</span>
          </button>
          {dashboardsOpen && <ul className="mt-3 space-y-1 border-t border-zinc-200 dark:border-zinc-800 pt-3">
            {DASHBOARDS.map((d) => (
              <li key={d.value}>
                <button type="button" title={d.description} onClick={() => onDashboard(d.value)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-zinc-800 dark:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-800">
                  <span className="text-zinc-500 dark:text-zinc-400"><LineIcon>{d.icon}</LineIcon></span>
                  <span className="flex-1 font-medium">{d.title}</span>
                  <ArrowIcon />
                </button>
              </li>
            ))}
          </ul>}
        </section>
      </div>
      <button type="button" onClick={() => onChoose('utils')} className={`${taskCard} mt-4 w-full flex items-center gap-4 px-5 py-4 text-left`}>
        <span className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 shrink-0"><LineIcon>{ICONS.utils}</LineIcon></span>
        <span className="flex-1 min-w-0">
          <strong className="block text-sm text-zinc-900 dark:text-zinc-100">Utils</strong>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">Fix dates, repair local deployments, sync local collections.</span>
        </span>
        <span className="inline-flex items-center gap-2 px-4 h-9 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-sm font-medium text-zinc-800 dark:text-zinc-200 shrink-0">Open utilities <ArrowIcon /></span>
      </button>
    </div>
  )
}
