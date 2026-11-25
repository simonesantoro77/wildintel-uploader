import { useEffect, useState } from 'react'
import { api } from '../api'
import { defaultResearchProject } from '../defaultResearchProject'
import { listWorking } from '../researchProjects'
import BackButton from '../components/BackButton'
import Notice from '../components/Notice'
import { PageHeader, UTIL_ICONS } from '../components/TaskCard'
import { PAGE_CLASS } from '../components/PageBar'
import { SmallSpinner, btnPrimary } from './ImportDeploymentPage'

/** Rebuilds the history of the status of the locations, the cameras and the SD cards of the default research project from its visits: what it lacks is added, and nothing of it is
 * overwritten nor deleted. */
export default function StatusHistoryPage({ onBack }: { onBack?: () => void; onOpenSettings?: (section?: 'general') => void; settingsOpen?: boolean } = {}) {
  const [projectId, setProjectId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listWorking().then(async ({ results }) => {
      const wanted = await defaultResearchProject()
      setProjectId(results.find((p) => p.acronym.toLowerCase() === wanted.toLowerCase())?.acronym ?? '')
    }).catch((e) => setError(e instanceof Error ? e.message : 'Could not read the collections folder.'))
  }, [])

  async function rebuild() {
    if (!projectId) return
    setBusy(true)
    setError(null)
    setAdded(null)
    try {
      setAdded((await api.rebuildStatusHistory(projectId)).added)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rebuild the history.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={PAGE_CLASS}>
      <PageHeader icon={UTIL_ICONS.history} title="Rebuild the history of the states" parent="Utilities" onParent={onBack}
        description="Works out the changes of status of the locations, the cameras and the SD cards from the visits kept." />
      <div className="max-w-prose space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
        <p>What was kept before the history was has none. Each visit says what it did — a camera put up, a card taken, a site started — and a line is written for each change, marked as rebuilt from the visits.</p>
        <p>The lines the history already has are kept: nothing is overwritten nor deleted, and a line that is there is not written again. What was changed by hand before cannot be known; when the visits do not end in the status of today, a last line says so.</p>
      </div>
      <div className="mt-6">
        {projectId === '' && <Notice kind="info">There is no default research project: set it in the settings, with the card at the top right.</Notice>}
        {projectId && <p className="text-sm text-zinc-600 dark:text-zinc-300">Research project: <strong className="font-mono">{projectId}</strong></p>}
        {added !== null && <Notice kind="success" role="status" className="mt-4">{added === 0 ? 'The history had every change the visits say: nothing was added.' : `${added} ${added === 1 ? 'line was' : 'lines were'} added to the history.`}</Notice>}
        {error && <Notice kind="error" role="alert" className="mt-4">{error}</Notice>}
      </div>
      <div className="mt-10 flex items-center justify-between gap-3">
        {onBack ? <BackButton onClick={onBack} disabled={busy} /> : <span />}
        <button type="button" className={btnPrimary} disabled={!projectId || busy} onClick={() => void rebuild()}>
          {busy && <SmallSpinner />}Rebuild the history from the visits
        </button>
      </div>
    </div>
  )
}
