import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { formatDeploymentPeriod } from '../dateFormat'
import type { DeploymentFields, DeploymentUploadState, FieldDeployment, LocalLocation, SdCard, StoredVisit } from '../types'
import { Icon, StateCard } from './Dashboard'
import { ActiveFilters, HELP_ICONS, HelpCard, HelpDrawer, MetricsSection, ProgressCard, RevisionSelection, RowOptions, TABLE, TableCard, TableFooter, TableToolbar } from './DashboardParts'
import IconButton, { ICON_PATHS } from './IconButton'
import LinkButton from './LinkButton'
import CoordinatesMap, { type MapLegend, type MapPoint } from './CoordinatesMap'
import { Glyph, ViewSwitch, type View } from './ViewSwitch'
import DeploymentDetails from './DeploymentDetails'
import SdCardDetails from './SdCardDetails'
import DeploymentPhotos from './DeploymentPhotos'
import { MENU_ICONS } from './TaskCard'
import VisitDetails from './VisitDetails'

/** How many deployments a page has: ten rows of the table, six labels. */
const PER_PAGE = 10
const LABELS = 6

/** Where a deployment is in its life — which says nothing of the camera, that is the visit's, nor of its uploads, which are their own: planned (a card was left, so its deployment is to be made), created (its images are stored) or not created (the camera was stolen, the card is gone: it will not be made — as a visit that could not be made). */
export type Filter = '' | 'planned' | 'created' | 'not_created'
const phaseOf = (d: FieldDeployment): Exclude<Filter, ''> => d.no_images ? 'not_created' : d.images_stored ? 'created' : 'planned'
const matches = (d: FieldDeployment, f: Filter) => !f || phaseOf(d) === f
/** The colour of a state on the map of the sites — its point, and the dot of its legend. */
const PHASE_FILL: Record<Exclude<Filter, ''>, string> = { planned: 'fill-zinc-400 dark:fill-zinc-500', created: 'fill-emerald-500', not_created: 'fill-red-500' }
const PHASE_DOT: Record<Exclude<Filter, ''>, string> = { planned: 'bg-zinc-400 dark:bg-zinc-500', created: 'bg-emerald-500', not_created: 'bg-red-500' }


