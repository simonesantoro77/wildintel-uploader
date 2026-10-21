import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import Combobox from '../components/Combobox'
import WizardStep from '../components/WizardStep'
import { SmallSpinner, btnOutline } from './ImportDeploymentPage'
import type { ClassificationProject, OtherCollection, ResearchProject, SyncCollection, SyncResult } from '../types'

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

/** Brings into the collections folder what a research project has in Trapper and the user chooses: nothing is ticked
 * to begin with. The field collections (R0003…) come with their deployments, timestamp log and, if asked, their images;
 * the other collections — subsets made in Trapper — are downloaded by their images, apart. What is already here is kept. */
export default function SyncCollectionsPage() {
  const [projects, setProjects] = useState<ResearchProject[]>([])
  const [projectPk, setProjectPk] = useState('')
  const [loading, setLoading] = useState(false)
  const [field, setField] = useState<SyncCollection[]>([])
  const [others, setOthers] = useState<OtherCollection[]>([])
  const [chosen, setChosen] = useState<Record<string, Set<string>>>({}) // field collection → deployments ticked
  const [open, setOpen] = useState<string | null>(null) // the field collection whose deployments are shown
  const [chosenOthers, setChosenOthers] = useState<Set<number>>(new Set())
  const [downloadImages, setDownloadImages] = useState(false)
  const [classifications, setClassifications] = useState<ClassificationProject[]>([])
  const [classificationPk, setClassificationPk] = useState('')
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

  const project = projects.find((p) => String(p.pk) === projectPk)

  async function chooseProject(pk: string) {
    setProjectPk(pk); setField([]); setOthers([]); setChosen({}); setOpen(null); setChosenOthers(new Set()); setClassifications([]); setClassificationPk('')
    setDownloadImages(false); setResult(null); setError(null)
    const picked = projects.find((p) => String(p.pk) === pk)
    if (!picked) return
    setLoading(true)
    try {
      const found = await api.syncCollectionNames({}, picked)
      setField(found.field); setOthers(found.other)
      setClassifications((await api.trapperClassificationProjects({}, picked.pk)).results)
    } catch (e) {
      setError(message(e, 'The collections could not be read from Trapper.'))
    } finally {
      setLoading(false)
    }
  }

  const tickedCollections = field.filter((c) => (chosen[c.name]?.size ?? 0) > 0)
  const tickedDeployments = tickedCollections.flatMap((c) => [...chosen[c.name]])
  const needsClassification = (downloadImages && tickedCollections.length > 0) || chosenOthers.size > 0
  const ready = (tickedCollections.length > 0 || chosenOthers.size > 0) && (!needsClassification || classificationPk !== '')

  function toggleCollection(c: SyncCollection) {
    setChosen((all) => ({ ...all, [c.name]: all[c.name]?.size ? new Set() : new Set(c.deployments) }))
  }
  function toggleDeployment(c: SyncCollection, id: string) {
    setChosen((all) => { const next = new Set(all[c.name] ?? []); if (!next.delete(id)) next.add(id); return { ...all, [c.name]: next } })
  }
  const toggleOther = (pk: number) => setChosenOthers((s) => { const next = new Set(s); if (!next.delete(pk)) next.add(pk); return next })

  function startOver() { setStarted(false); setResult(null); setProgress([]); setError(null) }

  async function handleSync() {
    if (!project || !ready) return
    setStarted(true); setSyncing(true); setError(null); setResult(null); setProgress([])
    try {
      await api.syncCollections({}, project, classificationPk ? Number(classificationPk) : null, tickedCollections.map((c) => c.name), tickedDeployments,
        downloadImages && tickedCollections.length > 0, others.filter((o) => chosenOthers.has(o.pk)).map((o) => ({ pk: o.pk, name: o.name })), (event) => {
          if (event.type === 'progress') setProgress((lines) => [...lines, event.message])
          else setResult(event)
        })
      void api.syncCollectionNames({}, project).then((found) => { setField(found.field); setOthers(found.other) }).catch(() => {})
    } catch (e) {
      setError(message(e, 'The sync failed.'))
    } finally {
      setSyncing(false)
    }
  }

  const step2Status = syncing ? 'running' : !started ? 'locked' : error && !result ? 'error' : 'done'
  const small = 'text-xs text-zinc-500 dark:text-zinc-400'
  const localText = (c: SyncCollection) => !c.local.exists ? 'Not here yet'
    : `Here: ${c.local.deployments.length} of ${c.deployments.length} deployment(s)${c.local.with_images.length ? `, ${c.local.with_images.length} with images` : ', no images'}`

  return (
    <div className="max-w-screen-md mx-auto px-4 py-8">
      <h2 className="text-xl font-bold mb-1 text-zinc-900 dark:text-zinc-100">Sync local collections</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
        Brings into your collections folder what a research project has in Trapper — only what you tick. The research project and its locations always come; then
        the field collections you choose, with their deployments and timestamp log, and their images if you ask for them. Collections made in Trapper for some
        other purpose are downloaded by their images, into a folder apart. What is already here is left as it is, and nothing is changed in Trapper.
      </p>

      <WizardStep n={1} title="Choose what to sync" status={started ? 'done' : 'open'} canEdit={!syncing} onEdit={startOver}
                  summary={project && <>{project.acronym ?? project.name} · {tickedCollections.length} collection(s), {tickedDeployments.length} deployment(s){chosenOthers.size ? ` · ${chosenOthers.size} other collection(s)` : ''}</>}
                  description="The research project, then the collections and deployments you want — nothing is ticked to begin with.">
        <div className="mb-4">
          <label className={labelClass} htmlFor="sync-research-project">Research project</label>
          <Combobox
            id="sync-research-project" options={projects.map((p) => ({ value: String(p.pk), label: p.acronym ? `${p.acronym} — ${p.name}` : p.name }))}
            value={projectPk} onChange={(v) => void chooseProject(v)} disabled={syncing}
            placeholder={projects.length === 0 ? 'No research projects' : 'Select a research project…'} clearLabel="Clear research project"
          />
        </div>
        {loading && <p className="text-sm text-zinc-500 flex items-center gap-2 mb-4"><SmallSpinner />Reading the collections from Trapper…</p>}

        {project && !loading && (
          <>
            <div className="mb-4">
              <p className={labelClass}>Field collections</p>
              {field.length === 0 ? <p className={small}>The research project has no collection named like R0003.</p> : (
                <div className="rounded border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700">
                  {field.map((c) => {
                    const ticked = chosen[c.name]?.size ?? 0
                    return (
                      <div key={c.name}>
                        <div className="flex items-center gap-3 px-3 py-2">
                          <input type="checkbox" aria-label={c.name} checked={ticked > 0} disabled={syncing || c.deployments.length === 0}
                                 ref={(el) => { if (el) el.indeterminate = ticked > 0 && ticked < c.deployments.length }} onChange={() => toggleCollection(c)} />
                          <span className="font-mono text-sm">{c.name}</span>
                          <span className={small}>{c.deployments.length} deployment(s) in Trapper · {localText(c)}</span>
                          {c.deployments.length > 0 && (
                            <button type="button" className="ml-auto text-xs text-blue-600 dark:text-blue-400 hover:underline" aria-expanded={open === c.name}
                                    onClick={() => setOpen(open === c.name ? null : c.name)}>{open === c.name ? 'Hide deployments' : 'Choose deployments'}</button>
                          )}
                        </div>
                        {open === c.name && (
                          <ul className="px-10 pb-2 grid sm:grid-cols-2 gap-1">
                            {c.deployments.map((id) => (
                              <li key={id} className="flex items-center gap-2 text-sm">
                                <input type="checkbox" aria-label={id} checked={chosen[c.name]?.has(id) ?? false} disabled={syncing} onChange={() => toggleDeployment(c, id)} />
                                <span className="font-mono">{id}</span>
                                <span className={small}>{c.local.with_images.includes(id) ? 'images here' : c.local.deployments.includes(id) ? 'here, no images' : ''}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {tickedCollections.length > 0 && (
              <div className="mb-4 rounded-lg border border-zinc-200 dark:border-zinc-700 px-4 py-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={downloadImages} disabled={syncing} onChange={(e) => setDownloadImages(e.target.checked)} />
                  <span>
                    <span className="block text-sm font-semibold text-zinc-800 dark:text-zinc-200">Also download their images from Trapper</span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Each image goes into its deployment&rsquo;s folder, as Trapper holds it. The ones already here are kept and not downloaded again. A deployment can have thousands,
                      so this can take long and need a lot of disk space. The deployments stay <em>synced</em>: read-only, not preprocessed.
                    </span>
                  </span>
                </label>
              </div>
            )}

            <div className="mb-4">
              <p className={labelClass}>Other collections</p>
              <p className={`${small} mb-1.5`}>Made in Trapper for some purpose (R0039-SOLONOVIEMBRE…): downloaded by their images into <span className="font-mono">downloads/{project.acronym ?? project.pk}/</span>, one folder per collection, apart from the field collections.</p>
              {others.length === 0 ? <p className={small}>None.</p> : (
                <div className="rounded border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700 max-h-64 overflow-y-auto">
                  {others.map((o) => (
                    <label key={o.pk} className="flex items-center gap-3 px-3 py-2 cursor-pointer">
                      <input type="checkbox" aria-label={o.name} checked={chosenOthers.has(o.pk)} disabled={syncing} onChange={() => toggleOther(o.pk)} />
                      <span className="text-sm">{o.name}</span>
                      <span className={small}>{o.downloaded ? `${o.downloaded} file(s) already here` : 'not downloaded'}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {needsClassification && (
              <div className="mb-4">
                <label className={labelClass} htmlFor="sync-classification-project">Classification project (to download the images)</label>
                <Combobox
                  id="sync-classification-project" options={classifications.map((c) => ({ value: String(c.pk), label: c.name }))}
                  value={classificationPk} onChange={setClassificationPk} disabled={syncing}
                  placeholder={classifications.length === 0 ? 'The research project has no classification project' : 'Select a classification project…'} clearLabel="Clear classification project"
                />
                <p className={`${small} mt-1`}>Trapper only gives the image files through a classification project that holds the collection: choose one that has it. Nothing is classified nor changed.</p>
              </div>
            )}
          </>
        )}

        {error && !started && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
        <div className="flex justify-end">
          <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!ready || syncing} onClick={() => void handleSync()}>
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
            {result.others && result.others.length > 0 && (
              <div className="text-sm mt-3" aria-label="Other collections downloaded">
                {result.others.map((o) => (
                  <p key={o.name}><strong>{o.name}:</strong> {o.downloaded} image(s) downloaded ({formatMegabytes(o.bytes)}), {o.already} already here — <span className="font-mono text-xs break-all">{o.folder}</span>
                    {o.failed.length > 0 && <span className="text-red-600 dark:text-red-400"> · {o.failed.length} failed, sync again to retry</span>}</p>
                ))}
              </div>
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
                {result.unassigned.length} deployment{result.unassigned.length === 1 ? '' : 's'} of the research project are not in any of its field collections, so they were not created
                {' '}(collections {unassignedCollections(result.unassigned).join(', ')}).
              </p>
            )}
          </section>
        )}
        {started && !syncing && (
          <div className="flex justify-end mt-4">
            <button type="button" className={btnOutline} onClick={startOver}>{result ? 'Sync more' : 'Back'}</button>
          </div>
        )}
      </WizardStep>
    </div>
  )
}
