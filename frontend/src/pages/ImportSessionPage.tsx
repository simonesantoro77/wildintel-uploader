import ReportPanel from '../components/ReportPanel'
import SessionResults from '../components/SessionResults'
import { Fragment, memo, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import WizardStep from '../components/WizardStep'
import { formatDay } from '../dateFormat'
import { api } from '../api'
import { isValidTimezone, shownErrors, stampTimezone, validateDeployment } from '../deploymentValidation'
import ResearchProjectPicker from '../components/ResearchProjectPicker'
import { EMPTY_DEPLOYMENT_FIELDS } from '../types'
import type {
  DeploymentCheck, DeploymentCheckResult, DeploymentFields, GuessedDetails, ImageCheck, ImportEvent, LocalLocation, LocalResearchProject,
  PreprocessingOptions, PreviousDeployment, SessionScan, StatisticsParams, UploadTarget, ValidationResult,
} from '../types'
import {
  ALL_DEPLOYMENT_CHECKS, DEFAULT_CHECK_SETTINGS, DEPLOYMENT_CHECK_DISPLAY, DEPLOYMENT_CHECK_OPTIONS, DeploymentCheckReport, Field,
  FormCard, IMAGE_CHECK_DESCRIPTIONS, IMAGE_CHECK_OPTIONS, SmallSpinner, StepHeading, StrictnessTable,
  DeploymentFormBody, LocationTimeNote, MoreDetailsForm, ValidationReport, buildDeploymentId, fillFromPreviousRevision, btnOutline, btnPrimary, deploymentCheckPassed, describePreprocessing, imageCheckPassed,
  inputClass, labelClass, statParamsOf, statParamsValid, toggled,
} from './ImportDeploymentPage'
import type { PreprocessStep, Strictness, WizardSettings } from './ImportDeploymentPage'

type StepKey = 'images' | 'origin' | 'checks' | 'prepare'

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'images', label: 'Images' },
  { key: 'origin', label: 'Origin and details' },
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

const EMPTY_LOCATION_DRAFT = { location_id: '', name: '', timezone: '', ignore_dst: true, latitude: '', longitude: '' }

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
}

