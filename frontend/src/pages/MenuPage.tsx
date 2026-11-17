import { useTrail } from '../components/Trail'
import TaskCard, { ArrowIcon, LineIcon, MENU_ICONS as ICONS, taskCard } from '../components/TaskCard'
import type { Task } from '../types'

const TASKS: { value: Task; icon: string; title: string; description: string }[] = [
  { value: 'visits', icon: 'visits', title: 'Manage visits', description: 'Register the visits to the camera traps — who went, when, to which site and what was done — or look at the visit book. The deployments are worked out from the visits.' },
  { value: 'deployment', icon: 'deployment', title: 'Manage deployments', description: 'Import a folder of camera-trap images as a deployment, or see the status of the deployments: which are closed, which still have the camera out and which are on Trapper.' },
  { value: 'upload', icon: 'upload', title: 'Manage uploads', description: 'Send a deployment kept on this computer to a repository, or see the status of the uploads: which deployments and revisions are in a repository and which are still to be uploaded.' },
]

interface Props {
  onChoose: (task: Task) => void
}

export default function MenuPage({ onChoose }: Props) {
  useTrail([{ label: 'Menu', icon: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></> }])
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">What do you want to do?</h1>
        <p className="text-zinc-500 dark:text-zinc-400 text-sm">Choose one of the following.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {TASKS.map((t) => <TaskCard key={t.value} icon={ICONS[t.icon]} title={t.title} description={t.description} onClick={() => onChoose(t.value)} />)}
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