/** What a destination is called. */
const DESTINATION_NAME: Record<string, string> = { trapper: 'Trapper', agouti: 'Agouti' }
const STATE_NAME: Record<string, string> = { planned: 'planned', done: 'done', failed: 'failed' }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The deployments the visits of a research project say, as a book: a square for each revision (collection), the status squares of the one picked, and a table — the one a link of the visit book goes to is highlighted. */
export default function FieldDeployments({ deployments: every, onShowSd, onShowLocation, onShowUploads, onShowStatistics, highlight, initialFilter = '', onShowVisit, loadDetails, onUpload, onUploadMany, onCreate, loadVisits, sdCards, researchProjectId, helpOpen = false, onCloseHelp }: {
  /** The help and the legend are open: the panel that says them is this component's, as it knows the states. */
  helpOpen?: boolean
  onCloseHelp?: () => void
  /** Goes to the SD card — its page in the settings, where its state and, if it is archived, why are. */
  onShowSd?: (label: string) => void
  /** Goes to the location — its page in the settings. */
  onShowLocation?: (site: string) => void
  /** Goes to the uploads dashboard, on the uploads of a deployment. */
  onShowUploads?: (deploymentId: string) => void
  /** Goes to the statistics, on a deployment: its revision, with it isolated. */
  onShowStatistics?: (deployment: FieldDeployment) => void
  deployments: FieldDeployment[]; highlight?: string; initialFilter?: Filter; onShowVisit?: (visit: { session: string; site: string }) => void
  /** Reads what a created deployment says of itself: its details, for its View button. */
  loadDetails?: (deploymentId: string) => Promise<DeploymentFields | null>
  /** Goes to upload the deployment — its revision is what the upload page starts from. */
  onUpload?: (deployment: FieldDeployment) => void
  /** Goes to upload the deployments ticked — all of one revision. */
  onUploadMany?: (deployments: FieldDeployment[]) => void
  /** Goes to create the deployment — to import its images — of one that is planned and whose card was already collected. */
  onCreate?: (deployment: FieldDeployment) => void
  /** Reads the visit that left the camera of a deployment, and the one that collected its card when there is one: the link of the visit opens them in a panel. */
  loadVisits?: (deployment: FieldDeployment) => Promise<{ visit: StoredVisit; end?: StoredVisit | null } | null>
  /** The SD cards of the research project: the link of a card opens its data in a panel — with a way on to the settings, by `onShowSd` — instead of going to the settings at once. */
  sdCards?: SdCard[]
  /** The research project of the deployments: with it, the photos of a created deployment can be looked at in a panel. */
  researchProjectId?: string
}) {
  // Every card that was left is a deployment to make; the ones whose camera was stolen will not be made (Not created).
  const deployments = every
  // The upload to each uploader in use is its own state, apart from the deployment's: planned from the start, then done or failed.
  const statesOf = (d: FieldDeployment): DeploymentUploadState[] => d.upload_states ?? [
    { destination: 'trapper', state: d.on_trapper ? 'done' : 'planned', kind: d.on_trapper ? (d.uploaded_at ? 'uploaded' : 'synced') : null, uploaded_at: d.uploaded_at ?? null, note: null },
  ]
  // opens on the latest revision — from the first render, not after it: what is shown does not change under a click —, unless a link brings to one deployment
  const [revision, setRevision] = useState(() => (highlight ? '' : [...new Set(every.map((d) => d.collection))].sort((a, b) => b.localeCompare(a))[0] ?? ''))
  const [filter, setFilter] = useState<Filter>(initialFilter)
  const [page, setPage] = useState(1)
  const [text, setText] = useState('')
  // How they are shown: the table, labels, or only the search field — which lists what matches as it is written, and picking one goes to it in the table.
  const [view, setView] = useState<View>('table')
  // where the locations are — read the first time the map is asked for
  const [locations, setLocations] = useState<LocalLocation[] | null>(null)
  useEffect(() => {
    if (view !== 'map' || !researchProjectId || locations !== null) return
    let cancelled = false
    api.listLocalLocations(researchProjectId)
      .then(({ results }) => { if (!cancelled) setLocations(results) })
      .catch(() => { if (!cancelled) setLocations([]) })
    return () => { cancelled = true }
  }, [view, researchProjectId, locations])
  const [listOpen, setListOpen] = useState(false)
  const [active, setActive] = useState(0)
  const perPage = view === 'labels' ? LABELS : PER_PAGE
  // The revisions and the status cards fold away, to leave the table alone.
  const [revisionsOpen, setRevisionsOpen] = useState(true)
  const [metricsOpen, setMetricsOpen] = useState(true)
  // a deployment the previous and next buttons go to: it takes the place of the one a link of another page said, and is brought into view
  const [jump, setJump] = useState<string | undefined>(undefined)
  const focus = jump ?? highlight
  // the visit whose panel is open, and why one could not be shown
  const [visitPanel, setVisitPanel] = useState<{ visit: StoredVisit; end?: StoredVisit | null } | null>(null)
  const [visitError, setVisitError] = useState<string | null>(null)
  // the SD card whose panel is open
  const [cardPanel, setCardPanel] = useState<string | null>(null)
  async function showVisit(d: FieldDeployment) {
    setVisitError(null)
    try {
      const found = await loadVisits!(d)
      if (found) setVisitPanel(found)
      else setVisitError(`The visit ${d.start_session ?? ''} to ${d.site} was not found.`)
    } catch (e) { setVisitError(e instanceof Error ? e.message : 'Could not read the visit.') }
  }
  const [details, setDetails] = useState<Record<string, DeploymentFields | null | 'error'>>({})
  // what a deployment says of itself is read once, for the row that opens it and for the panel of its eye
  function read(id: string) {
    if (loadDetails && !(id in details)) loadDetails(id).then((fields) => setDetails((d) => ({ ...d, [id]: fields }))).catch(() => setDetails((d) => ({ ...d, [id]: 'error' })))
  }
  // the deployment whose panel is open
  const [panelId, setPanelId] = useState<string | null>(null)
  const [photosPanel, setPhotosPanel] = useState<FieldDeployment | null>(null)
  const showPanel = (id: string) => { setPanelId(id); read(id) }
  const revisions = [...new Set(deployments.map((d) => d.collection))].sort((a, b) => b.localeCompare(a))
  const inRevision = revision ? deployments.filter((d) => d.collection === revision) : deployments
  const needle = text.trim().toLowerCase()
  const shown = inRevision.filter((d) => matches(d, filter)).filter((d) => !needle || `${d.deployment_id} ${d.site} ${d.collection} ${d.card ?? ''} ${d.camera_id ?? ''} ${phaseOf(d)}`.replace('_', ' ').toLowerCase().includes(needle))
  const pages = Math.max(1, Math.ceil(shown.length / perPage))
  const current = Math.min(page, pages)
  const onPage = shown.slice((current - 1) * perPage, current * perPage)
  const count = (f: Filter) => inRevision.filter((d) => matches(d, f)).length
  // The deployments ticked, to upload them all: each one created, with its upload to Trapper still to do, and all of one revision.
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const pickedDeployments = deployments.filter((d) => picked.has(d.deployment_id))
  const uploadable = (d: FieldDeployment) => phaseOf(d) === 'created' && statesOf(d).some((u) => u.destination === 'trapper' && u.state !== 'done')
  const canUploadPicked = pickedDeployments.length > 0 && pickedDeployments.every(uploadable) && new Set(pickedDeployments.map((d) => d.collection)).size === 1
  const togglePicked = (id: string) => setPicked((p) => { const next = new Set(p); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const pagePicked = onPage.length > 0 && onPage.every((d) => picked.has(d.deployment_id))
  const togglePage = () => setPicked((p) => { const next = new Set(p); for (const d of onPage) { if (pagePicked) next.delete(d.deployment_id); else next.add(d.deployment_id) } return next })

  // the one a link of the visit book goes to is brought into view, on its revision and on its page
  const marked = useRef<HTMLTableRowElement | null>(null)
  useEffect(() => {
    if (!focus) return
    const target = deployments.find((d) => d.deployment_id === focus)
    if (!target) return
    setRevision(target.collection); setFilter(''); setText('')
    const position = deployments.filter((d) => d.collection === target.collection).findIndex((d) => d.deployment_id === focus)
    setPage(Math.floor(position / perPage) + 1)
  }, [focus, deployments])
  useEffect(() => { marked.current?.scrollIntoView?.({ block: 'center' }) })
  // on arrival the latest revision is the one picked (unless a link brings to one deployment): the dashboard opens on what is current
  const defaulted = useRef(every.length > 0)   // it was settled with the first render when the deployments were there
  useEffect(() => {
    if (defaulted.current || deployments.length === 0) return
    defaulted.current = true
    if (!focus && revisions[0]) setRevision(revisions[0])
  }, [deployments]) // eslint-disable-line react-hooks/exhaustive-deps

  // of everything that was planned: a deployment that will not be made was planned too
  const percent = inRevision.length > 0 ? Math.round((count('created') / inRevision.length) * 100) : 0
  const SQUARES: { filter: Exclude<Filter, ''>; label: string; note: string; tone: string; badge: string; icon: ReactNode }[] = [
    { filter: 'planned', label: 'Planned', note: 'Images collected: to be created', tone: 'text-zinc-600 dark:text-zinc-300', badge: 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300', icon: <Icon path={<><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></>} className="h-5 w-5" /> },
    { filter: 'created', label: 'Created', note: 'Images stored', tone: 'text-emerald-600 dark:text-emerald-400', badge: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300', icon: <Icon path={<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />} className="h-5 w-5" /> },
    { filter: 'not_created', label: 'Not created', note: 'Camera stolen: the card is gone', tone: 'text-red-600 dark:text-red-400', badge: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300', icon: <Icon path={<><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></>} className="h-5 w-5" /> },
  ]


  const phaseLabel: Record<Exclude<Filter, ''>, string> = { planned: 'Planned', created: 'Created', not_created: 'Not created' }
  // Picking one from the list of the search goes to it in the table: its revision and its page, marked.
  const goTo = (d: FieldDeployment) => { setJump(d.deployment_id); setView('table'); setListOpen(false); setText('') }

  // The sites on the map: one point for each site of the deployments that match — two deployments of a site in different revisions share it: the point is the latest one's —,
  // coloured by its state, with a tick when it was uploaded.
  const mapSites = (() => {
    if (view !== 'map') return { points: [] as MapPoint[], legend: [] as MapLegend[], missing: 0 }
    const bySite = new Map<string, FieldDeployment[]>()
    for (const d of shown) bySite.set(d.site.toLowerCase(), [...(bySite.get(d.site.toLowerCase()) ?? []), d])
    const points: MapPoint[] = []
    let missing = 0
    for (const group of bySite.values()) {
      const latest = [...group].sort((a, b) => b.collection.localeCompare(a.collection) || b.start.localeCompare(a.start))[0]
      const place = locations?.find((l) => l.location_id.toLowerCase() === latest.site.toLowerCase())
      if (!place || place.latitude === null || place.longitude === null) { missing += 1; continue }
      const phase = phaseOf(latest)
      const uploaded = phase === 'created' && statesOf(latest).some((u) => u.state === 'done')
      points.push({
        key: latest.site.toLowerCase(), label: latest.site, latitude: place.latitude, longitude: place.longitude, legend: phase, fill: PHASE_FILL[phase], subtitle: place.name,
        badge: uploaded ? 'Uploaded' : undefined,
        lines: [
          ['State', `${phaseLabel[phase]} · ${latest.deployment_id}`],
          ['Coords', `${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}`],
          ['Period', formatDeploymentPeriod(latest)],
          ...(latest.card ? [['SD card', latest.card] as [string, string]] : []),
          ...(latest.card_full ? [['Photos', 'Card full'] as [string, string]] : latest.photos_counted != null ? [['Photos', String(latest.photos_counted)] as [string, string]] : []),
          ...(latest.camera_id ? [['Camera', latest.camera_id] as [string, string]] : []),
          ...(group.length > 1 ? [['Deployments', String(group.length)] as [string, string]] : []),
        ],
        footer: phase === 'created' ? (uploaded ? 'Uploaded' : 'Not uploaded yet') : phase === 'planned' ? 'Images not stored yet' : 'Camera stolen: no images',
        // what the card of the site offers: the buttons of its row, and to see it in the table
        actions: () => rowOptions(latest), pickName: 'Show it in the table', onPick: () => goTo(latest),
      })
    }
    const present = new Set(points.map((p) => p.legend))
    return { points, missing, legend: (['created', 'planned', 'not_created'] as const).filter((p) => present.has(p)).map((p) => ({ key: p, label: phaseLabel[p], dot: PHASE_DOT[p] })) }
  })()

  // What a deployment says of itself, as the table and the labels both show it.
  // the photos counted — or "Card full", when the card was and they were not counted —: a link to look at them when the deployment is created — its images are in the collections folder
  const photosText = (d: FieldDeployment) => (d.card_full ? 'Card full' : `${d.photos_counted} photos`)
  const hasPhotosText = (d: FieldDeployment) => d.card_full === true || d.photos_counted != null
  // a card that was full is told in red, as a state, in place of the number: its photos were not counted
  const cardFull = 'rounded-md px-2 py-0.5 text-xs font-semibold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
  const photos = (d: FieldDeployment) => (researchProjectId && phaseOf(d) === 'created'
    ? (d.card_full
      ? <button type="button" title="The card was full, so its photos were not counted. Show the photos" aria-label={`Show the photos of the deployment ${d.deployment_id}`} onClick={() => setPhotosPanel(d)} className={`${cardFull} hover:bg-red-200 dark:hover:bg-red-900/60`}>Card full</button>
      : <LinkButton className="font-semibold" aria-label={`Show the photos of the deployment ${d.deployment_id}`} onClick={() => setPhotosPanel(d)}>{photosText(d)}</LinkButton>)
    : (d.card_full ? <span title="The card was full, so its photos were not counted" className={cardFull}>Card full</span> : photosText(d)))
  const creation = (d: FieldDeployment) => (
    phaseOf(d) === 'not_created'
                          ? <span title="The camera was stolen: the card is gone, so the deployment will not be created" className="rounded-full px-2.5 py-1 text-xs font-semibold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">Not created</span>
                          : phaseOf(d) === 'planned'
                          ? <span className="rounded-full px-2.5 py-1 text-xs font-semibold bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">Planned</span>
                          : <span className="rounded-full px-2.5 py-1 text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">Created</span>
  )
  const uploadMark = (d: FieldDeployment) => (
    phaseOf(d) === 'created' ? (() => {
                          const states = statesOf(d)
                          const tip = states.map((u) => `${DESTINATION_NAME[u.destination] ?? u.destination}: ${STATE_NAME[u.state] ?? u.state}`).join(' · ')
                          const tick = <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></svg>
                          return states.some((u) => u.state === 'done')
                            ? (onShowUploads
                              ? <button type="button" title={`Uploaded (${tip}). Show its uploads`} aria-label={`Show the uploads of the deployment ${d.deployment_id}`} onClick={() => onShowUploads(d.deployment_id)}
                                        className="inline-flex rounded-full text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{tick}</button>
                              : <span role="img" title={`Uploaded (${tip})`} aria-label="Uploaded" className="inline-flex text-emerald-600 dark:text-emerald-400">{tick}</span>)
                            : <span role="img" title={`Not uploaded (${tip})`} aria-label="Not uploaded" className="inline-flex text-zinc-400 dark:text-zinc-500">
                                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>
                              </span>
                        })() : <span className="text-zinc-400">—</span>
  )
  const rowOptions = (d: FieldDeployment) => (
    // only what can be done with the row: the options that do not apply to it are not there
                        <RowOptions label={`Options of the deployment ${d.deployment_id}`}>
                          {phaseOf(d) === 'created' && onShowStatistics && (
                            <IconButton compact label={`Show the statistics of the deployment ${d.deployment_id}`} title="Show the statistics of the deployment" onClick={() => onShowStatistics(d)} path={<path d="M18 20V10M12 20V4M6 20v-6" />} />
                          )}
                          {phaseOf(d) === 'created' && (
                            <IconButton compact label={`View the deployment ${d.deployment_id}`} title="View the deployment" onClick={() => showPanel(d.deployment_id)} path={ICON_PATHS.view} />
                          )}
                          {/* the card was collected and the images are not stored: the deployment can be made now */}
                          {phaseOf(d) === 'planned' && d.status === 'closed' && onCreate && (
                            <IconButton compact label={`Create the deployment ${d.deployment_id}`} title="Create the deployment" onClick={() => onCreate(d)}
                                        path={MENU_ICONS.deployment} />
                          )}
                          {phaseOf(d) === 'created' && onUpload && statesOf(d).some((u) => u.destination === 'trapper' && u.state !== 'done') && (
                            <IconButton compact label={`Upload the deployment ${d.deployment_id}`} title={statesOf(d).some((u) => u.state === 'failed') ? 'Upload the images again' : 'Upload the images'} onClick={() => onUpload(d)} path={ICON_PATHS.upload} />
                          )}
                        </RowOptions>
  )

  return (
    <div aria-label="Deployments the visits say" role="region">
      {deployments.length === 0 ? <p className="text-sm text-zinc-500 dark:text-zinc-400">No deployment yet: no visit has left a camera.</p> : (
        <>
          <RevisionSelection open={revisionsOpen} onToggle={() => setRevisionsOpen(!revisionsOpen)} hint="Select one to filter its deployments"
            all={{ label: 'All revisions', note: plural(deployments.length, 'deployment', 'deployments'), percent: deployments.length > 0 ? Math.round((deployments.filter((d) => phaseOf(d) === 'created').length / deployments.length) * 100) : 0 }} value={revision}
            revisions={revisions.map((r) => ({ id: r, label: r, note: plural(deployments.filter((d) => d.collection === r).length, 'deployment', 'deployments') }))}
            onPick={(id) => { setRevision(id); setFilter(''); setPage(1) }} />

          <MetricsSection label="Deployments by status" open={metricsOpen} onToggle={() => setMetricsOpen(!metricsOpen)} hint="Click a card to filter the table by status">
            <ProgressCard percent={percent} done={count('created')} total={inRevision.length} barLabel="Deployments created" segments={[{ width: percent, className: 'bg-emerald-500' }]}
                          caption={`${count('created')} created · ${count('planned')} to create${count('not_created') > 0 ? ` · ${count('not_created')} will not be created` : ''}`} />
            {SQUARES.map((q) => (
              <StateCard key={q.filter} label={q.label} note={q.note} count={count(q.filter)} tone={q.tone} badge={q.badge} icon={q.icon} pressed={filter === q.filter}
                         onPress={() => { setFilter(filter === q.filter ? '' : q.filter); setPage(1) }} />
            ))}
          </MetricsSection>

          {visitError && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{visitError}</p>}
          <TableCard label="Deployments table">
            <TableToolbar searchLabel="Filter the deployments" placeholder={view === 'search' ? 'Select a deployment…' : 'Search by deployment, location, SD card, camera…'} text={text} onText={(t) => { setText(t); setPage(1); if (view === 'search') { setListOpen(true); setActive(0) } }}
              choice={{ label: 'Status', value: filter, onChange: (v) => { setFilter(v as Filter); setPage(1) }, options: SQUARES.map((q) => ({ value: q.filter, label: q.label })) }}
              trailing={<ViewSwitch view={view} items="deployments" views={['table', 'labels', 'map', 'search']} onChange={(v) => { setView(v); setPage(1); setListOpen(false) }} />}
              onSearchBlur={() => setListOpen(false)}
              onSearchKeyDown={(e) => {
                if (view !== 'search') return
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, shown.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
                else if (e.key === 'Enter' && listOpen && needle && shown[active]) { e.preventDefault(); goTo(shown[active]) }
                else if (e.key === 'Escape') setListOpen(false)
              }}
              onReset={() => { setText(''); setFilter(''); setRevision(''); setPage(1); setListOpen(false) }} />
            {view === 'search' && listOpen && needle !== '' && (
              <ul role="listbox" aria-label="Deployments" className="max-h-64 overflow-y-auto border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 py-1 text-sm">
                {shown.map((d, i) => (
                  <li key={d.deployment_id} role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => goTo(d)}
                      className={`cursor-pointer px-4 py-2 font-mono text-xs text-zinc-800 dark:text-zinc-200 ${i === active ? 'bg-blue-50 dark:bg-zinc-800' : ''}`}>
                    {d.deployment_id} · {d.site} · {phaseLabel[phaseOf(d)]}
                  </li>
                ))}
                {shown.length === 0 && <li className="px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400">No deployment matches.</li>}
              </ul>
            )}
            {view !== 'search' && (<ActiveFilters filters={[{ label: `Revision: ${revision || 'All'}`, tone: 'blue' }, { label: `Status: ${filter ? SQUARES.find((q) => q.filter === filter)?.label : 'All'}`, tone: 'green' }]} summary={`${shown.length} of ${deployments.length} deployments match`} />)}

            {view === 'table' && picked.size > 0 && (
              <div role="group" aria-label="Action on the selected deployments" className="m-3 flex flex-wrap items-center gap-3 rounded-xl border border-blue-300 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 text-sm">
                <span role="status" className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">{picked.size} selected</span>
                {picked.size < shown.length && (
                  <button type="button" className="text-blue-700 dark:text-blue-300 underline hover:no-underline" onClick={() => setPicked(new Set(shown.map((d) => d.deployment_id)))}>Select all {shown.length} matching</button>
                )}
                <button type="button" className="rounded-lg border border-zinc-300 dark:border-zinc-600 px-4 py-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => setPicked(new Set())}>Clear</button>
                <button type="button" className="ml-auto inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!canUploadPicked || !onUploadMany} title={canUploadPicked ? 'Upload the selected deployments' : 'Only deployments that are created and not yet on Trapper, all of one revision, can be uploaded.'} onClick={() => onUploadMany?.(pickedDeployments)}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICON_PATHS.upload}</svg>Upload deployments
                </button>
              </div>
            )}
            {view === 'table' && (
            <div className="overflow-x-auto">
              <table className={TABLE.table} aria-label="Deployments">
                <thead className={TABLE.head}>
                  <tr><th scope="col" className="w-10 pl-4 py-3"><input type="checkbox" aria-label="Select all the deployments of the page" checked={pagePicked} ref={(el) => { if (el) el.indeterminate = !pagePicked && onPage.some((d) => picked.has(d.deployment_id)) }} onChange={togglePage} /></th>{['Deployment', 'Visit', 'SD and photos', 'Creation', 'Upload'].map((h) => <th key={h} scope="col" className={TABLE.th}>{h}</th>)}<th scope="col" className="px-4 py-3"><span className="sr-only">What to do</span></th></tr>
                </thead>
                <tbody className={TABLE.body}>
                  {onPage.map((d) => (
                    <Fragment key={d.deployment_id}>
                    <tr ref={d.deployment_id === focus ? marked : undefined} aria-current={d.deployment_id === focus ? 'true' : undefined} className={d.deployment_id === focus ? 'row-flash bg-blue-100/80 dark:bg-blue-950/50 transition-colors' : TABLE.row(false)}>
                      <td className={`border-l-4 pl-3 py-3 ${d.deployment_id === focus ? 'border-l-blue-500' : 'border-l-transparent'}`}>
                        <input type="checkbox" aria-label={`Select the deployment ${d.deployment_id}`} checked={picked.has(d.deployment_id)} onChange={() => togglePicked(d.deployment_id)} />
                      </td>
                      <td className={`${TABLE.cell} font-mono text-xs font-semibold`}>
                        {d.deployment_id === focus && <svg data-marker aria-hidden="true" viewBox="0 0 24 24" className="mr-1 inline-block h-4 w-4 -translate-y-px fill-none stroke-blue-600 dark:stroke-sky-400" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 5l8 7-8 7" /></svg>}
                        {d.deployment_id}
                      </td>
                      <td className={TABLE.cell}>
                        {d.start_session && (onShowVisit || loadVisits
                          ? <LinkButton className="block text-xs font-semibold" aria-label={`Show the visit ${d.start_session} to ${d.site}`} onClick={() => (loadVisits ? void showVisit(d) : onShowVisit?.({ session: d.start_session!, site: d.site }))}>{d.start_session} · {d.site}</LinkButton>
                          : <span className="block text-xs font-semibold">{d.start_session} · {d.site}</span>)}
                        <span className="block font-mono text-xs">{formatDeploymentPeriod(d)}</span>
                      </td>
                      <td className={`${TABLE.cell} text-xs text-zinc-600 dark:text-zinc-400`}>
                        {d.card && (onShowSd || sdCards
                          ? <LinkButton className="font-semibold" aria-label={`Show the state of the SD card ${d.card}`} onClick={() => (sdCards ? setCardPanel(d.card!) : onShowSd?.(d.card!))}>SD {d.card}</LinkButton>
                          : <>SD {d.card}</>)}
                        {d.card && hasPhotosText(d) && ' · '}{hasPhotosText(d) && photos(d)}
                      </td>
                      <td className={TABLE.cell}>
                        {creation(d)}
                      </td>
                      <td className={TABLE.cell}>
                        {uploadMark(d)}
                      </td>
                      <td className={`${TABLE.cell} whitespace-nowrap`}>
                        {rowOptions(d)}
                      </td>
                    </tr>
                    </Fragment>
                  ))}
                  {shown.length === 0 && <tr><td colSpan={7} className="px-4 py-3 text-zinc-500 dark:text-zinc-400">No deployment matches.</td></tr>}
                </tbody>
              </table>
            </div>
            )}
            {view === 'map' && (
              <>
                {locations === null && shown.length > 0 && <p className="px-4 pt-4 text-sm text-zinc-500 dark:text-zinc-400">Reading where the sites are…</p>}
                <CoordinatesMap name="Deployments on a map" points={mapSites.points} legend={mapSites.legend} missing={mapSites.missing} noun="sites" markedKey={every.find((d) => d.deployment_id === focus)?.site.toLowerCase() ?? null} />
              </>
            )}
            {view === 'labels' && (
              <div role="group" aria-label="Deployments" className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
                {onPage.map((d) => (
                  <article key={d.deployment_id} aria-label={`Deployment ${d.deployment_id}`} aria-current={d.deployment_id === focus ? 'true' : undefined}
                           className={`rounded-2xl border p-5 ${d.deployment_id === focus ? 'row-flash border-blue-500 bg-blue-50 dark:bg-blue-950/30 ring-2 ring-blue-500/40' : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-base font-bold text-zinc-900 dark:text-white">{d.deployment_id}</span>
                      {creation(d)}
                    </div>
                    <div className="my-3 border-t border-zinc-200 dark:border-zinc-700/70" />
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2 font-mono text-xs">
                        <span className="text-blue-500"><Glyph><path d="M12 21s-6-5.200-6-10a6 6 0 1112 0c0 4.800-6 10-6 10z" /><circle cx="12" cy="11" r="2.200" /></Glyph></span>
                        {onShowLocation
                          ? <LinkButton title={`Show the details of the location ${d.site}`} onClick={() => onShowLocation(d.site)}>{d.site}</LinkButton>
                          : d.site}
                      </div>
                      <div>
                        {d.start_session && (onShowVisit || loadVisits
                          ? <LinkButton className="block text-xs font-semibold" aria-label={`Show the visit ${d.start_session} to ${d.site}`} onClick={() => (loadVisits ? void showVisit(d) : onShowVisit?.({ session: d.start_session!, site: d.site }))}>{d.start_session} · {d.site}</LinkButton>
                          : <span className="block text-xs font-semibold">{d.start_session} · {d.site}</span>)}
                        <span className="block font-mono text-xs text-zinc-600 dark:text-zinc-400">{formatDeploymentPeriod(d)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs text-zinc-600 dark:text-zinc-400">
                        <span>
                          {d.card && (onShowSd || sdCards
                            ? <LinkButton className="font-semibold" aria-label={`Show the state of the SD card ${d.card}`} onClick={() => (sdCards ? setCardPanel(d.card!) : onShowSd?.(d.card!))}>SD {d.card}</LinkButton>
                            : <>SD {d.card}</>)}
                          {d.card && hasPhotosText(d) && ' · '}{hasPhotosText(d) && photos(d)}
                        </span>
                        <span className="flex items-center gap-2"><span className="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Upload</span>{uploadMark(d)}</span>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end">{rowOptions(d)}</div>
                  </article>
                ))}
                {shown.length === 0 && <p className="col-span-full py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">No deployment matches.</p>}
              </div>
            )}

            {view !== 'search' && view !== 'map' && shown.length > 0 && (
              <TableFooter from={(current - 1) * perPage + 1} to={Math.min(current * perPage, shown.length)} total={shown.length} noun="deployments" page={current} pages={pages} onPage={setPage} />
            )}
          </TableCard>

          {panelId && (() => {
            const shown = deployments.find((x) => x.deployment_id === panelId)
            return shown && <DeploymentDetails deployment={shown} fields={details[panelId]} creation={phaseOf(shown)} uploaded={statesOf(shown).some((u) => u.state === 'done')} onClose={() => setPanelId(null)} />
          })()}

          {visitPanel && (
            <VisitDetails closed={visitPanel} onClose={() => setVisitPanel(null)} researchProjectId={researchProjectId}
              onOpenVisit={onShowVisit ? (session) => { setVisitPanel(null); onShowVisit({ session, site: visitPanel.visit.location_id }) } : undefined} />
          )}

          {photosPanel && researchProjectId && (
            <DeploymentPhotos researchProjectId={researchProjectId} collection={photosPanel.collection} deploymentId={photosPanel.deployment_id} timezone={photosPanel.timezone} onClose={() => setPhotosPanel(null)} />
          )}

          {cardPanel && (
            <SdCardDetails label={cardPanel} card={sdCards?.find((c) => c.label.toLowerCase() === cardPanel.toLowerCase())} onClose={() => setCardPanel(null)}
              onOpenInSettings={onShowSd ? () => { setCardPanel(null); onShowSd(cardPanel) } : undefined} />
          )}

          {helpOpen && onCloseHelp && (
            <HelpDrawer onClose={onCloseHelp}>
              <HelpCard title="Overall progress" tone="text-blue-600 dark:text-blue-400" icon={HELP_ICONS.progress}><p>The share of the deployments that are created — their images are stored — over the revision picked or over all of them.</p></HelpCard>
              <HelpCard title="Deployment states" tone="text-emerald-600 dark:text-emerald-400" icon={HELP_ICONS.tags}>
                <dl className="space-y-2">
                  {SQUARES.map((q) => <div key={q.filter} className="flex items-baseline gap-3"><dt className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${q.badge}`}>{q.label}</dt><dd>{q.note}</dd></div>)}
                </dl>
              </HelpCard>
              <HelpCard title="Creation and uploads" tone="text-violet-600 dark:text-violet-400" icon={HELP_ICONS.upload}><p>A deployment is <em>planned</em> while its card is to be imported and <em>created</em> when its images are stored. <em>Not created</em> is a deployment of a camera that was stolen: the card is gone. Uploading is another thing: each deployment has an upload for every uploader in use, <em>planned</em> from the start, then <em>done</em> or <em>failed</em> — a failed one is tried again.</p></HelpCard>
              <HelpCard title="Filters and search" tone="text-sky-600 dark:text-sky-400" icon={HELP_ICONS.filter}><p>Search by deployment, site, card or camera, and filter by status; pick a revision above.</p></HelpCard>
            </HelpDrawer>
          )}
        </>
      )}
    </div>
  )
}
