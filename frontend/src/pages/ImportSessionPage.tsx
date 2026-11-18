import { inTheApp } from '../researchProjects'
import ReportPanel from '../components/ReportPanel'
import TimezoneCombobox from '../components/TimezoneCombobox'
import DeploymentResults from '../components/DeploymentResults'
import SessionResults from '../components/SessionResults'
import { Fragment, memo, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import WizardStep from '../components/WizardStep'
import ClosedVisitsTable from '../components/ClosedVisitsTable'
import { formatLocal, formatVisitWhen } from '../dateFormat'
import { api } from '../api'
import { applyEntry } from '../epicollectImport'
import RecordingPeriod from '../components/RecordingPeriod'
import PrefilledDetails from '../components/PrefilledDetails'
import { SOURCE_ORDER } from '../components/DateSourcePicker'
import Notice, { BadgeIcon, Mark } from '../components/Notice'
import type { DateSource, Period } from '../components/DateSourcePicker'
import type { EpicollectEntry } from '../epicollectImport'
import { isValidTimezone, shownErrors, stampTimezone, validateDeployment } from '../deploymentValidation'
import ResearchProjectPicker from '../components/ResearchProjectPicker'
import RevisionSquares from '../components/RevisionSquares'
import { MENU_ICONS, PageHeader } from '../components/TaskCard'
import { useDefaultResearchProject } from '../components/DefaultResearchProject'
import { EMPTY_DEPLOYMENT_FIELDS } from '../types'
import type { ClosedVisitTarget } from '../types'
import type {
  ClosedVisit, DeploymentCheck, DeploymentCheckResult, DeploymentFields, GuessedDetails, ImageCheck, ImportEvent, LocalLocation, LocalResearchProject,
  PreprocessingOptions, PreviousDeployment, SdCard, SessionScan, SessionScanDeployment, StatisticsParams, UploadTarget, ValidationResult,
} from '../types'
import {
  ALL_DEPLOYMENT_CHECKS, DEFAULT_CHECK_SETTINGS, DEPLOYMENT_CHECK_DISPLAY, DEPLOYMENT_CHECK_OPTIONS, DeploymentCheckReport, Field,
  FormCard, IMAGE_CHECK_DESCRIPTIONS, IMAGE_CHECK_OPTIONS, SmallSpinner, StepHeading, StrictnessTable,
  DEFAULT_REQUIRED_DEPLOYMENT_CHECKS, DeploymentFormBody, LocationTimeNote, MoreDetailsForm, ValidationReport, buildDeploymentId, fillFromPreviousRevision, btnOutline, btnPrimary, deploymentCheckPassed, describePreprocessing, imageCheckPassed,
  inputClass, labelClass, hintClass, statParamsOf, statParamsValid, toggled, fillFromClosedVisit, visitKey, visitLabel,
  FieldLabel, DetailsFromContext, LockedDetailsContext, mergedDetails, visitApplies, detailsFound, fieldworkVisits, revisionOfVisit,
} from './ImportDeploymentPage'
import type { PreprocessStep, Strictness, WizardSettings } from './ImportDeploymentPage'

type StepKey = 'origin' | 'images' | 'dates' | 'checks' | 'prepare'

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'origin', label: 'Origin' },
  { key: 'images', label: 'Images' },
  { key: 'dates', label: 'Dates and details' },
  { key: 'checks', label: 'Check details' },
  { key: 'prepare', label: 'Prepare and save' },
]

/** What is asked of each deployment of the session: its own location, period, camera and notes — the same fields
 * as a single deployment's. Its dates carry the designator of its timezone, as there. */
interface Entry {
  fields: DeploymentFields
  timezone: string
  /** The location's summer-time setting, as its timezone is: read from it, kept in it. */
  ignoreDst: boolean | null
  /** Whether the camera, site and notes are open in the form. */
  /** Where the location was deduced from, until it is picked by hand. */
  locationFrom?: 'folder' | 'log'
}

interface Outcome<T> { result?: T; error?: string }

interface ImportRun { events: ImportEvent[]; done: boolean; error?: string; destDir?: string }

const EMPTY_LOCATION_DRAFT = { location_id: '', name: '', timezone: 'UTC', ignore_dst: 'no', latitude: '', longitude: '' }

/** The location a subfolder is named after — "DONA_01" for the folder "DONA_01", "R0003-DONA_01" or "dona_01 (2)" —
 * when there is exactly one such. */
export function matchLocation(folderName: string, locations: LocalLocation[]): LocalLocation | undefined {
  const folder = folderName.toLowerCase()
  const exact = locations.find((l) => l.location_id.toLowerCase() === folder)
  if (exact) return exact
  const contained = locations.filter((l) => folder.includes(l.location_id.toLowerCase()))
  return contained.length === 1 ? contained[0] : undefined
}

/** What a location gives its deployment: its id, name and coordinates. */
function locationFields(location?: LocalLocation): Partial<DeploymentFields> {
  return {
    location_id: location?.location_id ?? null, location_name: location?.name ?? null,
    latitude: location?.latitude ?? null, longitude: location?.longitude ?? null, coordinate_uncertainty: location?.coordinate_uncertainty ?? null,
  }
}

interface Props {
  /** Offered once the session is imported: goes to the upload page, on the revision's collection. */
  onUpload?: (target: UploadTarget) => void
  /** Opens the settings, on a section when given one. */
  onOpenSettings?: (section?: 'epicollect' | 'general') => void
  /** Whether the settings are open over the wizard: what they hold is read again once they close. */
  settingsOpen?: boolean
  /** Goes back to the menu — what Back does on the first step. */
  onBack?: () => void
  /** The heading, when the page is not the collection's. */
  title?: string
  /** Given, a single visit picked is not imported here: it is handed over — Import deployment takes it, as it is one deployment. */
  onSingleVisit?: (target: ClosedVisitTarget) => void
  /** Given, the visits ticked can be imported one after another: they are handed over, in order, and Import deployment is run for each. */
  onQueue?: (targets: ClosedVisitTarget[]) => void
  /** Goes to Register visits on a research project: what is done when there is no visit to link the deployments to. */
  onRegisterVisits?: (researchProjectId: string) => void
  /** The visits ticked when it opens, with the revision they are of — instead of the latest revision with all its visits. */
  initialVisits?: ClosedVisitTarget[]
}

