import { useEffect, useState } from 'react'
import { api } from '../api'
import { DashboardHeader, HelpButton } from '../components/DashboardParts'
import { useDefaultResearchProject } from '../components/DefaultResearchProject'
import FieldDeployments from '../components/FieldDeployments'
import { readDeployment } from '../deploymentDetails'
import type { ClosedVisitTarget, FieldDeployment, SdCard, UploadTarget } from '../types'
import { btnOutline } from './ImportDeploymentPage'
import type { VisitFocus } from './VisitBookPage'

interface Props {
  onBack: () => void
  /** Opens the settings, on the section given — where the default research project is changed. */
  onOpenSettings?: (section?: 'general' | 'sdcards' | 'locations', researchProjectId?: string, item?: string) => void
  settingsOpen?: boolean
  /** The deployment shown highlighted, on its revision and its page: the one a link of the visit book goes to. */
  focus?: string
  /** Goes to the visit dashboard, on a visit: the one that started a deployment. */
  onShowVisit?: (visit: VisitFocus) => void
  /** Goes to upload a deployment: the research project and the revision it is of. */
  onUpload?: (target: UploadTarget) => void
  /** Goes to the uploads dashboard, on the uploads of a deployment. */
  onShowUploads?: (deploymentId: string) => void
  /** Goes to Import deployment, on the visit that left the camera: to create the deployment of a card that was collected. */
  onImportImages?: (target: ClosedVisitTarget) => void
  /** Goes to the statistics, on a deployment: its revision, with it isolated. */
  onShowStatistics?: (deployment: FieldDeployment) => void
}

/** The dashboard of the deployments of the default research project — the statistics: which are closed with their images stored, which still have the camera out, which are not on Trapper yet. */
export default function DeploymentStatusPage({ onBack, onOpenSettings, settingsOpen, focus, onShowVisit, onUpload, onShowUploads, onImportImages, onShowStatistics }: Props) {
  const { project, error: projectError } = useDefaultResearchProject(settingsOpen)
  const [deployments, setDeployments] = useState<FieldDeployment[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  // The SD cards of the research project, for the panel of the card of a deployment.
  const [sdCards, setSdCards] = useState<SdCard[]>([])
  const error = projectError ?? loadError

  // The deployment is of the visit that left the camera: it is found in the visits of the research project.
  async function create(d: FieldDeployment) {
    if (!project || !onImportImages) return
    try {
      const { results } = await api.visitBook(project.acronym)
      const visit = results.find((v) => !v.not_done && !v.unknown && v.session === d.start_session && v.location_id.toLowerCase() === d.site.toLowerCase())
      if (!visit) { setLoadError(`The visit ${d.start_session ?? ''} to ${d.site}, which left the camera, was not found.`); return }
      onImportImages({ researchProjectId: project.acronym, visit })
    } catch (e) { setLoadError(e instanceof Error ? e.message : 'Could not read the visits.') }
  }

  // The visits of a deployment: the one that left the camera and the one that collected its card, from the visits kept to the location.
  async function loadVisits(d: FieldDeployment) {
    if (!project) return null
    const { results } = await api.listVisits(project.acronym, d.site)
    const at = (session: string | null) => (session ? results.find((v) => v.session === session && v.location_id.toLowerCase() === d.site.toLowerCase()) : undefined)
    const visit = at(d.start_session)
    return visit ? { visit, end: at(d.end_session) ?? null } : null
  }

  useEffect(() => {
    setSdCards([])
    if (!project) return
    let cancelled = false
    Promise.resolve().then(() => api.getSettings())
      .then((s) => { if (!cancelled) setSdCards((s?.FIELDWORK?.sd_cards ?? []).filter((c) => (c.research_project ?? '').toLowerCase() === project.acronym.toLowerCase())) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [project?.acronym]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDeployments(null); setLoadError(null)
    if (!project) return
    let cancelled = false
    api.fieldDeployments(project.acronym)
      .then(({ results }) => { if (!cancelled) setDeployments(results) })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not read the deployments.') })
    return () => { cancelled = true }
  }, [project?.acronym]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-8">
      <DashboardHeader parent="Manage deployments" onParent={onBack} icon={<path d="M18 20V10M12 20V4M6 20v-6" />} title="Deployments dashboard" description="The deployments indicated by the visits and their current status."
        actions={<HelpButton expanded={helpOpen} onClick={() => setHelpOpen(true)} />}
        withProject />

      {error && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {project && (deployments === null ? <p className="text-sm text-zinc-500 dark:text-zinc-400">Reading the deployments…</p> : <FieldDeployments researchProjectId={project.acronym} deployments={deployments} loadVisits={loadVisits} sdCards={sdCards} onCreate={onImportImages ? (d) => void create(d) : undefined} helpOpen={helpOpen} onCloseHelp={() => setHelpOpen(false)} onShowSd={onOpenSettings && ((label) => onOpenSettings('sdcards', project.acronym, label))} onShowLocation={onOpenSettings && ((site) => onOpenSettings('locations', project.acronym, site))} onShowUploads={onShowUploads} onShowStatistics={onShowStatistics} highlight={focus} onShowVisit={onShowVisit} loadDetails={(id) => readDeployment(project.acronym, id)} onUpload={onUpload && ((d) => onUpload({ researchProjectId: project.acronym, collection: d.collection }))} />)}

      <div className="mt-10">
        <button type="button" className={btnOutline} onClick={onBack}><span aria-hidden="true">← </span>Back</button>
      </div>
    </div>
  )
}
