import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import Combobox from '../components/Combobox'
import { FilesReady, PreparingFiles, btnPrimary as primaryButton, formatBytes } from '../components/PrepareFiles'
import type { PrepareItem } from '../components/PrepareFiles'
import { UploadedToTrapper, UploadingToTrapper } from '../components/UploadToTrapper'
import type { UploadItem } from '../components/UploadToTrapper'
import WizardStep from '../components/WizardStep'
import { formatPeriod } from '../dateFormat'
import type { AccessCheck, ClassificationProject, LocalResearchProject, UploadCollection, UploadTarget, UploadDeploymentInfo, UploadEvent, UploadMode, UploadStep } from '../types'

const btnPrimary = 'px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
const btnOutline = 'px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50'
const labelClass = 'block text-sm font-semibold mb-1.5 text-zinc-700 dark:text-zinc-300'
const inputClass = 'w-full px-3 py-2 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono'

const STEPS: { step: UploadStep; label: string }[] = [
  { step: 'connect', label: 'Connect to Trapper' },
  { step: 'classification', label: 'Classification project' },
  { step: 'uploader', label: 'Uploader login' },
  { step: 'location', label: 'Location' },
  { step: 'deployment', label: 'Deployment' },
  { step: 'package', label: 'Pack the images' },
  { step: 'csv', label: 'Deployments csv' },
  { step: 'upload', label: 'Upload' },
  { step: 'process', label: 'Process' },
  { step: 'wait', label: 'Collection created' },
]

/** One deployment's upload as it goes. */
interface Run {
  steps: Partial<Record<UploadStep, { status: 'running' | 'done' | 'skipped'; message: string; url?: string }>>
  progress: { file: string; bytes: number; total: number } | null
  /** Images packed so far, and how many there are. */
  pack: { index: number; total: number } | null
  /** What the packages weigh, once they are made, and how many images are in them. */
  packaged: { images: number; parts: number; bytes: number } | null
  /** Bytes of each file that has gone up, by name. */
  sent: Record<string, number>
  result: Extract<UploadEvent, { type: 'done' }> | null
  error: string | null
}

const EMPTY_RUN: Run = { steps: {}, progress: null, pack: null, packaged: null, sent: {}, result: null, error: null }

function reduceRun(run: Run, event: UploadEvent): Run {
  if (event.type === 'step') return { ...run, steps: { ...run.steps, [event.step]: { status: event.status, message: event.message, url: event.url } } }
  if (event.type === 'upload_progress') return { ...run, progress: { file: event.file, bytes: event.bytes, total: event.total }, sent: { ...run.sent, [event.file]: event.bytes } }
  if (event.type === 'package_ready') return { ...run, packaged: { images: event.images, parts: event.parts, bytes: event.bytes } }
  if (event.type === 'pack_progress') return { ...run, pack: { index: event.index, total: event.total } }
  return { ...run, result: event, progress: null, pack: null }
}

const MODES: { value: UploadMode; title: string; description: string; button: string; busy: string }[] = [
  { value: 'upload', title: 'Upload to Trapper', description: 'Creates what’s missing in Trapper, packs the images and sends them.', button: 'Upload to Trapper', busy: 'Uploading…' },
  { value: 'dry_run', title: 'Rehearse first (dry run)', description: 'Looks at Trapper and tells you what would be created and sent. Nothing is created, sent or written.', button: 'Rehearse the upload', busy: 'Checking…' },
  { value: 'generate', title: 'Only prepare the files', description: 'Writes the files into your collections folder and stops, so you can send them some other way. Doesn’t need Trapper.', button: 'Prepare the files', busy: 'Preparing…' },
]

