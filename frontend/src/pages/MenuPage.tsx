import OptionCards from '../components/OptionCards'
import type { Option } from '../components/OptionCards'
import type { Task } from '../types'

const TASK_OPTIONS: Option<Task>[] = [
  { value: 'fieldlog', emoji: '📋', title: 'Field records', description: 'After a field trip: add the Epicollect download to the fieldwork datasheet, check it, and get each deployment\u2019s start and end (UTC) for the collection.', available: true },
  { value: 'cards', emoji: '💾', title: 'Copy SD cards', description: 'Guided by the field records: each card matched to its deployment, copied untouched and checked, never twice. Also folders organized some other way.', available: true },
  { value: 'deployment', emoji: '📷', title: 'Import deployment', description: 'Organize a folder of camera-trap images locally, then register the deployment in Trapper.', available: true },
  { value: 'session', emoji: '🗂️', title: 'Import session', description: 'A folder with one subfolder per deployment: the revision, the checks and the preprocessing are common, the location and dates are asked for each.', available: true },
  { value: 'upload', emoji: '☁️', title: 'Upload deployment to Trapper', description: 'Pick a collection kept locally and send a deployment to Trapper — creating its location and the deployment there if they are missing.', available: true },
]

interface Props {
  onChoose: (task: Task) => void
}

export default function MenuPage({ onChoose }: Props) {
  return (
    <div className="mx-auto px-4 py-8" style={{ maxWidth: 700 }}>
      <h1 className="text-2xl font-bold mb-1">What do you want to do?</h1>
      <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">Choose one of the following.</p>
      <OptionCards options={TASK_OPTIONS} selected={null} onChoose={onChoose} />
      <button
        type="button" onClick={() => onChoose('utils')}
        className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-300 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
      >
        <span className="text-lg">🧰</span>
        <strong>Utils</strong>
        <span className="text-zinc-500 dark:text-zinc-400">— repair local deployments, sync local collections</span>
      </button>
    </div>
  )
}