export default function ImportSessionPage({ onUpload, onOpenSettings, settingsOpen = false, onBack, title = 'Import deployments', onSingleVisit, onQueue, onRegisterVisits, initialVisits }: Props = {}) {
  // how the visits ticked are imported: all at once, or one after another
  const [how, setHow] = useState<'all' | 'one'>('all')
  const [step, setStep] = useState(0)
  const stepKey = STEPS[step].key
  // The sub-steps of the images and of the origin: the one open, and the furthest reached.
  const [imagesOpen, setImagesOpen] = useState(1)
  const [imagesReached, setImagesReached] = useState(1)
  const [originOpen, setOriginOpen] = useState(1)
  const [originReached, setOriginReached] = useState(1)

  // ── Session folder ──
  const [sessionDir, setSessionDir] = useState('')
  const [scan, setScan] = useState<SessionScan | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [included, setIncluded] = useState<Set<string>>(new Set())

  // ── Common to the whole session ──
  const [checkSettings, setCheckSettings] = useState<WizardSettings>(DEFAULT_CHECK_SETTINGS)
  const [imageChecks, setImageChecks] = useState<Set<ImageCheck>>(new Set(['corrupted', 'sequence', 'structure', 'camera', 'exif', 'duplicates']))
  const [requiredImageChecks, setRequiredImageChecks] = useState<Set<ImageCheck>>(new Set())
  const [deploymentChecks, setDeploymentChecks] = useState<Set<DeploymentCheck>>(new Set(ALL_DEPLOYMENT_CHECKS))
  const [requiredDeploymentChecks, setRequiredDeploymentChecks] = useState<Set<DeploymentCheck>>(new Set(DEFAULT_REQUIRED_DEPLOYMENT_CHECKS))
  const [preprocessSteps, setPreprocessSteps] = useState<Set<PreprocessStep>>(new Set(['rename', 'resize', 'metadata']))
  const [exiftool, setExiftool] = useState<boolean | null>(null)
  const [revision, setRevision] = useState('')
  // The log the revision was deduced from, until it is edited.
  const [revisionFromLog, setRevisionFromLog] = useState<string | null>(null)
  // The revision starts as the next one expected for the deployments' locations, until it is typed.
  const revisionTouched = useRef(false)
  const [revisionSuggested, setRevisionSuggested] = useState(false)
  // Set the moment a value is edited (refs, so a settings response arriving meanwhile never puts it back).
  const preprocessTouched = useRef(false)

  // ── Origin ──
  // The research project picked, as in the Origin step of Import deployment (see ResearchProjectPicker).
  const [project, setProject] = useState<LocalResearchProject | undefined>(undefined)
  const projectId = project?.acronym ?? ''
  // As Import deployment does, Import deployments has the default research project of the settings, which is not picked here.
  const { project: defaultProject, defaultAcronym } = useDefaultResearchProject(settingsOpen)
  const fixedProject = Boolean(onSingleVisit) && Boolean(defaultProject)
  useEffect(() => { if (fixedProject && defaultProject && project?.acronym !== defaultProject.acronym) { setProject(defaultProject); setDrafts({}) } }, [fixedProject, defaultProject]) // eslint-disable-line react-hooks/exhaustive-deps
  const [localLocations, setLocalLocations] = useState<LocalLocation[]>([])
  // The visits of the project that closed a deployment with none yet: the ones the session is of are picked in the origin, and each folder is linked to one.
  const [closedVisits, setClosedVisits] = useState<ClosedVisit[] | null>(null)
  const [visitsError, setVisitsError] = useState<string | null>(null)
  const [pickedVisits, setPickedVisits] = useState<Set<string>>(new Set())
  // The revision the visits are of, picked first: only its closed visits are offered. Ticking a visit locks the list to its revision as well (the others are disabled).
  const [revisionPick, setRevisionPick] = useState<number | null>(null)
  // Where each deployment of visits has its camera, site and notes from, once picked: the visit's (the field sheet) before that.
  const [detailsPick, setDetailsPick] = useState<Record<string, 'merge' | 'manual'>>({})
  const [folderVisit, setFolderVisit] = useState<Record<string, string>>({})
  // The SD card each folder's images come from, and the cards the settings keep.
  const [folderSd, setFolderSd] = useState<Record<string, string>>({})
  const [sdCards, setSdCards] = useState<SdCard[]>([])
  const [revisionFromVisits, setRevisionFromVisits] = useState(false)
  const [originError, setOriginError] = useState<string | null>(null)
  // Whether the project's locations are read: the details of the deployments start from the location their folder is named after.
  const [locationsReady, setLocationsReady] = useState(false)

  // ── Per deployment ──
  const [drafts, setDrafts] = useState<Record<string, Entry>>({})
  const [guessed, setGuessed] = useState<Record<string, GuessedDetails>>({})
  const [guessingLeft, setGuessingLeft] = useState(0)
  const guessRequested = useRef(new Set<string>())
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [activeName, setActiveName] = useState('')
  // The deployment whose camera, site and notes are open in the "More details" step.
  const [moreName, setMoreName] = useState('')
  // Which section of the checks is open: 1 to choose them, 2 for how they went.
  const [checksOpen, setChecksOpen] = useState(1)
  const [filter, setFilter] = useState('')
  const [onlyIncomplete, setOnlyIncomplete] = useState(false)
  // The same, in the step of the camera, site and notes.
  const [moreFilter, setMoreFilter] = useState('')
  const [onlyWithoutDetails, setOnlyWithoutDetails] = useState(false)
  // Where each deployment is already kept, by its id — importing it again would be refused.
  const [existing, setExisting] = useState<Record<string, string | null>>({})
  // Whether each deployment is known to have an earlier revision (true) or not (false), by research project and id — until it is looked up, unknown.
  const [previousFound, setPreviousFound] = useState<Record<string, PreviousDeployment | null>>({})
  // What the last fill said, and whether it was for one deployment or for all of them.
  // Whether the settings turn Epicollect5 on; the entry it has for each deployment (by folder) at the revision, and why there is none to offer.
  const [epicollectOn, setEpicollectOn] = useState(false)
  const [epicollectFound, setEpicollectFound] = useState<Record<string, EpicollectEntry>>({})
  const [epicollectMissing, setEpicollectMissing] = useState<string | null>(null)
  const [epicollectDone, setEpicollectDone] = useState(false)
  // Whether the other details of the entries have been imported — the dates are not part of that: they come from the source picked.
  const [epicollectImported, setEpicollectImported] = useState(false)
  // Where each deployment's dates come from; the ones picked by hand are not changed by what is found later.
  const [dateSources, setDateSources] = useState<Record<string, DateSource>>({})
  const sourcePicked = useRef(new Set<string>())
  const [fillMessage, setFillMessage] = useState<{ scope: 'one' | 'all'; text: string; undo?: { name: string; fields: DeploymentFields } } | null>(null)
  const [locFilter, setLocFilter] = useState('')
  const [folderFilter, setFolderFilter] = useState('')
  const [folderTab, setFolderTab] = useState<'all' | 'missing' | 'ready'>('all')
  const [locTab, setLocTab] = useState<'all' | 'missing' | 'ready'>('all')
  // The folders ticked in the table of locations: "Assign" then only touches those.
  const [locSelected, setLocSelected] = useState<Set<string>>(new Set())
  const [addingLocation, setAddingLocation] = useState(false)
  const [locationDraft, setLocationDraft] = useState(EMPTY_LOCATION_DRAFT)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [savingDetails, setSavingDetails] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [validations, setValidations] = useState<Record<string, Outcome<ValidationResult>>>({})
  const [validating, setValidating] = useState(false)
  const [checks, setChecks] = useState<Record<string, Outcome<DeploymentCheckResult>>>({})
  const [checking, setChecking] = useState(false)
  const [runs, setRuns] = useState<Record<string, ImportRun>>({})
  const [importing, setImporting] = useState(false)
  const [collectionPath, setCollectionPath] = useState<string | null>(null)
  const [openFolderError, setOpenFolderError] = useState<string | null>(null)

  // The deployments ticked in the session folder; each is a unit in the image checks, and only those free of errors go on to the next steps.
  const candidates = (scan?.deployments ?? []).filter((d) => included.has(d.name))
  /** Whether a deployment may go on: its images could be checked, and it passed every check set to Must pass. */
  const freeOfErrors = (name: string) => {
    const outcome = validations[name]
    if (outcome?.error) return false
    return [...requiredImageChecks].filter((c) => checkSettings.VALIDATION[c]).every((c) => imageCheckPassed(c, outcome?.result ?? null) === true)
  }
  const chosen = candidates.filter((d) => freeOfErrors(d.name))
  // With visits picked, the session is of them: each folder is a deployment of one, which tells where and when.
  const pickedList = (closedVisits ?? []).filter((c) => pickedVisits.has(visitKey(c)))
  const visitsMode = pickedList.length > 0
  // One visit: the folder is the one of its deployment, with the images in it, as in Import deployment; several: a folder with one subfolder for each.
  const singleVisit = pickedList.length === 1
  const visitOf = (name: string): ClosedVisit | undefined => pickedList.find((c) => visitKey(c) === folderVisit[name])
  const projectSdCards = sdCards.filter((c) => (c.research_project ?? '').toLowerCase() === projectId.toLowerCase())
  // The deployments' details are asked for once the research project is picked and the details sub-step is open.
  // With visits, each folder's location is the visit's: nothing is asked of where they were taken, and the step starts at the dates.
  useEffect(() => {
    if (stepKey === 'dates' && visitsMode && originOpen === 1) { setOriginOpen(2); setOriginReached((r) => Math.max(r, 2)) }
  }, [stepKey, visitsMode, originOpen])
  const detailsActive = stepKey === 'dates' && Boolean(projectId) && locationsReady

  useEffect(() => {
    if (stepKey !== 'images' && stepKey !== 'checks' && stepKey !== 'prepare') return
    let cancelled = false
    api.getSettings()
      .then((s) => {
        if (cancelled) return
        setCheckSettings({ VALIDATION: s.VALIDATION, POSTVALIDATION: s.POSTVALIDATION, PREPROCESSING: s.PREPROCESSING })
        setSdCards(s.FIELDWORK?.sd_cards ?? [])
        if (!preprocessTouched.current) setPreprocessSteps(new Set((['rename', 'resize', 'metadata'] as const).filter((k) => s.PREPROCESSING[k])))
      })
      .catch(() => { /* the settings can't be read: every check stays shown */ })
    return () => { cancelled = true }
  }, [stepKey])

  useEffect(() => {
    if (stepKey !== 'prepare') return
    let cancelled = false
    api.exiftoolStatus().then((s) => { if (!cancelled) setExiftool(s.available) }).catch(() => { if (!cancelled) setExiftool(null) })
    return () => { cancelled = true }
  }, [stepKey])

  useEffect(() => {
    setLocationsReady(false)
    if (!projectId) { setLocalLocations([]); return }
    let cancelled = false
    api.listLocalLocations(projectId)
      .then(({ results }) => { if (!cancelled) { setLocalLocations(results.filter(inTheApp)); setLocationsReady(true) } })
      .catch((e) => { if (!cancelled) setOriginError(e instanceof Error ? e.message : 'Could not read the locations.') })
    return () => { cancelled = true }
  }, [projectId])

  // The project's visits that closed a deployment with none yet: a deployment is always of one of them, so with none there is nothing to import.
  useEffect(() => {
    setClosedVisits(null); setVisitsError(null); setPickedVisits(new Set()); setFolderVisit({}); setFolderSd({}); setRevisionFromVisits(false)
    if (!projectId) return
    let cancelled = false
    Promise.resolve().then(() => api.closedVisits(projectId))
      .then(({ results }) => { if (!cancelled) setClosedVisits(results) })
      .catch((e) => { if (!cancelled) { setClosedVisits([]); setVisitsError(e instanceof Error ? e.message : 'The visits could not be read.') } })
    return () => { cancelled = true }
  }, [projectId])

  // Each folder takes the visit to the location its name says, while there is one left — it can be changed.
  useEffect(() => {
    if (!scan || pickedList.length === 0) { setFolderVisit({}); return }
    setFolderVisit((current) => {
      const next: Record<string, string> = {}
      const used = new Set<string>()
      for (const [name, key] of Object.entries(current)) {
        if (pickedVisits.has(key) && !used.has(key) && scan.deployments.some((d) => d.name === name)) { next[name] = key; used.add(key) }
      }
      for (const d of scan.deployments) {
        if (next[d.name]) continue
        const free = pickedList.filter((c) => !used.has(visitKey(c)))
        const location = matchLocation(d.name, free.map((c) => ({ location_id: c.visit.location_id }) as LocalLocation))
        const found = location && free.find((c) => c.visit.location_id === location.location_id)
        if (found) { next[d.name] = visitKey(found); used.add(visitKey(found)) }
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan, pickedVisits, closedVisits])

  // With one visit, the one folder is its deployment's, whatever it is called.
  useEffect(() => {
    if (!singleVisit || !scan || scan.deployments.length !== 1) return
    const key = visitKey(pickedList[0])
    setFolderVisit((current) => (current[scan.deployments[0].name] === key ? current : { [scan.deployments[0].name]: key }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [singleVisit, scan, pickedVisits])
  // A folder scanned for one visit is not the one scanned for several: it is scanned again when the number of visits goes from one to many or back.
  const wasSingle = useRef(singleVisit)
  useEffect(() => {
    if (wasSingle.current !== singleVisit && scan) setScan(null)
    wasSingle.current = singleVisit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [singleVisit])

  /** Links a folder to a visit (or none): what its details were is worked out again from it. */
  function linkFolder(name: string, key: string) {
    setFolderVisit((current) => {
      const next = { ...current }
      for (const [other, k] of Object.entries(next)) if (k === key && other !== name) delete next[other] // a visit is of one deployment
      if (key) next[name] = key; else delete next[name]
      return next
    })
    setDrafts((all) => { const next = { ...all }; delete next[name]; return next })
    sourcePicked.current.delete(name); guessRequested.current.delete(name)
  }

  /** Picks the revision the visits are of — or none, to see them all: the ticked visits are of another one, so they are let go. */
  function pickRevision(revision: number | null) {
    setRevisionPick(revision)
    // the visits of the revision are all ticked, to be taken off one by one; with none picked, none is
    if (revision !== null && closedVisits) tickVisits(closedVisits.filter((c) => revisionOfVisit(c) === revision), true, new Set())
    else if (pickedVisits.size > 0) { setPickedVisits(new Set()); setDrafts({}); setRevisionFromVisits(false) }
  }

  // The first revision of those offered — the latest — is picked when the visits are read, with all its visits ticked.
  const revisionDefaulted = useRef<string | null>(null)
  useEffect(() => {
    if (!closedVisits || closedVisits.length === 0 || revisionDefaulted.current === projectId) return
    revisionDefaulted.current = projectId
    // the visits ticked in the visit dashboard, when it comes from there: with the revision they are of
    const wanted = new Set((initialVisits ?? []).map((t) => visitKey({ visit: t.visit, end: t.visit } as ClosedVisit)))
    const given = wanted.size > 0 ? closedVisits.filter((c) => wanted.has(visitKey(c))) : []
    if (given.length > 0) {
      setRevisionPick(revisionOfVisit(given[0]))
      tickVisits(given, true, new Set())
      return
    }
    const revisions = closedVisits.map((c) => revisionOfVisit(c)).filter((r): r is number => r !== null)
    if (revisions.length > 0) pickRevision(Math.max(...revisions))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedVisits, projectId])

  /** The visits ticked in the table: the keys it says are the ones picked. */
  function pickVisits(next: Set<string>) {
    applyPicked(next)
  }

  /** Ticks, or unticks, several visits at once. */
  function tickVisits(list: ClosedVisit[], ticked: boolean, from: Set<string> = pickedVisits) {
    const next = new Set(from)
    for (const c of list) { if (ticked) next.add(visitKey(c)); else next.delete(visitKey(c)) }
    applyPicked(next)
  }

  function applyPicked(next: Set<string>) {
    setPickedVisits(next)
    setDrafts({})
    const first = (closedVisits ?? []).find((v) => next.has(visitKey(v)))
    const revision = first ? revisionOfVisit(first) : null
    if (first && revision) { revisionTouched.current = true; setRevision(String(revision)); setRevisionFromLog(null); setRevisionSuggested(false); setRevisionFromVisits(true) }
    else setRevisionFromVisits(false)
  }

  // The details of each deployment start from what the scan found and the location its folder is named after.
  useEffect(() => {
    if (!detailsActive || !scan) return
    setDrafts((current) => {
      const next = { ...current }
      let added = false
      for (const d of scan.deployments.filter((x) => included.has(x.name))) {
        if (next[d.name]) continue
        added = true
        // The location is picked in the first sub-step (or assigned from the folder's name there): the dates wait for its timezone — unless
        // the folder is a visit's, which says where it was: its location, and what it tells of the camera and the site.
        const cv = visitOf(d.name)
        const location = cv ? localLocations.find((l) => l.location_id.toLowerCase() === cv.visit.location_id.toLowerCase()) : undefined
        const timezone = location?.timezone ?? ''
        const base: DeploymentFields = {
          ...EMPTY_DEPLOYMENT_FIELDS, ...(location ? locationFields(location) : {}),
          // Only the dates a timestamp log gives are known by now: the rest are read from the images, below.
          start_date: stampTimezone(d.start_date ?? '', timezone), end_date: d.end_date ? stampTimezone(d.end_date, timezone) : null,
        }
        next[d.name] = { timezone, ignoreDst: location?.ignore_dst ?? null, fields: cv ? fillFromClosedVisit(base, cv) : base }
      }
      return added ? next : current
    })
    setActiveName((name) => (name && included.has(name) ? name : [...included][0] ?? ''))
  }, [detailsActive, scan, included, localLocations, drafts])

  // What each deployment's images say of it — its dates and camera — read once the details are asked for, one deployment at a time.
  useEffect(() => {
    if (!detailsActive) return
    const pending = chosen.filter((d) => drafts[d.name] && !guessRequested.current.has(d.name))
    if (pending.length === 0) return
    pending.forEach((d) => guessRequested.current.add(d.name))
    setGuessingLeft((n) => n + pending.length)
    void (async () => {
      for (const d of pending) {
        try {
          const g = await api.guessDetails(d.path)
          if (!mounted.current) return
          setGuessed((prev) => ({ ...prev, [d.name]: g }))
          // What was already typed (or given by a timestamp log) stays: only the empty fields are filled in.
          setDrafts((current) => {
            const entry = current[d.name]
            if (!entry) return current
            const f = entry.fields
            return { ...current, [d.name]: { ...entry, fields: {
              ...f, start_date: f.start_date || stampTimezone(g.start_date ?? '', entry.timezone),
              end_date: f.end_date || (g.end_date ? stampTimezone(g.end_date, entry.timezone) : null),
              camera_model: f.camera_model || g.camera_model, camera_id: f.camera_id || g.camera_id,
            } } }
          })
        } catch { /* the details are typed by hand then */ }
        if (mounted.current) setGuessingLeft((n) => n - 1)
      }
    })()
  }, [detailsActive, drafts, chosen])

  // Which of the deployments the revision and the locations name are already kept — said as soon as it can be known.
  const knownIds = chosen.map((d) => fieldsOf(d.name).deployment_id).filter(Boolean).sort().join('\n')
  useEffect(() => {
    if (!detailsActive || !projectId || !knownIds) { setExisting({}); return }
    let cancelled = false
    api.existingDeployments(projectId, knownIds.split('\n'))
      .then(({ results }) => { if (!cancelled) setExisting(results) })
      .catch(() => { if (!cancelled) setExisting({}) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsActive, projectId, knownIds])

  // The revision starts as the next one expected for the deployments' locations — the highest of them — until it is typed.
  const locationIds = [...new Set(chosen.map((d) => fieldsOf(d.name).location_id).filter((id): id is string => Boolean(id)))].sort().join('\n')
  useEffect(() => {
    if (!detailsActive || !projectId || !locationIds || revisionTouched.current || revisionFromLog) return
    let cancelled = false
    Promise.all(locationIds.split('\n').map((id) => api.nextRevision(projectId, id)))
      .then((answers) => {
        if (cancelled || revisionTouched.current) return
        setRevision(String(Math.max(...answers.map((a) => a.next)))); setRevisionSuggested(true)
      })
      .catch(() => { /* no suggestion: it is typed */ })
    return () => { cancelled = true }
  }, [detailsActive, projectId, locationIds, revisionFromLog])

  // ── The session folder ──

  async function handleBrowse() {
    setBrowsing(true); setScanError(null)
    try {
      const { path } = await api.browseFolder()
      if (path) { setSessionDir(path); setScan(null) }
    } catch (e) {
      setScanError(e instanceof Error ? e.message : 'Could not open the folder browser.')
    } finally {
      setBrowsing(false)
    }
  }

  async function handleScan() {
    setScanning(true); setScanError(null); setScan(null)
    try {
      let result: SessionScan
      if (singleVisit) {
        // the folder is the deployment's own: its images are counted, and it is the only deployment there is
        const folder = await api.scanFolder(sessionDir)
        const name = sessionDir.split(/[\\/]/).filter(Boolean).pop() ?? sessionDir
        result = { deployments: [{ ...folder, name, path: sessionDir, start_date: null, end_date: null, from_timestamp_log: false, log_deployment_id: null }], loose_files: 0, warnings: [], timestamp_log: null }
      } else {
        result = await api.scanSession(sessionDir)
      }
      setScan(result)
      const logged = result.timestamp_log?.revision
      if (logged) { setRevision(String(logged)); setRevisionFromLog(result.timestamp_log!.name) }
      else if (revisionFromLog) { setRevision(''); setRevisionFromLog(null) }
      setIncluded(new Set(result.deployments.filter((d) => d.image_count > 0).map((d) => d.name)))
      guessRequested.current.clear(); sourcePicked.current.clear(); setDateSources({}); setGuessed({}); setGuessingLeft(0); setPreviousFound({}); setDrafts({}); setValidations({}); setChecks({}); setRuns({})
    } catch (e) {
      setScanError(e instanceof Error ? e.message : 'Could not scan the folder.')
    } finally {
      setScanning(false)
    }
  }

  // ── Validate ──

  const shownImageChecks = IMAGE_CHECK_OPTIONS.filter((o) => checkSettings.VALIDATION[o.value])
  const runnableImageChecks = shownImageChecks.map((o) => o.value).filter((c) => imageChecks.has(c))

  async function handleValidate() {
    setValidating(true); setValidations({})
    for (const d of candidates) {
      try {
        const result = await api.validateImages(d.path, runnableImageChecks, projectId)
        setValidations((v) => ({ ...v, [d.name]: { result } }))
      } catch (e) {
        setValidations((v) => ({ ...v, [d.name]: { error: e instanceof Error ? e.message : 'Could not validate the images.' } }))
      }
    }
    setValidating(false)
  }

  // ── Origin ──

  // ── Details ──

  const revisionNumber = Number(revision)
  const revisionValid = revision.trim() !== '' && Number.isInteger(revisionNumber) && revisionNumber >= 1 && revisionNumber <= 9999

  function fieldsOf(name: string): DeploymentFields {
    const entry = drafts[name]
    if (!entry) return EMPTY_DEPLOYMENT_FIELDS
    return { ...entry.fields, deployment_id: buildDeploymentId(revision, entry.fields.location_id) }
  }

  const errorsOf = (name: string) => validateDeployment(fieldsOf(name), drafts[name]?.timezone ?? '')
  const idCounts = chosen.reduce<Record<string, number>>((n, d) => {
    const id = fieldsOf(d.name).deployment_id
    if (id) n[id] = (n[id] ?? 0) + 1
    return n
  }, {})
  const duplicated = (name: string) => (idCounts[fieldsOf(name).deployment_id] ?? 0) > 1
  /** How many things are wrong or missing in a deployment's details. */
  const problemsOf = (name: string) => (drafts[name] ? Object.keys(errorsOf(name)).length + (duplicated(name) ? 1 : 0) : 1)
  const completed = chosen.filter((d) => problemsOf(d.name) === 0).length
  const existingFolder = (name: string) => existing[fieldsOf(name).deployment_id] ?? null
  const existingNames = chosen.filter((d) => existingFolder(d.name))
  // There can only be an earlier revision after the first, and once it is known that a deployment has none, it is not offered.
  const hasEarlierRevision = (name: string) => {
    const id = fieldsOf(name).deployment_id
    return revisionValid && revisionNumber > 1 && Boolean(id) && Boolean(previousFound[`${projectId}|${id}`])
  }
  const canFillFromPrevious = chosen.some((d) => hasEarlierRevision(d.name))
  // Whether the earlier revisions have been looked up (revision 1 has none): until they have, and while one can be copied from, Epicollect5's lack of entries is not said.
  const previousChecked = !revisionValid || revisionNumber <= 1 || !knownIds || knownIds.split('\n').every((id) => `${projectId}|${id}` in previousFound)
  const detailsReady = revisionValid && chosen.length > 0 && completed === chosen.length

  /** The location each deployment without one is named after: its folder's name first; failing that, the id its row in the timestamp log gives it. */
  const suggested = chosen.flatMap((d) => {
    if (!drafts[d.name] || drafts[d.name].fields.location_id) return []
    const byFolder = matchLocation(d.name, localLocations)
    const byLog = byFolder || !d.log_deployment_id ? undefined : matchLocation(d.log_deployment_id, localLocations)
    const location = byFolder ?? byLog
    return location ? [{ name: d.name, location, from: (byFolder ? 'folder' : 'log') as 'folder' | 'log' }] : []
  })
  const withLocation = chosen.filter((d) => drafts[d.name]?.fields.location_id).length

  // Stable, so that the rows of a big session do not all render again when one of them changes.
  const pickRef = useRef(pickLocation)
  pickRef.current = pickLocation
  const onPickLocation = useCallback((name: string, id: string) => pickRef.current(name, id), [])

  // What the banner assigns: the suggestions of the folders ticked, or all of them when none is.
  const suggestedNow = locSelected.size > 0 ? suggested.filter((x) => locSelected.has(x.name)) : suggested
  const shownLocations = chosen.filter((d) => d.name.toLowerCase().includes(locFilter.trim().toLowerCase())
    && (locTab === 'all' || (locTab === 'ready') === Boolean(drafts[d.name]?.fields.location_id)))

  function assignSuggested(these: typeof suggested) {
    for (const x of these) {
      pickLocation(x.name, x.location.location_id, x.location)
      updateEntry(x.name, (e) => ({ ...e, locationFrom: x.from }))
    }
  }

  function updateEntry(name: string, change: (entry: Entry) => Entry) {
    setDrafts((all) => (all[name] ? { ...all, [name]: change(all[name]) } : all))
  }

  function updateField<K extends keyof DeploymentFields>(name: string, key: K, value: DeploymentFields[K]) {
    updateEntry(name, (e) => ({ ...e, fields: { ...e.fields, [key]: value } }))
  }

  /** Sets the timezone and re-stamps both dates with the designator it gives them — the wall-clock time stays. */
  function setTimezone(name: string, timezone: string) {
    updateEntry(name, (e) => ({
      ...e, timezone,
      fields: { ...e.fields, start_date: stampTimezone(e.fields.start_date, timezone), end_date: e.fields.end_date ? stampTimezone(e.fields.end_date, timezone) : e.fields.end_date },
    }))
  }

  function pickLocation(name: string, locationId: string, known?: LocalLocation) {
    const location = known ?? localLocations.find((l) => l.location_id === locationId)
    updateEntry(name, (e) => ({ ...e, locationFrom: undefined, ignoreDst: location?.ignore_dst ?? null, fields: { ...e.fields, ...locationFields(location) } }))
    if (location?.timezone) setTimezone(name, location.timezone)
  }

  /** Fills these deployments in from the previous revision of the same one — R0002-DONA_01 from R0001-DONA_01 —
   * keeping their own location, dates and id. The camera model and id are only filled in when the images gave none. */
  function fillFromPrevious(names: string[], scope: 'one' | 'all') {
    const found = names.filter((n) => previousFound[`${projectId}|${fieldsOf(n).deployment_id}`])
    setDrafts((all) => {
      const next = { ...all }
      for (const name of found) {
        const previous = previousFound[`${projectId}|${fieldsOf(name).deployment_id}`]?.deployment
        if (previous && next[name]) next[name] = { ...next[name], fields: fillFromPreviousRevision(next[name].fields, previous) }
      }
      return next
    })
    setDetailsPick((p) => ({ ...p, ...Object.fromEntries(found.map((n) => [n, 'manual' as const])) }))
    const before = names.length === 1 ? drafts[names[0]]?.fields : undefined
    setFillMessage({ scope, undo: found.length && before ? { name: names[0], fields: before } : undefined, text: names.length === 1
      ? (found.length ? `Filled in from ${previousFound[`${projectId}|${fieldsOf(names[0]).deployment_id}`]!.deployment_id}.` : 'There is no previous revision of this deployment to fill it in from.')
      : `Filled in ${found.length} of ${names.length} from their previous revision${found.length < names.length ? ` — the other ${names.length - found.length} have none` : ''}.` })
  }

  // Whether the settings turn Epicollect5 on — read again when they are closed, as they may have changed.
  useEffect(() => {
    if (stepKey !== 'dates' || settingsOpen) return
    let cancelled = false
    api.getSettings()
      .then((s) => { if (!cancelled) setEpicollectOn(s.EPICOLLECT5.enabled) })
      .catch(() => { if (!cancelled) setEpicollectOn(false) })
    return () => { cancelled = true }
  }, [stepKey, settingsOpen])

  // ...and, once the revision and the locations are known, the entries Epicollect5 has for them — one read for all.
  const locationKey = [...new Set(chosen.map((d) => fieldsOf(d.name).location_id).filter((l): l is string => Boolean(l)))].sort().join('\n')
  useEffect(() => {
    setEpicollectFound({}); setEpicollectMissing(null); setEpicollectDone(false); setEpicollectImported(false)
    if (!detailsActive || settingsOpen || !epicollectOn || !revisionValid || !locationKey) return
    let cancelled = false
    const timer = setTimeout(() => { // the revision may still be being typed
      void (async () => {
        try {
          const { results } = await api.epicollectEntriesBatch(locationKey.split('\n'), revisionNumber)
          if (cancelled) return
          const found: Record<string, EpicollectEntry> = {}
          for (const d of chosen) {
            const id = fieldsOf(d.name).location_id
            const entry = id ? results[id] : null
            if (entry) found[d.name] = entry
          }
          setEpicollectFound(found)
          if (Object.keys(found).length === 0) setEpicollectMissing('')
          setEpicollectDone(true)
        } catch (e) {
          if (!cancelled) { setEpicollectMissing(e instanceof Error ? e.message : 'Could not read the Epicollect5 project.'); setEpicollectDone(true) }
        }
      })()
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsActive, settingsOpen, epicollectOn, revisionValid, revisionNumber, locationKey])

  /** The period a source gives a deployment — null when it has none (the manual one is whatever is typed). */
  function periodOf(d: SessionScanDeployment, source: DateSource, timezone: string): Period | null {
    if (source === 'visit') {
      const cv = visitOf(d.name)
      return cv ? { start: stampTimezone(`${cv.visit.date}T${cv.visit.time}`, timezone), end: stampTimezone(`${cv.end.date}T${cv.end.time}`, timezone) } : null
    }
    if (source === 'log') return d.from_timestamp_log && d.start_date ? { start: stampTimezone(d.start_date, timezone), end: d.end_date ? stampTimezone(d.end_date, timezone) : null } : null
    if (source === 'exif') { const g = guessed[d.name]; return g?.start_date ? { start: stampTimezone(g.start_date, timezone), end: g.end_date ? stampTimezone(g.end_date, timezone) : null } : null }
    return null
  }

  function applyPeriod(changes: Record<string, { source: DateSource; period: Period | null }>) {
    setDateSources((all) => ({ ...all, ...Object.fromEntries(Object.entries(changes).map(([name, c]) => [name, c.source])) }))
    setDrafts((all) => {
      const next = { ...all }
      for (const [name, { period }] of Object.entries(changes)) if (period && next[name]) next[name] = { ...next[name], fields: { ...next[name].fields, start_date: period.start ?? '', end_date: period.end } }
      return next
    })
  }

  // Each deployment takes the first source that has its dates: the visits, the timestamp log, the images — and by hand if none does,
  // once they have all been looked at. Better ones found later replace the ones taken, unless one was picked.
  useEffect(() => {
    if (!detailsActive) return
    const looking = guessingLeft > 0
    const changes: Record<string, { source: DateSource; period: Period | null }> = {}
    for (const d of chosen) {
      const entry = drafts[d.name]
      if (!entry || sourcePicked.current.has(d.name)) continue
      const order: DateSource[] = visitOf(d.name) ? ['visit', ...SOURCE_ORDER] : SOURCE_ORDER
      const best = order.find((s) => (s === 'manual' ? !looking : periodOf(d, s, entry.timezone) !== null))
      if (best && best !== dateSources[d.name]) changes[d.name] = { source: best, period: periodOf(d, best, entry.timezone) }
    }
    if (Object.keys(changes).length > 0) applyPeriod(changes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsActive, drafts, guessed, guessingLeft, scan])

  /** The sources of a deployment's dates, each showing what it found so they can be compared, and the period taken — typed when it is by hand. */
  function datePanel(d: SessionScanDeployment, entry: Entry, start: string | null, end: string | null, dateSource: DateSource | undefined) {
    const cv = visitOf(d.name)
    return (
      <div aria-label={`Dates of ${d.name}`} role="group" className="mx-5 mb-4">
        <h5 className="sr-only">{fieldsOf(d.name).deployment_id || d.name}</h5>
        <RecordingPeriod visits={cv ? { left: cv.visit.session, collected: cv.end.session } : null} fromVisits={dateSource === 'visit'} start={start} end={end} timezone={entry.timezone}
                         onEdit={() => pickSource(d, 'manual')} onRestore={() => pickSource(d, 'visit')}
                         editForm={<DeploymentFormBody collapsible periodOnly deployment={entry.fields} timezone={entry.timezone} errors={activeErrors_of(d.name)}
                                                       onField={(key, value) => updateField(d.name, key, value)} datesGuessed={false} />} />
      </div>
    )
  }

  /** Takes the dates from the source picked; "by hand" keeps what there is, and lets it be edited. */
  function pickSource(d: SessionScanDeployment, source: DateSource) {
    sourcePicked.current.add(d.name)
    applyPeriod({ [d.name]: { source, period: periodOf(d, source, drafts[d.name]?.timezone ?? '') } })
  }

  /** The camera, site and notes of a deployment: what its previous deployment says overwritten with what its visit says, locked — or by hand, keeping what is there. */
  function pickDetails(name: string, source: 'merge' | 'manual') {
    setDetailsPick((p) => ({ ...p, [name]: source }))
    if (source === 'manual') return
    const cv = visitOf(name)
    const previous = previousFound[`${projectId}|${fieldsOf(name).deployment_id}`]?.deployment ?? null
    updateEntry(name, (e) => ({ ...e, fields: mergedDetails(e.fields, previous, cv ?? null) }))
  }

  // What the previous deployments say is read after the visits' details are taken: the merge is made again when they are there.
  useEffect(() => {
    for (const d of chosen) {
      if (detailsPick[d.name] === 'manual' || !drafts[d.name]) continue
      const cv = visitOf(d.name)
      const previous = previousFound[`${projectId}|${fieldsOf(d.name).deployment_id}`]?.deployment ?? null
      if (!cv && !previous) continue
      updateEntry(d.name, (e) => ({ ...e, fields: mergedDetails(e.fields, previous, cv ?? null) }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previousFound, folderVisit, Object.keys(drafts).join('|')])

  /** Fills the camera, site and notes of the deployments that have an entry in Epicollect5 from it. */
  function importFromEpicollect() {
    const names = Object.keys(epicollectFound)
    setDrafts((all) => {
      const next = { ...all }
      for (const name of names) {
        const entry = next[name]
        if (!entry) continue
        const filled = applyEntry(entry.fields, epicollectFound[name].fields, entry.timezone)
        next[name] = { ...entry, fields: { ...filled, start_date: entry.fields.start_date, end_date: entry.fields.end_date } } // the dates follow the source picked
      }
      return next
    })
    setFillMessage({ scope: 'all', text: `Filled in ${names.length} of ${chosen.length} from Epicollect5 — check the camera, site and notes in More details.` })
    setDetailsPick((p) => ({ ...p, ...Object.fromEntries(names.map((n) => [n, 'manual' as const])) }))
    setEpicollectImported(true)
  }

  // As soon as the revision gives a deployment its id, its previous revision is looked up — once; copying from it is up to the user.
  useEffect(() => {
    if (!detailsActive || !projectId || !revisionValid || revisionNumber <= 1 || !knownIds) return // revision 1 has no earlier one
    const timer = setTimeout(() => {
      const ids = knownIds.split('\n').filter((id) => !(`${projectId}|${id}` in previousFound))
      if (ids.length === 0) return
      api.previousDeployments(projectId, ids)
        .then(({ results }) => setPreviousFound((found) => ({ ...found, ...Object.fromEntries(ids.map((id) => [`${projectId}|${id}`, results[id] ?? null])) })))
        .catch(() => { /* nothing to offer then */ })
    }, 400) // the revision may still be being typed
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsActive, projectId, revisionValid, knownIds])

  const locationErrors = {
    location_id: locationDraft.location_id.trim() ? undefined : 'Required',
    timezone: !locationDraft.timezone.trim() ? 'Required' : !isValidTimezone(locationDraft.timezone) ? 'Not a known IANA timezone (e.g. Europe/Madrid).' : undefined,
    ignore_dst: locationDraft.ignore_dst ? undefined : 'Required',
    latitude: coordinateError(locationDraft.latitude, 90),
    longitude: coordinateError(locationDraft.longitude, 180),
  }
  const canSaveLocation = Object.values(locationErrors).every((e) => !e)

  async function handleSaveLocation() {
    setLocationError(null)
    try {
      const saved = await api.saveLocalLocation(projectId, {
        location_id: locationDraft.location_id.trim(), name: locationDraft.name.trim() || null, timezone: locationDraft.timezone.trim(), ignore_dst: locationDraft.ignore_dst === 'yes',
        trapper_pk: null, latitude: Number(locationDraft.latitude), longitude: Number(locationDraft.longitude), coordinate_uncertainty: null,
      })
      setLocalLocations((list) => [...list, saved])
      pickLocation(activeName, saved.location_id, saved)
      setAddingLocation(false); setLocationDraft(EMPTY_LOCATION_DRAFT)
    } catch (e) {
      setLocationError(e instanceof Error ? e.message : 'Could not save the location.')
    }
  }

  /** Each deployment's row goes into its collection's FileTimestampLog and FieldworkLog before the postvalidation. */
  async function handleContinueFromDetails() {
    setSavingDetails(true); setDetailsError(null)
    try {
      for (const d of chosen) {
        const linked = visitOf(d.name)
        await (linked ? api.writeTimestampLog(projectId, fieldsOf(d.name), fieldworkVisits(linked, folderSd[d.name] ?? '')) : api.writeTimestampLog(projectId, fieldsOf(d.name)))
      }
    } catch (e) {
      setDetailsError(e instanceof Error ? e.message : "Could not write the collection's timestamp log.")
      setSavingDetails(false)
      return
    }
    setSavingDetails(false)
    setChecks({})
    setStep((s) => s + 1)
  }

  // ── Postvalidation ──

  // The checks against the visit are only there when the session is of visits.
  const shownDeploymentChecks = DEPLOYMENT_CHECK_OPTIONS.filter((o) => checkSettings.POSTVALIDATION[o.value] && (visitsMode || (o.value !== 'sd_card' && o.value !== 'photo_count')))
  const runnableDeploymentChecks = shownDeploymentChecks.map((o) => o.value).filter((c) => deploymentChecks.has(c))
  // The tolerance and what the statistical checks mean by a sequence and by similar come from the settings.
  const toleranceHours = String(checkSettings.POSTVALIDATION.tolerance_hours)
  const statistics: StatisticsParams | null = statParamsValid(statParamsOf(checkSettings.POSTVALIDATION))

  async function handleCheck() {
    setChecking(true); setChecks({})
    for (const d of chosen) {
      try {
        const result = await api.validateDeployment(d.path, fieldsOf(d.name), runnableDeploymentChecks, {
          collectionName: null, expectedLocationId: drafts[d.name].fields.location_id || null, toleranceHours: Number(toleranceHours),
          researchProjectId: projectId || null, statistics: statistics ?? undefined,
          visit: visitOf(d.name) ? {
            left_session: visitOf(d.name)!.visit.session, left_sd: visitOf(d.name)!.visit.sd ?? null,
            collected_session: visitOf(d.name)!.end.session, counted_photos: visitOf(d.name)!.end.num_photos ?? null, sd_card: folderSd[d.name] || null,
          } : null,
        })
        setChecks((c) => ({ ...c, [d.name]: { result } }))
      } catch (e) {
        setChecks((c) => ({ ...c, [d.name]: { error: e instanceof Error ? e.message : 'Could not check the deployment.' } }))
      }
    }
    setChecking(false)
  }

  const requiredDeploymentChecksOk = [...requiredDeploymentChecks]
    .filter((c) => checkSettings.POSTVALIDATION[c] && shownDeploymentChecks.some((o) => o.value === c))
    .every((c) => chosen.every((d) => deploymentCheckPassed(c, checks[d.name]?.result ?? null) === true))

  // ── Preprocessing & import ──

  const preSettings = checkSettings.PREPROCESSING
  const effectiveSteps = new Set([...preprocessSteps].filter((k) => k !== 'metadata' || exiftool !== false))
  const pending = chosen.filter((d) => !runs[d.name]?.done)

  async function handleImport() {
    setImporting(true); setOpenFolderError(null)
    for (const d of pending) {
      const name = d.name
      setRuns((r) => ({ ...r, [name]: { events: [], done: false } }))
      const onEvent = (event: ImportEvent) => setRuns((r) => ({
        ...r, [name]: { ...r[name], events: [...r[name].events, event], ...(event.type === 'done' ? { done: true, destDir: event.dest_dir } : {}) },
      }))
      try {
        const deployment = fieldsOf(name)
        // Asked again each time: the first deployment creates the revision's collection, the next ones find it.
        const planned = await api.collectionPath(projectId, deployment.deployment_id)
        setCollectionPath(planned.path)
        const options: PreprocessingOptions = {
          rename: effectiveSteps.has('rename'), resize: effectiveSteps.has('resize'), resize_width: preSettings.resize_width,
          metadata: effectiveSteps.has('metadata'), owner: preSettings.owner, publisher: preSettings.publisher,
          coverage: preSettings.coverage, license_url: preSettings.license_url, research_project: project?.name ?? '',
          convert_to_utc: preSettings.convert_to_utc,
        }
        await api.importLocal(d.path, planned.path, planned.exists ? null : planned.collection, deployment, options, onEvent)
        // The visit this deployment is of is closed by it: it is not offered again.
        const linked = visitOf(name)
        if (linked) api.linkVisit(projectId, linked.visit, deployment.deployment_id).catch(() => {})
      } catch (e) {
        setRuns((r) => ({ ...r, [name]: { ...r[name], error: e instanceof Error ? e.message : 'The import failed.' } }))
      }
    }
    setImporting(false)
  }

  async function handleOpenFolder() {
    setOpenFolderError(null)
    try { await api.openFolder(collectionPath!) } catch (e) { setOpenFolderError(e instanceof Error ? e.message : String(e)) }
  }

  const allDone = chosen.length > 0 && pending.length === 0
  const failures = chosen.filter((d) => runs[d.name]?.error && !runs[d.name]?.done).length

  const visible = chosen.filter((d) => d.name.toLowerCase().includes(filter.trim().toLowerCase()) && (!onlyIncomplete || problemsOf(d.name) > 0))
  function selectDeployment(name: string) { setActiveName((current) => (current === name ? '' : name)); setAddingLocation(false); setFillMessage((m) => (m?.scope === 'one' ? null : m)) }
  const activeErrors_of = (name: string) => shownErrors(errorsOf(name))
  useEffect(() => { if (Object.keys(checks).length === 0 && !checking) setChecksOpen(1) }, [checks, checking])
  function selectMore(name: string) { setMoreName((current) => (current === name ? '' : name)); setFillMessage((m) => (m?.scope === 'one' ? null : m)) }
  /** How many of the optional details — camera, site, groups, tags, notes — a deployment has filled in. */
  const moreFilledOf = (name: string) => {
    const f = drafts[name]?.fields
    if (!f) return 0
    return [f.camera_id, f.camera_model, f.camera_height, f.camera_depth, f.camera_tilt, f.camera_heading, f.camera_interval, f.detection_distance, f.feature_type, f.habitat,
      f.setup_by, f.bait_use, f.timestamp_issues, f.deployment_groups, f.comments, f.tags.length || null].filter((v) => v != null && v !== '' && v !== false).length
  }

  const imagesChecked = candidates.some((d) => validations[d.name])
  const canContinue: Record<StepKey, boolean> = {
    origin: Boolean(projectId) && closedVisits !== null && visitsMode,
    images: chosen.length > 0 && !validating && (!visitsMode || chosen.every((d) => folderVisit[d.name])),
    dates: detailsActive && detailsReady && !savingDetails,
    checks: requiredDeploymentChecksOk && !checking,
    prepare: false,
  }

  const chip = 'rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1 text-xs text-zinc-700 dark:text-zinc-300'
  const sessionName = sessionDir.split(/[\\/]/).filter(Boolean).pop() ?? sessionDir
  const listOf = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)
  const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
  const deploymentsCount = plural(chosen.length, 'deployment', 'deployments')
  const imagesTotal = chosen.reduce((n, d) => n + d.image_count, 0)
  const revisionName = revisionValid ? `R${String(revisionNumber).padStart(4, '0')}` : ''
  /** What has been settled so far, as chips that fill in with each step: the research project, the visits with their range, the photos and the cards, and — once the
   * dates and details are set — the revision, the deployments and the dates they cover. */
  function progressChips(upTo: 'images' | 'dates' | 'details') {
    const chips: ReactNode[] = []
    if (projectId) chips.push(<span key="rp" className={chip}>{projectId}</span>)
    if (pickedList.length > 0) {
      const from = pickedList.map((c) => c.visit.date).sort()[0], to = pickedList.map((c) => c.end.date).sort().reverse()[0]
      chips.push(<span key="visits" className={chip}>{plural(pickedList.length, 'visit', 'visits')} · {from} → {to}</span>)
    }
    if (upTo !== 'images') {
      chips.push(<span key="photos" className={chip}>{plural(imagesTotal, 'image', 'images')}</span>)
      const cards = [...new Set(chosen.map((d) => folderSd[d.name]).filter(Boolean))]
      if (cards.length > 0) chips.push(<span key="sd" className={chip}>{cards.length === 1 ? 'SD card' : 'SD cards'} <span className="font-mono">{cards.join(', ')}</span></span>)
    }
    if (upTo === 'details') {
      if (revisionName) chips.push(<span key="rev" className={`${chip} font-mono`}>{revisionName}</span>)
      chips.push(<span key="count" className={chip}>{deploymentsCount}</span>)
      const starts = chosen.map((d) => drafts[d.name]?.fields.start_date).filter(Boolean) as string[]
      const ends = chosen.map((d) => drafts[d.name]?.fields.end_date).filter(Boolean) as string[]
      if (starts.length > 0) chips.push(<span key="dates" className={chip}>{formatLocal([...starts].sort()[0])} → {ends.length > 0 ? formatLocal([...ends].sort().reverse()[0]) : '…'}</span>)
    }
    return chips.length > 0 ? <div className="flex flex-wrap gap-2 mb-6">{chips}</div> : null
  }
  const strictnessLegend = (
    <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
      <strong className="font-semibold text-zinc-700 dark:text-zinc-300">Skip</strong> doesn't run the check · <strong className="font-semibold text-zinc-700 dark:text-zinc-300">Warn</strong> shows the problems but lets you continue · <strong className="font-semibold text-zinc-700 dark:text-zinc-300">Must pass</strong> blocks you until it passes.
    </p>
  )
  const outcomeBannerOf = (problems: number, blocking: number, requiredCount: number, what: string) => ({
    kind: (problems === 0 ? 'success' : blocking > 0 ? 'error' : 'warning') as 'success' | 'warning' | 'error',
    text: problems === 0
      ? 'Every check passed in every deployment.'
      : <>{plural(problems, 'check found', 'checks found')} problems in {what}. {
          blocking > 0
            ? `${plural(blocking, 'is', 'are')} set to Must pass — resolve ${blocking === 1 ? 'it' : 'them'} to continue.`
            : requiredCount === 0 ? 'None is set to Must pass, so you can continue.' : 'The ones set to Must pass passed, so you can continue.'
        }</>,
  })
  const openImagesStep = (n: number) => { setImagesOpen(n); setImagesReached((r) => Math.max(r, n)) }
  function chooseImageStrictness(check: ImageCheck, strictness: Strictness) {
    setImageChecks((prev) => { const next = new Set(prev); if (strictness === 'skip') next.delete(check); else next.add(check); return next })
    setRequiredImageChecks((prev) => { const next = new Set(prev); if (strictness === 'must') next.add(check); else next.delete(check); return next })
  }
  function chooseDeploymentStrictness(check: DeploymentCheck, strictness: Strictness) {
    setDeploymentChecks((prev) => { const next = new Set(prev); if (strictness === 'skip') next.delete(check); else next.add(check); return next })
    setRequiredDeploymentChecks((prev) => { const next = new Set(prev); if (strictness === 'must') next.add(check); else next.delete(check); return next })
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-8">
      <PageHeader icon={MENU_ICONS.deployment} title={title}
        description="Imports a folder of deployments — one subfolder each — into their revision. The revision, the checks and the preprocessing are the same for all of them; the location, the dates and the camera are asked for each."
        parent="Menu" onParent={onBack} />

      {/* Step indicator */}
      <div className="flex items-start mb-10">
        {STEPS.map((s, i) => (
          <div key={s.key} className="relative flex-1 flex flex-col items-center">
            {i < STEPS.length - 1 && (
              <div aria-hidden="true" className={`absolute top-[18px] left-[calc(50%+26px)] w-[calc(100%-52px)] border-t ${i < step ? 'border-emerald-500' : 'border-zinc-300 dark:border-zinc-700'}`} />
            )}
            <div
              className={`relative w-9 h-9 rounded-full flex items-center justify-center font-bold mb-1 text-sm ${
                i < step ? 'bg-emerald-600 text-white' : i === step ? 'bg-blue-600 text-white' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'
              }`}
            >
              {i < step ? <BadgeIcon className="h-4 w-4" /> : i + 1}
            </div>
            <small className={`text-xs text-center ${i === step ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>
              {s.label}
            </small>
          </div>
        ))}
      </div>

      {/* ── Step: where it comes from — the research project ── */}
      {stepKey === 'origin' && (
        <div>
          <StepHeading>Origin</StepHeading>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
            {fixedProject ? 'Pick the revision and the visits whose images you have.' : 'Say which research project the session belongs to.'} Next you pick the folder with the deployments.
          </p>
          <div className="border-t border-zinc-200 dark:border-zinc-700" />
          <WizardStep n={1} title={fixedProject ? 'Which visits are they of?' : 'Which research project?'} status="open" canEdit={false} onEdit={() => {}}
                      description={fixedProject
                        ? <>The revision of <span className="font-mono font-semibold">{defaultProject?.acronym ?? defaultAcronym}</span>, and the visits of it whose images you have.</>
                        : 'The research project is the same for all of them. Research projects are kept in the collections folder.'}>
            {!fixedProject && <ResearchProjectPicker value={projectId} onSelect={(picked) => { setProject(picked); setDrafts({}) }} />}
            {originError && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{originError}</p>}
            {projectId && closedVisits === null && <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400">Reading the visits…</p>}
            {projectId && closedVisits !== null && closedVisits.length === 0 && (
              <Notice kind="warning" role="status" className="!items-start"
                      action={onRegisterVisits && <button type="button" className={btnPrimary} onClick={() => onRegisterVisits(projectId)}>Register the visits</button>}>
                <div>
                  <strong>{visitsError ? `The visits of ${projectId} could not be read.` : `There is no visit of ${projectId} whose card was collected and has no deployment.`}</strong>{' '}
                  {visitsError ?? 'A deployment is always linked to a visit — the one that left the camera, closed by the one that collected its card. Register the visits first, by hand or from a file with their history.'}
                </div>
              </Notice>
            )}
            {projectId && closedVisits !== null && closedVisits.length > 0 && (() => {
              // all of one revision: the visits whose cards were collected on the same trip
              const session = pickedList[0] ? revisionOfVisit(pickedList[0]) : revisionPick
              const offered = (c: ClosedVisit) => !session || revisionOfVisit(c) === session
              // the table is filtered by the status collected: those that were closed by a visit that collected the card
              const collected = closedVisits.filter((c) => (c.visit.state ?? 'collected') === 'collected')
              const shown = revisionPick ? collected.filter((c) => revisionOfVisit(c) === revisionPick) : collected
              const revisions = [...new Set(closedVisits.map((c) => revisionOfVisit(c)).filter((r): r is number => r !== null))].sort((x, y) => y - x)
              // "Select all" takes the visits of one session — the ticked one's, or else the first shown
              const target = session ?? (shown[0] ? revisionOfVisit(shown[0]) : null)
              return (
                <>
                <FormCard title="Revision" description="A revision is one visit to every site. Pick the one these images are of: only its closed visits without a deployment are offered next.">
                  <RevisionSquares all={{ label: 'All revisions', note: plural(closedVisits.length, 'visit to import', 'visits to import') }} value={session ? String(session) : ''}
                    revisions={revisions.map((r) => ({ id: String(r), label: `R${String(r).padStart(4, '0')}`, note: plural(closedVisits.filter((c) => revisionOfVisit(c) === r).length, 'visit to import', 'visits to import') }))}
                    onPick={(id) => pickRevision(id ? Number(id) : null)} />
                </FormCard>
                <FormCard title="Visits" description={`The visits to ${projectId} that left a camera and whose card has been collected, with no deployment yet. Tick the ones the images are of — all of one revision. Each folder will be one of them: it says where and when it was taken.`}>
                  <ClosedVisitsTable
                    visits={shown}
                    many={{
                      selected: pickedVisits, onChange: pickVisits, noun: 'visits',
                      selectable: offered,
                      choices: [{ label: 'All the visits of the revision', pick: (items) => items.filter((c) => revisionOfVisit(c) === target) }, { label: 'None', pick: () => [] }],
                    }}
                    locations={localLocations} sdCards={sdCards.filter((c) => c.research_project?.toLowerCase() === projectId.toLowerCase())}
                    filters={[{ label: `Revision: ${session ? `R${String(session).padStart(4, '0')}` : 'All'}`, tone: 'blue' }, { label: 'Status: Collected', tone: 'green' }]} total={closedVisits.length} />
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2" role="status">
                    {pickedList.length === 0 ? 'No visit ticked yet.' : `${plural(pickedList.length, 'visit', 'visits')} of the revision R${String(session).padStart(4, '0')}.`}
                  </p>
                </FormCard>
                {onQueue && pickedList.length > 1 && (
                  <FormCard title="How do you want to import them?" description="All at once takes a folder with a subfolder of images for each. One after another asks for each deployment in turn, as Import deployment does, the first, then the second…">
                    <div role="radiogroup" aria-label="How to import them" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {([['all', 'All at once', 'One folder with a subfolder for each visit: the checks, the details and the preparation are done for all of them together.'],
                         ['one', 'One after another', 'Each deployment goes through the whole flow before the next one: its folder, its checks, its details and its saving.']] as const).map(([value, label, hint]) => (
                        <label key={value} className={`block cursor-pointer rounded-xl border px-4 py-3 ${how === value ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-zinc-200 dark:border-zinc-700'}`}>
                          <span className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100"><input type="radio" name="how-to-import" checked={how === value} onChange={() => setHow(value)} />{label}</span>
                          <span className="mt-1 block text-sm text-zinc-600 dark:text-zinc-300">{hint}</span>
                        </label>
                      ))}
                    </div>
                  </FormCard>
                )}
                </>
              )
            })()}
            <div className="flex justify-between items-center mt-4">
              {onBack ? <button type="button" className={btnOutline} onClick={onBack}><span aria-hidden="true">← </span>Back</button> : <div />}
              <button type="button" aria-label={onQueue && how === 'one' && pickedList.length > 1 ? 'Start with the first' : 'Continue to the images'} className={btnPrimary} disabled={!canContinue.origin} onClick={() => (onSingleVisit && pickedList.length === 1 ? onSingleVisit({ researchProjectId: projectId, visit: pickedList[0].visit })
                : onQueue && how === 'one' && pickedList.length > 1 ? onQueue([...pickedList].sort((a, b) => a.visit.location_id.localeCompare(b.visit.location_id, undefined, { numeric: true })).map((c) => ({ researchProjectId: projectId, visit: c.visit })))
                : setStep((s) => s + 1))}>{onQueue && how === 'one' && pickedList.length > 1 ? 'Start with the first' : 'Continue'}<span aria-hidden="true"> →</span></button>
            </div>
          </WizardStep>
        </div>
      )}

      {/* ── Step: the images — the session folder, the checks, the results ── */}
      {stepKey === 'images' && (() => {
        const mustCount = shownImageChecks.filter((o) => imageChecks.has(o.value) && requiredImageChecks.has(o.value)).length
        const ran = candidates.some((d) => validations[d.name])
        const left = ran ? candidates.filter((d) => !freeOfErrors(d.name)) : []
        const imagesUnlocked = (n: number) => (n === 1 ? true : n === 2 ? Boolean(scan) && candidates.length > 0 : ran || validating)
        const imagesStatus = (n: number): 'open' | 'done' | 'locked' | 'running' => {
          if (n === 3 && n === imagesOpen) return validating ? 'running' : 'open'
          return n === imagesOpen ? 'open' : n <= imagesReached && imagesUnlocked(n) ? 'done' : 'locked'
        }
        const runChecks = () => { openImagesStep(3); handleValidate() }
        const failedIn = (c: ImageCheck) => candidates.filter((d) => imageCheckPassed(c, validations[d.name]?.result ?? null) === false).length
        const problems = shownImageChecks.filter((o) => imageChecks.has(o.value) && failedIn(o.value) > 0)
                const withProblems = candidates.filter((d) => validations[d.name]?.error || runnableImageChecks.some((c) => imageCheckPassed(c, validations[d.name]?.result ?? null) === false))
        return (
        <div>
          {progressChips('images')}
          <StepHeading>Images</StepHeading>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
            Select the revision&rsquo;s folder, choose which checks to run over the images of its deployments, and validate them before they go any further.
          </p>
          <div className="border-t border-zinc-200 dark:border-zinc-700" />
          <WizardStep n={1} title={singleVisit ? 'Folder with the images' : 'Revision folder'} status={imagesStatus(1)} canEdit={!validating} onEdit={() => setImagesOpen(1)}
                      description={singleVisit ? 'The folder with the images of the visit\u2019s deployment, on this computer.' : 'A folder with one subfolder per deployment, on this computer.'}
                      summary={scan && <>{sessionName}<br />{plural(candidates.length, 'deployment', 'deployments')} · {plural(candidates.reduce((n, d) => n + d.image_count, 0), 'image', 'images')}</>}>
            <Notice kind="warning" className="mb-4">Copy the images from the cameras&rsquo; memory cards to a local folder first — don&rsquo;t point this at a card itself.</Notice>
            <label className={labelClass} htmlFor="session-dir">Folder path</label>
            <div className="flex gap-2">
              <input id="session-dir" className={`${inputClass} flex-1`} placeholder="/home/me/Pictures/R0003" value={sessionDir}
                     onChange={(e) => { setSessionDir(e.target.value); setScan(null) }} />
              <button type="button" className={`${btnOutline} flex items-center gap-2`} disabled={browsing} onClick={handleBrowse}>
                {browsing && <SmallSpinner />}{browsing ? 'Browsing…' : 'Browse…'}
              </button>
              <button type="button" className={btnOutline} disabled={!sessionDir || scanning} onClick={handleScan}>
                {scanning ? <SmallSpinner /> : scan ? 'Scan again' : 'Scan'}
              </button>
            </div>
            {scanError && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{scanError}</p>}
            {scan && (
              <div className="mt-4">
                {scan.warnings.map((w, i) => <Notice key={i} kind="warning" className="mb-2">{w}</Notice>)}
                {scan.timestamp_log && (
                  <Notice kind="success" role="status" className="mb-2">
                    Timestamp log found: <span className="font-mono">{scan.timestamp_log.name}</span>. Its dates are imported.
                  </Notice>
                )}
                {singleVisit ? (
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-5 py-4 text-sm space-y-3">
                    <p role="status" className="text-zinc-600 dark:text-zinc-300"><strong>{plural(scan.deployments[0].image_count, 'image', 'images')}</strong> found in <span className="font-mono">{scan.deployments[0].name}</span>, for the visit <span className="font-mono">{visitLabel(pickedList[0])}</span>.</p>
                    <div className="max-w-sm">
                      <label className={labelClass} htmlFor="single-sd">SD card of the images</label>
                      <select id="single-sd" aria-label={`SD card of ${scan.deployments[0].name}`} className={inputClass} value={folderSd[scan.deployments[0].name] ?? ''} onChange={(e) => setFolderSd((cur) => ({ ...cur, [scan.deployments[0].name]: e.target.value }))}>
                        <option value="">None said</option>
                        {projectSdCards.map((c) => <option key={c.label} value={c.label}>{[c.label, [c.brand, c.capacity].filter(Boolean).join(' ')].filter(Boolean).join(' — ')}</option>)}
                      </select>
                    </div>
                  </div>
                ) : (
                <>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">{scan.deployments.length} subfolder(s) — tick the ones to import.</p>
                {visitsMode && (() => {
                  const ticked = scan.deployments.filter((d) => included.has(d.name))
                  const withVisit = ticked.filter((d) => folderVisit[d.name]).length
                  const percent = ticked.length === 0 ? 0 : Math.round((withVisit / ticked.length) * 100)
                  return (
                    <div className="mb-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/40 p-5">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100" role="status">{withVisit} of {plural(ticked.length, 'folder', 'folders')} {withVisit === 1 && ticked.length === 1 ? 'has' : 'have'} a visit</p>
                        <span className="text-sm text-zinc-500 dark:text-zinc-400">{percent}%</span>
                      </div>
                      <div role="progressbar" aria-label="Folders with a visit" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-3 h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                        <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${percent}%` }} />
                      </div>
                      <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                        <div className="inline-flex overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700" role="tablist" aria-label="Show the folders">
                          {([['all', 'All', ticked.length], ['missing', 'Missing', ticked.length - withVisit], ['ready', 'Ready', withVisit]] as const).map(([id, label, n]) => (
                            <button key={id} type="button" role="tab" aria-selected={folderTab === id} onClick={() => setFolderTab(id)}
                                    className={`px-4 py-2.5 text-sm font-medium border-l first:border-l-0 border-zinc-300 dark:border-zinc-700 ${folderTab === id ? 'bg-blue-600 text-white' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>{label} {n}</button>
                          ))}
                        </div>
                        <input aria-label="Filter the folders by name" className={`${inputClass} !w-56`} placeholder="Filter by name…" value={folderFilter} onChange={(e) => setFolderFilter(e.target.value)} />
                      </div>
                    </div>
                  )
                })()}
                <table className="w-full text-sm border border-zinc-200 dark:border-zinc-700 rounded">
                  <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-500 dark:text-zinc-400">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-center">Import</th>
                      <th scope="col" className="px-3 py-2 text-left">Subfolder</th>
                      <th scope="col" className="px-3 py-2 text-right">Images</th>
                      <th scope="col" className="px-3 py-2 text-left">Dates</th>
                      {visitsMode && <th scope="col" className="px-3 py-2 text-left">Visit</th>}
                      {visitsMode && <th scope="col" className="px-3 py-2 text-left">SD card</th>}
                      {scan.timestamp_log && <th scope="col" className="px-3 py-2 text-left">In the timestamp log</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                    {scan.deployments.filter((d) => !visitsMode || (d.name.toLowerCase().includes(folderFilter.trim().toLowerCase())
                      && (folderTab === 'all' || (folderTab === 'ready') === Boolean(included.has(d.name) && folderVisit[d.name])))).map((d) => (
                      <tr key={d.name}>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" aria-label={d.name} checked={included.has(d.name)} onChange={() => setIncluded((s) => toggled(s, d.name))} />
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {d.name}
                          {d.warnings.map((w, i) => <p key={i} className="text-xs font-sans text-amber-600 dark:text-amber-400"><Mark kind="warning" />{w}</p>)}
                        </td>
                        <td className="px-3 py-2 text-right">{d.image_count}</td>
                        <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{d.from_timestamp_log ? `${d.start_date ? formatLocal(d.start_date) : '?'} → ${d.end_date ? formatLocal(d.end_date) : '?'}` : <span title="Read from the images when the details are asked for">—</span>}</td>
                        {visitsMode && (
                          <td className="px-3 py-2">
                            {included.has(d.name) && (
                              <select aria-label={`Visit of ${d.name}`} className={inputClass} value={folderVisit[d.name] ?? ''} onChange={(e) => linkFolder(d.name, e.target.value)}>
                                <option value="">Choose a visit</option>
                                {pickedList.filter((c) => !Object.entries(folderVisit).some(([other, k]) => other !== d.name && k === visitKey(c))).map((c) => (
                                  <option key={visitKey(c)} value={visitKey(c)}>{`${c.visit.location_id} · ${c.visit.session} · ${formatVisitWhen(c.visit)}`}</option>
                                ))}
                              </select>
                            )}
                          </td>
                        )}
                        {visitsMode && (
                          <td className="px-3 py-2">
                            {included.has(d.name) && (
                              <select aria-label={`SD card of ${d.name}`} className={inputClass} value={folderSd[d.name] ?? ''} onChange={(e) => setFolderSd((cur) => ({ ...cur, [d.name]: e.target.value }))}>
                                <option value="">None said</option>
                                {projectSdCards.map((c) => <option key={c.label} value={c.label}>{[c.label, [c.brand, c.capacity].filter(Boolean).join(' ')].filter(Boolean).join(' — ')}</option>)}
                              </select>
                            )}
                          </td>
                        )}
                        {scan.timestamp_log && (
                          <td className="px-3 py-2">
                            {d.from_timestamp_log
                              ? <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">In the log</span>
                              : <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">Not in the log</span>}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visitsMode && (() => {
                  const without = candidates.filter((d) => !folderVisit[d.name])
                  return without.length === 0
                    ? <Notice kind="success" role="status" className="mt-3">Every folder has its visit: {plural(candidates.length, 'deployment', 'deployments')} of the collection R{String(revisionOfVisit(pickedList[0]) ?? 0).padStart(4, '0')}.</Notice>
                    : <Notice kind="warning" role="alert" className="mt-3">{without.length === 1 ? 'A folder has' : `${without.length} folders have`} no visit yet — pick it above: <span className="font-mono">{without.slice(0, 5).map((d) => d.name).join(', ')}{without.length > 5 ? ', …' : ''}</span>. Or untick {without.length === 1 ? 'it' : 'them'} if {without.length === 1 ? 'it is' : 'they are'} not of this session.</Notice>
                })()}
                </>
                )}
                {scan.timestamp_log && (scan.timestamp_log.unmatched?.length ?? 0) > 0 && (
                  <Notice kind="warning" role="alert" className="mt-3">
                    {scan.timestamp_log.unmatched!.length === 1 ? 'An entry of the timestamp log has' : `${scan.timestamp_log.unmatched!.length} entries of the timestamp log have`} no folder:{' '}
                    <span className="font-mono">{scan.timestamp_log.unmatched!.slice(0, 5).join(', ')}{scan.timestamp_log.unmatched!.length > 5 ? ', …' : ''}</span>.
                  </Notice>
                )}
              </div>
            )}
            <div className="flex justify-end items-center mt-4">
              <button type="button" aria-label="Continue to the checks" className={btnPrimary} disabled={!scan || scanning || candidates.length === 0 || (visitsMode && candidates.some((d) => !folderVisit[d.name]))} onClick={() => openImagesStep(2)}>Continue<span aria-hidden="true"> →</span></button>
            </div>
          </WizardStep>

          <WizardStep n={2} title="Choose the checks" status={imagesStatus(2)} canEdit={!validating} onEdit={() => setImagesOpen(2)}
                      description={`Choose which checks to run over the images of the ${plural(candidates.length, 'deployment', 'deployments')}, and how strict each one should be.`}
                      summary={<>{runnableImageChecks.length} {runnableImageChecks.length === 1 ? 'check' : 'checks'} to run{mustCount > 0 && ` · ${mustCount} must pass`}</>}>
            {shownImageChecks.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">
                Every validation check is turned off in the settings, so there is nothing to run here — go on.
              </p>
            ) : (
              <>
                <StrictnessTable options={shownImageChecks} enabled={imageChecks} required={requiredImageChecks} running={false}
                                 describe={(c) => IMAGE_CHECK_DESCRIPTIONS[c]} outcome={() => undefined} onChoose={chooseImageStrictness} />
                {strictnessLegend}
              </>
            )}
            <div className="flex items-center justify-between gap-3 mt-4">
              <button type="button" className={btnOutline} onClick={() => setImagesOpen(1)}><span aria-hidden="true">← </span>Back</button>
              <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={runnableImageChecks.length === 0 || validating} onClick={runChecks}>
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current"><path d="M6 4l14 8-14 8z" /></svg>Run checks
              </button>
            </div>
          </WizardStep>

          <WizardStep n={3} title="Results" status={imagesStatus(3)} canEdit={!validating} onEdit={() => setImagesOpen(3)}
                      description="How each check went, in each folder."
                      summary={ran && (left.length === 0 ? 'Checks run — every folder goes on' : `${plural(chosen.length, 'folder goes', 'folders go')} on, ${left.length} left out`)}
                      badge={validating ? 'Checking…' : undefined} expanded={imagesOpen === 3}
                      action={ran && imagesOpen === 3 ? (
                        <button type="button" className={`${btnOutline} flex items-center gap-2`} disabled={validating || runnableImageChecks.length === 0} onClick={handleValidate}>
                          {validating ? <SmallSpinner /> : null}{validating ? 'Checking…' : 'Run again'}
                        </button>
                      ) : undefined}>
            {ran && (
              <SessionResults
                running={validating} checks={runnableImageChecks} onLeaveOut={(names) => setIncluded((set) => new Set([...set].filter((n) => !names.includes(n))))}
                folders={(scan?.deployments ?? []).filter((d) => validations[d.name]).map((d) => ({
                  name: d.name, images: d.image_count, reportId: validations[d.name].result?.report_id ?? null, error: validations[d.name].error,
                  included: included.has(d.name) && freeOfErrors(d.name),
                  problem: Boolean(validations[d.name].error) || runnableImageChecks.some((c) => imageCheckPassed(c, validations[d.name].result ?? null) === false),
                  plain: validations[d.name].result && !validations[d.name].result!.report_id ? <ValidationReport validation={validations[d.name].result!} /> : undefined,
                }))}
                banner={problems.length === 0 && left.length === 0
                  ? { tone: 'ok', text: 'Every check passed in every folder.' }
                  : { tone: left.length > 0 ? 'error' : 'warn', text: <>{plural(problems.length, 'check found', 'checks found')} problems in {withProblems.length} of {plural(candidates.length, 'folder', 'folders')}.{' '}
                      {left.length > 0
                        ? <>{plural(left.length, 'folder fails', 'folders fail')} a check set to Must pass, or could not be checked, so {left.length === 1 ? 'it is' : 'they are'} left out: <span className="font-mono">{left.map((d) => d.name).join(', ')}</span>.</>
                        : requiredImageChecks.size === 0 ? 'None is set to Must pass, so you can continue.' : 'The ones set to Must pass passed, so you can continue.'}</> }}
                byCheck={
                  <StrictnessTable options={shownImageChecks} enabled={imageChecks} required={requiredImageChecks} running={validating} results
                                   unit={{ one: 'folder', many: 'folders' }} describe={(c) => IMAGE_CHECK_DESCRIPTIONS[c]}
                                   outcome={(c) => (candidates.some((d) => imageCheckPassed(c, validations[d.name]?.result ?? null) !== null) ? { failed: failedIn(c), images: null } : undefined)} />
                } />
            )}
          </WizardStep>
        </div>
        )
      })()}

      {/* ── Step: where they were taken, the dates and the details of each deployment ── */}
      {stepKey === 'dates' && (() => {
        const whenOpen = originOpen === 2 && Boolean(projectId)
        const moreOpen = originOpen === 3 && Boolean(projectId)
        const originStatus = (n: number): 'open' | 'done' | 'locked' => {
          if (n === 1) return !whenOpen && !moreOpen ? 'open' : 'done'
          if (n === 2) return whenOpen ? 'open' : projectId && originReached >= 2 ? 'done' : 'locked'
          return moreOpen ? 'open' : projectId && detailsReady && originReached >= 3 ? 'done' : 'locked'
        }
        return (
        <div>
          {progressChips('dates')}

          <StepHeading>Dates and details</StepHeading>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
            {visitsMode ? 'Their locations are those of the visits. Fill in their dates and what you know about the cameras and sites.' : 'Say where each deployment was taken, then fill in their dates and what you know about the cameras and sites.'}
          </p>
          <div className="border-t border-zinc-200 dark:border-zinc-700" />
          {!visitsMode && (
          <WizardStep n={1} title="Where were they taken?" status={originStatus(1)} canEdit onEdit={() => setOriginOpen(1)}
                      description="Pick the location of each deployment, from the locations of the research project."
                      summary={project && <>{project.acronym} · {withLocation === chosen.length ? 'every folder has a location' : `${withLocation} of ${plural(chosen.length, 'folder has', 'folders have')} a location`}</>}>
            {originError && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{originError}</p>}
          {projectId && locationsReady && (
            <div className="mt-6">
              {suggested.length > 0 ? (
                <div className="mb-4 flex items-center gap-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/50 px-5 py-4 text-sm text-blue-900 dark:text-blue-100">
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-current text-blue-600 dark:text-blue-300"><path d="M12 2l2.4 7.1L22 12l-7.6 2.9L12 22l-2.4-7.1L2 12l7.6-2.9z" /></svg>
                  <span className="flex-1">
                    The {suggested.length <= 3 ? `names of ${listOf(suggested.map((x) => x.name))}` : `names of ${suggested.length} folders`} match {suggested.length === 1 ? 'a location' : 'locations'} in {projectId}.
                  </span>
                  <button type="button" className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700" onClick={() => assignSuggested(suggestedNow)}>Assign {suggestedNow.length}</button>
                </div>
              ) : withLocation < chosen.length && (
                <Notice kind="error" role="alert" className="mb-4">
                  {localLocations.length === 0
                    ? <>{projectId} has no locations yet — add them below, one for each deployment.</>
                    : <>No folder name matches a location in {projectId}. Pick the location of each deployment below, or add the ones that are missing.</>}
                </Notice>
              )}
              <div className="mb-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/40 p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100" role="status">{withLocation} of {plural(chosen.length, 'folder', 'folders')} {withLocation === 1 && chosen.length === 1 ? 'has' : 'have'} a location</p>
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">{chosen.length === 0 ? 0 : Math.round((withLocation / chosen.length) * 100)}%</span>
                </div>
                <div role="progressbar" aria-label="Folders with a location" aria-valuemin={0} aria-valuemax={100} aria-valuenow={chosen.length === 0 ? 0 : Math.round((withLocation / chosen.length) * 100)}
                     className="mt-3 h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                  <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${chosen.length === 0 ? 0 : (withLocation / chosen.length) * 100}%` }} />
                </div>
                <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                  <div className="inline-flex overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700" role="tablist" aria-label="Show">
                    {([['all', 'All', chosen.length], ['missing', 'Missing', chosen.length - withLocation], ['ready', 'Ready', withLocation]] as const).map(([id, label, n]) => (
                      <button key={id} type="button" role="tab" aria-selected={locTab === id} onClick={() => setLocTab(id)}
                              className={`px-4 py-2.5 text-sm font-medium border-l first:border-l-0 border-zinc-300 dark:border-zinc-700 ${locTab === id ? 'bg-blue-600 text-white' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>{label} {n}</button>
                    ))}
                  </div>
                  <input aria-label="Filter by name" className={`${inputClass} !w-56`} placeholder="Filter by name…" value={locFilter} onChange={(e) => setLocFilter(e.target.value)} />
                </div>
              </div>
              <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 dark:bg-zinc-800 text-xs text-zinc-500 dark:text-zinc-400 sticky top-0 z-10">
                    <tr>
                      <th scope="col" className="w-10 pl-4 py-2.5 text-left">
                        <input type="checkbox" aria-label="Select all folders" checked={shownLocations.length > 0 && shownLocations.every((d) => locSelected.has(d.name))}
                               onChange={(e) => setLocSelected(e.target.checked ? new Set(shownLocations.map((d) => d.name)) : new Set())} />
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-left">Folder</th>
                      <th scope="col" className="px-3 py-2.5 text-left">Location</th>
                      <th scope="col" className="px-4 py-2.5 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                    {shownLocations.map((d) => {
                      const entry = drafts[d.name]
                      const fields = entry?.fields
                      const located = Boolean(fields?.location_id)
                      return (
                        <Fragment key={d.name}>
                          <tr>
                            <td className="pl-4 py-3 align-top"><input type="checkbox" aria-label={`Select ${d.name}`} checked={locSelected.has(d.name)} onChange={() => setLocSelected((set) => toggled(set, d.name))} /></td>
                            <td className="px-3 py-3 align-top">
                              <span className="block font-mono font-semibold text-zinc-900 dark:text-zinc-100">{d.name}</span>
                              <span className="block text-xs text-zinc-500 dark:text-zinc-400">{plural(d.image_count, 'image', 'images')}</span>
                              {entry?.locationFrom && (
                                <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                                  Assigned from {entry.locationFrom === 'folder' ? `the folder's name, ${d.name}` : `the deployment id in the timestamp log, ${d.log_deployment_id}`}.
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3 align-top w-64">
                              <LocationSelect name={d.name} value={fields?.location_id ?? ''} locations={localLocations} onPick={onPickLocation} />
                              {!(addingLocation && activeName === d.name) && (
                                <button type="button" className="mt-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                        onClick={() => { setActiveName(d.name); setAddingLocation(true); setLocationDraft({ ...EMPTY_LOCATION_DRAFT, location_id: matchLocation(d.name, localLocations) ? '' : d.name }); setLocationError(null) }}>
                                  Add a new location
                                </button>
                              )}
                              {entry && located && (
                                <div className="text-xs mt-2">
                                  <LocationTimeNote locationId={fields!.location_id} latitude={fields!.latitude} longitude={fields!.longitude}
                                                    timezone={entry.timezone} ignoreDst={entry.ignoreDst ?? preSettings.ignore_dst} />
                                </div>
                              )}
                              {located && (fields!.latitude == null || fields!.longitude == null) && (
                                <p className="text-xs text-red-600 dark:text-red-400 mt-2">This location has no coordinates, and a deployment needs them.</p>
                              )}
                              {duplicated(d.name) && <p className="text-xs text-red-600 dark:text-red-400 mt-2">Another deployment of the revision has this id — each needs its own location.</p>}
                              {existingFolder(d.name) && (
                                <Notice kind="warning" role="alert" className="mt-2">
                                  This deployment already exists: <span className="font-mono break-all">{existingFolder(d.name)}</span> is already kept, and
                                  importing it again would be refused as it would mix them. Choose another location, or move that folder away.
                                </Notice>
                              )}
                            </td>
                            <td className="px-4 py-3 align-top text-right">
                              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${located ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300'}`}>
                                {located ? 'Ready' : 'Missing'}
                              </span>
                            </td>
                          </tr>
                          {addingLocation && activeName === d.name && (
                            <tr><td /><td colSpan={3} className="px-3 pb-4">
                
      <div className="mt-4 p-4 rounded border border-zinc-200 dark:border-zinc-700">
        <h6 className="text-sm font-semibold mb-1">New location</h6>
        <p className={`${hintClass} mb-3`}>Create a new location linked to the research project {projectId}.</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Location id" required value={locationDraft.location_id} onChange={(v) => setLocationDraft((l) => ({ ...l, location_id: v }))} />
          <Field label="Location name" value={locationDraft.name} onChange={(v) => setLocationDraft((l) => ({ ...l, name: v }))} />
          <div>
            <FieldLabel id="location-timezone" label="Location timezone" required />
            <TimezoneCombobox id="location-timezone" value={locationDraft.timezone} invalid={!locationDraft.timezone} onChange={(v) => setLocationDraft((d) => ({ ...d, timezone: v }))} />
            <p className={hintClass}>The location's own — every deployment there is read in it.</p>
          </div>
          <Field label="Location latitude" required type="number" step="any" value={locationDraft.latitude} error={shown(locationErrors.latitude)} onChange={(v) => setLocationDraft((l) => ({ ...l, latitude: v }))} />
          <Field label="Location longitude" required type="number" step="any" value={locationDraft.longitude} error={shown(locationErrors.longitude)} onChange={(v) => setLocationDraft((l) => ({ ...l, longitude: v }))} />
        </div>
        {locationError && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{locationError}</p>}
        <div className="flex gap-2 mt-4">
          <button type="button" className={btnPrimary} disabled={!canSaveLocation} onClick={handleSaveLocation}>Save location</button>
          <button type="button" className={btnOutline} onClick={() => setAddingLocation(false)}>Cancel</button>
        </div>
      </div>
                            </td></tr>
                          )}
                        </Fragment>
                      )
                    })}
                    {shownLocations.length === 0 && <tr><td colSpan={4} className="px-4 py-3 text-zinc-500 dark:text-zinc-400">No folder matches.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
            <div className="flex justify-between items-center mt-4">
              <button type="button" className={btnOutline} onClick={() => setStep((s) => s - 1)}><span aria-hidden="true">← </span>Back</button>
              <button type="button" className={btnPrimary} disabled={!projectId} onClick={() => { setOriginOpen(2); setOriginReached(2) }}>Continue to the details<span aria-hidden="true"> →</span></button>
            </div>
          </WizardStep>
          )}

          <WizardStep n={visitsMode ? 1 : 2} title="When was it collected?" status={originStatus(2)} canEdit onEdit={() => setOriginOpen(2)}
                      description="The revision number, and the period of each deployment."
                      summary={revisionValid && <>Revision {revisionName}<br />{deploymentsCount}</>}>
          {guessingLeft > 0 && <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Reading the dates and the cameras from the images… ({guessingLeft} deployment(s) left)</p>}
          <FormCard title={visitsMode ? 'The deployments' : 'Which revision is this?'} description={visitsMode ? 'The revision is the one of the visits you chose: they give every deployment its id.' : 'One revision number for the whole session. It gives every deployment its id.'}>
            {!visitsMode && <div className="flex items-end gap-2 max-w-xs">
              <button type="button" aria-label="Lower the revision number" className={`${btnOutline} !px-3`} disabled={!revisionValid || revisionNumber <= 1}
                      onClick={() => { revisionTouched.current = true; setRevision(String(revisionNumber - 1)); setRevisionFromLog(null); setRevisionSuggested(false); setRevisionFromVisits(false) }}>−</button>
              <div className="flex-1">
                <Field label="What revision number are you importing?" required type="number" min={1} max={9999} step={1} placeholder="e.g. 3" value={revision} onChange={(v) => { revisionTouched.current = true; setRevision(v); setRevisionFromLog(null); setRevisionSuggested(false); setRevisionFromVisits(false) }}
                       error={revision.trim() !== '' && !revisionValid ? 'A whole number from 1 to 9999.' : undefined} />
              </div>
              <button type="button" aria-label="Raise the revision number" className={`${btnOutline} !px-3`} disabled={revisionValid && revisionNumber >= 9999}
                      onClick={() => { revisionTouched.current = true; setRevision(String((revisionValid ? revisionNumber : 0) + 1)); setRevisionFromLog(null); setRevisionSuggested(false); setRevisionFromVisits(false) }}>+</button>
            </div>}
            {!visitsMode && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5">
              {revisionFromVisits && revisionValid ? 'Taken from the session of the visits you chose — change it if it is not right.' : revisionFromLog && revisionValid ? `Taken from the deployment ids in ${revisionFromLog} — change it if it is not right.` : revisionSuggested && revisionValid ? 'Filled in as the next one expected for these locations — change it if it is not right.' : '1 for the first visit to these locations, 2 for the second, and so on.'}
            </p>}
            {revisionValid && chosen.length > 0 && (
              <div className="mt-3 flex items-center gap-2 flex-wrap text-xs text-zinc-500 dark:text-zinc-400">
                <span>Deployment ids</span>
                {chosen.slice(0, 4).map((d) => <span key={d.name} className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 font-mono text-zinc-700 dark:text-zinc-300">{fieldsOf(d.name).deployment_id}</span>)}
                {chosen.length > 4 && <span>+{chosen.length - 4} more</span>}
              </div>
            )}
            {revisionValid && existingNames.length > 0 && (
              <Notice kind="warning" role="status" className="mt-3">
                Revision {revisionNumber} already has {existingNames.length} of these {chosen.length} deployment(s) in the collections folder:{' '}
                <span className="font-mono">{existingNames.slice(0, 5).map((d) => fieldsOf(d.name).deployment_id).join(', ')}{existingNames.length > 5 ? ', …' : ''}</span>.
                Importing them again would be refused — pick another revision, or leave them out.
              </Notice>
            )}
            {Object.keys(epicollectFound).length > 0 && !epicollectImported && (
              <div className="mt-4 flex items-center gap-4 flex-wrap rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/50 px-5 py-4 text-sm text-blue-900 dark:text-blue-100">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current text-blue-600 dark:text-blue-300" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
                <span className="flex-1 min-w-[14rem]">
                  Epicollect5 has an entry for revision {revisionNumber} of {Object.keys(epicollectFound).length === chosen.length ? 'every one of these deployments' : `${Object.keys(epicollectFound).length} of these ${chosen.length} deployments`}.
                  The camera, site and notes can be filled in from {Object.keys(epicollectFound).length === 1 ? 'it' : 'them'}. 
                </span>
                <button type="button" className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700" onClick={importFromEpicollect}>Import from Epicollect5</button>
              </div>
            )}
            {epicollectDone && epicollectMissing !== null && previousChecked && !canFillFromPrevious && (
              <div role="alert" className="mt-4 flex items-center gap-4 flex-wrap rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/50 px-5 py-4 text-sm text-amber-900 dark:text-amber-100">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current text-amber-600 dark:text-amber-300" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></svg>
                <span className="flex-1 min-w-[14rem]">
                  {epicollectMissing || `Epicollect5 has no entry for revision ${revisionNumber} of these deployments: their details have to be filled in here.`}
                </span>
                {onOpenSettings && <button type="button" className="rounded-lg bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-700" onClick={() => onOpenSettings('epicollect')}>Open Epicollect5 settings</button>}
              </div>
            )}
            {fillMessage?.scope === 'all' && <p aria-live="polite" className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{fillMessage.text}</p>}
          </FormCard>

          {scan?.timestamp_log && (
            <p aria-live="polite" className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
              The start and end dates of {scan.timestamp_log.matched} of these {chosen.length} deployment(s) were taken from{' '}
              <span className="font-mono">{scan.timestamp_log.name}</span>, found in the folder, not from the images' EXIF data.
            </p>
          )}
          <FormCard title="When was each one collected?" description="The period of every deployment, and where its dates come from. Open a row to change its dates.">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-zinc-600 dark:text-zinc-400" role="status">{completed} of {chosen.length} deployment(s) complete.</p>
              <div className="flex items-center gap-3">
                <input aria-label="Filter deployments" className={`${inputClass} !w-44`} placeholder="Filter by name…" value={filter} onChange={(e) => setFilter(e.target.value)} />
                <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                  <input type="checkbox" checked={onlyIncomplete} onChange={(e) => setOnlyIncomplete(e.target.checked)} />
                  Only the incomplete ones
                </label>
              </div>
            </div>
            <div className="mb-3 h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden" role="progressbar" aria-label="Deployments complete" aria-valuemin={0} aria-valuemax={chosen.length} aria-valuenow={completed}>
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${chosen.length ? (completed / chosen.length) * 100 : 0}%` }} />
            </div>
            <ul className="-mx-5 divide-y divide-zinc-200 dark:divide-zinc-700 border-y border-zinc-200 dark:border-zinc-700">
              {visible.map((d) => {
                const entry = drafts[d.name]
                const fields = entry?.fields
                const errors = entry ? errorsOf(d.name) : {}
                const start = fields?.start_date ?? null
                const end = fields?.end_date ?? null
                const open = d.name === activeName && Boolean(entry)
                const reading = !d.from_timestamp_log && guessingLeft > 0 && !(d.name in guessed)
                const dateSource = dateSources[d.name]
                const source = !start || !dateSource ? null
                  : dateSource === 'log' ? `From ${scan?.timestamp_log?.name ?? 'the collection’s csv'}`
                  : dateSource === 'exif' ? 'From the images'
                  : dateSource === 'visit' ? 'From the visits'
                  : 'Entered by hand'
                const datesOk = Boolean(start && end && !errors.start_date && !errors.end_date)
                const clash = existingFolder(d.name) ? 'Already exists' : duplicated(d.name) ? 'Duplicate id' : null
                const label = clash ?? (datesOk ? 'Ready' : start ? 'To fix' : 'Dates needed')
                const shown = (iso: string) => formatLocal(iso, entry?.timezone)
                return (
                  <li key={d.name}>
                    <button type="button" aria-expanded={open} aria-label={`${open ? 'Close' : 'Open'} ${d.name}`} onClick={() => selectDeployment(d.name)}
                            className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-zinc-100/60 dark:hover:bg-zinc-800/50">
                      <span className="flex-1 min-w-0">
                        <span className="block font-mono font-semibold text-sm text-zinc-900 dark:text-zinc-100">{d.name}</span>
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                          {start ? `${shown(start)} → ${end ? shown(end) : '…'}` : 'No dates yet'}
                          {source && <> · {source}</>}
                        </span>
                      </span>
                      {reading ? (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">Reading the images…</span>
                      ) : (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${label === 'Ready' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300'}`}>{label}</span>
                      )}
                      <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 fill-none stroke-current text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                    </button>
                    {open && fields && entry && (
                      datePanel(d, entry, start, end, dateSource)
                    )}
                  </li>
                )
              })}
              {visible.length === 0 && <li className="px-5 py-3 text-sm text-zinc-500 dark:text-zinc-400">No deployment matches.</li>}
            </ul>
          </FormCard>
          {detailsError && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{detailsError}</p>}
          <div className="flex justify-between items-center mt-4">
            <button type="button" className={btnOutline} onClick={() => (visitsMode ? setStep((s) => s - 1) : setOriginOpen(1))}><span aria-hidden="true">← </span>Back</button>
            <button type="button" aria-label="Continue to more details" className={btnPrimary} disabled={!detailsReady}
                    onClick={() => { setOriginOpen(3); setOriginReached(3) }}>Continue<span aria-hidden="true"> →</span></button>
          </div>
          </WizardStep>

          <WizardStep n={visitsMode ? 2 : 3} title="More details" status={originStatus(3)} canEdit onEdit={() => { setOriginOpen(3); setOriginReached(3) }}
                      description="Everything here is optional. For each deployment, fill in what you know of its camera and its site now — you can add the rest later."
                      summary={`${chosen.filter((d) => moreFilledOf(d.name) > 0).length} of ${plural(chosen.length, 'deployment', 'deployments')} with details`}>
          {(() => {
            const withDetails = chosen.filter((d) => moreFilledOf(d.name) > 0).length
            const shownMore = chosen.filter((d) => d.name.toLowerCase().includes(moreFilter.trim().toLowerCase()) && (!onlyWithoutDetails || moreFilledOf(d.name) === 0))
            return (
          <FormCard title="Camera, site and notes" description="What you know of each deployment's camera and site. Open a row to fill it in.">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400" role="status">{withDetails} of {chosen.length} deployment(s) with details.</p>
            <div className="flex items-center gap-3">
              <input aria-label="Filter the deployments" className={`${inputClass} !w-44`} placeholder="Filter by name…" value={moreFilter} onChange={(e) => setMoreFilter(e.target.value)} />
              <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                <input type="checkbox" checked={onlyWithoutDetails} onChange={(e) => setOnlyWithoutDetails(e.target.checked)} />
                Only the ones without details
              </label>
            </div>
          </div>
          <div className="mb-3 h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden" role="progressbar" aria-label="Deployments with details" aria-valuemin={0} aria-valuemax={chosen.length} aria-valuenow={withDetails}>
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${chosen.length ? (withDetails / chosen.length) * 100 : 0}%` }} />
          </div>
          <div className="-mx-5 divide-y divide-zinc-200 dark:divide-zinc-700 border-y border-zinc-200 dark:border-zinc-700">
            {shownMore.map((d) => {
              const entry = drafts[d.name]
              const fields = entry?.fields
              const open = d.name === moreName && Boolean(entry)
              const filled = moreFilledOf(d.name)
              return (
                <div key={d.name}>
                  <button type="button" aria-expanded={open} aria-label={`${open ? 'Close' : 'Open'} the details of ${d.name}`} onClick={() => selectMore(d.name)}
                          className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-zinc-100/60 dark:hover:bg-zinc-800/50">
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-semibold text-sm text-zinc-900 dark:text-zinc-100">{d.name}</span>
                        {entry && fieldsOf(d.name).deployment_id && <span className="rounded border border-zinc-300 dark:border-zinc-700 px-1.5 py-0.5 font-mono text-xs text-zinc-600 dark:text-zinc-300">{fieldsOf(d.name).deployment_id}</span>}
                      </span>
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                        {filled > 0 ? [fields?.camera_model, fields?.camera_id, fields?.habitat].filter(Boolean).join(' · ') || `${filled} ${filled === 1 ? 'detail' : 'details'} filled in` : 'No camera or site details yet — optional'}
                      </span>
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${filled > 0 ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'}`}>{filled} filled</span>
                    <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 fill-none stroke-current text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                  {open && fields && entry && (
                    <div aria-label={`Details of ${d.name}`} role="group" className="mx-5 mb-4 rounded-lg bg-zinc-100 dark:bg-zinc-800 p-4">
                      <h5 className="sr-only">{fieldsOf(d.name).deployment_id || d.name}</h5>
                      {(visitOf(d.name) || previousFound[`${projectId}|${fieldsOf(d.name).deployment_id}`]) && (() => {
                        const cv = visitOf(d.name) && visitApplies(visitOf(d.name)!.visit) ? visitOf(d.name)! : null
                        const previous = previousFound[`${projectId}|${fieldsOf(d.name).deployment_id}`]
                        return (
                          <PrefilledDetails
                            previous={previous ? { id: previous.deployment_id, fields: detailsFound(fillFromPreviousRevision(EMPTY_DEPLOYMENT_FIELDS, previous.deployment)).count } : null}
                            visit={cv ? { session: cv.visit.session, when: formatVisitWhen(cv.visit), fields: detailsFound(fillFromClosedVisit(EMPTY_DEPLOYMENT_FIELDS, cv)).count } : null}
                            locked={(detailsPick[d.name] ?? 'merge') === 'merge'} onEdit={() => pickDetails(d.name, 'manual')} onRestore={() => pickDetails(d.name, 'merge')} />
                        )
                      })()}
                      {!visitOf(d.name) && (hasEarlierRevision(d.name) || fillMessage?.scope === 'one') && (
                        <div className="mb-4 flex items-center gap-3 flex-wrap">
                          {hasEarlierRevision(d.name) && (
                            <button type="button" className={btnOutline} onClick={() => fillFromPrevious([d.name], 'one')}>Fill from the previous revision</button>
                          )}
                          {fillMessage?.scope === 'one' && !fillMessage.undo && <span aria-live="polite" className="text-xs text-zinc-500 dark:text-zinc-400">{fillMessage.text}</span>}
                        </div>
                      )}
                      {!visitOf(d.name) && fillMessage?.scope === 'one' && fillMessage.undo?.name === d.name && (
                        <div role="status" className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-5 py-4 text-sm text-emerald-900 dark:text-emerald-100">
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>
                          <span className="flex-1"><strong className="font-semibold">{fillMessage.text}</strong> Change anything that&rsquo;s different this time.</span>
                          <button type="button" className="rounded-lg border border-emerald-400 dark:border-emerald-800 px-4 py-2 text-sm font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                                  onClick={() => { const { name, fields: before } = fillMessage.undo!; setDrafts((all) => (all[name] ? { ...all, [name]: { ...all[name], fields: before } } : all)); setFillMessage(null) }}>Start empty</button>
                        </div>
                      )}

                      <LockedDetailsContext.Provider value={Boolean(visitOf(d.name) || previousFound[`${projectId}|${fieldsOf(d.name).deployment_id}`]) && (detailsPick[d.name] ?? 'merge') !== 'manual'}>
                        <DetailsFromContext.Provider value={[visitOf(d.name) && `Visit ${visitOf(d.name)!.visit.session}`, previousFound[`${projectId}|${fieldsOf(d.name).deployment_id}`]?.deployment_id].filter(Boolean).join(' & ') || null}>
                          <MoreDetailsForm deployment={fields} errors={activeErrors_of(d.name)} onField={(key, value) => updateField(d.name, key, value)} />
                        </DetailsFromContext.Provider>
                      </LockedDetailsContext.Provider>
                    </div>
                  )}
                </div>
              )
            })}
            {shownMore.length === 0 && <p className="px-5 py-3 text-sm text-zinc-500 dark:text-zinc-400">No deployment matches.</p>}
          </div>
          </FormCard>
            )
          })()}
          </WizardStep>
        </div>
        )
      })()}

      {/* ── Step: check the details of each deployment ── */}
      {stepKey === 'checks' && (() => {
        const failedIn = (c: DeploymentCheck) => chosen.filter((d) => deploymentCheckPassed(c, checks[d.name]?.result ?? null) === false).length
        const ran = chosen.some((d) => checks[d.name])
        const problems = shownDeploymentChecks.filter((o) => deploymentChecks.has(o.value) && failedIn(o.value) > 0)
        const blocking = problems.filter((o) => requiredDeploymentChecks.has(o.value))
        const withProblems = chosen.filter((d) => checks[d.name]?.error || runnableDeploymentChecks.some((c) => deploymentCheckPassed(c, checks[d.name]?.result ?? null) === false))
        const byCheckTable = (
          <StrictnessTable
            options={shownDeploymentChecks.map((o) => ({ value: o.value, label: DEPLOYMENT_CHECK_DISPLAY[o.value].label }))}
            enabled={deploymentChecks} required={requiredDeploymentChecks} running={checking} results unit={{ one: 'deployment', many: 'deployments' }}
            describe={(c) => DEPLOYMENT_CHECK_DISPLAY[c].description('the one you chose for each deployment').replace(/\.$/, '')}
            outcome={(c) => (chosen.some((d) => deploymentCheckPassed(c, checks[d.name]?.result ?? null) !== null) ? { failed: failedIn(c), images: null } : undefined)} />
        )
        return (
        <div>
          {progressChips('details')}

          <StepHeading>Check the details</StepHeading>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">
            Now that each deployment is known, we check the names, dates and statistics of all {chosen.length} of them, and that the images fit them.
            Choose how strict each check should be.
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
            Some of these checks can be customized in the settings (Settings › Postvalidation): the tolerance of the image dates, and what the
            comparison with the previous revisions means — the length of a sequence, the way of comparing and how much counts as similar.
          </p>
          <div className="border-t border-zinc-200 dark:border-zinc-700" />

          <WizardStep n={1} title="Choose the checks" status={checksOpen === 1 ? 'open' : 'done'} canEdit={!checking} onEdit={() => setChecksOpen(1)}
                      description="Choose how strict each check should be: skip it, warn about what it finds, or make it a must."
                      summary={<>{runnableDeploymentChecks.length} {runnableDeploymentChecks.length === 1 ? 'check' : 'checks'} to run{requiredDeploymentChecks.size > 0 && ` · ${requiredDeploymentChecks.size} must pass`}</>}>
            {shownDeploymentChecks.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">Every postvalidation check is turned off in the settings, so there is nothing to run here — go on.</p>
            ) : (
              <>
                <StrictnessTable
                  options={shownDeploymentChecks.map((o) => ({ value: o.value, label: DEPLOYMENT_CHECK_DISPLAY[o.value].label }))}
                  enabled={deploymentChecks} required={requiredDeploymentChecks} running={false} unit={{ one: 'deployment', many: 'deployments' }}
                  describe={(c) => DEPLOYMENT_CHECK_DISPLAY[c].description('the one you chose for each deployment').replace(/\.$/, '')}
                  outcome={() => undefined} onChoose={chooseDeploymentStrictness} />
                {strictnessLegend}
                <div className="flex justify-end mt-4">
                  <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={checking || runnableDeploymentChecks.length === 0} onClick={() => { setChecksOpen(2); void handleCheck() }}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current"><path d="M6 4l14 8-14 8z" /></svg>Run checks
                  </button>
                </div>
              </>
            )}
          </WizardStep>

          <WizardStep n={2} title="Check results" status={checking ? 'running' : ran ? (checksOpen === 2 ? 'open' : 'done') : 'locked'}
                      canEdit={!checking} onEdit={() => setChecksOpen(2)} expanded={checksOpen === 2}
                      description={ran && !checking ? `${deploymentsCount} · checked ${plural(Object.keys(checks).length, 'deployment', 'deployments')}.` : 'How each check went.'}
                      summary={ran && (requiredDeploymentChecksOk ? 'Checks run — you can continue' : 'A check set to Must pass failed')}
                      badge={checking ? 'Checking…' : undefined}
                      action={ran && checksOpen === 2 ? (
                        <button type="button" className={`${btnOutline} flex items-center gap-2`} disabled={checking || runnableDeploymentChecks.length === 0} onClick={() => void handleCheck()}>
                          {checking ? <SmallSpinner /> : null}{checking ? 'Checking…' : 'Run again'}
                        </button>
                      ) : undefined}>
            {ran && !checking && (
              <DeploymentResults
                deployments={chosen.filter((d) => checks[d.name]).map((d) => {
                  const outcome = checks[d.name]
                  return {
                    name: fieldsOf(d.name).deployment_id, images: d.image_count, error: outcome.error,
                    failed: runnableDeploymentChecks.filter((c) => deploymentCheckPassed(c, outcome.result ?? null) === false).map((c) => DEPLOYMENT_CHECK_DISPLAY[c].label),
                    reportId: outcome.result?.report_id ?? null,
                    detail: outcome.result && !outcome.result.report_id ? <DeploymentCheckReport result={outcome.result} toleranceHours={toleranceHours} /> : undefined,
                  }
                })}
                banner={outcomeBannerOf(problems.length, blocking.length, requiredDeploymentChecks.size, plural(withProblems.length, 'deployment', 'deployments'))}
                byCheck={byCheckTable} />
            )}
            {(!ran || checking) && byCheckTable}
          </WizardStep>
        </div>
        )
      })()}

      {/* ── Step: prepare the images and save the deployments ── */}
      {stepKey === 'prepare' && (() => {
        const rows: { key: string; label: string; always?: boolean; step?: PreprocessStep; text: ReactNode; disabledReason?: string }[] = [
          { key: 'copy', label: 'Copy into the collection', always: true, text: <>Copies the images of each deployment into its own folder in the revision&rsquo;s collection. Anything that isn&rsquo;t an image is copied as it is.</> },
          { key: 'dates', label: 'Read the capture dates', always: true, text: <>From each image&rsquo;s EXIF, as the camera&rsquo;s local time in its location&rsquo;s timezone, ignoring summer time where the location says so{preSettings.convert_to_utc ? ', converted to UTC' : ''}.</> },
          { key: 'rename', label: 'Rename the images', step: 'rename', text: <><span className="font-mono">{'<deployment>__<YYYYMMDD>_<n>.<EXT>'}</span> in upper case.</> },
          { key: 'resize', label: 'Resize the images', step: 'resize', text: <>Images wider than <strong>{preSettings.resize_width} px</strong> are resized to that width, keeping their proportions.</> },
          { key: 'metadata', label: 'Add metadata', step: 'metadata', text: <>Authorship, rights and license, written into each image as XMP — owner <span className="font-mono">{preSettings.owner || 'Unknown'}</span>, publisher <span className="font-mono">{preSettings.publisher || 'Unknown'}</span>.</>, disabledReason: exiftool === false ? 'ExifTool is not installed, and writing the metadata needs it.' : undefined },
        ]
        const started = importing || Object.keys(runs).length > 0
        const active = (r: (typeof rows)[number]) => r.always || (r.step !== undefined && effectiveSteps.has(r.step))
        const status1 = started ? 'done' : 'open'
        return (
          <div>
            {progressChips('details')}

            <StepHeading>Prepare and save</StepHeading>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
              Choose what is done to the images of every deployment, see how it went, and save the revision in your local collection. Nothing is uploaded to Trapper yet.
            </p>
            <div className="border-t border-zinc-200 dark:border-zinc-700" />

            <WizardStep n={1} title="Processing steps" status={status1} canEdit={false} onEdit={() => {}}
                        description={`Choose what to do to the images of every deployment as they are imported. Your originals are never touched. ${describePreprocessing(effectiveSteps)}.`}
                        summary={describePreprocessing(effectiveSteps)}>
              <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700 mb-4">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 dark:bg-zinc-800">
                    <tr className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      <th scope="col" className="px-4 py-2.5 text-left">Step</th>
                      <th scope="col" className="px-4 py-2.5 text-center">Include</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                    {rows.map((r) => (
                      <tr key={r.key}>
                        <td className="px-4 py-3 text-zinc-800 dark:text-zinc-200">
                          <span className="font-medium">{r.label}</span>
                          <span className="block text-xs text-zinc-500 dark:text-zinc-400">{r.text}</span>
                          {r.disabledReason && <span className="block text-xs text-red-600 dark:text-red-400">{r.disabledReason}</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {r.always
                            ? <span className="text-xs px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">Always</span>
                            : <input type="checkbox" aria-label={r.label} checked={active(r)} disabled={Boolean(r.disabledReason)}
                                     onChange={() => { preprocessTouched.current = true; setPreprocessSteps((s) => toggled(s, r.step!)) }} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Each optional step can be switched off for this run; its values come from Settings › Preprocessing.</p>
              <div className="flex justify-end mt-4">
                <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={importing || pending.length === 0} onClick={handleImport}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current"><path d="M6 4l14 8-14 8z" /></svg>
                  {`Import ${pending.length} deployment${pending.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </WizardStep>

            <WizardStep n={2} title="Processing results" status={allDone ? 'done' : importing ? 'running' : started ? 'open' : 'locked'} canEdit={false} onEdit={() => {}} expanded={allDone}
                        badge={importing ? 'Importing…' : undefined}
                        description="How each deployment went: its images are copied, renamed, resized and tagged into its folder in the revision’s collection."
                        action={!importing && failures > 0 ? <button type="button" className={`${btnPrimary} flex items-center gap-2`} onClick={handleImport}>{`Import the ${pending.length} left`}</button> : undefined}>
              <div className="mb-4">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">{chosen.filter((d) => runs[d.name]?.done).length} of {plural(chosen.length, 'deployment', 'deployments')} imported</span>
                  <span className="text-zinc-500 dark:text-zinc-400">{chosen.length === 0 ? 0 : Math.round((chosen.filter((d) => runs[d.name]?.done).length / chosen.length) * 100)}%</span>
                </div>
                <div role="progressbar" aria-label="Deployments imported" aria-valuemin={0} aria-valuemax={100}
                     aria-valuenow={chosen.length === 0 ? 0 : Math.round((chosen.filter((d) => runs[d.name]?.done).length / chosen.length) * 100)}
                     className="mt-2 h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                  <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${chosen.length === 0 ? 0 : (chosen.filter((d) => runs[d.name]?.done).length / chosen.length) * 100}%` }} />
                </div>
              </div>
              <ul className="space-y-2 mb-4">
                {chosen.map((d) => {
                  const run = runs[d.name]
                  const id = fieldsOf(d.name).deployment_id
                  return (
                    <li key={d.name} className="rounded border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm" aria-label={`Import of ${id}`}>
                      <span className="font-mono">{id}</span>{' '}
                      {!run && <span className="text-zinc-500 dark:text-zinc-400">— waiting</span>}
                      {run && !run.done && !run.error && <span className="text-zinc-500 dark:text-zinc-400">— importing…
                        {(() => { const last = [...run.events].reverse().find((e) => e.type === 'copy'); return last && last.type === 'copy' ? ` ${last.index}/${last.total}` : '' })()}</span>}
                      {run?.done && <span className="text-emerald-600 dark:text-emerald-400"><Mark kind="success" />imported — <span className="font-mono">{run.destDir}</span></span>}
                      {run?.error && !run.done && <span className="text-red-600 dark:text-red-400"><Mark kind="warning" />{run.error}</span>}
                      {(() => { const done = run?.events.find((e) => e.type === 'done'); return done && done.type === 'done' && done.report_id ? <ReportPanel reportId={done.report_id} /> : null })()}
                      {run?.events.filter((e) => e.type === 'skipped').map((e, i) => (
                        <p key={i} className="text-xs text-amber-600 dark:text-amber-400"><Mark kind="warning" />Skipped {e.type === 'skipped' ? `${e.name}: ${e.detail}` : ''}</p>
                      ))}
                    </li>
                  )
                })}
              </ul>
            </WizardStep>

            <WizardStep n={3} title="Save to your collection" status={allDone ? 'done' : 'locked'} canEdit={false} onEdit={() => {}} expanded={allDone}
                        description="Available once the images are prepared.">
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                The {deploymentsCount} go into revision {revisionName}&rsquo;s collection of <span className="font-mono">{projectId}</span>. Each deployment is consolidated: its
                metadata is written and it is <strong>sealed</strong>, so it can&rsquo;t be modified afterwards — and it can then be uploaded.
              </p>
              {allDone && (
                <div className="flex items-center gap-3 flex-wrap">
                  <p className="text-sm text-emerald-600 dark:text-emerald-400"><Mark kind="success" />Imported — {chosen.length} deployment(s).</p>
                  {collectionPath && <button type="button" className={btnOutline} onClick={handleOpenFolder}>Open folder</button>}
                  {onUpload && projectId && revisionValid && (
                    <button type="button" className={btnPrimary} onClick={() => onUpload({ researchProjectId: projectId, collection: revisionName })}>
                      Upload to Trapper
                    </button>
                  )}
                  {openFolderError && <p className="text-sm text-red-600 dark:text-red-400">{openFolderError}</p>}
                </div>
              )}
            </WizardStep>
          </div>
        )
      })()}

      {/* Navigation */}
      <div className="flex justify-between items-end mt-10">
        {stepKey === 'origin' ? (
          <div />  // its own Back and Continue are in the step
        ) : stepKey === 'dates' ? (
          originOpen === 3 && !importing ? <button type="button" className={btnOutline} onClick={() => setOriginOpen(2)}><span aria-hidden="true">← </span>Back</button> : <div />  // the other two have their own
        ) : stepKey === 'images' && imagesOpen === 2 ? (
          <div />  // its own Back is in the step
        ) : stepKey === 'images' && imagesOpen === 3 ? (
          <button type="button" className={btnOutline} disabled={validating} onClick={() => setImagesOpen(2)}><span aria-hidden="true">← </span>Back</button>
        ) : step > 0 && !importing ? (
          <button type="button" className={btnOutline} onClick={() => setStep((s) => s - 1)} disabled={allDone}><span aria-hidden="true">← </span>Back</button>
        ) : <div />}

        {stepKey === 'images' && (
          <div className="flex flex-col items-end gap-1">
            {scan && candidates.length > 0 && chosen.length === 0 && <p className="text-xs text-amber-600 dark:text-amber-400">No deployment is free of errors, so none can go on.</p>}
            <button type="button" className={btnPrimary} disabled={!canContinue.images} onClick={() => setStep((s) => s + 1)}>{imagesChecked && chosen.length > 0 ? `Continue with ${plural(chosen.length, 'folder', 'folders')}` : 'Continue'}<span aria-hidden="true"> →</span></button>
          </div>
        )}
        {stepKey === 'dates' && (
          <div className="flex flex-col items-end gap-1 max-w-md">
            {detailsError && <p className="text-xs text-red-600 dark:text-red-400 text-right">{detailsError}</p>}
            {detailsActive && originOpen >= 2 && !detailsReady && (() => {
              const incomplete = chosen.filter((d) => problemsOf(d.name) > 0)
              const onlyDates = incomplete.length > 0 && incomplete.every((d) => Object.keys(errorsOf(d.name)).every((k) => k === 'start_date' || k === 'end_date') && !duplicated(d.name))
              return <p className="text-xs text-amber-600 dark:text-amber-400">{!revisionValid ? 'Enter the revision number.' : `${plural(incomplete.length, 'deployment needs', 'deployments need')} ${onlyDates ? 'dates' : 'details'}.`}</p>
            })()}
            <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!canContinue.dates} onClick={handleContinueFromDetails}>
              {savingDetails && <SmallSpinner />}{savingDetails ? 'Saving…' : <>Continue<span aria-hidden="true"> →</span></>}
            </button>
          </div>
        )}
        {stepKey === 'checks' && (
          <div className="flex flex-col items-end gap-1">
            {!requiredDeploymentChecksOk && <p className="text-xs text-amber-600 dark:text-amber-400">Run the checks and resolve the ones set to Must pass to continue.</p>}
            <button type="button" className={btnPrimary} disabled={!canContinue.checks} onClick={() => setStep((s) => s + 1)}>Continue<span aria-hidden="true"> →</span></button>
          </div>
        )}
      </div>
    </div>
  )
}

/** The location of a deployment, picked from the project's — it renders again only when its own value changes. */
const LocationSelect = memo(function LocationSelect({ name, value, locations, onPick }: {
  name: string; value: string; locations: LocalLocation[]; onPick: (name: string, id: string) => void
}) {
  // The list of locations is only put in the page when the select is used: a big session has many rows.
  const [used, setUsed] = useState(false)
  const label = (l: LocalLocation) => (l.name ? `${l.location_id} — ${l.name}` : l.location_id)
  const options = used ? locations : locations.filter((l) => l.location_id === value)
  return (
    <select id={`location-${name}`} aria-label={`Location of ${name}`} className={inputClass} value={value}
            onMouseDown={() => setUsed(true)} onFocus={() => setUsed(true)} onChange={(e) => onPick(name, e.target.value)}>
      <option value="">Choose a location</option>
      {options.map((l) => <option key={l.location_id} value={l.location_id}>{label(l)}</option>)}
    </select>
  )
})

function coordinateError(text: string, limit: number): string | undefined {
  if (text.trim() === '') return 'Required'
  const n = Number(text)
  return Number.isFinite(n) && Math.abs(n) <= limit ? undefined : `Must be between ${-limit} and ${limit}.`
}

/** An error worth showing beside a field — everything but "left empty". */
function shown(message?: string): string | undefined {
  return message && message !== 'Required' ? message : undefined
}
