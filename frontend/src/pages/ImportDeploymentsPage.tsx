import { useState } from 'react'
import type { ClosedVisitTarget, UploadTarget } from '../types'
import ImportDeploymentPage from './ImportDeploymentPage'
import ImportSessionPage from './ImportSessionPage'

const idOf = (t: ClosedVisitTarget) => `${t.visit.session}-${t.visit.location_id}`

/** Import deployments: pick the closed visits the images are of. With one, it is Import deployment — a folder with the images; with several, either all at once — a folder
 * with a subfolder of images for each, and the subfolder of each visit is said — or one after another: Import deployment is run for each, the first, then the second… */
export default function ImportDeploymentsPage({ onUpload, onOpenSettings, settingsOpen = false, onBack, onRegisterVisits }: {
  onRegisterVisits?: (researchProjectId: string) => void
  onUpload?: (target: UploadTarget) => void; onOpenSettings?: (section?: 'epicollect' | 'general' | 'projects' | 'locations' | 'sdcards', researchProjectId?: string, item?: string) => void; settingsOpen?: boolean; onBack?: () => void
}) {
  const [single, setSingle] = useState<ClosedVisitTarget | null>(null)
  // the visits imported one after another, the one it is at, and the folder the images of the one before were in
  const [queue, setQueue] = useState<ClosedVisitTarget[] | null>(null)
  const [index, setIndex] = useState(0)
  const [parent, setParent] = useState<string | null>(null)
  if (single) return <ImportDeploymentPage closedVisit={single} onUpload={onUpload} settingsOpen={settingsOpen} onOpenSettings={onOpenSettings} onBack={() => setSingle(null)} />
  if (queue) {
    const stop = () => { setQueue(null); setIndex(0); setParent(null) }
    const go = () => (index + 1 < queue.length ? setIndex(index + 1) : stop())
    return (
      <ImportDeploymentPage key={idOf(queue[index])} closedVisit={queue[index]} onUpload={onUpload} settingsOpen={settingsOpen} onOpenSettings={onOpenSettings} onBack={stop}
                            queue={{ index, total: queue.length, current: idOf(queue[index]), next: index + 1 < queue.length ? idOf(queue[index + 1]) : null, parentFolder: parent, onFolder: setParent, onNext: go, onSkip: go, onStop: stop }} />
    )
  }
  return <ImportSessionPage title="Import deployments" onSingleVisit={setSingle} onQueue={(visits) => { setQueue(visits); setIndex(0); setParent(null) }} onUpload={onUpload} settingsOpen={settingsOpen} onOpenSettings={onOpenSettings} onBack={onBack} onRegisterVisits={onRegisterVisits} />
}
