import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import Combobox from '../components/Combobox'
import WizardStep from '../components/WizardStep'
import { SmallSpinner, btnOutline } from './ImportDeploymentPage'
import type { ClassificationProject, ResearchProject, SyncCollection, SyncResult } from '../types'

const btnPrimary = 'px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
const labelClass = 'block text-sm font-semibold mb-1.5 text-zinc-700 dark:text-zinc-300'

const KINDS: { key: keyof SyncResult['created']; label: string }[] = [
  { key: 'research_project', label: 'Research project' },
  { key: 'locations', label: 'Locations' },
  { key: 'collections', label: 'Collections' },
  { key: 'deployments', label: 'Deployments' },
  { key: 'timestamp_log', label: 'Timestamp log rows' },
  { key: 'images', label: 'Images files (images.json)' },
]

/** "12.3 MB", or "1.20 GB" from a gigabyte on. */
function formatMegabytes(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`
}

/** The collection prefixes (R0003…) of deployment ids, each once — what the ones not synced belong to. */
function unassignedCollections(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.match(/^R\d+/i)?.[0].toUpperCase() ?? id))].sort()
}

/** Checks the local collections folder against what Trapper has for a classification project, and creates what it lacks. */
export default function SyncCollectionsPage() {
  const [projects, setProjects] = useState<ResearchProject[]>([])
  const [projectPk, setProjectPk] = useState('')
  const [classifications, setClassifications] = useState<ClassificationProject[]>([])
  const [classificationPk, setClassificationPk] = useState('')
  const [collections, setCollections] = useState<SyncCollection[]>([])
  const [collectionName, setCollectionName] = useState('')
  const [chosenDeployments, setChosenDeployments] = useState<Set<string>>(new Set())
  const [downloadImages, setDownloadImages] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [started, setStarted] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [progress, setProgress] = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [progress])

  const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

  useEffect(() => {
    api.trapperResearchProjects({})
      .then(({ results }) => setProjects(results))
      .catch((e) => setError(message(e, 'The research projects could not be read from Trapper.')))
  }, [])

  async function chooseProject(pk: string) {
    setProjectPk(pk); setClassificationPk(''); setClassifications([]); setCollections([]); setCollectionName(''); setChosenDeployments(new Set()); setResult(null); setError(null)
    if (!pk) return
    try {
      setClassifications((await api.trapperClassificationProjects({}, Number(pk))).results)
    } catch (e) {
      setError(message(e, 'The classification projects could not be read from Trapper.'))
    }
  }

  async function chooseClassification(pk: string) {
    setClassificationPk(pk); setCollections([]); setCollectionName(''); setChosenDeployments(new Set()); setResult(null); setError(null)
    if (!pk) return
    try {
      const found = (await api.syncCollectionNames({}, Number(projectPk), Number(pk))).results
      setCollections(found)
    } catch (e) {
      setError(message(e, 'The collections could not be read from Trapper.'))
    }
  }

  const collection = collections.find((c) => c.name === collectionName)
  const deployments = collection?.deployments ?? []
  const allChosen = deployments.length > 0 && chosenDeployments.size === deployments.length

  /** Choosing a collection starts with all its deployments ticked. */
  function chooseCollection(name: string) {
    setCollectionName(name); setResult(null); setProgress([])
    setChosenDeployments(new Set(collections.find((c) => c.name === name)?.deployments ?? []))
  }

  function startOver() { setStarted(false); setResult(null); setProgress([]); setError(null) }

  const toggle = (id: string) => setChosenDeployments((s) => { const next = new Set(s); if (!next.delete(id)) next.add(id); return next })

  async function handleSync() {
    const project = projects.find((p) => String(p.pk) === projectPk)
    if (!project || !classificationPk || !collection || chosenDeployments.size === 0) return
    setStarted(true); setSyncing(true); setError(null); setResult(null); setProgress([])
    try {
      await api.syncCollections({}, project, Number(classificationPk), [collection.name], deployments.filter((d) => chosenDeployments.has(d)), downloadImages, (event) => {
        if (event.type === 'progress') setProgress((lines) => [...lines, event.message])
        else setResult(event)
      })
    } catch (e) {
      setError(message(e, 'The sync failed.'))
    } finally {
      setSyncing(false)
    }
  }

  const step2Status = syncing ? 'running' : !started ? 'locked' : error && !result ? 'error' : 'done'

  return (
    <div className="mx-auto max-w-[900px] px-4 py-8">
      <h2 className="text-xl font-bold mb-1 text-zinc-900 dark:text-zinc-100">Sync local collections</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
        The local folders are checked against what Trapper has for a classification project, and what is missing is created: the research project and its locations, the collection
        (with its timestamp log) and the chosen deployments. What is already there is left as it is. The images are only downloaded if you ask for it.
      </p>

      <WizardStep n={1} title="Choose what to sync" status={started ? 'done' : 'open'} canEdit={!syncing} onEdit={startOver}
                  summary={collection && <>{projects.find((p) => String(p.pk) === projectPk)?.acronym ?? projectPk} › {classifications.find((c) => String(c.pk) === classificationPk)?.name} › {collection.name} · {chosenDeployments.size} {chosenDeployments.size === 1 ? 'deployment' : 'deployments'}</>}
                  description="A classification project of Trapper, one of its collections, and the deployments to sync.">
        <div className="mb-4">
          <label className={labelClass} htmlFor="sync-research-project">Research project</label>
          <Combobox
            id="sync-research-project" options={projects.map((p) => ({ value: String(p.pk), label: p.acronym ? `${p.acronym} — ${p.name}` : p.name }))}
            value={projectPk} onChange={chooseProject} disabled={syncing}
            placeholder={projects.length === 0 ? 'No research projects' : 'Select a research project…'} clearLabel="Clear research project"
          />
        </div>

        <div className="mb-4">
          <label className={labelClass} htmlFor="sync-classification-project">Classification project</label>
          <Combobox
            id="sync-classification-project" options={classifications.map((c) => ({ value: String(c.pk), label: c.name }))}
            value={classificationPk} onChange={chooseClassification} disabled={!projectPk || syncing}
            placeholder="Select a classification project…" clearLabel="Clear classification project"
          />
        </div>

        {classificationPk && (
          <div className="mb-4">
            <label className={labelClass} htmlFor="sync-collection">Collection</label>
            <Combobox
              id="sync-collection" options={collections.map((c) => ({ value: c.name, label: `${c.name} — ${c.deployments.length} deployment(s)` }))}
              value={collectionName} onChange={chooseCollection} disabled={syncing}
              placeholder={collections.length === 0 ? 'No collections starting with R' : 'Select a collection…'} clearLabel="Clear collection"
            />
          </div>
        )}

        {collection && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Deployments</p>
              {deployments.length > 0 && (
                <button type="button" className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50" disabled={syncing}
                        onClick={() => setChosenDeployments(new Set(allChosen ? [] : deployments))}>
                  {allChosen ? 'Deselect all' : 'Select all'}
                </button>
              )}
            </div>
            {deployments.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">This collection has no deployments.</p>
            ) : (
              <table className="w-full text-sm border border-zinc-200 dark:border-zinc-700 rounded">
                <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-500 dark:text-zinc-400">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-center w-12">
                      <input type="checkbox" aria-label="Select all deployments" checked={allChosen} disabled={syncing}
                             onChange={() => setChosenDeployments(new Set(allChosen ? [] : deployments))} />
                    </th>
                    <th scope="col" className="px-3 py-2 text-left">Deployment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                  {deployments.map((id) => (
                    <tr key={id}>
                      <td className="px-3 py-2 text-center">
                        <input type="checkbox" aria-label={id} checked={chosenDeployments.has(id)} disabled={syncing} onChange={() => toggle(id)} />
                      </td>
                      <td className="px-3 py-2 font-mono">{id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {collection && deployments.length > 0 && (
          <div className="mb-4 rounded-lg border border-zinc-200 dark:border-zinc-700 px-4 py-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={downloadImages} disabled={syncing} onChange={(e) => setDownloadImages(e.target.checked)} />
              <span>
                <span className="block text-sm font-semibold text-zinc-800 dark:text-zinc-200">Also download the images from Trapper</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Each image goes into its deployment&rsquo;s folder, as Trapper holds it. A deployment can have thousands, so this can take a long time and a lot of disk space.
                  Only the images in this classification project can be downloaded, and the ones already in the folder are kept. The deployments stay <em>synced</em>: read-only, not preprocessed.
                </span>
              </span>
            </label>
          </div>
        )}

        {error && !started && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
        <div className="flex justify-end">
          <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!collection || chosenDeployments.size === 0 || syncing} onClick={() => void handleSync()}>
            Sync
          </button>
        </div>
      </WizardStep>

      <WizardStep n={2} title="Sync" status={step2Status} canEdit={false} onEdit={() => {}} expanded
                  description="Creates in your collections folder what Trapper has and is missing here.">
        {progress.length > 0 && (
          <div ref={logRef} role="log" aria-label="Sync progress"
               className="mb-4 max-h-56 overflow-y-auto rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/40 px-3 py-2 text-xs font-mono text-zinc-600 dark:text-zinc-400 space-y-0.5">
            {progress.map((line, i) => <p key={i}>{line}</p>)}
          </div>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400 mt-4">{error}</p>}

        {syncing && progress.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-2"><SmallSpinner />Syncing…</p>}
        {error && started && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
        {result && (
          <section className="p-5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/40" aria-label="Sync result">
            <h2 className="text-sm font-semibold mb-1">Synced into <span className="font-mono">{result.folder}</span></h2>
            <ul className="text-sm mt-2 space-y-1">
              {KINDS.map(({ key, label }) => (
                <li key={key}>
                  <strong>{label}:</strong> {result.created[key].length} created, {result.kept[key].length} already there
                  {result.created[key].length > 0 && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{result.created[key].join(', ')}</span>}
                </li>
              ))}
            </ul>
            {result.downloaded && (
              <div className="text-sm mt-3" aria-label="Downloaded images">
                <p><strong>Images downloaded:</strong> {result.downloaded.images.toLocaleString('en-US')} ({formatMegabytes(result.downloaded.bytes)})</p>
                {Object.keys(result.downloaded.not_held).length > 0 && (
                  <p className="text-amber-700 dark:text-amber-400 mt-1">
                    Trapper lists images that this classification project does not hold, so they could not be downloaded:{' '}
                    {Object.entries(result.downloaded.not_held).map(([id, names]) => `${id} (${names.length})`).join(', ')}.
                  </p>
                )}
                {result.downloaded.failed.length > 0 && (
                  <div className="text-red-600 dark:text-red-400 mt-1">
                    <p>{result.downloaded.failed.length} image{result.downloaded.failed.length === 1 ? '' : 's'} could not be downloaded. Sync again to retry them:</p>
                    <ul className="list-disc ml-5">
                      {result.downloaded.failed.slice(0, 10).map((f) => <li key={`${f.deployment_id}/${f.name}`}><span className="font-mono">{f.name}</span> — {f.error}</li>)}
                      {result.downloaded.failed.length > 10 && <li>…and {result.downloaded.failed.length - 10} more.</li>}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {result.collections.length === 0 && (
              <p className="text-sm text-amber-700 dark:text-amber-400 mt-3">The classification project has no collection starting with R.</p>
            )}
            {result.failed.length > 0 && (
              <div className="text-sm text-red-600 dark:text-red-400 mt-3">
                <p>{result.failed.length} deployment{result.failed.length === 1 ? '' : 's'} could not be created, as Trapper holds {result.failed.length === 1 ? 'it' : 'them'} with invalid values:</p>
                <ul className="list-disc ml-5">
                  {result.failed.map((f) => <li key={f.deployment_id}><span className="font-mono">{f.deployment_id}</span> — {f.error}</li>)}
                </ul>
              </div>
            )}
            {result.unassigned.length > 0 && (
              <p className="text-sm text-amber-700 dark:text-amber-400 mt-3">
                {result.unassigned.length} deployment{result.unassigned.length === 1 ? '' : 's'} of the research project are not in the collections of this classification project, so they were not created
                {' '}(collections {unassignedCollections(result.unassigned).join(', ')}).
              </p>
            )}
          </section>
        )}
        {started && !syncing && (
          <div className="flex justify-end mt-4">
            <button type="button" className={btnOutline} onClick={startOver}>{result ? 'Sync another collection' : 'Back'}</button>
          </div>
        )}
      </WizardStep>
    </div>
  )
}
