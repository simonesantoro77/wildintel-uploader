import type { Task } from '../types'

/** The steps of the workflow, in the order they are done after a field trip. */
const STEPS: { n: number; task: Task; emoji: string; title: string; description: string; when?: string }[] = [
  { n: 1, task: 'fieldlog', emoji: '📋', title: 'Field records', description: 'Add the field survey (from the field app) to the field history, check it, and get each deployment’s start and end (UTC) for the collection.' },
  { n: 2, task: 'cards', emoji: '💾', title: 'Copy SD cards', description: 'Each card matched to its deployment by the field records, copied untouched and checked. If a card’s dates and times look wrong, you are taken to check and fix them. Also folders organized some other way.' },
  { n: 3, task: 'session', emoji: '🗂️', title: 'Process collection', description: 'The copied cards of a collection, one folder per deployment: checks and preparing the images (renaming, resizing and metadata), then kept in the collection.' },
  { n: 4, task: 'upload', emoji: '☁️', title: 'Upload to Trapper', description: 'Send the deployments of a processed collection to Trapper — creating their location and the deployment there if they are missing.' },
]

interface Props {
  onChoose: (task: Task) => void
}

export default function MenuPage({ onChoose }: Props) {
  return (
    <div className="mx-auto px-4 py-8" style={{ maxWidth: 760 }}>
      <h1 className="text-2xl font-bold mb-1">What do you want to do?</h1>
      <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">After a field trip, the steps go in this order.</p>
      <ol className="space-y-3">
        {STEPS.map((step) => (
          <li key={step.task}>
            <button
              type="button" onClick={() => onChoose(step.task)}
              className="w-full flex items-start gap-4 p-4 rounded-xl border-2 text-left border-zinc-300 dark:border-zinc-700 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
            >
              <span className="w-10 h-10 shrink-0 rounded-full bg-blue-600 text-white flex items-center justify-center text-lg font-bold" aria-hidden="true">{step.n}</span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="text-xl" aria-hidden="true">{step.emoji}</span>
                  <strong className="text-zinc-900 dark:text-zinc-100">{step.title}</strong>
                  {step.when && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">{step.when}</span>}
                </span>
                <span className="block text-zinc-500 dark:text-zinc-400 text-sm mt-1">{step.description}</span>
              </span>
            </button>
            {step.task === 'session' && (
              <button type="button" onClick={() => onChoose('deployment')}
                      className="ml-14 mt-1 text-sm text-blue-600 dark:text-blue-400 hover:underline">
                or a single deployment: Process deployment
              </button>
            )}
          </li>
        ))}
      </ol>
      <button
        type="button" onClick={() => onChoose('utils')}
        className="mt-6 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-300 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
      >
        <span className="text-lg">🧰</span>
        <strong>Utils</strong>
        <span className="text-zinc-500 dark:text-zinc-400">: check and fix dates and times, repair local deployments, sync local collections from Trapper</span>
      </button>
    </div>
  )
}