export default function ImportSessionPage({ onUpload }: Props = {}) {
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
  const [requiredDeploymentChecks, setRequiredDeploymentChecks] = useState<Set<DeploymentCheck>>(new Set())
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
  const [localLocations, setLocalLocations] = useState<LocalLocation[]>([])
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
  // Where each deployment is already kept, by its id — importing it again would be refused.
  const [existing, setExisting] = useState<Record<string, string | null>>({})
  // Whether each deployment is known to have an earlier revision (true) or not (false), by research project and id — until it is looked up, unknown.
  const [previousFound, setPreviousFound] = useState<Record<string, PreviousDeployment | null>>({})
  // What the last fill said, and whether it was for one deployment or for all of them.
  const [fillMessage, setFillMessage] = useState<{ scope: 'one' | 'all'; text: string; undo?: { name: string; fields: DeploymentFields } } | null>(null)
  const [locFilter, setLocFilter] = useState('')
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
  // The deployments' details are asked for once the research project is picked and the details sub-step is open.
  const detailsActive = stepKey === 'origin' && Boolean(projectId) && locationsReady

  useEffect(() => {
    if (stepKey !== 'images' && stepKey !== 'checks' && stepKey !== 'prepare') return
    let cancelled = false
    api.getSettings()
      .then((s) => {
        if (cancelled) return
        setCheckSettings({ VALIDATION: s.VALIDATION, POSTVALIDATION: s.POSTVALIDATION, PREPROCESSING: s.PREPROCESSING })
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
      .then(({ results }) => { if (!cancelled) { setLocalLocations(results); setLocationsReady(true) } })
      .catch((e) => { if (!cancelled) setOriginError(e instanceof Error ? e.message : 'Could not read the locations.') })
    return () => { cancelled = true }
  }, [projectId])

  // The details of each deployment start from what the scan found and the location its folder is named after.
  useEffect(() => {
    if (!detailsActive || !scan) return
    setDrafts((current) => {
      const next = { ...current }
      for (const d of scan.deployments.filter((x) => included.has(x.name))) {
        if (next[d.name]) continue
        // The location is picked in the first sub-step (or assigned from the folder's name there): the dates wait for its timezone.
        const timezone = ''
        next[d.name] = {
          timezone, ignoreDst: null,
          fields: {
            ...EMPTY_DEPLOYMENT_FIELDS,
            // Only the dates a timestamp log gives are known by now: the rest are read from the images, below.
            start_date: stampTimezone(d.start_date ?? '', timezone), end_date: d.end_date ? stampTimezone(d.end_date, timezone) : null,
          },
        }
      }
      return next
    })
    setActiveName((name) => (name && included.has(name) ? name : [...included][0] ?? ''))
  }, [detailsActive, scan, included, localLocations])

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
      const result = await api.scanSession(sessionDir)
      setScan(result)
      const logged = result.timestamp_log?.revision
      if (logged) { setRevision(String(logged)); setRevisionFromLog(result.timestamp_log!.name) }
      else if (revisionFromLog) { setRevision(''); setRevisionFromLog(null) }
      setIncluded(new Set(result.deployments.filter((d) => d.image_count > 0).map((d) => d.name)))
      guessRequested.current.clear(); setGuessed({}); setGuessingLeft(0); setPreviousFound({}); setDrafts({}); setValidations({}); setChecks({}); setRuns({})
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
        const result = await api.validateImages(d.path, runnableImageChecks)
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
    const before = names.length === 1 ? drafts[names[0]]?.fields : undefined
    setFillMessage({ scope, undo: found.length && before ? { name: names[0], fields: before } : undefined, text: names.length === 1
      ? (found.length ? `Filled in from ${previousFound[`${projectId}|${fieldsOf(names[0]).deployment_id}`]!.deployment_id}.` : 'There is no previous revision of this deployment to fill it in from.')
      : `Filled in ${found.length} of ${names.length} from their previous revision${found.length < names.length ? ` — the other ${names.length - found.length} have none` : ''}.` })
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
    timezone: locationDraft.timezone && !isValidTimezone(locationDraft.timezone) ? 'Not a known IANA timezone (e.g. Europe/Madrid).' : undefined,
    latitude: coordinateError(locationDraft.latitude, 90),
    longitude: coordinateError(locationDraft.longitude, 180),
  }
  const canSaveLocation = Object.values(locationErrors).every((e) => !e)

  async function handleSaveLocation() {
    setLocationError(null)
    try {
      const saved = await api.saveLocalLocation(projectId, {
        location_id: locationDraft.location_id.trim(), name: locationDraft.name.trim() || null, timezone: locationDraft.timezone.trim() || null, ignore_dst: locationDraft.ignore_dst,
        trapper_pk: null, latitude: Number(locationDraft.latitude), longitude: Number(locationDraft.longitude), coordinate_uncertainty: null,
      })
      setLocalLocations((list) => [...list, saved])
      pickLocation(activeName, saved.location_id, saved)
      setAddingLocation(false); setLocationDraft(EMPTY_LOCATION_DRAFT)
    } catch (e) {
      setLocationError(e instanceof Error ? e.message : 'Could not save the location.')
    }
  }

  /** Each deployment's row goes into its collection's FileTimestampLog before the postvalidation. */
  async function handleContinueFromDetails() {
    setSavingDetails(true); setDetailsError(null)
    try {
      for (const d of chosen) await api.writeTimestampLog(projectId, fieldsOf(d.name))
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

  const shownDeploymentChecks = DEPLOYMENT_CHECK_OPTIONS.filter((o) => checkSettings.POSTVALIDATION[o.value])
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
        })
        setChecks((c) => ({ ...c, [d.name]: { result } }))
      } catch (e) {
        setChecks((c) => ({ ...c, [d.name]: { error: e instanceof Error ? e.message : 'Could not check the deployment.' } }))
      }
    }
    setChecking(false)
  }

  const requiredDeploymentChecksOk = [...requiredDeploymentChecks]
    .filter((c) => checkSettings.POSTVALIDATION[c])
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
    images: chosen.length > 0 && !validating,
    origin: detailsActive && detailsReady && !savingDetails,
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
  const strictnessLegend = (
    <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
      <strong className="font-semibold text-zinc-700 dark:text-zinc-300">Skip</strong> doesn't run the check · <strong className="font-semibold text-zinc-700 dark:text-zinc-300">Warn</strong> shows the problems but lets you continue · <strong className="font-semibold text-zinc-700 dark:text-zinc-300">Must pass</strong> blocks you until it passes.
    </p>
  )
  const outcomeBanner = (problems: number, blocking: number, requiredCount: number, what: string) => (
    <div role="status" className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
      problems === 0
        ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
        : blocking > 0
          ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300'
          : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
    }`}>
      {problems === 0
        ? 'Every check passed in every deployment.'
        : <>{plural(problems, 'check found', 'checks found')} problems in {what}. {
            blocking > 0
              ? `${plural(blocking, 'is', 'are')} set to Must pass — resolve ${blocking === 1 ? 'it' : 'them'} to continue.`
              : requiredCount === 0 ? 'None is set to Must pass, so you can continue.' : 'The ones set to Must pass passed, so you can continue.'
          }</>}
    </div>
  )
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
    <div className="max-w-screen-md mx-auto px-4 py-8">
      <h2 className="text-xl font-bold mb-1 text-zinc-900 dark:text-zinc-100">Import session</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
        Imports a folder of deployments — one subfolder each — into the local collections folder. The revision, the checks and the
        preprocessing are the same for all of them; the location, the dates and the camera are asked for each.
      </p>

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
              {i < step ? '✓' : i + 1}
            </div>
            <small className={`text-xs text-center ${i === step ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>
              {s.label}
            </small>
          </div>
        ))}
      </div>

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
          <StepHeading>Images</StepHeading>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
            Select the session&rsquo;s folder, choose which checks to run over the images of its deployments, and validate them before they go any further.
          </p>
          <div className="border-t border-zinc-200 dark:border-zinc-700" />
          <WizardStep n={1} title="Session folder" status={imagesStatus(1)} canEdit={!validating} onEdit={() => setImagesOpen(1)}
                      description="A folder with one subfolder per deployment, on this computer."
                      summary={scan && <>{sessionName}<br />{plural(candidates.length, 'deployment', 'deployments')} · {plural(candidates.reduce((n, d) => n + d.image_count, 0), 'image', 'images')}</>}>
            <div className="mb-4 flex items-center gap-2 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              <span aria-hidden="true">⚠</span>
              <span>Copy the images from the cameras&rsquo; memory cards to a local folder first — don&rsquo;t point this at a card itself.</span>
            </div>
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
                {scan.warnings.map((w, i) => <p key={i} className="text-sm text-amber-600 dark:text-amber-400">⚠ {w}</p>)}
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">{scan.deployments.length} subfolder(s) — tick the ones to import.</p>
                <table className="w-full text-sm border border-zinc-200 dark:border-zinc-700 rounded">
                  <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-500 dark:text-zinc-400">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-center">Import</th>
                      <th scope="col" className="px-3 py-2 text-left">Subfolder</th>
                      <th scope="col" className="px-3 py-2 text-right">Images</th>
                      <th scope="col" className="px-3 py-2 text-left">Dates</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                    {scan.deployments.map((d) => (
                      <tr key={d.name}>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" aria-label={d.name} checked={included.has(d.name)} onChange={() => setIncluded((s) => toggled(s, d.name))} />
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {d.name}
                          {d.warnings.map((w, i) => <p key={i} className="text-xs font-sans text-amber-600 dark:text-amber-400">⚠ {w}</p>)}
                        </td>
                        <td className="px-3 py-2 text-right">{d.image_count}</td>
                        <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{d.from_timestamp_log ? `${d.start_date?.slice(0, 10) ?? '?'} → ${d.end_date?.slice(0, 10) ?? '?'}` : <span title="Read from the images when the details are asked for">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button type="button" aria-label="Continue to the checks" className={btnPrimary} disabled={!scan || scanning || candidates.length === 0} onClick={() => openImagesStep(2)}>Continue<span aria-hidden="true"> →</span></button>
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

      {/* ── Step: where they were taken, and the details of each deployment ── */}
      {stepKey === 'origin' && (() => {
        const whenOpen = originOpen === 2 && Boolean(projectId)
        const moreOpen = originOpen === 3 && Boolean(projectId)
        const originStatus = (n: number): 'open' | 'done' | 'locked' => {
          if (n === 1) return !whenOpen && !moreOpen ? 'open' : 'done'
          if (n === 2) return whenOpen ? 'open' : projectId && originReached >= 2 ? 'done' : 'locked'
          return moreOpen ? 'open' : projectId && detailsReady && originReached >= 3 ? 'done' : 'locked'
        }
        return (
        <div>
          <div className="flex flex-wrap gap-2 mb-6">
            <span className={chip}>{deploymentsCount}</span>
            <span className={chip}>{plural(imagesTotal, 'image', 'images')}</span>
            <span className={`${chip} font-mono`}>{sessionName}</span>
          </div>

          <StepHeading>Origin and details</StepHeading>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
            Say which research project the session belongs to and where each deployment was taken, then fill in their dates and what you know about the cameras and sites.
          </p>
          <div className="border-t border-zinc-200 dark:border-zinc-700" />
          <WizardStep n={1} title="Where were they taken?" status={originStatus(1)} canEdit onEdit={() => setOriginOpen(1)}
                      description="The research project is the same for the whole session. Pick its location for each deployment, from the project's locations."
                      summary={project && <>{project.acronym} · {withLocation === chosen.length ? 'every folder has a location' : `${withLocation} of ${plural(chosen.length, 'folder has', 'folders have')} a location`}</>}>
            <ResearchProjectPicker value={projectId} onSelect={(picked) => { setProject(picked); setDrafts({}) }} />
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
                <div role="alert" className="mb-4 flex items-center gap-4 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-5 py-4 text-sm text-red-800 dark:text-red-200">
                  <span aria-hidden="true">⚠</span>
                  <span>
                    {localLocations.length === 0
                      ? <>{projectId} has no locations yet — add them below, one for each deployment.</>
                      : <>No folder name matches a location in {projectId}. Pick the location of each deployment below, or add the ones that are missing.</>}
                  </span>
                </div>
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
                                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-2">
                                  <LocationTimeNote locationId={fields!.location_id} latitude={fields!.latitude} longitude={fields!.longitude}
                                                    timezone={entry.timezone} ignoreDst={entry.ignoreDst ?? preSettings.ignore_dst} />
                                </p>
                              )}
                              {located && (fields!.latitude == null || fields!.longitude == null) && (
                                <p className="text-xs text-red-600 dark:text-red-400 mt-2">This location has no coordinates, and a deployment needs them.</p>
                              )}
                              {duplicated(d.name) && <p className="text-xs text-red-600 dark:text-red-400 mt-2">Another deployment of the session has this id — each needs its own location.</p>}
                              {existingFolder(d.name) && (
                                <p role="alert" className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                                  ⚠ This deployment already exists: <span className="font-mono break-all">{existingFolder(d.name)}</span> is already kept, and
                                  importing it again would be refused as it would mix them. Choose another location, or move that folder away.
                                </p>
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
        <h6 className="text-sm font-semibold mb-3">New location</h6>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Location id" required value={locationDraft.location_id} onChange={(v) => setLocationDraft((l) => ({ ...l, location_id: v }))} />
          <Field label="Location name" value={locationDraft.name} onChange={(v) => setLocationDraft((l) => ({ ...l, name: v }))} />
          <Field label="Location timezone" value={locationDraft.timezone} error={locationErrors.timezone} placeholder="Europe/Madrid" onChange={(v) => setLocationDraft((l) => ({ ...l, timezone: v }))} />
          <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer mt-7">
            <input type="checkbox" className="mt-1" checked={locationDraft.ignore_dst} onChange={(e) => setLocationDraft((l) => ({ ...l, ignore_dst: e.target.checked }))} />
            The location’s cameras ignore summer time (DST)
          </label>
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
            <div className="flex justify-end mt-4">
              <button type="button" className={btnPrimary} disabled={!projectId} onClick={() => { setOriginOpen(2); setOriginReached(2) }}>Continue to the details<span aria-hidden="true"> →</span></button>
            </div>
          </WizardStep>

          <WizardStep n={2} title="When was it collected?" status={originStatus(2)} canEdit onEdit={() => setOriginOpen(2)}
                      description="The revision number, and the period of each deployment."
                      summary={revisionValid && <>Revision {revisionName}<br />{deploymentsCount}</>}>
          {guessingLeft > 0 && <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Reading the dates and the cameras from the images… ({guessingLeft} deployment(s) left)</p>}
          <FormCard title="Which revision is this?" description="One revision number for the whole session. It gives every deployment its id.">
            <div className="flex items-end gap-2 max-w-xs">
              <button type="button" aria-label="Lower the revision number" className={`${btnOutline} !px-3`} disabled={!revisionValid || revisionNumber <= 1}
                      onClick={() => { revisionTouched.current = true; setRevision(String(revisionNumber - 1)); setRevisionFromLog(null); setRevisionSuggested(false) }}>−</button>
              <div className="flex-1">
                <Field label="What revision number are you importing?" required type="number" min={1} max={9999} step={1} placeholder="e.g. 3" value={revision} onChange={(v) => { revisionTouched.current = true; setRevision(v); setRevisionFromLog(null); setRevisionSuggested(false) }}
                       error={revision.trim() !== '' && !revisionValid ? 'A whole number from 1 to 9999.' : undefined} />
              </div>
              <button type="button" aria-label="Raise the revision number" className={`${btnOutline} !px-3`} disabled={revisionValid && revisionNumber >= 9999}
                      onClick={() => { revisionTouched.current = true; setRevision(String((revisionValid ? revisionNumber : 0) + 1)); setRevisionFromLog(null); setRevisionSuggested(false) }}>+</button>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5">
              {revisionFromLog && revisionValid ? `Taken from the deployment ids in ${revisionFromLog} — change it if it is not right.` : revisionSuggested && revisionValid ? 'Filled in as the next one expected for these locations — change it if it is not right.' : '1 for the first visit to these locations, 2 for the second, and so on.'}
            </p>
            {revisionValid && chosen.length > 0 && (
              <div className="mt-3 flex items-center gap-2 flex-wrap text-xs text-zinc-500 dark:text-zinc-400">
                <span>Deployment ids</span>
                {chosen.slice(0, 4).map((d) => <span key={d.name} className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 font-mono text-zinc-700 dark:text-zinc-300">{fieldsOf(d.name).deployment_id}</span>)}
                {chosen.length > 4 && <span>+{chosen.length - 4} more</span>}
              </div>
            )}
            {revisionValid && existingNames.length > 0 && (
              <p aria-live="polite" className="mt-3 text-sm text-amber-700 dark:text-amber-400">
                ⚠ Revision {revisionNumber} already has {existingNames.length} of these {chosen.length} deployment(s) in the collections folder:{' '}
                <span className="font-mono">{existingNames.slice(0, 5).map((d) => fieldsOf(d.name).deployment_id).join(', ')}{existingNames.length > 5 ? ', …' : ''}</span>.
                Importing them again would be refused — pick another revision, or leave them out.
              </p>
            )}
          </FormCard>

          {scan?.timestamp_log && (
            <p aria-live="polite" className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
              The start and end dates of {scan.timestamp_log.matched} of these {chosen.length} deployment(s) were taken from{' '}
              <span className="font-mono">{scan.timestamp_log.name}</span>, found in the session folder, not from the images' EXIF data.
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
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 dark:bg-zinc-800">
                  <tr className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    <th scope="col" className="px-4 py-2.5 text-left">Folder</th>
                    <th scope="col" className="px-4 py-2.5 text-left">Start</th>
                    <th scope="col" className="px-4 py-2.5 text-left">End</th>
                    <th scope="col" className="px-4 py-2.5 text-left">Status</th>
                    <th scope="col" className="w-10"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                  {visible.map((d) => {
                    const entry = drafts[d.name]
                    const fields = entry?.fields
                    const errors = entry ? errorsOf(d.name) : {}
                    const start = fields?.start_date ?? null
                    const end = fields?.end_date ?? null
                    const open = d.name === activeName && Boolean(entry)
                    const reading = !d.from_timestamp_log && guessingLeft > 0 && !(d.name in guessed)
                    // Where the dates were first filled in from: the collection's csv, or the images — and "by hand" once they are not those any more.
                    const original = d.from_timestamp_log ? { start: d.start_date, end: d.end_date } : { start: guessed[d.name]?.start_date ?? null, end: guessed[d.name]?.end_date ?? null }
                    const same = (a: string | null, b: string | null) => (a ?? '').slice(0, 19) === (b ?? '').slice(0, 19)
                    const source = !start ? null
                      : same(start, original.start) && same(end, original.end)
                        ? (d.from_timestamp_log ? `From ${scan?.timestamp_log?.name ?? 'the collection’s csv'}` : 'From the images')
                        : 'Entered by hand'
                    const datesOk = Boolean(start && end && !errors.start_date && !errors.end_date)
                    const clash = existingFolder(d.name) ? 'Already exists' : duplicated(d.name) ? 'Duplicate id' : null
                    const label = clash ?? (datesOk ? 'Ready' : start ? 'To fix' : 'Dates needed')
                    const shown = (iso: string | null) => (iso ? `${formatDay(iso)} ${iso.slice(11, 16)}` : '—')
                    return (
                      <Fragment key={d.name}>
                        <tr className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" onClick={() => selectDeployment(d.name)}>
                          <td className="px-4 py-3 font-mono text-zinc-900 dark:text-zinc-100">{d.name}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-zinc-700 dark:text-zinc-300">{shown(start)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-zinc-700 dark:text-zinc-300">{shown(end)}</td>
                          <td className="px-4 py-3">
                            {reading ? (
                              <span className="text-xs text-zinc-500 dark:text-zinc-400">Reading the images…</span>
                            ) : (
                              <>
                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${label === 'Ready' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300'}`}>{label}</span>
                                {source && <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{source}</span>}
                              </>
                            )}
                          </td>
                          <td className="px-2">
                            <button type="button" aria-expanded={open} aria-label={`${open ? 'Close' : 'Open'} ${d.name}`} onClick={(e) => { e.stopPropagation(); selectDeployment(d.name) }}
                                    className="flex h-8 w-8 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700">
                              <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 fill-none stroke-current transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                            </button>
                          </td>
                        </tr>
                        {open && fields && entry && (
                          <tr>
                            <td colSpan={5} className="px-4 pb-4">
                              <div aria-label={`Dates of ${d.name}`} role="group">
                                <h5 className="sr-only">{fieldsOf(d.name).deployment_id || d.name}</h5>
                                <DeploymentFormBody collapsible periodOnly deployment={fields} timezone={entry.timezone} errors={activeErrors_of(d.name)}
                                                    onField={(key, value) => updateField(d.name, key, value)}
                                                    datesGuessed={Boolean(guessed[d.name]?.start_date) && !d.from_timestamp_log}
                                                    datesFromLog={d.from_timestamp_log ? scan?.timestamp_log?.name : undefined} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                  {visible.length === 0 && <tr><td colSpan={5} className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">No deployment matches.</td></tr>}
                </tbody>
              </table>
            </div>
          </FormCard>
          {detailsError && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{detailsError}</p>}
          <div className="flex justify-end mt-4">
            <button type="button" aria-label="Continue to more details" className={btnPrimary} disabled={!detailsReady}
                    onClick={() => { setOriginOpen(3); setOriginReached(3) }}>Continue<span aria-hidden="true"> →</span></button>
          </div>
          </WizardStep>

          <WizardStep n={3} title="More details" status={originStatus(3)} canEdit onEdit={() => { setOriginOpen(3); setOriginReached(3) }}
                      description="Everything here is optional. For each deployment, fill in what you know of its camera and its site now — you can add the rest later."
                      summary={`${chosen.filter((d) => moreFilledOf(d.name) > 0).length} of ${plural(chosen.length, 'deployment', 'deployments')} with details`}>
          {canFillFromPrevious && (() => {
            const withEarlier = chosen.filter((d) => hasEarlierRevision(d.name))
            const earlier = Math.max(...withEarlier.map((d) => previousFound[`${projectId}|${fieldsOf(d.name).deployment_id}`]!.revision))
            return (
              <div className="mb-4 flex items-center gap-4 flex-wrap rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/50 px-5 py-4 text-sm text-blue-900 dark:text-blue-100">
                <span className="flex-1 min-w-[14rem]">
                  Revision {earlier} is on file for {withEarlier.length <= 3 ? listOf(withEarlier.map((d) => d.name)) : `${withEarlier.length} of these deployments`}.
                  Copy their camera, site and notes? Locations and dates aren&rsquo;t copied — each revision has its own.
                </span>
                <button type="button" className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                        onClick={() => fillFromPrevious(withEarlier.map((d) => d.name), 'all')}>Copy from revision {earlier}</button>
              </div>
            )
          })()}
          {fillMessage?.scope === 'all' && <p aria-live="polite" className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">{fillMessage.text}</p>}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700 mb-4">
            {chosen.filter((d) => d.name.toLowerCase().includes(filter.trim().toLowerCase())).map((d) => {
              const entry = drafts[d.name]
              const fields = entry?.fields
              const open = d.name === moreName && Boolean(entry)
              const filled = moreFilledOf(d.name)
              return (
                <div key={d.name}>
                  <button type="button" aria-expanded={open} aria-label={`${open ? 'Close' : 'Open'} the details of ${d.name}`} onClick={() => selectMore(d.name)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left">
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
                    <div aria-label={`Details of ${d.name}`} role="group" className="px-4 pb-4">
                      <h5 className="sr-only">{fieldsOf(d.name).deployment_id || d.name}</h5>
                      {(hasEarlierRevision(d.name) || fillMessage?.scope === 'one') && (
                        <div className="mb-4 flex items-center gap-3 flex-wrap">
                          {hasEarlierRevision(d.name) && (
                            <button type="button" className={btnOutline} onClick={() => fillFromPrevious([d.name], 'one')}>Fill from the previous revision</button>
                          )}
                          {fillMessage?.scope === 'one' && !fillMessage.undo && <span aria-live="polite" className="text-xs text-zinc-500 dark:text-zinc-400">{fillMessage.text}</span>}
                        </div>
                      )}
                      {fillMessage?.scope === 'one' && fillMessage.undo?.name === d.name && (
                        <div role="status" className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-5 py-4 text-sm text-emerald-900 dark:text-emerald-100">
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>
                          <span className="flex-1"><strong className="font-semibold">{fillMessage.text}</strong> Change anything that&rsquo;s different this time.</span>
                          <button type="button" className="rounded-lg border border-emerald-400 dark:border-emerald-800 px-4 py-2 text-sm font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                                  onClick={() => { const { name, fields: before } = fillMessage.undo!; setDrafts((all) => (all[name] ? { ...all, [name]: { ...all[name], fields: before } } : all)); setFillMessage(null) }}>Start empty</button>
                        </div>
                      )}

                      <MoreDetailsForm deployment={fields} errors={activeErrors_of(d.name)} onField={(key, value) => updateField(d.name, key, value)} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
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
        return (
        <div>
          <div className="flex flex-wrap gap-2 mb-6">
            <span className={chip}>{deploymentsCount}</span>
            <span className={`${chip} font-mono`}>{projectId}</span>
            {revisionName && <span className={`${chip} font-mono`}>{revisionName}</span>}
          </div>

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
            {ran && !checking && outcomeBanner(problems.length, blocking.length, requiredDeploymentChecks.size, plural(withProblems.length, 'deployment', 'deployments'))}
            <StrictnessTable
              options={shownDeploymentChecks.map((o) => ({ value: o.value, label: DEPLOYMENT_CHECK_DISPLAY[o.value].label }))}
              enabled={deploymentChecks} required={requiredDeploymentChecks} running={checking} results unit={{ one: 'deployment', many: 'deployments' }}
              describe={(c) => DEPLOYMENT_CHECK_DISPLAY[c].description('the one you chose for each deployment').replace(/\.$/, '')}
              outcome={(c) => (chosen.some((d) => deploymentCheckPassed(c, checks[d.name]?.result ?? null) !== null) ? { failed: failedIn(c), images: null } : undefined)} />
            <div className="mt-4 space-y-2">
              {chosen.filter((d) => checks[d.name]).map((d) => {
                const outcome = checks[d.name]
                const bad = Boolean(outcome.error) || runnableDeploymentChecks.some((c) => deploymentCheckPassed(c, outcome.result ?? null) === false)
                return (
                  <details key={d.name} className="rounded border border-zinc-200 dark:border-zinc-700 px-3 py-2" open={bad}>
                    <summary className="cursor-pointer text-sm font-mono">{bad ? '⚠' : '✔'} {fieldsOf(d.name).deployment_id}</summary>
                    {outcome.error && <p className="text-sm text-red-600 dark:text-red-400">{outcome.error}</p>}
                    {outcome.result && !outcome.result.report_id && <DeploymentCheckReport result={outcome.result} toleranceHours={toleranceHours} />}
                    {outcome.result?.report_id && <ReportPanel reportId={outcome.result.report_id} />}
                  </details>
                )
              })}
            </div>
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
            <div className="flex flex-wrap gap-2 mb-6">
              <span className={chip}>{deploymentsCount}</span>
              <span className={`${chip} font-mono`}>{projectId}</span>
              {revisionName && <span className={`${chip} font-mono`}>{revisionName}</span>}
            </div>

            <StepHeading>Prepare and save</StepHeading>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
              Choose what is done to the images of every deployment, see how it went, and save the revision in your local collection. Nothing is uploaded to Trapper yet.
            </p>
            <div className="border-t border-zinc-200 dark:border-zinc-700" />

            <WizardStep n={1} title="Preprocessing steps" status={status1} canEdit={false} onEdit={() => {}}
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

            <WizardStep n={2} title="Preprocessing results" status={allDone ? 'done' : importing ? 'running' : started ? 'open' : 'locked'} canEdit={false} onEdit={() => {}} expanded={allDone}
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
                      {run?.done && <span className="text-emerald-600 dark:text-emerald-400">✔ imported — <span className="font-mono">{run.destDir}</span></span>}
                      {run?.error && !run.done && <span className="text-red-600 dark:text-red-400">⚠ {run.error}</span>}
                      {(() => { const done = run?.events.find((e) => e.type === 'done'); return done && done.type === 'done' && done.report_id ? <ReportPanel reportId={done.report_id} /> : null })()}
                      {run?.events.filter((e) => e.type === 'skipped').map((e, i) => (
                        <p key={i} className="text-xs text-amber-600 dark:text-amber-400">⚠ Skipped {e.type === 'skipped' ? `${e.name}: ${e.detail}` : ''}</p>
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
                  <p className="text-sm text-emerald-600 dark:text-emerald-400">✔ Session imported — {chosen.length} deployment(s).</p>
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
      <div className="flex justify-between items-start mt-10">
        {step > 0 && !importing ? (
          <button type="button" className={btnOutline} onClick={() => setStep((s) => s - 1)} disabled={allDone}><span aria-hidden="true">← </span>Back</button>
        ) : stepKey === 'images' && imagesOpen === 3 ? (
          <button type="button" className={btnOutline} disabled={validating} onClick={() => setImagesOpen(2)}><span aria-hidden="true">← </span>Back</button>
        ) : <div />}

        {stepKey === 'images' && (
          <div className="flex flex-col items-end gap-1">
            {scan && candidates.length > 0 && chosen.length === 0 && <p className="text-xs text-amber-600 dark:text-amber-400">No deployment is free of errors, so none can go on.</p>}
            <button type="button" className={btnPrimary} disabled={!canContinue.images} onClick={() => setStep((s) => s + 1)}>{imagesChecked && chosen.length > 0 ? `Continue with ${plural(chosen.length, 'folder', 'folders')}` : 'Continue'}<span aria-hidden="true"> →</span></button>
          </div>
        )}
        {stepKey === 'origin' && (
          <div className="flex flex-col items-end gap-1 max-w-md">
            {detailsError && <p className="text-xs text-red-600 dark:text-red-400 text-right">{detailsError}</p>}
            {detailsActive && originOpen >= 2 && !detailsReady && (() => {
              const incomplete = chosen.filter((d) => problemsOf(d.name) > 0)
              const onlyDates = incomplete.length > 0 && incomplete.every((d) => Object.keys(errorsOf(d.name)).every((k) => k === 'start_date' || k === 'end_date') && !duplicated(d.name))
              return <p className="text-xs text-amber-600 dark:text-amber-400">{!revisionValid ? 'Enter the revision number.' : `${plural(incomplete.length, 'deployment needs', 'deployments need')} ${onlyDates ? 'dates' : 'details'}.`}</p>
            })()}
            <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!canContinue.origin} onClick={handleContinueFromDetails}>
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
