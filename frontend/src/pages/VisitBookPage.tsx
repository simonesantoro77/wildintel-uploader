import { actionsLabel } from '../visitActions'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { PHASE_BADGE, PHASE_DOT, PHASE_FILL, PHASE_LABEL } from '../visitPhases'
import { api } from '../api'
import { formatVisitWhen } from '../dateFormat'
import { Icon, StateCard } from '../components/Dashboard'
import Notice from '../components/Notice'
import { ActiveFilters, DashboardBar, DownloadButton, HELP_ICONS, HelpButton, HelpCard, HelpDrawer, MetricsSection, ProgressCard, RevisionSelection, RowOptions, TABLE, TableCard, TableFooter, TableToolbar } from '../components/DashboardParts'
import { MENU_ICONS } from '../components/TaskCard'
import IconButton, { ICON_PATHS } from '../components/IconButton'
import LinkButton from '../components/LinkButton'
import EditVisitDialog from '../components/EditVisitDialog'
import LocationDetails from '../components/LocationDetails'
import VisitDetails from '../components/VisitDetails'
import CoordinatesMap, { type MapLegend, type MapPoint } from '../components/CoordinatesMap'
import { ViewSwitch, type View } from '../components/ViewSwitch'
import { useDefaultResearchProject } from '../components/DefaultResearchProject'
import type { BookVisit, ClosedVisitTarget, LocalLocation, RevisionCreated, VisitState } from '../types'
import { btnOutline, btnPrimary } from './ImportDeploymentPage'
import { download } from '../csvFile'

interface Props {
  onBack: () => void
  /** Goes to Import deployment for a closed visit: its research project, and the visit whose card was collected — the deployment is of it. */
  onImportImages?: (target: ClosedVisitTarget) => void
  /** Opens the settings, on the section given — where the default research project is changed. */
  onOpenSettings?: (section?: 'general' | 'cameras' | 'locations', researchProjectId?: string, item?: string) => void
  /** Whether the settings are open: the default research project is read again when they are closed, as it may have been changed. */
  settingsOpen?: boolean
  /** Goes to the status of the deployments, on one of them: the link of the tick of the images stored. */
  onShowDeployment?: (deploymentId: string) => void
  /** The visit shown open, on its revision and its page: the one a link of the deployments dashboard goes to. */
  focus?: VisitFocus
  /** Goes to register the visit of a location that is planned: its research project and the location. */
  onCreateVisit?: (target: { researchProjectId: string; site: string }) => void
  /** Goes to Register visits — the button in the header of the dashboard. */
  onRegisterVisits?: () => void
  /** Goes to Import deployments for several closed visits ticked: their research project and the visits whose cards were collected — the deployments are of them. */
  onCreateDeployments?: (targets: ClosedVisitTarget[]) => void
}



/** The columns the book can be sorted by. */
type SortKey = 'session' | 'where' | 'when' | 'status' | 'actions' | 'stored'
const COLUMNS: [SortKey, string][] = [['session', 'Revision'], ['where', 'Location'], ['when', 'When'], ['actions', 'Actions'], ['status', 'Status'], ['stored', 'Images']]

/** What a row says in a column, to sort by it: the rows not made go last whatever the direction (they have no day, no actions…). */
function sortValue(v: BookVisit, key: SortKey): string | number {
  switch (key) {
    case 'session': return v.session
    case 'where': return v.location_id.toLowerCase()
    case 'when': return `${v.date}T${v.time}`
    case 'status': { const i = PHASES.indexOf(phaseOf(v) as Phase); return i < 0 ? PHASES.length : i } // a visit that left no camera goes last
    case 'actions': return actionsLabel(v.actions).toLowerCase()
    case 'stored': return v.deployment_id ? 0 : v.deployment_status === 'closed' ? 1 : 2 // stored, to create, not stored
  }
}

/** Where a visit is in its life: planned (not made yet), deployed (it left a camera that is still out), collected (the card was collected: a later visit closed it), stolen (the camera was
 * stolen, so no images) not visited (the visit could not be made) and no camera (it left none and nothing is waited for). Whether the images are stored is told by the Images column, not by the state. */
type Phase = VisitState
const phaseOf = (v: BookVisit): Phase | null =>
  v.state !== undefined ? v.state : v.not_done ? 'planned' : v.not_visited ? 'not_visited' : v.deployment_status === 'open' ? 'deployed' : v.deployment_status === 'closed' ? (v.deployment_no_images ? 'stolen' : 'collected') : null
const PHASES: Phase[] = ['collected', 'stolen', 'deployed', 'not_visited', 'no_camera', 'unknown', 'planned']
/** The rows the status cards show: the ones in a phase, or all. */
type StatusFilter = '' | Phase
const matches = (v: BookVisit, f: StatusFilter) => !f || phaseOf(v) === f

/** The visit a link of another page goes to: the revision and the site it was made at. */
export interface VisitFocus { session: string; site: string }

/** The order the book has when no column is chosen: the latest revision first, within it the visits made newest first and then the ones not made, by site. */
const byDefault = (a: BookVisit, b: BookVisit) =>
  b.session.localeCompare(a.session) || Number(a.not_done) - Number(b.not_done) || (a.not_done ? a.location_id.localeCompare(b.location_id) : `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`))
const keyOf = (v: BookVisit) => `${v.session}|${v.location_id}|${v.date}|${v.time}`


/** The days a revision went from and to — its first and its last visit made, as the wall clock of their locations says —, or nothing when none was made. The end is only
 * told when the revision is complete (no visit left planned): one still going has its end open ("2024-09-04 → …"). */
