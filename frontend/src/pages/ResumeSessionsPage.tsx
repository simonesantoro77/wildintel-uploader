import { useState } from 'react'
import { api } from '../api'
import type { SessionSummary } from '../types'

interface Props {
  sessions: SessionSummary[]
  /** Resumes `session` — the caller mounts the matching task page with it. */
  onResume: (session: SessionSummary) => void
  /** Called once `session` is already deleted on the backend. */
  onDiscarded: (taskId: string) => void
  /** Leaves this screen to start a new run instead — the sessions are kept,
   * and offered again next time the app starts. */
  onSkip: () => void
}

const TASK_TITLES: Record<SessionSummary['task'], string> = { deployment: 'Process deployment', upload: 'Upload deployment to Trapper', session: 'Process collection',
  'upload-session': 'Upload session to Trapper', utils: 'Utilities', sync: 'Sync local collections', repair: 'Repair local deployments', fieldlog: 'Field records', cards: 'Copy SD cards', timefix: 'Check and fix dates and times',
}

const PHASE_LABELS: Record<SessionSummary['phase'], string> = {
  scanned: 'Source folder scanned',
  selected: 'Project and location chosen',
  ready: 'Ready to import',
}

const btnOutline = 'px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50'
const btnPrimary = 'px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-40'
const btnDanger = 'px-4 py-2 text-sm border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50'

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

function SessionCard({ session, onResume, onDiscarded }: { session: SessionSummary; onResume: () => void; onDiscarded: (taskId: string) => void }) {
  const [discarding, setDiscarding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { selection } = session

  async function handleDiscard() {
    setDiscarding(true)
    setError(null)
    try {
      await api.discardSession(session.task_id)
      onDiscarded(session.task_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not discard this session.')
      setDiscarding(false)
    }
  }

  return (
    <div className="rounded-xl border-2 border-zinc-300 dark:border-zinc-700 p-5">
      <div className="mb-3">
        <strong className="text-zinc-900 dark:text-zinc-100">
          {TASK_TITLES[session.task] ?? session.task}: {session.deployment?.deployment_id ?? selection?.location?.location_id ?? session.source_dir}
        </strong>
        <p className="text-zinc-500 dark:text-zinc-400 text-xs mt-0.5">Started {formatDate(session.created_at)}</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm mb-4">
        <dt className="text-zinc-500 dark:text-zinc-400">Source folder</dt>
        <dd className="text-zinc-800 dark:text-zinc-200 font-mono break-all">{session.source_dir}</dd>
        {selection?.destination === 'local' ? (
          <>
            <dt className="text-zinc-500 dark:text-zinc-400">Collection folder</dt>
            <dd className="text-zinc-800 dark:text-zinc-200 font-mono break-all">{selection.collection_dir}</dd>
          </>
        ) : selection && (
          <>
            {selection.research_project && (
              <>
                <dt className="text-zinc-500 dark:text-zinc-400">Research project</dt>
                <dd className="text-zinc-800 dark:text-zinc-200">{selection.research_project.name}</dd>
              </>
            )}
            {selection.classification_project && (
              <>
                <dt className="text-zinc-500 dark:text-zinc-400">Classification project</dt>
                <dd className="text-zinc-800 dark:text-zinc-200">{selection.classification_project.name}</dd>
              </>
            )}
            {selection.location && (
              <>
                <dt className="text-zinc-500 dark:text-zinc-400">Location</dt>
                <dd className="text-zinc-800 dark:text-zinc-200">
                  {selection.location.location_id}{selection.location.name ? ` — ${selection.location.name}` : ''}
                </dd>
              </>
            )}
          </>
        )}
        <dt className="text-zinc-500 dark:text-zinc-400">Progress</dt>
        <dd className="text-zinc-800 dark:text-zinc-200">{PHASE_LABELS[session.phase]}</dd>
      </dl>

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}

      <div className="flex items-center gap-2">
        <button type="button" className={btnPrimary} onClick={onResume} disabled={discarding}>Resume</button>
        <button type="button" className={btnDanger} onClick={handleDiscard} disabled={discarding}>
          {discarding ? 'Discarding…' : 'Discard'}
        </button>
      </div>
    </div>
  )
}

export default function ResumeSessionsPage({ sessions, onResume, onDiscarded, onSkip }: Props) {
  return (
    <div className="mx-auto max-w-[900px] px-4 py-8">
      <h1 className="text-2xl font-bold mb-1">Unfinished run{sessions.length > 1 ? 's' : ''}</h1>
      <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
        {sessions.length === 1
          ? 'A previous run was left before it finished. Resume it to pick up where it left off.'
          : 'These runs were left before they finished. Resume one to pick up where it left off.'}{' '}
        Credentials are never saved in a session, so you may be asked for them again.
      </p>

      <div className="space-y-4 mb-6">
        {sessions.map((session) => (
          <SessionCard key={session.task_id} session={session} onResume={() => onResume(session)} onDiscarded={onDiscarded} />
        ))}
      </div>

      <button type="button" className={btnOutline} onClick={onSkip}>Start a new run instead</button>
    </div>
  )
}
