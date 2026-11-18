import { useState } from 'react'
import type { ClosedVisitTarget } from '../types'
import VisitBookPage from './VisitBookPage'
import type { VisitFocus } from './VisitBookPage'
import VisitsPage from './VisitsPage'

type View = 'register' | 'book'

interface Props {
  onBack: () => void
  /** Opens the settings, on the section given — the page is left as it is under them. */
  onOpenSettings?: (section?: 'general' | 'trappers' | 'sdcards' | 'cameras' | 'locations', researchProjectId?: string) => void
  settingsOpen?: boolean
  /** Goes to Import deployment for a visit that was just closed. */
  onImportImages?: (target: ClosedVisitTarget) => void
  /** Goes to Import deployment on a research project, to pick the revision whose visits were just closed. */
  onImportImagesOf?: (researchProjectId: string) => void
  /** Goes to the status of the deployments, on one of them. */
  onShowDeployment?: (deploymentId: string) => void
  /** The visit the dashboard opens on, when a link of the deployments dashboard sent the user here. */
  focusVisit?: VisitFocus
  /** Opens on the visit dashboard — what the menu opens it on; Register visits is what it opens on otherwise. */
  startBook?: boolean
}

/** Register visits, or the visit dashboard: the page the menu opens, with the way back to the menu. */
export default function VisitsHomePage({ onBack, onOpenSettings, settingsOpen, onImportImages, onImportImagesOf, onShowDeployment, focusVisit, startBook }: Props) {
  const [view, setView] = useState<View>(focusVisit || startBook ? 'book' : 'register')
  // The visit that was planned and is to be created: the register opens on it.
  const [start, setStart] = useState<{ researchProjectId: string; site: string } | undefined>(undefined)

  if (view === 'register') return <VisitsPage start={start} onBack={onBack} onOpenSettings={onOpenSettings} settingsOpen={settingsOpen} onImportImages={onImportImages} onImportImagesOf={onImportImagesOf} />
  return <VisitBookPage onBack={onBack} onImportImages={onImportImages} onOpenSettings={onOpenSettings} settingsOpen={settingsOpen} onShowDeployment={onShowDeployment} focus={focusVisit} onCreateVisit={(target) => { setStart(target); setView('register') }} />
}