function spanOf(visits: BookVisit[]): string | undefined {
  const days = visits.filter((v) => !v.not_done && v.date).map((v) => v.date).sort()
  if (days.length === 0) return undefined
  const first = days[0], last = days[days.length - 1]
  if (visits.some((v) => v.not_done)) return `${first} → …`
  return first === last ? first : `${first} → ${last}`
}

/** How many visits a page of the book has. */
const PER_PAGE = 10
const LABELS = 6

/** The visit book of a research project: the visits kept to it, and the deployments they say — closed, and the ones whose camera is still out — with the logs of their collections. */
export default function VisitBookPage({ onBack, onImportImages, onOpenSettings, settingsOpen, onShowDeployment, focus, onCreateVisit, onRegisterVisits, onCreateDeployments }: Props) {
  // The legend and the help: a panel at the right, marked from the header.
  const [helpOpen, setHelpOpen] = useState(false)
  // The revisions and the status cards fold away, to leave the table alone.
  const [revisionsOpen, setRevisionsOpen] = useState(true)
  const [metricsOpen, setMetricsOpen] = useState(true)
  // The book is of the research project the general settings say is the default: the one that is active.
  const { project, defaultAcronym, error: projectError } = useDefaultResearchProject(settingsOpen)
  // The data of a location, in a panel at the right: from the link of the location of a visit.
  const [sitePanel, setSitePanel] = useState<{ site: string; location: LocalLocation | undefined } | null>(null)
  const [siteError, setSiteError] = useState<string | null>(null)
  async function showSite(site: string) {
    if (!project) return
    setSiteError(null)
    try {
      const { results } = await api.listLocalLocations(project.acronym)
      setSitePanel({ site, location: results.find((l) => l.location_id.toLowerCase() === site.toLowerCase()) })
    } catch (e) { setSiteError(e instanceof Error ? e.message : 'Could not read the locations.') }
  }
  const [visits, setVisits] = useState<BookVisit[] | null>(null)
  const [marked, setMarked] = useState<string | null>(null)
  // The visits ticked, to do an action on all of them — and the action chosen.
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // the marked row is scrolled to when a visit is brought into view — from the map or a link — and not when a row is pressed: the page would move under the pointer
  const bringIntoView = useRef(false)
  // pressing a row marks it, and pressing the marked one again clears it — a button or a link in it only does what it does: it may bring another visit into view, and that one is the marked
  const pressRow = (key: string, e: { target: EventTarget }) => { if (!(e.target as Element).closest('button,a,input,select,textarea')) setMarked((was) => (was === key ? null : key)) }
  // the visit whose panel is open, and how the visits are seen: as a table or as labels
  const [panelVisit, setPanelVisit] = useState<BookVisit | null>(null)
  const [view, setView] = useState<View>('table')
  // where the locations are — read the first time the map is asked for
  const [locations, setLocations] = useState<LocalLocation[] | null>(null)
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
  // A revision is one visit to every site: the book can be of one of them, or of all.
  const [revision, setRevision] = useState('')
  const defaulted = useRef(false)
  const [page, setPage] = useState(1)
  // Sorted by a column when one is chosen — pressing it again turns it round —; else the latest revision first.
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  // planning the next revision: what it said, and the closing of the revision before when it asks for it
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<RevisionCreated | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [closing, setClosing] = useState(false)
  // the planned revision that has no visit, which asked to be closed before the next one is planned
  const [confirmingEmpty, setConfirmingEmpty] = useState(false)
  const pendingRevision = useRef<string | null>(null)   // the revision to open on when the visits are read again
  const [exportError, setExportError] = useState<string | null>(null)
  const error = projectError ?? loadError ?? exportError
  const emptyRevision = createError?.match(/^(R\d{4}) is planned and has no visit yet/)?.[1] ?? null

  /** Plans the next revision — a visit to each location that is ready — and opens the visit book on it; if the revision before is not finished, it is said. */
  async function createRevision() {
    if (!project) return
    setCreating(true); setCreateError(null); setCreated(null); setConfirmingClose(false); setConfirmingEmpty(false)
    try {
      const result = await api.createRevision(project.acronym)
      pendingRevision.current = result.session
      setCreated(result)
      setReloads((n) => n + 1)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'The revision could not be created.')
    } finally {
      setCreating(false)
    }
  }

  /** The locations of the revision before that were not visited are marked as such — the visits that could not be made — and that revision is finished. */
  async function closePrevious() {
    if (!project || !unfinished) return
    setClosing(true)
    try {
      setConfirmingClose(false)
      await api.markNotVisited(project.acronym, unfinished.previous)
      setReloads((n) => n + 1)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'The locations could not be marked as not visited.')
    } finally {
      setClosing(false)
    }
  }

  /** A revision that was planned and has no visit is closed: every location is marked as not visited — the visits that could not be made —, and the next revision is planned. */
  async function closeEmptyAndCreate() {
    if (!project || !emptyRevision) return
    setClosing(true); setConfirmingEmpty(false)
    try {
      await api.markNotVisited(project.acronym, emptyRevision)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'The locations could not be marked as not visited.')
      setClosing(false)
      return
    }
    setClosing(false)
    await createRevision()
  }

  /** The visits of the research project as a CSV file that Register visits › CSV reads back. */
  async function exportVisits() {
    if (!project) return
    setExporting(true); setExportError(null)
    try {
      const { csv, filename } = await api.exportVisitsCsv(project.acronym)
      download(filename, csv)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Could not export the visits.')
    } finally {
      setExporting(false)
    }
  }
  // The visit being edited, or the unknown one being filled in.
  const [editing, setEditing] = useState<BookVisit | null>(null)
  const [reloads, setReloads] = useState(0)
  useEffect(() => {
    setVisits(null); setLoadError(null); setPage(1); setMarked(null); setRevision(''); setLocations(null); defaulted.current = false
  }, [project?.acronym])
  useEffect(() => {
    if (!project) return
    let cancelled = false
    api.visitBook(project.acronym)
      .then(({ results }) => {
        if (cancelled) return
        setVisits(results)
        if (pendingRevision.current) {   // a revision was just planned: the book opens on it, in the same render the visits come in
          setRevision(pendingRevision.current); setStatusFilter(''); setFilter(''); setPage(1); setMarked(null)
          pendingRevision.current = null
          defaulted.current = true
          return
        }
        // opens on the latest revision in the same render the visits come in — not after it: what is shown does not change under a click — unless a link brings to one visit
        if (!defaulted.current) {
          defaulted.current = true
          const latest = [...new Set(results.map((v) => v.session))].sort((x, y) => y.localeCompare(x))[0]
          if (!focus && latest) setRevision(latest)
        }
      })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not read the visits.') })
    return () => { cancelled = true }
  }, [project?.acronym, reloads]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (view !== 'map' || !project || locations !== null) return
    let cancelled = false
    api.listLocalLocations(project.acronym)
      .then(({ results }) => { if (!cancelled) setLocations(results) })
      .catch(() => { if (!cancelled) setLocations([]) })    // with no locations the points that have their own coordinates are still drawn
    return () => { cancelled = true }
  }, [view, project?.acronym, locations]) // eslint-disable-line react-hooks/exhaustive-deps

  // the row that was marked — from the map, or from a link — is brought into view, whichever page or view it is on
  useEffect(() => {
    if (!marked || !bringIntoView.current) return
    const row = document.querySelector('tr[aria-current="true"], article[aria-current="true"]')
    if (!row) return
    bringIntoView.current = false
    row.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [marked, view, page, revision, visits])

  // How many rows each status square has — over the rows of the revision picked (all of them when none is), whatever the text filter says.
  const everyRow = visits ?? []
  const revisions = [...new Set(everyRow.map((v) => v.session))].sort((x, y) => y.localeCompare(x))
  const rows = revision ? everyRow.filter((v) => v.session === revision) : everyRow

  // A revision that was planned and has no visit yet cannot take one until the revision before it is finished: the locations still to be visited in that one are what the book
  // shows as planned in it. Said whenever it is so — not only when the revision is created —, with the way to finish it: mark them as not visited.
  const unfinished = (() => {
    const sessions = [...new Set(everyRow.map((v) => v.session))].sort()
    const latest = sessions[sessions.length - 1]
    if (!latest || !everyRow.filter((v) => v.session === latest).every((v) => v.not_done)) return null
    const before = sessions.find((s) => Number(s.slice(1)) === Number(latest.slice(1)) - 1)
    const missing = before ? everyRow.filter((v) => v.session === before && v.not_done).map((v) => v.location_id) : []
    return before && missing.length > 0 ? { session: latest, previous: before, missing } : null
  })()
  const count = (f: StatusFilter) => rows.filter((v) => matches(v, f)).length
  // a visit that could not be made is settled: it counts as completed — what is pending is what is still planned
  const made = rows.filter((v) => !v.not_done && !v.unknown).length
  const percent = rows.length ? Math.round((made / rows.length) * 100) : 0
  const SQUARES: { filter: Phase; label: string; note: string; tone: string; badge: string; icon: ReactNode }[] = [
    { filter: 'planned', label: 'Planned', note: 'Not visited yet', tone: 'text-zinc-600 dark:text-zinc-300', badge: 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300', icon: <Icon path={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>} className="h-5 w-5" /> },
    { filter: 'deployed', label: 'Deployed', note: 'Camera out, card not collected', tone: 'text-amber-600 dark:text-amber-400', badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300', icon: <Icon path={<><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 17.5v.01" /></>} className="h-5 w-5" /> },
    { filter: 'collected', label: 'Collected', note: 'Card collected', tone: 'text-emerald-600 dark:text-emerald-400', badge: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300', icon: <Icon path={<><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></>} className="h-5 w-5" /> },
    { filter: 'stolen', label: 'Stolen', note: 'Camera stolen, no images', tone: 'text-red-600 dark:text-red-400', badge: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300', icon: <Icon path={<><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>} className="h-5 w-5" /> },
    { filter: 'not_visited', label: 'Not visited', note: 'The visit could not be made', tone: 'text-slate-600 dark:text-slate-300', badge: 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200', icon: <Icon path={<><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></>} className="h-5 w-5" /> },
    { filter: 'no_camera', label: 'No camera', note: 'Left no camera', tone: 'text-sky-600 dark:text-sky-400', badge: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300', icon: <Icon path={<><rect x="4" y="7" width="16" height="11" rx="2" /><path d="M4 4l16 16" /></>} className="h-5 w-5" /> },
  ]

  // a visit is brought into view: on its revision, on its page, and open
  function showVisit(target: BookVisit) {
    bringIntoView.current = true
    setRevision(target.session); setStatusFilter(''); setFilter(''); setSort(null)
    setPage(Math.floor((visits ?? []).filter((v) => v.session === target.session).sort(byDefault).findIndex((v) => keyOf(v) === keyOf(target)) / perPage) + 1)
    setMarked(keyOf(target))
  }
  // the visit a link of the deployments dashboard goes to
  useEffect(() => {
    if (!focus || !visits) return
    const target = visits.find((v) => !v.not_done && v.session === focus.session && v.location_id.toLowerCase() === focus.site.toLowerCase())
    if (target) showVisit(target)
  }, [focus, visits]) // eslint-disable-line react-hooks/exhaustive-deps
  // the visit that was made to the same location in the closest revision after the one of a row
  const nextOf = (v: BookVisit) => everyRow
    .filter((w) => !w.not_done && w.location_id.toLowerCase() === v.location_id.toLowerCase() && w.session > v.session)
    .sort((a, b) => a.session.localeCompare(b.session) || `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))[0]
  // the visit that collected the card of a row — the closest later one that was made: the revisions not made, not visited or unknown say nothing and are left between, as dots —
  const closedOf = (v: BookVisit) => {
    if (v.deployment_status !== 'closed') return { visit: v, end: null }
    const later = everyRow.filter((w) => w.location_id.toLowerCase() === v.location_id.toLowerCase() && w.session > v.session).sort((a, b) => a.session.localeCompare(b.session))
    const end = later.find((w) => !w.not_done && !w.not_visited && !w.unknown)
    if (!end) return { visit: v, end: null }
    const label = (w: BookVisit) => (w.unknown ? 'Unknown' : w.not_visited ? 'Not visited' : 'Not made')
    return { visit: v, end, between: later.filter((w) => w.session < end.session).map((w) => ({ session: w.session, label: label(w) })) }
  }
  // the visit that was made to the same location in the closest revision before the one of a row
  const previousOf = (v: BookVisit) => everyRow
    .filter((w) => !w.not_done && w.location_id.toLowerCase() === v.location_id.toLowerCase() && w.session < v.session)
    .sort((a, b) => b.session.localeCompare(a.session) || `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`))[0]

  const needle = filter.trim().toLowerCase()
  const shown = rows
    .filter((v) => matches(v, statusFilter))
    .filter((v) => !needle || `${v.location_id} ${v.session} ${v.camera_id ?? ''} ${v.sd ?? ''} ${v.trappers ?? ''} ${actionsLabel(v.actions, ' ')} ${v.deployment_id ?? ''} ${phaseOf(v) ? PHASE_LABEL[phaseOf(v)!] : ''}`.toLowerCase().includes(needle))
    // by the column chosen — the rows not made last —, else the latest revision first, within it the visits made newest first and then the ones not made, by site
    .sort((a, b) => {
      if (!sort) return byDefault(a, b)
      if (a.not_done !== b.not_done && ['when', 'actions', 'stored'].includes(sort.key)) return Number(a.not_done) - Number(b.not_done)
      const x = sortValue(a, sort.key), y = sortValue(b, sort.key)
      const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      return (sort.descending ? -order : order) || byDefault(a, b)
    })
  // The sites on the map: one point for each site of the rows that match — of the revision picked, or the latest visit of each when all are —, coloured by the state of that visit.
  const mapSites = (() => {
    if (view !== 'map') return { points: [] as MapPoint[], legend: [] as MapLegend[], missing: 0 }
    const bySite = new Map<string, BookVisit[]>()
    for (const v of shown) bySite.set(v.location_id.toLowerCase(), [...(bySite.get(v.location_id.toLowerCase()) ?? []), v])
    const points: MapPoint[] = []
    let missing = 0
    for (const group of bySite.values()) {
      const latest = [...group].sort((a, b) => b.session.localeCompare(a.session) || Number(a.not_done) - Number(b.not_done))[0]
      const place = locations?.find((l) => l.location_id.toLowerCase() === latest.location_id.toLowerCase())
      const own = group.find((w) => w.latitude !== null && w.longitude !== null)
      const latitude = place?.latitude ?? own?.latitude ?? null, longitude = place?.longitude ?? own?.longitude ?? null
      if (latitude === null || longitude === null) { missing += 1; continue }
      const phase = phaseOf(latest) ?? 'unknown'
      const made = !latest.not_done && !latest.unknown && phase !== 'not_visited'
      points.push({
        key: latest.location_id.toLowerCase(), label: latest.location_id, latitude, longitude, legend: phase, fill: PHASE_FILL[phase], subtitle: place?.name,
        lines: [
          ['State', `${PHASE_LABEL[phase]} · ${latest.session}`],
          ['Coords', `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`],
          ...(made ? [['Visit', formatVisitWhen(latest)] as [string, string]] : []),
          ...(latest.sd ? [['SD card', latest.sd] as [string, string]] : []),
          ...(latest.camera_id ? [['Camera', latest.camera_id] as [string, string]] : []),
          ...(group.length > 1 ? [['Visits', String(group.length)] as [string, string]] : []),
        ],
        footer: latest.deployment_id ? `Deployment ${latest.deployment_id}` : made ? 'Images not stored yet' : null,
        // what the card of the chosen site offers: the buttons of its row, and to see it in the table
        actions: () => optionsOf(latest), pickName: 'Show it in the table', onPick: () => { setView('table'); showVisit(latest) },
      })
    }
    const present = new Set(points.map((p) => p.legend))
    return { points, missing, legend: PHASES.filter((p) => present.has(p)).map((p) => ({ key: p, label: PHASE_LABEL[p], dot: PHASE_DOT[p] })) }
  })()
  const perPage = view === 'labels' ? LABELS : PER_PAGE
  const pages = Math.max(1, Math.ceil(shown.length / perPage))
  const current = Math.min(page, pages)
  const onPage = shown.slice((current - 1) * perPage, current * perPage)
  // The ticked visits can make their deployments when the card of each was collected and has no deployment yet — all of one revision, which is what Import deployments takes.
  const pickedVisits = (visits ?? []).filter((v) => picked.has(keyOf(v)))
  const collectable = (v: BookVisit) => phaseOf(v) === 'collected' && !v.deployment_id && v.deployment_status === 'closed' && !v.deployment_no_images
  const createReason = pickedVisits.length === 0 ? 'Tick the visits first.'
    : !pickedVisits.every(collectable) ? 'Only visits whose card was collected, and have no deployment yet, can create their deployments.'
    : new Set(pickedVisits.map((v) => v.session)).size > 1 ? 'Tick the visits of one revision.' : null
  const togglePicked = (key: string) => setPicked((p) => { const next = new Set(p); if (next.has(key)) next.delete(key); else next.add(key); return next })
  const pagePicked = onPage.length > 0 && onPage.every((v) => picked.has(keyOf(v)))
  const togglePage = () => setPicked((p) => { const next = new Set(p); for (const v of onPage) { if (pagePicked) next.delete(keyOf(v)); else next.add(keyOf(v)) } return next })
  function runAction() {
    if (createReason || !project) return
    const targets = pickedVisits.map((v) => ({ researchProjectId: project.acronym, visit: v }))
    if (targets.length === 1 && onImportImages) onImportImages(targets[0])
    else onCreateDeployments?.(targets)
  }


  // What a visit says of its state, its images and what can be done with it: as the table and the labels both show them.
  const phaseOf2 = (v: BookVisit) => (
    <>
                              {phaseOf(v)
                                ? <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${PHASE_BADGE[phaseOf(v)!]}`}><span aria-hidden="true" className="inline-flex [&>svg]:h-3 [&>svg]:w-3">{SQUARES.find((q) => q.filter === phaseOf(v))?.icon}</span>{PHASE_LABEL[phaseOf(v)!]}</span>
                                : <span className="text-zinc-400">—</span>}
    </>
  )
  const imagesOf = (v: BookVisit) => (
    <>
                              {v.not_done || v.unknown ? null : v.deployment_id ? (
                                <button type="button" title="Show image details" className="inline-flex rounded-full text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label={`Details of the deployment ${v.deployment_id}`} onClick={() => onShowDeployment?.(v.deployment_id!)}>
                                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></svg>
                                </button>
                              ) : <span role="img" aria-label="Images not stored" title={v.deployment_no_images ? 'No images: the camera was stolen' : 'Not stored: the card has not been collected yet'} className="inline-flex text-zinc-400 dark:text-zinc-500">
                                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>
                                </span>}
    </>
  )
  const optionsOf = (v: BookVisit) => {
    return (
                              <RowOptions label={`Options of the visit ${v.session} to ${v.location_id}`}>
                                {(() => {
                                  const before = previousOf(v)
                                  return before && (
                                    <IconButton compact label={`Show the previous visit to ${v.location_id} (${before.session})`} title={`The previous revision of this location: ${before.session}`}
                                      onClick={() => showVisit(before)} path={ICON_PATHS.before} />
                                  )
                                })()}
                                {!v.not_done && !v.unknown && (
                                  <IconButton compact label={`Edit the visit ${v.session} to ${v.location_id}`} title={v.locked ? 'It starts or closes an imported deployment: it cannot be edited' : 'Edit the visit'} disabled={v.locked}
                                    onClick={() => setEditing(v)} path={<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>} />
                                )}
                                {v.unknown && (
                                  <IconButton compact label={`Fill in the visit ${v.session} to ${v.location_id}`} title="Nothing is known of this visit: fill it in"
                                    onClick={() => setEditing(v)} path={<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>} />
                                )}
                                {!v.not_done && !v.unknown && (
                                  <IconButton compact label={`View the visit ${v.session} to ${v.location_id}`} title="View the visit"
                                    onClick={() => setPanelVisit(v)} path={ICON_PATHS.view} />
                                )}
                                {(() => {
                                  const after = nextOf(v)
                                  return after && (
                                    <IconButton compact label={`Show the next visit to ${v.location_id} (${after.session})`} title={`The next revision of this location: ${after.session}`}
                                      onClick={() => showVisit(after)} path={ICON_PATHS.after} />
                                  )
                                })()}
                                {v.not_done && onCreateVisit && (
                                  <IconButton compact label={`Create the visit ${v.session} to ${v.location_id}`} title="Create the visit"
                                    onClick={() => onCreateVisit({ researchProjectId: project!.acronym, site: v.location_id })} path={<><path d="M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>} />
                                )}
                                {!v.not_done && !v.deployment_id && v.deployment_status === 'closed' && !v.deployment_no_images && onImportImages && (
                                  <IconButton compact label={`Create the deployment of the visit ${v.session} to ${v.location_id}`} title="Create the deployment"
                                    onClick={() => onImportImages({ researchProjectId: project!.acronym, visit: v })} path={MENU_ICONS.deployment} />
                                )}
                              </RowOptions>
    )
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-8 pt-3">
      <DashboardBar icon={<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>} title="Visit dashboard" description="The visits kept to a research project." parent="Menu" onParent={onBack}
        actions={<>
          {project && visits !== null && visits.length > 0 && (
            <DownloadButton busy={exporting} onClick={() => void exportVisits()} title="Download the visits of this research project as a CSV file, to import them again in Register visits › CSV file">{exporting ? 'Exporting…' : 'Export visits (CSV)'}</DownloadButton>
          )}
          {onRegisterVisits && (
            <button type="button" className={`${btnOutline} inline-flex items-center gap-2`} title="Register the visits to the camera traps" onClick={onRegisterVisits}>
              <Icon path={<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />} className="h-4 w-4" />
              Register visits
            </button>
          )}
          {project && visits !== null && (
            <button type="button" className={`${btnOutline} inline-flex items-center gap-2`} disabled={creating} title="Plans the next revision: a visit to each location that is ready, planned"
                    onClick={() => void createRevision()}>
              <Icon path={<><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>} className="h-4 w-4" />
              {creating ? 'Creating…' : 'Create the next revision'}
            </button>
          )}
          <HelpButton expanded={helpOpen} onClick={() => setHelpOpen(true)} />
        </>} />

      {!project && defaultAcronym !== null && !projectError && (
        <p role="status" className="mb-3 text-sm text-amber-700 dark:text-amber-400">
          {defaultAcronym ? <>The default research project, <span className="font-mono">{defaultAcronym}</span>, is not in the collections folder.</> : 'No default research project is set.'} Choose one in the header.
        </p>
      )}
      {error && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {project && (
        <>
          {createError && !confirmingEmpty && (
            <Notice kind="error" role="alert" className="mb-4"
                    action={emptyRevision ? <button type="button" className={btnOutline} disabled={closing} onClick={() => setConfirmingEmpty(true)}>Mark {emptyRevision} as not visited</button> : undefined}>
              {createError}
            </Notice>
          )}
          {createError && emptyRevision && confirmingEmpty && (
            <Notice kind="warning" role="alert" className="mb-4" action={(
              <span className="flex gap-2">
                <button type="button" className={btnOutline} disabled={closing} onClick={() => setConfirmingEmpty(false)}>Cancel</button>
                <button type="button" className={btnPrimary} disabled={closing} onClick={() => void closeEmptyAndCreate()}>Yes, mark them and plan the next revision</button>
              </span>
            )}>
              Every location of <strong>{emptyRevision}</strong> will be marked as not visited, the revision will be finished and it cannot be modified. Then the next revision is planned. Do you want to do it?
            </Notice>
          )}
          {unfinished && !confirmingClose && (
            <Notice kind="warning" role="alert" className="mb-4" action={<button type="button" className={btnOutline} disabled={closing} onClick={() => setConfirmingClose(true)}>Mark them as not visited</button>}>
              <strong>{unfinished.session}</strong> is planned, but <strong>{unfinished.previous}</strong> is not finished: {unfinished.missing.length} {unfinished.missing.length === 1 ? 'location is' : 'locations are'} still to be visited in it ({unfinished.missing.join(', ')}). No visit can be made in {unfinished.session} until it is finished: make those visits, or mark them as not visited.
            </Notice>
          )}
          {unfinished && confirmingClose && (
            <Notice kind="warning" role="alert" className="mb-4" action={(
              <span className="flex gap-2">
                <button type="button" className={btnOutline} disabled={closing} onClick={() => setConfirmingClose(false)}>Cancel</button>
                <button type="button" className={btnPrimary} disabled={closing} onClick={() => void closePrevious()}>Yes, mark them as not visited</button>
              </span>
            )}>
              Once this is done, the visit book of <strong>{unfinished.previous}</strong> will be consolidated and it cannot be modified. Do you want to mark {unfinished.missing.join(', ')} as not visited?
            </Notice>
          )}
          {created && (
            <div className="mb-5 space-y-3">
              <Notice kind="success" role="status" action={<button type="button" className={btnOutline} onClick={() => { setCreated(null); setConfirmingClose(false) }}>Dismiss</button>}>
                <strong>{created.session}</strong> has been created: a visit is planned to each of the {created.planned.length} {created.planned.length === 1 ? 'location' : 'locations'} that can be visited ({created.planned.join(', ')}).
              </Notice>
            </div>
          )}
          {visits !== null && revisions.length > 0 && (
            <RevisionSelection open={revisionsOpen} onToggle={() => setRevisionsOpen(!revisionsOpen)} hint="Select one to filter planned & completed visits"
              all={{ label: 'All revisions', note: `${everyRow.filter((v) => !v.not_done).length} of ${everyRow.length} done`, percent: everyRow.length ? Math.round((everyRow.filter((v) => !v.not_done).length / everyRow.length) * 100) : 0 }} value={revision}
              revisions={revisions.map((r) => { const of = everyRow.filter((v) => v.session === r); return { id: r, label: r, note: `${of.filter((v) => !v.not_done).length} of ${of.length} done`, dates: spanOf(of), complete: of.length > 0 && of.every((v) => !v.not_done) } })}
              onPick={(id) => { setRevision(id); setStatusFilter(''); setPage(1); setMarked(null) }} />
          )}
          {visits !== null && (
            <MetricsSection label="Visits by status" open={metricsOpen} onToggle={() => setMetricsOpen(!metricsOpen)} hint="Click a card to filter the table by status">
              <ProgressCard percent={percent} done={made} total={rows.length} barLabel="Visits done" caption={`${rows.length - made} pending ${rows.length - made === 1 ? 'visit' : 'visits'}`}
                segments={[
                  { width: rows.length ? ((count('collected') + count('stolen')) / rows.length) * 100 : 0, className: 'bg-emerald-500' },
                  { width: rows.length ? (count('deployed') / rows.length) * 100 : 0, className: 'bg-amber-500' },
                  { width: rows.length ? (count('not_visited') / rows.length) * 100 : 0, className: 'bg-slate-400' },
                ]} />
              {SQUARES.map((q) => (
                <StateCard key={q.label} label={q.label} note={q.note} count={count(q.filter)} tone={q.tone} badge={q.badge} icon={q.icon} pressed={statusFilter === q.filter}
                           onPress={() => { setStatusFilter(statusFilter === q.filter ? '' : q.filter); setPage(1); setMarked(null) }} />
              ))}
            </MetricsSection>
          )}

          <TableCard label="Visits table">
          <TableToolbar searchLabel="Filter the visits" placeholder="Search by site, revision, camera, card, who, deployment…" text={filter} onText={(t) => { setFilter(t); setPage(1); setMarked(null) }}
            choice={{ label: 'Status', value: statusFilter, onChange: (v) => { setStatusFilter(v as StatusFilter); setPage(1); setMarked(null) }, options: SQUARES.map((q) => ({ value: q.filter, label: q.label })) }}
            trailing={<ViewSwitch view={view} items="visits" views={['table', 'labels', 'map']} onChange={(v) => { setView(v); setPage(1) }} />}
            onReset={() => { setFilter(''); setStatusFilter(''); setRevision(''); setSort(null); setPage(1); setMarked(null) }} />
          {visits !== null && (
            <ActiveFilters filters={[{ label: `Revision: ${revision || 'All'}`, tone: 'blue' }, { label: `Status: ${statusFilter ? PHASE_LABEL[statusFilter] : 'All'}`, tone: 'green' }]} summary={`${shown.length} of ${everyRow.length} visits match`} />
          )}

          {visits !== null && view !== 'map' && picked.size > 0 && (
            <div role="group" aria-label="Action on the selected visits" className="m-3 flex flex-wrap items-center gap-3 rounded-xl border border-blue-300 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 text-sm">
              <span role="status" className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">{picked.size} selected</span>
              {picked.size < shown.length && (
                <button type="button" className="text-blue-700 dark:text-blue-300 underline hover:no-underline" onClick={() => setPicked(new Set(shown.map(keyOf)))}>Select all {shown.length} matching</button>
              )}
              <button type="button" className={btnOutline} onClick={() => setPicked(new Set())}>Clear</button>
              <span className="ml-auto flex flex-wrap items-center gap-2">
                <button type="button" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={createReason !== null || !onImportImages} title={createReason ?? 'Create the deployments of the selected visits'} onClick={runAction}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{MENU_ICONS.deployment}</svg>Create deployments
                </button>
              </span>
            </div>
          )}

          {(
            visits === null ? <p className="text-sm text-zinc-500 dark:text-zinc-400">Reading the visits…</p> : (
              <>
              {view === 'table' && (
              <div className="overflow-x-auto">
                <table className={TABLE.table} aria-label="Visits">
                  <thead className={TABLE.head}>
                    <tr>
                      <th scope="col" className="w-10 pl-4 py-3"><input type="checkbox" aria-label="Select all the visits of the page" checked={pagePicked} ref={(el) => { if (el) el.indeterminate = !pagePicked && onPage.some((v) => picked.has(keyOf(v))) }} onChange={togglePage} /></th>
                      {COLUMNS.map(([key, label]) => (
                        <th key={key} scope="col" aria-sort={sort?.key === key ? (sort.descending ? 'descending' : 'ascending') : 'none'} className={TABLE.th}>
                          <button type="button" className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => { setSort(sort?.key === key ? { key, descending: !sort.descending } : { key, descending: false }); setPage(1); setMarked(null) }}>
                            {label}
                            <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-3.5 w-3.5 fill-none stroke-current ${sort?.key === key ? 'text-blue-500' : 'text-zinc-400 dark:text-zinc-600'}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              {sort?.key === key ? (sort.descending ? <path d="M12 5v14M6 13l6 6 6-6" /> : <path d="M12 19V5M6 11l6-6 6 6" />) : <path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4" />}
                            </svg>
                          </button>
                        </th>
                      ))}
                      <th scope="col" className="px-4 py-3"><span className="sr-only">What to do</span></th>
                    </tr>
                  </thead>
                  <tbody className={TABLE.body}>
                    {onPage.map((v) => {
                      const key = keyOf(v)
                      return (
                        <Fragment key={key}>
                          <tr aria-current={marked === key ? 'true' : undefined} onClick={(e) => pressRow(key, e)} className={`cursor-pointer ${marked === key ? 'row-flash bg-blue-100/80 dark:bg-blue-950/50 transition-colors' : TABLE.row(false)}`}>
                            <td className={`border-l-4 pl-3 py-3 ${marked === key ? 'border-l-blue-500' : 'border-l-transparent'}`} onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" aria-label={`Select the visit ${v.session} to ${v.location_id}`} checked={picked.has(key)} onChange={() => togglePicked(key)} />
                            </td>
                            <td className={`px-4 py-3 font-mono font-semibold text-zinc-900 dark:text-zinc-200`}>
                              {marked === key && <svg data-marker aria-hidden="true" viewBox="0 0 24 24" className="mr-1 inline-block h-4 w-4 -translate-y-px fill-none stroke-blue-600 dark:stroke-sky-400" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 5l8 7-8 7" /></svg>}
                              {v.session}
                            </td>
                            <td className="px-4 py-3 font-mono">
                              {project
                                ? <LinkButton title={`Show the details of the location ${v.location_id}`} className="font-mono" onClick={() => void showSite(v.location_id)}>{v.location_id}</LinkButton>
                                : v.location_id}
                            </td>
                            <td className="px-4 py-3 font-mono text-[11px] whitespace-nowrap text-zinc-600 dark:text-zinc-300">{v.not_done || v.unknown || phaseOf(v) === 'not_visited' ? <span className="font-sans text-zinc-400">—</span> : formatVisitWhen(v)}</td>
                            <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{v.actions.length === 0 && !v.not_done ? '—' : actionsLabel(v.actions)}</td>
                            <td className="px-4 py-3">{phaseOf2(v)}</td>
                            <td className="px-4 py-3">{imagesOf(v)}</td>
                            <td className="px-4 py-3 whitespace-nowrap">{optionsOf(v)}</td>
                          </tr>
                        </Fragment>
                      )
                    })}
                    {shown.length === 0 && <tr><td colSpan={8} className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{visits.length === 0 ? 'No visit has been registered to this research project yet.' : 'No visit matches.'}</td></tr>}
                  </tbody>
                </table>
              </div>
              )}
              {view === 'map' && (
                <>
                  {locations === null && shown.length > 0 && <p className="px-4 pt-4 text-sm text-zinc-500 dark:text-zinc-400">Reading where the sites are…</p>}
                  <CoordinatesMap name="Visits on a map" points={mapSites.points} legend={mapSites.legend} missing={mapSites.missing} noun="sites" markedKey={marked ? marked.split('|')[1]?.toLowerCase() ?? null : null} />
                </>
              )}
              {view === 'labels' && (
                <div role="group" aria-label="Visits" className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
                  {onPage.map((v) => (
                    <article key={keyOf(v)} aria-label={`Visit ${v.session} to ${v.location_id}`} aria-current={marked === keyOf(v) ? 'true' : undefined} onClick={(e) => pressRow(keyOf(v), e)} className={`cursor-pointer rounded-2xl border p-5 ${marked === keyOf(v) ? 'row-flash border-blue-500 bg-blue-50 dark:bg-blue-950/30 ring-2 ring-blue-500/40' : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900'}`}>
                      <div className="flex items-center justify-between gap-3">
                        {project
                          ? <LinkButton title={`Show the details of the location ${v.location_id}`} className="font-mono text-base font-bold" onClick={() => void showSite(v.location_id)}>{v.location_id}</LinkButton>
                          : <span className="font-mono text-base font-bold">{v.location_id}</span>}
                        <span>{phaseOf2(v)}</span>
                      </div>
                      <p className="mt-1 font-mono text-sm text-zinc-500 dark:text-zinc-400">{v.session}{v.actions.length > 0 ? ` · ${actionsLabel(v.actions)}` : ''}</p>
                      <div className="my-3 border-t border-zinc-200 dark:border-zinc-700/70" />
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-mono text-zinc-600 dark:text-zinc-300">{v.not_done || v.unknown || phaseOf(v) === 'not_visited' ? '—' : formatVisitWhen(v)}</span>
                        <span className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">Images {imagesOf(v)}</span>
                      </div>
                      <div className="mt-3 flex justify-end">{optionsOf(v)}</div>
                    </article>
                  ))}
                  {shown.length === 0 && <p className="col-span-full py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">{visits.length === 0 ? 'No visit has been registered to this research project yet.' : 'No visit matches.'}</p>}
                </div>
              )}
              {shown.length > 0 && view !== 'map' && (
                <TableFooter from={(current - 1) * perPage + 1} to={Math.min(current * perPage, shown.length)} total={shown.length} noun="visits" page={current} pages={pages} onPage={(n) => { setPage(n); setMarked(null) }} />
              )}
              </>
            )
          )}
          </TableCard>
        </>
      )}

      {siteError && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{siteError}</p>}
      {panelVisit && (
        <VisitDetails onClose={() => setPanelVisit(null)} closed={closedOf(panelVisit)} researchProjectId={project?.acronym} onOpenSettings={onOpenSettings} />
      )}
      {sitePanel && (
        <LocationDetails site={sitePanel.site} location={sitePanel.location} onClose={() => setSitePanel(null)}
          onOpenInSettings={onOpenSettings && project ? () => { setSitePanel(null); onOpenSettings('locations', project.acronym, sitePanel.site) } : undefined} />
      )}

      {helpOpen && (
        <HelpDrawer onClose={() => setHelpOpen(false)}>
          <HelpCard title="Overall progress" tone="text-blue-600 dark:text-blue-400" icon={HELP_ICONS.progress}><p>The share of the visits done, over the revision picked or over all of them, with the ones still pending.</p></HelpCard>
          <HelpCard title="Visit states" tone="text-emerald-600 dark:text-emerald-400" icon={HELP_ICONS.tags}>
            <dl className="space-y-2">
              {[...SQUARES.map((q) => ({ key: q.filter, label: q.label, note: q.note, badge: q.badge })), { key: 'unknown', label: 'Unknown', note: 'Nothing is known of it: a revision before the first visit kept to a site', badge: PHASE_BADGE.unknown }].map((q) => (
                <div key={q.key} className="flex items-baseline gap-3">
                  <dt className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${q.badge}`}>{q.label}</dt>
                  <dd>{q.note}</dd>
                </div>
              ))}
            </dl>
          </HelpCard>
          <HelpCard title="Data states" tone="text-violet-600 dark:text-violet-400" icon={HELP_ICONS.images}><p><span className="font-medium text-zinc-700 dark:text-zinc-200">Images</span>: once the deployment of the visit is made its images are stored, whatever the state of the visit, and its tick opens the details of that deployment in the deployments dashboard. A visit whose camera was stolen is <em>Stolen</em>: there are no images, and nothing to create.</p></HelpCard>
          <HelpCard title="Filters and search" tone="text-sky-600 dark:text-sky-400" icon={HELP_ICONS.filter}><p>Search by site, revision, camera or card, and filter by status; pick a revision above.</p></HelpCard>
        </HelpDrawer>
      )}

      <div className="mt-10">
        <button type="button" className={btnOutline} onClick={onBack}><span aria-hidden="true">← </span>Back</button>
      </div>
      {editing && project && (
        <EditVisitDialog projectId={project.acronym} visit={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setMarked(null); setReloads((n) => n + 1) }} />
      )}
    </div>
  )
}
