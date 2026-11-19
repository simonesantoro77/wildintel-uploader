import { Fragment, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Icon, StateCard } from '../components/Dashboard'
import { ActiveFilters, ChevronCell, DashboardHeader, DetailsRow, HELP_ICONS, HelpButton, HelpCard, HelpDrawer, MetricsSection, ProgressCard, RevisionSelection, RowOptions, TABLE, TableCard, TableFooter, TableToolbar } from '../components/DashboardParts'
import { useDefaultResearchProject } from '../components/DefaultResearchProject'
import DeploymentDetails from '../components/DeploymentDetails'
import LocationDetails from '../components/LocationDetails'
import VisitDetails from '../components/VisitDetails'
import IconButton, { ICON_PATHS } from '../components/IconButton'
import LinkButton from '../components/LinkButton'
import UploadList from '../components/UploadList'
import { Glyph, ViewSwitch, type View } from '../components/ViewSwitch'
import { MENU_ICONS } from '../components/TaskCard'
import { formatDeploymentPeriod, formatInstant } from '../dateFormat'
import { readDeployment } from '../deploymentDetails'
import type { DeploymentFields, DeploymentUploadState, FieldDeployment, LocalLocation, StoredVisit, UploadStateName, UploadTarget } from '../types'
import { destinationLabel } from '../uploadDestinations'
import { btnOutline } from './ImportDeploymentPage'
import type { VisitFocus } from './VisitBookPage'
import { PAGE_CLASS } from '../components/PageBar'

interface Props {
  onBack: () => void
  /** Opens the settings, on the section given — where the default research project is changed. */
  onOpenSettings?: (section?: 'general' | 'locations', researchProjectId?: string, item?: string) => void
  settingsOpen?: boolean
  /** Goes to the visit dashboard, on a visit: the one that started a deployment. */
  onShowVisit?: (visit: VisitFocus) => void
  /** Goes to the Deployments dashboard, on a deployment: its details. */
  onShowDeployment?: (deploymentId: string) => void
  /** Goes to upload a deployment: the research project and the revision it is of. */
  onUpload?: (target: UploadTarget) => void
  /** What the search starts with — a deployment, when the page is reached from its link in the deployments dashboard. */
  search?: string
}

/** How many uploads a page has. */
const PER_PAGE = 10
const LABELS = 6

const plural = (n: number) => `${n} ${n === 1 ? 'upload' : 'uploads'}`


/** One upload: a deployment going to an uploader, and where that is. */
interface UploadRow { deployment: FieldDeployment; upload: DeploymentUploadState }

const STATE_LABEL: Record<UploadStateName, string> = { planned: 'Planned', done: 'Done', failed: 'Failed' }
const STATE_BADGE: Record<UploadStateName, string> = {
  planned: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300',
  done: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  failed: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
}

/** The dashboard of the uploads of the default research project: each deployment is to be uploaded to every uploader in use — that is an upload, planned from the start —, and
 * it ends done or failed; a failed one is tried again. A deployment that will not be made (the camera was stolen) has none. */