const images = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'image' : 'images'}`

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)
}

/** What can be sent: a preprocessed deployment (the yaml needs the dates its preprocessing recorded). */
const canUpload = (d: UploadDeploymentInfo) => d.preprocessed && d.images > 0

/** Sends a deployment kept in a local collection to Trapper — pick the research project, the
 * collection and the deployments in it; each goes through creating its location and the
 * deployment in Trapper if they're missing, packing its images into a zip and a yaml, and uploading
 * them for Trapper to process into a collection. */
interface Props {
  /** Where to start from — the research project and collection a finished import went into. */
  initial?: UploadTarget
  /** Opens the settings, where the Trapper account is. */
  onOpenSettings?: () => void
}

export default function UploadDeploymentPage({ initial, onOpenSettings }: Props = {}) {
  const [projects, setProjects] = useState<LocalResearchProject[]>([])
  const [projectId, setProjectId] = useState('')
  const [collections, setCollections] = useState<UploadCollection[]>([])
  const [collectionName, setCollectionName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<UploadMode>('upload')
  // With an upload: whether the package files — the zips, the yamls and the deployments csv — are deleted once they are up.
  const [deleteFiles, setDeleteFiles] = useState(false)
  const [trapper, setTrapper] = useState<{ base_url: string | null; user_name: string | null; has_password: boolean } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [runs, setRuns] = useState<Record<string, Run>>({})
  const [order, setOrder] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [finished, setFinished] = useState(false)
  // Whether what to upload is settled: step 1 shuts, with a pencil to open it again, and step 2 opens.
  const [chosen, setChosen] = useState(false)
  // Likewise for what to do (step 2): once settled, it shuts and what runs it opens.
  const [modeChosen, setModeChosen] = useState(false)
  // The files prepared before going on to upload them: step 3 shuts with this as its summary, and the upload is step 4.
  const [prepared, setPrepared] = useState<{ deployments: number; images: number; bytes: number } | null>(null)
  // When preparing the files began and ended, and what stops it.
  const [startedAt, setStartedAt] = useState(0)
  const [finishedAt, setFinishedAt] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  // The classification project the collection goes to: the ones Trapper has, and the chosen pk (a text, for when they can't be listed).
  const [classifications, setClassifications] = useState<ClassificationProject[]>([])
  const [classificationError, setClassificationError] = useState<string | null>(null)
  const [classificationPk, setClassificationPk] = useState('')
  // Whether the account has access to the research project and the collection chosen — looked up as soon as both are.
  const [selectionChecks, setSelectionChecks] = useState<AccessCheck[] | null>(null)
  const [checkingSelection, setCheckingSelection] = useState(false)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [recheck, setRecheck] = useState(0)

  useEffect(() => {
    if (initial) chooseProject(initial.researchProjectId, initial.collection)
    api.listResearchProjects().then(({ results }) => setProjects(results)).catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not read the collections folder.'))
    api.trapperGetConfig().then(setTrapper).catch(() => setTrapper(null))
  }, [])

  async function loadCollections(id: string, pick?: string) {
    setCollections([]); setCollectionName(''); setSelected(new Set()); setLoadError(null)
    if (!id) return
    try {
      const { results } = await api.uploadCollections(id)
      setCollections(results)
      if (pick) selectCollection(pick, results)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not read the collections.')
    }
  }

  /** The classification projects Trapper has for the research project: with only one, it is the one chosen. */
  async function loadClassifications(id: string) {
    setClassifications([]); setClassificationPk(''); setClassificationError(null)
    if (!id || !connected) return
    try {
      const { results } = await api.uploadClassificationProjects(id)
      setClassifications(results)
      if (results.length === 1) setClassificationPk(String(results[0].pk))
    } catch (e) {
      setClassificationError(e instanceof Error ? e.message : 'Could not read the classification projects.')
    }
  }

  function chooseProject(id: string, pick?: string) {
    setProjectId(id)
    setPrepared(null)
    setRuns({}); setOrder([]); setFinished(false)
    void loadCollections(id, pick)
  }

  function chooseCollection(name: string) {
    setPrepared(null)
    setRuns({}); setOrder([]); setFinished(false)
    selectCollection(name, collections)
  }

  function selectCollection(name: string, from: UploadCollection[]) {
    setCollectionName(name)
    const found = from.find((c) => c.name === name)
    // What is left to send: preprocessed, and not sent before.
    setSelected(new Set((found?.deployments ?? []).filter((d) => canUpload(d) && !d.uploaded_at).map((d) => d.deployment_id)))
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const collection = collections.find((c) => c.name === collectionName)
  const connected = Boolean(trapper?.base_url && trapper.user_name && trapper.has_password)
  // Generating the files needs no account — the others look at Trapper.
  const accountOk = mode === 'generate' || connected
  const modeInfo = MODES.find((m) => m.value === mode)!
  // The classification projects are looked up once the research project and the account are both known.
  useEffect(() => {
    void loadClassifications(projectId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, connected])

  useEffect(() => {
    setSelectionChecks(null); setSelectionError(null)
    if (!projectId || !collectionName || !connected) { setCheckingSelection(false); return }
    let cancelled = false
    setCheckingSelection(true)
    ;(async () => {
      try {
        const { checks } = await api.checkUploadSelection(projectId, collectionName)
        if (!cancelled) setSelectionChecks(checks)
      } catch (e) {
        if (!cancelled) setSelectionError(e instanceof Error ? e.message : 'Could not check the access.')
      } finally {
        if (!cancelled) setCheckingSelection(false)
      }
    })()
    return () => { cancelled = true }
  }, [projectId, collectionName, connected, recheck])

  // The research project is not in Trapper (or the account cannot reach it): nothing can be sent or rehearsed.
  const projectMissing = Boolean(selectionChecks?.some((c) => c.check === 'research_project' && !c.ok))
  const classificationValue = classificationPk.trim() === '' ? null : Number(classificationPk)
  const classificationValid = classificationValue === null || (Number.isInteger(classificationValue) && classificationValue >= 1)
  // The yaml needs one: with an account it is the one picked (or the only one); offline, the pk typed in.
  const classificationReady = classificationValue !== null && classificationValid
  const selectable = (collection?.deployments ?? []).filter(canUpload)
  const toUpload = (collection?.deployments ?? []).filter((d) => selected.has(d.deployment_id) && canUpload(d))

  async function handleUpload(runMode: UploadMode = mode) {
    if (!collection) return
    const ids = toUpload.map((d) => d.deployment_id)
    const abort = new AbortController()
    abortRef.current = abort
    setUploading(true); setFinished(false); setOrder(ids); setStartedAt(Date.now())
    setRuns(Object.fromEntries(ids.map((id) => [id, EMPTY_RUN])))
    for (const id of ids) {
      try {
        if (abort.signal.aborted) throw new Error('Stopped before it began.')
        await api.uploadDeployment(projectId, collection.name, id, runMode, (event) => setRuns((r) => ({ ...r, [id]: reduceRun(r[id] ?? EMPTY_RUN, event) })), classificationValue, abort.signal, runMode === 'upload' && deleteFiles)
      } catch (e) {
        const stopped = abort.signal.aborted
        setRuns((r) => ({ ...r, [id]: { ...(r[id] ?? EMPTY_RUN), progress: null, pack: null, error: stopped ? 'Stopped.' : e instanceof Error ? e.message : 'The upload failed.' } }))
      }
    }
    abortRef.current = null
    setFinishedAt(Date.now())
    setUploading(false); setFinished(true)
    if (runMode === 'upload') void loadCollections(projectId).then(() => setCollectionName(collection.name)) // shows what was uploaded
  }

  const deleteOption = (
    <label className="flex items-start gap-3 cursor-pointer py-1">
      <input type="checkbox" className="mt-1" checked={deleteFiles} disabled={uploading} onChange={(e) => setDeleteFiles(e.target.checked)} />
      <span>
        <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">Delete the package files once they are uploaded</span>
        <span className="block text-xs text-zinc-500 dark:text-zinc-400">The zips, the yamls and the deployments csv are taken away when Trapper has them. Left unticked, they stay in your packages folder.</span>
      </span>
    </label>
  )

  const imagesToSend = toUpload.reduce((sum, d) => sum + d.images, 0)
  const blockedBy = !accountOk ? 'Set the Trapper account in the settings first.'
    : mode !== 'generate' && projectMissing ? `${projectId} isn’t in Trapper yet.`
    : toUpload.length === 0 ? 'Pick at least one deployment.'
    : !classificationReady ? 'Pick the classification project.' : null
  const failures = order.filter((id) => runs[id]?.error).length
  const succeeded = order.filter((id) => runs[id]?.result).length

  const stepStatus = (n: 1 | 2): 'open' | 'locked' | 'running' | 'done' => {
    if (n === 1) return chosen ? 'done' : 'open'
    return !chosen || !collection ? 'locked' : modeChosen ? 'done' : 'open'
  }

  // Preparing the files: each deployment as it is, for the progress and for what was written.
  const preparing = mode === 'generate'
  const prepareItems: PrepareItem[] = order.map((id, index) => {
    const run = runs[id] ?? EMPTY_RUN
    const images = collection?.deployments.find((d) => d.deployment_id === id)?.images ?? 0
    const result = run.result?.mode === 'generate' ? run.result : null
    const started = Object.keys(run.steps).length > 0 || order.slice(0, index).every((before) => runs[before]?.result || runs[before]?.error)
    const sizes = result?.file_sizes ?? {}
    return {
      id, images,
      state: run.error ? 'failed' : result ? 'done' : uploading && started ? 'working' : 'pending',
      step: run.steps.csv ? 3 : run.steps.package ? 2 : 1,
      packed: run.pack?.index ?? 0,
      files: (result?.files ?? []).map((name) => ({ name, bytes: sizes[name] ?? 0 })),
      error: run.error ?? undefined,
    }
  })
  // Sending the images to Trapper: each deployment as it is, for the progress and for what was set up.
  const sending = mode === 'upload'
  // What became of the package files: deleted, or kept in the folder the upload wrote them to.
  const uploadResults = order.map((id) => runs[id]?.result).filter((r): r is Extract<UploadEvent, { type: 'done' }> => r?.type === 'done' && r.mode === 'upload')
  const keptDir = uploadResults.find((r) => r.files_deleted === false)?.output_dir
  const filesNote: ReactNode = uploadResults.length === 0 ? null : keptDir ? (
    <span className="flex items-center gap-3 flex-wrap">
      <span className="flex-1 min-w-0"><strong className="font-semibold">The package files were kept</strong> in <span className="font-mono break-all">{keptDir}</span>.</span>
      <button type="button" className={btnOutline} onClick={() => void api.openFolder(keptDir).catch(() => {})}>Open folder</button>
    </span>
  ) : <><strong className="font-semibold">The package files were deleted</strong> once they were uploaded.</>

  const uploadItems: UploadItem[] = order.map((id, index) => {
    const run = runs[id] ?? EMPTY_RUN
    const info = collection?.deployments.find((d) => d.deployment_id === id)
    const result = run.result?.mode === 'upload' ? run.result : null
    const started = Object.keys(run.steps).length > 0 || order.slice(0, index).every((before) => runs[before]?.result || runs[before]?.error)
    const images = result?.images ?? run.packaged?.images ?? info?.images ?? 0
    const bytes = result?.bytes ?? run.packaged?.bytes ?? info?.bytes ?? 0
    const created = Boolean(result?.deployment_created)
    return {
      id, images, bytes,
      state: run.error ? 'failed' : result ? 'done' : uploading && started ? 'working' : 'pending',
      stage: run.steps.process || run.steps.wait ? 'process' : run.steps.upload ? 'send' : run.steps.package ? 'pack' : 'setup',
      sentBytes: Object.values(run.sent).reduce((sum, b) => sum + b, 0),
      steps: [
        { label: created ? 'Created in Trapper' : 'Already in Trapper', message: run.steps.deployment?.message ?? '', done: true,
          links: [run.steps.location?.url && { label: 'Open the location', url: run.steps.location.url }, run.steps.deployment?.url && { label: 'Open the deployment', url: run.steps.deployment.url }].filter(Boolean) as { label: string; url: string }[] },
        { label: 'Images packed', message: run.packaged ? `${images.toLocaleString('en-US')} images in ${run.packaged.parts} ${run.packaged.parts === 1 ? 'package' : 'packages'}.` : '', done: true },
        { label: `${images.toLocaleString('en-US')} images sent`, message: `${formatBytes(bytes)} sent to Trapper.`, done: true },
        { label: 'Trapper is processing the images', message: 'They show up in the deployment as they’re ready.', done: false },
      ],
      locationId: info?.location_id ?? null,
      locationCreated: Boolean(result?.location_created),
      deploymentCreated: created,
      collectionUrl: run.steps.wait?.url,
      error: run.error ?? undefined,
    }
  })
  const outputDir = order.map((id) => runs[id]?.result?.output_dir).find(Boolean) ?? null

  return (
    <div className="max-w-screen-md mx-auto px-4 py-8">
      <h2 className="text-xl font-bold mb-1 text-zinc-900 dark:text-zinc-100">Upload deployment to Trapper</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
        Sends deployments from your collections folder to Trapper. Anything missing there is created, then the images are sent for Trapper to process.
      </p>

      {trapper === null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">Reading the settings…</p>
      ) : connected ? (
        <div className="flex items-center justify-between gap-3 flex-wrap text-sm text-zinc-600 dark:text-zinc-300 mb-4 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 px-4 py-2.5">
          <p>
            <span aria-hidden="true">ℹ️ </span>Uploading as <span className="font-mono">{trapper.user_name}</span> to <span className="font-mono">{trapper.base_url}</span>
            {mode === 'generate' ? ' (not needed just to prepare the files).' : ''}
          </p>
          {onOpenSettings && <button type="button" className={btnOutline} onClick={onOpenSettings}>Change in Settings</button>}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap text-sm text-amber-700 dark:text-amber-400 mb-4 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5">
          <p>
            <span aria-hidden="true">ℹ️ </span>There is no Trapper account saved yet — set its URL, username and password in Settings › Trapper first
            {mode === 'generate' ? ' (to look up a research project that was not filled in from Trapper).' : '.'}
          </p>
          {onOpenSettings && <button type="button" className={btnOutline} onClick={onOpenSettings}>Open Settings</button>}
        </div>
      )}

      <WizardStep n={1} title="Choose what to upload" status={stepStatus(1)} canEdit={!uploading} onEdit={() => { setChosen(false); setModeChosen(false); setPrepared(null) }}
                  summary={collection && <>{projectId} › {collectionName} · {toUpload.length} {toUpload.length === 1 ? 'deployment' : 'deployments'} ({images(imagesToSend)})</>}
                  description="The research project, collection and deployments kept in your collections folder.">
        <div className="mb-4">
          <label className={labelClass} htmlFor="upload-research-project">Research project</label>
          <Combobox
            id="upload-research-project" options={projects.map((p) => ({ value: p.acronym, label: `${p.acronym} — ${p.name}` }))}
            value={projectId} onChange={chooseProject} disabled={uploading}
            placeholder={projects.length === 0 ? 'No research projects yet' : 'Select a research project…'} clearLabel="Clear research project"
          />
          {selectionChecks?.filter((c) => c.check === 'research_project' && c.ok).map((c) => (
            <p key={c.check} className="flex items-center gap-2 mt-2 text-sm text-emerald-600 dark:text-emerald-400">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.5" /></svg>
              Found in Trapper
            </p>
          ))}
          {selectionChecks?.filter((c) => c.check === 'research_project' && !c.ok).map((c) => (
            <div key={c.check} role="alert" className="mt-2 rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3">
              <p className="text-sm text-red-700 dark:text-red-300"><span aria-hidden="true">⚠ </span>{c.message}</p>
              <p className="text-xs text-red-700/80 dark:text-red-300/80 mt-1">Research projects can’t be created from here. Create it in Trapper, then check again.</p>
              <div className="flex items-center gap-2 mt-2">
                <button type="button" className={btnOutline} disabled={checkingSelection} onClick={() => setRecheck((n) => n + 1)}>Check again</button>
                {trapper?.base_url && <a className={`${btnPrimary} no-underline`} href={trapper.base_url} target="_blank" rel="noreferrer">Open Trapper</a>}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">You can still go “Only prepare the files” below without Trapper.</p>
            </div>
          ))}
          {projects.length === 0 && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Nothing is kept in the collections folder yet — import a deployment first.</p>}
        </div>

        {projectId && (
          <div className="mb-4">
            <label className={labelClass} htmlFor="upload-collection">Collection</label>
            <Combobox
              id="upload-collection" options={collections.map((c) => ({ value: c.name, label: `${c.name} · ${c.deployments.length} ${c.deployments.length === 1 ? 'deployment' : 'deployments'}` }))}
              value={collectionName} onChange={chooseCollection} disabled={uploading}
              placeholder={collections.length === 0 ? 'No collections yet' : 'Select a collection…'} clearLabel="Clear collection"
            />
            {checkingSelection && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Checking your access in Trapper…</p>}
            {selectionError && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{selectionError}</p>}
            {selectionChecks?.filter((c) => c.check === 'collection').map((c) => (
              c.ok ? (
                <p key={c.check} className={`flex items-center gap-2 mt-2 text-sm ${c.found ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" />{c.found ? <path d="M8 12.5l2.7 2.7L16 9.5" /> : <path d="M12 8v4M12 16h.01" />}</svg>
                  {c.found ? 'Found in Trapper' : 'Not in Trapper yet — the upload creates it'}
                </p>
              ) : (
                <p key={c.check} className="text-xs mt-1 text-red-600 dark:text-red-400">⚠ {c.message}</p>
              )
            ))}
          </div>
        )}

        {collection && (
          <div className="mb-4">
            <p className={labelClass}>Deployments</p>
            {collection.deployments.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">This collection has no deployments.</p>}
            {collection.deployments.length > 0 && (
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
                <div className="flex items-center gap-3 flex-wrap px-4 py-2 text-xs border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                  <span className="text-zinc-500 dark:text-zinc-400">{selectable.filter((d) => selected.has(d.deployment_id)).length} of {selectable.length} selected · {images(imagesToSend)}</span>
                  <span className="ml-auto flex items-center gap-3">
                    <button type="button" className="text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50" disabled={uploading || selectable.length === 0}
                            onClick={() => setSelected(new Set(selectable.map((d) => d.deployment_id)))}>Select all</button>
                    <button type="button" className="text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50" disabled={uploading || selectable.every((d) => d.uploaded_at)}
                            onClick={() => setSelected(new Set(selectable.filter((d) => !d.uploaded_at).map((d) => d.deployment_id)))}>Select the not uploaded</button>
                    <button type="button" className="text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50" disabled={uploading || selected.size === 0}
                            onClick={() => setSelected(new Set())}>Select none</button>
                  </span>
                </div>
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
                  {collection.deployments.map((d) => (
                    <li key={d.deployment_id} className="flex items-center gap-3 px-4 py-3">
                      <input type="checkbox" aria-label={d.deployment_id} checked={selected.has(d.deployment_id) && canUpload(d)}
                             disabled={!canUpload(d) || uploading} onChange={() => toggle(d.deployment_id)} />
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-sm text-zinc-900 dark:text-zinc-100">{d.deployment_id}</p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">{d.location_id} · {formatPeriod(d.start_date, d.end_date)}</p>
                        {!d.preprocessed && (
                          <p className="text-xs text-red-600 dark:text-red-400">Not preprocessed — import it again through the wizard before uploading it.</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 whitespace-nowrap">
                        <p className="text-sm text-zinc-800 dark:text-zinc-200">{images(d.images)}</p>
                        {canUpload(d) && (d.uploaded_at
                          ? <span className="rounded-full px-3 py-0.5 text-xs font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300">Already in Trapper</span>
                          : <span className="rounded-full px-3 py-0.5 text-xs font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">New in Trapper</span>)}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {collection && (
          <div className={`mt-4 ${connected && projectMissing ? 'opacity-60' : ''}`}>
            <label className={labelClass} htmlFor="upload-classification">Classification project</label>
            {classifications.length > 0 || connected ? (
              <Combobox
                id="upload-classification" options={classifications.map((c) => ({ value: String(c.pk), label: `${c.name} (#${c.pk})${c.is_active ? '' : ' — inactive'}` }))}
                value={classificationPk} onChange={setClassificationPk} disabled={uploading || projectMissing}
                placeholder={projectMissing ? `Needs ${projectId} in Trapper` : classifications.length === 0 ? 'No classification projects yet' : 'Select a classification project…'} clearLabel="Clear classification project"
              />
            ) : (
              <input id="upload-classification" type="number" min={1} step={1} className={inputClass} value={classificationPk} disabled={uploading}
                     placeholder="Its pk in Trapper" onChange={(e) => setClassificationPk(e.target.value)} aria-invalid={classificationValid ? undefined : true} />
            )}
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              {projectMissing ? `Available once ${projectId} is found in Trapper.` : 'The collection is created in this classification project of Trapper.'}
            </p>
            {connected && !projectMissing && classifications.some((c) => String(c.pk) === classificationPk) && (
              <p className="flex items-center gap-2 mt-2 text-sm text-emerald-600 dark:text-emerald-400">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.5" /></svg>
                Found in Trapper
              </p>
            )}
            {classificationError && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{classificationError}</p>}
            {!classificationError && connected && !projectMissing && classifications.length === 0 && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Trapper has none for this research project — create it there first.</p>
            )}
            {!connected && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Without a Trapper account they can’t be listed: type its pk.</p>}
            {connected && classifications.length > 1 && !classificationReady && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">The research project has several: pick the one the collection goes to.</p>
            )}
          </div>
        )}
        {loadError && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{loadError}</p>}
        {collection && (
          <div className="flex items-center justify-end gap-3 mt-5">
            {(toUpload.length === 0 || !classificationReady) && (
              <p className="text-xs text-amber-600 dark:text-amber-400">{toUpload.length === 0 ? 'Pick at least one deployment.' : 'Pick the classification project.'}</p>
            )}
            <button type="button" aria-label="Continue to step 2" className={btnPrimary} disabled={toUpload.length === 0 || !classificationReady || uploading} onClick={() => setChosen(true)}>
              Continue<span aria-hidden="true"> →</span>
            </button>
          </div>
        )}
      </WizardStep>

      <WizardStep n={2} title="Choose what to do" status={stepStatus(2)} canEdit={!uploading} onEdit={() => { setModeChosen(false); setPrepared(null) }} summary={prepared ? 'Only prepare the files, then upload them' : modeInfo.title}
                  description="Run the real upload, rehearse it first, or just prepare the files.">
        <div className="space-y-2" role="radiogroup" aria-label="What to do">
          {MODES.map((m) => (
            <label key={m.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${mode === m.value ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-zinc-200 dark:border-zinc-700'}`}>
              <input type="radio" name="upload-mode" className="mt-1" checked={mode === m.value} disabled={uploading} onChange={() => { setMode(m.value); setPrepared(null); setRuns({}); setOrder([]); setFinished(false) }} aria-label={m.title} />
              <span>
                <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">{m.title}</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">{m.description}</span>
              </span>
            </label>
          ))}
        </div>
        {mode === 'upload' && <div className="mt-3">{deleteOption}</div>}
        {toUpload.length > 0 && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-3">
            <strong className="text-zinc-700 dark:text-zinc-300">You’ll get: </strong>
            {mode === 'upload' && <>{toUpload.length} {toUpload.length === 1 ? 'deployment' : 'deployments'} ({images(imagesToSend)}) sent to {projectId} › {collectionName} in Trapper. Anything missing there is created first.</>}
            {mode === 'dry_run' && <>A report of what would be created in Trapper and how the {images(imagesToSend)} of {toUpload.length} {toUpload.length === 1 ? 'deployment' : 'deployments'} would be packed. Nothing is created, sent or written.</>}
            {mode === 'generate' && <>The zips, the yamls and the deployments csv of {toUpload.length} {toUpload.length === 1 ? 'deployment' : 'deployments'} ({images(imagesToSend)}), written into your collections folder.</>}
          </p>
        )}
        <div className="flex items-center justify-between gap-3 mt-5">
          <button type="button" className={`${btnOutline} flex items-center gap-2`} onClick={() => setChosen(false)}><span aria-hidden="true">←</span>Back</button>
          <button type="button" aria-label="Continue to step 3" className={btnPrimary} disabled={uploading} onClick={() => { setModeChosen(true); if (!blockedBy) void handleUpload() }}>Continue<span aria-hidden="true"> →</span></button>
        </div>
      </WizardStep>

      {chosen && modeChosen && sending && prepared && collection && (
        <WizardStep n={3} title="Prepare the files" status="done" canEdit={!uploading} onEdit={() => { setPrepared(null); setMode('generate'); setRuns({}); setOrder([]); setFinished(false) }}
                    summary={`${prepared.deployments} ${prepared.deployments === 1 ? 'deployment' : 'deployments'} prepared · ${images(prepared.images)} · ${formatBytes(prepared.bytes)}`}
                    description="The files are written into your collections folder." />
      )}

      {chosen && modeChosen && preparing && collection && (
        <WizardStep n={3} title="Prepare the files" status={uploading ? 'running' : finished ? 'done' : 'open'} canEdit={false} onEdit={() => {}} expanded
                    description="Checks the images, packs them together and writes their description into your collections folder. Nothing is sent to Trapper.">
          {order.length === 0 ? (
            <div className="flex items-center justify-end gap-3">
              {blockedBy && <p className="text-xs text-amber-600 dark:text-amber-400">{blockedBy}</p>}
              <button type="button" className={btnPrimary} disabled={Boolean(blockedBy)} onClick={() => void handleUpload()}>{modeInfo.button}</button>
            </div>
          ) : uploading ? (
            <PreparingFiles items={prepareItems} startedAt={startedAt} onStop={() => abortRef.current?.abort()} />
          ) : (
            <FilesReady collection={collection.name} items={prepareItems} outputDir={outputDir} startedAt={startedAt} finishedAt={finishedAt}
                        onOpenFolder={() => void api.openFolder(outputDir!).catch(() => {})}
                        onBack={() => { setRuns({}); setOrder([]); setFinished(false) }}
                        uploadOptions={deleteOption}
                        onUpload={() => {
                          const done = prepareItems.filter((i) => i.state === 'done')
                          const sizes = new Map(done.flatMap((i) => i.files).map((f) => [f.name, f.bytes])) // the deployments csv is in each one's files
                          setPrepared({ deployments: done.length, images: done.reduce((sum, i) => sum + i.images, 0), bytes: [...sizes.values()].reduce((sum, b) => sum + b, 0) })
                          setMode('upload'); setRuns({}); setOrder([]); setFinished(false)
                          if (connected && !projectMissing) void handleUpload('upload') // the next step starts by itself
                        }} />
          )}
        </WizardStep>
      )}

      {chosen && modeChosen && sending && collection && (
        <WizardStep n={prepared ? 4 : 3} title="Upload to Trapper" status={uploading ? 'running' : finished ? 'done' : 'open'} canEdit={false} onEdit={() => {}} expanded
                    description="Creates what’s missing in Trapper, packs the images and sends them for Trapper to process.">
          {order.length === 0 ? (
            <div>
              <div className="mb-4">{deleteOption}</div>
              <div className="flex items-center justify-end gap-3">
                {blockedBy && <p className="text-xs text-amber-600 dark:text-amber-400">{blockedBy}</p>}
                <button type="button" className={primaryButton} disabled={Boolean(blockedBy)} onClick={() => void handleUpload()}>{modeInfo.button}</button>
              </div>
            </div>
          ) : uploading ? (
            <UploadingToTrapper items={uploadItems} startedAt={startedAt} target={`${trapper?.base_url ?? 'Trapper'}${trapper?.user_name ? ` as ${trapper.user_name}` : ''}`} onStop={() => abortRef.current?.abort()} />
          ) : (
            <UploadedToTrapper collection={collection.name} researchProject={projectId} items={uploadItems} startedAt={startedAt} finishedAt={finishedAt}
                               filesNote={filesNote}
                               onMore={() => { setRuns({}); setOrder([]); setFinished(false); setPrepared(null); setModeChosen(false); setChosen(false) }} />
          )}
        </WizardStep>
      )}

      {chosen && modeChosen && !preparing && !sending && collection && (
        <div className="flex items-center justify-end gap-3 mb-6">
          {blockedBy && !uploading && <p className="text-xs text-amber-600 dark:text-amber-400">{blockedBy}</p>}
          <button type="button" className={btnPrimary} disabled={uploading || Boolean(blockedBy)} onClick={() => void handleUpload()}>
            {uploading ? modeInfo.busy : modeInfo.button}
          </button>
        </div>
      )}

      {!preparing && !sending && order.length > 0 && (
        <div className="space-y-4">
          {order.map((id) => {
            const run = runs[id] ?? EMPTY_RUN
            return (
              <section key={id} className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700" aria-label={`Upload of ${id}`}>
                <h5 className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">{id}</h5>
                <ol className="space-y-1 text-sm">
                  {STEPS.filter(({ step }) => run.steps[step]).map(({ step, label }) => {
                    const info = run.steps[step]!
                    return (
                      <li key={step} className={info.status === 'done' ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-600 dark:text-zinc-400'}>
                        {info.status === 'done' ? '✔' : '…'} <span className="font-medium">{label}</span> — {info.message}
                        {info.url && (
                          <span className="block text-xs ml-5"><a className="text-blue-600 dark:text-blue-400 hover:underline break-all" href={info.url} target="_blank" rel="noreferrer">{info.url}</a></span>
                        )}
                      </li>
                    )
                  })}
                </ol>
                {run.progress && (
                  <div className="mt-2">
                    <progress className="w-full" max={run.progress.total} value={run.progress.bytes} aria-label={`Uploading ${run.progress.file}`} />
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                      {run.progress.file} — {megabytes(run.progress.bytes)} of {megabytes(run.progress.total)} MB
                    </p>
                  </div>
                )}
                {run.result && run.result.mode === 'upload' && (
                  <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">
                    ✔ Uploaded to collection {run.result.collection} in {run.result.parts} package(s).
                  </p>
                )}
                {run.result && run.result.mode === 'dry_run' && (
                  <div className="mt-2 text-sm text-sky-700 dark:text-sky-400">
                    <p>🔍 Dry run — nothing was created, sent or written.</p>
                    <ul className="list-disc ml-6 text-xs">
                      <li>{run.result.would_create_location ? 'The location would be created in Trapper.' : 'The location is already in Trapper.'}</li>
                      <li>{run.result.would_create_deployment ? 'The deployment would be created in Trapper.' : 'The deployment is already in Trapper.'}</li>
                      <li>The images would go up in {run.result.parts} package(s).</li>
                    </ul>
                  </div>
                )}
                {run.result && run.result.mode === 'generate' && (
                  <div className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">
                    <p>✔ Files written to <span className="font-mono break-all">{run.result.output_dir}</span>:</p>
                    <ul className="list-disc ml-6 text-xs font-mono">
                      {(run.result.files ?? []).map((f) => <li key={f}>{f}</li>)}
                    </ul>
                    <button type="button" className={`${btnOutline} mt-2`} onClick={() => void api.openFolder(run.result!.output_dir!).catch(() => {})}>
                      Open folder
                    </button>
                  </div>
                )}
                {run.error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">⚠ {run.error}</p>}
              </section>
            )
          })}
          {finished && (
            <p className={`text-sm ${failures ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {succeeded} deployment(s) {'checked'}{failures ? `, ${failures} failed` : ''}.
            </p>
          )}
        </div>
      )}
      {!preparing && !sending && finished && (
        <div className="flex justify-end mt-4">
          <button type="button" className={btnOutline} onClick={() => { setRuns({}); setOrder([]); setFinished(false) }}>Upload more</button>
        </div>
      )}
    </div>
  )
}