export default function UploadStatusPage({ onBack, onOpenSettings, settingsOpen, onShowVisit, onShowDeployment, onUpload, search }: Props) {
  const { project, error: projectError } = useDefaultResearchProject(settingsOpen)
  const [deployments, setDeployments] = useState<FieldDeployment[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [revision, setRevision] = useState('')
  const defaulted = useRef(false)
  // the uploads of one uploader, or '' for all of them
  const [uploader, setUploader] = useState('')
  // the uploads in one state, or '' for all of them
  const [state, setState] = useState<'' | UploadStateName>('')
  const [text, setText] = useState(search ?? '')
  const [page, setPage] = useState(1)
  // as a table, or as a label for each upload
  const [view, setView] = useState<View>('table')
  // the upload whose details are open
  const [opened, setOpened] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  // The revisions and the status cards fold away, to leave the table alone.
  const [revisionsOpen, setRevisionsOpen] = useState(true)
  const [metricsOpen, setMetricsOpen] = useState(true)
  // The panels at the right: what a deployment, a location and a visit say, from their links in the table.
  const [deploymentPanel, setDeploymentPanel] = useState<{ deployment: FieldDeployment; fields: DeploymentFields | null | 'error' | undefined } | null>(null)
  const [sitePanel, setSitePanel] = useState<{ site: string; location: LocalLocation | undefined } | null>(null)
  const [visitPanel, setVisitPanel] = useState<{ visit: StoredVisit; end?: StoredVisit | null } | null>(null)
  const error = projectError ?? loadError

  async function showDeployment(d: FieldDeployment) {
    if (!project) return
    setDeploymentPanel({ deployment: d, fields: undefined })
    let fields: DeploymentFields | null | 'error'
    try { fields = await readDeployment(project.acronym, d.deployment_id) } catch { fields = 'error' }
    setDeploymentPanel((p) => (p && p.deployment.deployment_id === d.deployment_id ? { deployment: d, fields } : p))
  }
  async function showSite(site: string) {
    if (!project) return
    try {
      const { results } = await api.listLocalLocations(project.acronym)
      setSitePanel({ site, location: results.find((l) => l.location_id.toLowerCase() === site.toLowerCase()) })
    } catch (e) { setLoadError(e instanceof Error ? e.message : 'Could not read the locations.') }
  }
  async function showVisit(d: FieldDeployment) {
    if (!project) return
    try {
      const { results } = await api.listVisits(project.acronym, d.site)
      const at = (session: string | null) => (session ? results.find((v) => v.session === session && v.location_id.toLowerCase() === d.site.toLowerCase()) : undefined)
      const visit = at(d.start_session)
      if (visit) setVisitPanel({ visit, end: at(d.end_session) ?? null })
      else setLoadError(`The visit ${d.start_session ?? ''} to ${d.site} was not found.`)
    } catch (e) { setLoadError(e instanceof Error ? e.message : 'Could not read the visit.') }
  }

  useEffect(() => {
    setDeployments(null); setLoadError(null); setRevision(''); defaulted.current = false
    if (!project) return
    let cancelled = false
    api.fieldDeployments(project.acronym)
      .then(({ results }) => {
        if (cancelled) return
        setDeployments(results)
        // opens on the latest revision in the same render the uploads come in — not after it: what is shown does not change under a click
        if (!defaulted.current) {
          defaulted.current = true
          const latest = [...new Set(results.filter((d) => !d.no_images && (d.upload_states ?? []).length > 0).map((d) => d.collection))].sort((x, y) => y.localeCompare(x))[0]
          if (latest) setRevision(latest)
        }
      })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not read the uploads.') })
    return () => { cancelled = true }
  }, [project?.acronym]) // eslint-disable-line react-hooks/exhaustive-deps

  // the uploads there are: every deployment that will be made, times every uploader in use
  const every: UploadRow[] = (deployments ?? []).filter((d) => !d.no_images).flatMap((d) => (d.upload_states ?? []).map((u) => ({ deployment: d, upload: u })))
  const revisions = [...new Set(every.map((r) => r.deployment.collection))].sort((a, b) => b.localeCompare(a))
  const uploaders = [...new Set(every.map((r) => r.upload.destination))]
  // the cards and the table follow the revision and the uploader picked
  const own = every.filter((r) => (!revision || r.deployment.collection === revision) && (!uploader || r.upload.destination === uploader))
  const count = (s: UploadStateName) => own.filter((r) => r.upload.state === s).length
  const percent = own.length ? Math.round((count('done') / own.length) * 100) : 0
  const needle = text.trim().toLowerCase()
  const shown = own
    .filter((r) => !state || r.upload.state === state)
    .filter((r) => !needle || `${r.deployment.deployment_id} ${r.deployment.site} ${r.deployment.collection} ${destinationLabel(r.upload.destination)} ${STATE_LABEL[r.upload.state]}`.toLowerCase().includes(needle))
  const perPage = view === 'labels' ? LABELS : PER_PAGE
  const pages = Math.max(1, Math.ceil(shown.length / perPage))
  const current = Math.min(page, pages)
  const onPage = shown.slice((current - 1) * perPage, current * perPage)
  const key = (r: UploadRow) => `${r.deployment.deployment_id}/${r.upload.destination}`

  // What an upload says of its state, and what can be done with it: as the table and the labels both show them.
  const statusOf = (r: UploadRow) => (
    <>
                            <span title={r.upload.note ?? undefined} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATE_BADGE[r.upload.state]}`}>{STATE_LABEL[r.upload.state]}</span>
                            {r.upload.state === 'done' && <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">{r.upload.uploaded_at ? formatInstant(r.upload.uploaded_at) : 'synced'}</span>}
    </>
  )
  const optionsOf = (r: UploadRow) => {
    const d = r.deployment
    return (
                            <RowOptions label={`Options of the upload of ${d.deployment_id} to ${destinationLabel(r.upload.destination)}`}>
                              {r.upload.state === 'done' && (
                                <IconButton compact label={`View the upload of ${d.deployment_id} to ${destinationLabel(r.upload.destination)}`} title="View the upload" expanded={opened === key(r)}
                                            onClick={() => setOpened(opened === key(r) ? null : key(r))} path={ICON_PATHS.view} />
                              )}
                              {r.upload.state !== 'done' && onUpload && project && (
                                <IconButton compact label={`${r.upload.state === 'failed' ? 'Try again the upload of' : 'Upload'} the deployment ${d.deployment_id}${uploaders.length > 1 ? ` to ${destinationLabel(r.upload.destination)}` : ''}`}
                                            title={d.images_stored ? (r.upload.state === 'failed' ? 'Upload the images again' : 'Upload the images') : 'The deployment is not created yet: its images are not stored'}
                                            disabled={!d.images_stored} onClick={() => onUpload({ researchProjectId: project.acronym, collection: d.collection })} path={ICON_PATHS.upload} />
                              )}
                            </RowOptions>
    )
  }

  const SQUARES: { state: UploadStateName; note: string; tone: string; badge: string; icon: React.ReactNode }[] = [
    { state: 'planned', note: 'Still to be uploaded', tone: 'text-amber-600 dark:text-amber-400', badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300', icon: <Icon path={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>} className="h-5 w-5" /> },
    { state: 'done', note: 'Uploaded', tone: 'text-blue-600 dark:text-blue-400', badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300', icon: <Icon path={<><path d="M20 16.2A4.5 4.5 0 0017.5 8h-1.8A7 7 0 104 14.9" /><path d="M12 12v9M8 16l4-4 4 4" /></>} className="h-5 w-5" /> },
    { state: 'failed', note: 'Tried and failed: try again', tone: 'text-red-600 dark:text-red-400', badge: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300', icon: <Icon path={<><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 17.5v.01" /></>} className="h-5 w-5" /> },
  ]

  return (
    <div className={PAGE_CLASS}>
      <DashboardHeader parent="Menu" onParent={onBack} icon={MENU_ICONS.upload} title="Uploads dashboard" description="The uploads of the deployments to each uploader in use, and their current status."
        actions={<HelpButton expanded={helpOpen} onClick={() => setHelpOpen(true)} />} />

      {error && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {project && deployments === null && <p className="text-sm text-zinc-500 dark:text-zinc-400">Reading the deployments…</p>}

      {deployments !== null && (
        <>
          {revisions.length > 0 && (
            <RevisionSelection open={revisionsOpen} onToggle={() => setRevisionsOpen(!revisionsOpen)} hint="Select one to see its uploads and where each is"
              all={{ label: 'All revisions', note: plural(every.length), percent: every.length ? Math.round((every.filter((r) => r.upload.state === 'done').length / every.length) * 100) : 0 }} value={revision}
              revisions={revisions.map((r) => ({ id: r, label: r, note: plural(every.filter((x) => x.deployment.collection === r).length) }))}
              onPick={(id) => { setRevision(id); setPage(1) }} />
          )}

          <MetricsSection label="Uploads by status" open={metricsOpen} onToggle={() => setMetricsOpen(!metricsOpen)} hint="Click a card to filter the table by status">
            <ProgressCard percent={percent} done={count('done')} total={own.length} barLabel="Uploads done" segments={[{ width: percent, className: 'bg-blue-500' }]}
                          caption={`${count('done')} done · ${count('planned')} planned · ${count('failed')} failed${revision ? ` · ${revision}` : ''}${uploader ? ` · to ${destinationLabel(uploader)}` : ''}`} />
            {SQUARES.map((q) => (
              <StateCard key={q.state} label={STATE_LABEL[q.state]} note={q.note} count={count(q.state)} tone={q.tone} badge={q.badge} icon={q.icon}
                         pressed={state === q.state} onPress={() => { setState(state === q.state ? '' : q.state); setPage(1) }} />
            ))}
          </MetricsSection>

          <TableCard label="Uploads table">
            <TableToolbar searchLabel="Filter the uploads" placeholder="Search by deployment, site, revision, uploader, status…" text={text} onText={(t) => { setText(t); setPage(1) }}
              choice={{ label: 'Uploader', value: uploader, onChange: (v) => { setUploader(v); setPage(1) }, options: uploaders.map((u) => ({ value: u, label: destinationLabel(u) })) }}
              trailing={<ViewSwitch view={view} items="uploads" views={['table', 'labels']} onChange={(v) => { setView(v); setPage(1) }} />}
              onReset={() => { setText(''); setUploader(''); setState(''); setRevision(''); setPage(1) }} />
            <ActiveFilters filters={[{ label: `Revision: ${revision || 'All'}`, tone: 'blue' }, { label: `Uploader: ${uploader ? destinationLabel(uploader) : 'All'}`, tone: 'blue' }, { label: `Status: ${state ? STATE_LABEL[state] : 'All'}`, tone: 'green' }]}
                           summary={`${shown.length} of ${every.length} uploads match`} />

            {view === 'table' && (
            <div className="overflow-x-auto">
              <table className={TABLE.table} aria-label="Uploads">
                <thead className={TABLE.head}>
                  <tr><th scope="col" className="w-10 px-2 py-3"><span className="sr-only">Details</span></th>{['Deployment', 'Location', 'Visit', 'Uploader', 'Status'].map((h) => <th key={h} scope="col" className={TABLE.th}>{h}</th>)}<th scope="col" className="px-4 py-3"><span className="sr-only">What to do</span></th></tr>
                </thead>
                <tbody className={TABLE.body}>
                  {onPage.map((r) => {
                    const d = r.deployment
                    return (
                      <Fragment key={key(r)}>
                        <tr className={TABLE.row(opened === key(r))}>
                          <ChevronCell open={opened === key(r)} available={r.upload.state === 'done'} label={`the details of the upload of ${d.deployment_id} to ${destinationLabel(r.upload.destination)}`} onToggle={() => setOpened(opened === key(r) ? null : key(r))} />
                          <td className={`${TABLE.cell} font-mono text-xs font-semibold`}>
                            {project
                              ? <LinkButton className="font-mono text-xs font-semibold" aria-label={`Show the details of the deployment ${d.deployment_id}`} onClick={() => void showDeployment(d)}>{d.deployment_id}</LinkButton>
                              : d.deployment_id}
                          </td>
                          <td className={`${TABLE.cell} font-mono text-xs`}>
                            {project
                              ? <LinkButton title={`Show the details of the location ${d.site}`} onClick={() => void showSite(d.site)}>{d.site}</LinkButton>
                              : d.site}
                          </td>
                          <td className={TABLE.cell}>
                            {d.start_session && (project
                              ? <LinkButton className="block text-xs font-semibold" aria-label={`Show the visit ${d.start_session} to ${d.site}`} onClick={() => void showVisit(d)}>{d.start_session} · {d.site}</LinkButton>
                              : <span className="block text-xs font-semibold">{d.start_session} · {d.site}</span>)}
                            <span className="block font-mono text-xs">{formatDeploymentPeriod(d)}</span>
                          </td>
                          <td className={TABLE.cell}>{destinationLabel(r.upload.destination)}</td>
                          <td className={TABLE.cell}>{statusOf(r)}</td>
                          <td className={`${TABLE.cell} whitespace-nowrap`}>
                            {optionsOf(r)}
                          </td>
                        </tr>
                        {opened === key(r) && (
                          <DetailsRow colSpan={7}><UploadList deployment={d.deployment_id} uploads={(d.uploads ?? []).filter((u) => u.destination === r.upload.destination)} /></DetailsRow>
                        )}
                      </Fragment>
                    )
                  })}
                  {shown.length === 0 && <tr><td colSpan={7} className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{every.length === 0 ? 'There is no upload yet: no deployment is planned, or no uploader is in use.' : 'No upload matches.'}</td></tr>}
                </tbody>
              </table>
            </div>
            )}
            {view === 'labels' && (
              <div role="group" aria-label="Uploads" className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
                {onPage.map((r) => {
                  const d = r.deployment
                  return (
                    <article key={key(r)} aria-label={`Upload of ${d.deployment_id} to ${destinationLabel(r.upload.destination)}`} className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5">
                      <div className="flex items-center justify-between gap-3">
                        {project
                          ? <LinkButton className="font-mono text-base font-bold" aria-label={`Show the details of the deployment ${d.deployment_id}`} onClick={() => void showDeployment(d)}>{d.deployment_id}</LinkButton>
                          : <span className="font-mono text-base font-bold">{d.deployment_id}</span>}
                        <span>{statusOf(r)}</span>
                      </div>
                      <div className="my-3 border-t border-zinc-200 dark:border-zinc-700/70" />
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center gap-2 font-mono text-xs">
                          <span className="text-blue-500"><Glyph><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></Glyph></span>
                          {project
                            ? <LinkButton title={`Show the details of the location ${d.site}`} onClick={() => void showSite(d.site)}>{d.site}</LinkButton>
                            : d.site}
                        </div>
                        <div>
                          {d.start_session && (project
                            ? <LinkButton className="block text-xs font-semibold" aria-label={`Show the visit ${d.start_session} to ${d.site}`} onClick={() => void showVisit(d)}>{d.start_session} · {d.site}</LinkButton>
                            : <span className="block text-xs font-semibold">{d.start_session} · {d.site}</span>)}
                          <span className="block font-mono text-xs text-zinc-600 dark:text-zinc-400">{formatDeploymentPeriod(d)}</span>
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">To <span className="font-semibold text-zinc-800 dark:text-zinc-200">{destinationLabel(r.upload.destination)}</span></p>
                      </div>
                      <div className="mt-3 flex justify-end">{optionsOf(r)}</div>
                      {opened === key(r) && <div className="mt-3 border-t border-zinc-200 dark:border-zinc-700/70 pt-3"><UploadList deployment={d.deployment_id} uploads={(d.uploads ?? []).filter((u) => u.destination === r.upload.destination)} /></div>}
                    </article>
                  )
                })}
                {shown.length === 0 && <p className="col-span-full py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">{every.length === 0 ? 'There is no upload yet: no deployment is planned, or no uploader is in use.' : 'No upload matches.'}</p>}
              </div>
            )}

            {shown.length > 0 && (
              <TableFooter from={(current - 1) * perPage + 1} to={Math.min(current * perPage, shown.length)} total={shown.length} noun="uploads" page={current} pages={pages} onPage={setPage} />
            )}
          </TableCard>

          {deploymentPanel && (
            <DeploymentDetails deployment={deploymentPanel.deployment} fields={deploymentPanel.fields}
              creation={deploymentPanel.deployment.no_images ? 'not_created' : deploymentPanel.deployment.images_stored ? 'created' : 'planned'}
              uploaded={(deploymentPanel.deployment.upload_states ?? []).some((u) => u.state === 'done')} onClose={() => setDeploymentPanel(null)}
              onOpen={onShowDeployment ? () => { setDeploymentPanel(null); onShowDeployment(deploymentPanel.deployment.deployment_id) } : undefined} />
          )}
          {sitePanel && (
            <LocationDetails site={sitePanel.site} location={sitePanel.location} onClose={() => setSitePanel(null)}
              onOpenInSettings={onOpenSettings && project ? () => { setSitePanel(null); onOpenSettings('locations', project.acronym, sitePanel.site) } : undefined} />
          )}
          {visitPanel && (
            <VisitDetails closed={visitPanel} onClose={() => setVisitPanel(null)}
              onOpenVisit={onShowVisit ? (session) => { setVisitPanel(null); onShowVisit({ session, site: visitPanel.visit.location_id }) } : undefined} />
          )}

          {helpOpen && (
            <HelpDrawer onClose={() => setHelpOpen(false)}>
              <HelpCard title="Uploads" tone="text-blue-600 dark:text-blue-400" icon={HELP_ICONS.upload}><p>An upload is a deployment going to an uploader. Every deployment that will be made has one for each uploader in use, <em>planned</em> from the start — it waits for the deployment to be created. Then it is <em>done</em> or <em>failed</em>, and a failed one is tried again. A deployment of a stolen camera has none: the card is gone.</p></HelpCard>
              <HelpCard title="Progress" tone="text-violet-600 dark:text-violet-400" icon={HELP_ICONS.progress}><p>The bar counts the uploads done over all there are: the deployments of the revision times the uploaders in use (or the one picked). Pick a card to see only the uploads in that status.</p></HelpCard>
              <HelpCard title="Filters and search" tone="text-sky-600 dark:text-sky-400" icon={HELP_ICONS.filter}><p>Search by deployment, site, revision, uploader or status; pick a revision above, and an uploader in the list.</p></HelpCard>
            </HelpDrawer>
          )}
        </>
      )}

      <div className="mt-10">
        <button type="button" className={btnOutline} onClick={onBack}><span aria-hidden="true">← </span>Back</button>
      </div>
    </div>
  )
}
