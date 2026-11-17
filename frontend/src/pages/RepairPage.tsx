import { listWorking } from '../researchProjects'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { defaultResearchProject } from '../defaultResearchProject'
import PickTable, { LabelFrame, PickedTick } from '../components/PickTable'
import { Mark, mark } from '../components/Notice'
import BackButton from '../components/BackButton'
import ReportPanel from '../components/ReportPanel'
import { PageHeader, UTIL_ICONS } from '../components/TaskCard'
import WizardStep from '../components/WizardStep'
import { SmallSpinner, btnOutline, btnPrimary } from './ImportDeploymentPage'
import type { FieldDeployment, LocalResearchProject, RepairCollection, RepairEvent, RepairState, RepairStep } from '../types'

const labelClass = 'block text-sm font-semibold mb-1.5 text-zinc-700 dark:text-zinc-300'

const STEPS: { step: RepairStep; label: string }[] = [
  { step: 'inspect', label: 'Look at the folder' },
  { step: 'dates', label: 'Dates and timestamp log' },
  { step: 'deployment', label: 'deployment.json' },
  { step: 'preprocessing', label: 'preprocessing.json' },
  { step: 'images', label: 'images.json' },
  { step: 'seal', label: 'Validate and seal' },
]

interface Run {
  steps: Partial<Record<RepairStep, { status: 'running' | 'done' | 'skipped'; message: string }>>
  result: Extract<RepairEvent, { type: 'done' }> | null
  error: string | null
}

const EMPTY_RUN: Run = { steps: {}, result: null, error: null }

function reduceRun(run: Run, event: RepairEvent): Run {
  if (event.type === 'step') return { ...run, steps: { ...run.steps, [event.step]: { status: event.status, message: event.message } } }
  return { ...run, result: event }
}

/** The badge of a deployment: valid is what its seal says — anything else is not. */
function StateBadge({ state, repairing }: { state: RepairState | undefined; repairing: boolean }) {
  if (repairing) return <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400"><SmallSpinner />Repairing…</span>
  const [text, tone] = !state ? ['Not checked', 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400']
    : state.status === 'valid' ? [mark('success', 'Valid'), 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300']
    : state.status === 'synced' ? ['From Trapper', 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300']
    : state.status === 'unsealed' ? [mark('warning', 'Not sealed'), 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300']
    : [mark('warning', 'Not valid'), 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300']
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{text}</span>
}

/** Checks the deployments kept in a local collection — a deployment is valid if its seal.json still matches it — and repairs the ones that
 * are not: their metadata files (deployment.json, images.json, preprocessing.json, seal.json) are written again from what the folder
 * holds, taking the period from the collection's timestamp log when it has the deployment. Three steps: what to check, what the check
 * found, and the repairs. */
export default function RepairPage({ onBack }: { onBack?: () => void; onOpenSettings?: (section?: 'general') => void; settingsOpen?: boolean } = {}) {
  const [projects, setProjects] = useState<LocalResearchProject[]>([])
  const [projectId, setProjectId] = useState('')
  const [collections, setCollections] = useState<RepairCollection[]>([])
  // what the visits say of each deployment — its visit and its card —, by its id
  const [fields, setFields] = useState<Record<string, FieldDeployment>>({})
  const [collectionName, setCollectionName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set()) // what to check
  const [chosen, setChosen] = useState(false)
  const [states, setStates] = useState<Record<string, RepairState>>({})
  const [checking, setChecking] = useState(false)
  const [toRepair, setToRepair] = useState<Set<string>>(new Set())
  const [repairing, setRepairing] = useState<string | null>(null)
  const [runs, setRuns] = useState<Record<string, Run>>({})
  const [order, setOrder] = useState<string[]>([])
  const [finished, setFinished] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

  useEffect(() => {
    listWorking().then(async ({ results }) => {
      setProjects(results)
      // The default research project of the general settings comes filled in.
      const wanted = await defaultResearchProject()
      const found = results.find((p) => p.acronym.toLowerCase() === wanted.toLowerCase())
      if (wanted && found) void chooseProject(found.acronym)
    }).catch((e) => setError(message(e, 'Could not read the collections folder.')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const collection = collections.find((c) => c.name === collectionName)
  // the deployments that are kept here: the ones taken from Trapper have nothing to repair and are not listed
  const deployments = (collection?.deployments ?? []).filter((d) => !d.synced)
  const checkable = deployments
  const busy = checking || repairing !== null
  const toCheck = checkable.filter((d) => selected.has(d.deployment_id))
  const checkedList = deployments.filter((d) => states[d.deployment_id])
  const notValid = checkedList.filter((d) => states[d.deployment_id].status !== 'valid')
  const chosenToRepair = notValid.filter((d) => toRepair.has(d.deployment_id))
  const repairStarted = order.length > 0
  const failures = order.filter((id) => runs[id]?.error).length

  function resetResults() { setStates({}); setRuns({}); setOrder([]); setToRepair(new Set()); setFinished(false); setError(null) }
  function startOver() { setChosen(false); resetResults() }

  async function chooseProject(id: string) {
    setProjectId(id); setCollections([]); setCollectionName(''); setSelected(new Set()); startOver()
    if (!id) return
    try {
      setCollections((await api.repairCollections(id)).results)
      // the visit and the card of each deployment: told besides it when the visits are kept
      api.fieldDeployments(id).then(({ results }) => setFields(Object.fromEntries(results.map((d) => [d.deployment_id, d])))).catch(() => setFields({}))
    } catch (e) {
      setError(message(e, 'Could not read the collections.'))
    }
  }

  function chooseCollection(name: string) {
    setCollectionName(name); startOver()
    setSelected(new Set((collections.find((c) => c.name === name)?.deployments ?? []).filter((d) => !d.synced).map((d) => d.deployment_id)))
  }

  const toggleRepair = (id: string) => setToRepair((s) => { const next = new Set(s); if (!next.delete(id)) next.add(id); return next })

  /** Looks at the chosen deployments: which seals still match, and what is wrong with the others. */
  async function handleCheck() {
    if (!collection) return
    resetResults(); setChosen(true); setChecking(true)
    const found: Record<string, RepairState> = {}
    try {
      for (const d of toCheck) {
        found[d.deployment_id] = await api.repairInspect(projectId, collection.name, d.deployment_id)
        setStates({ ...found })
      }
      // What is left to do: the ones that are not valid.
      setToRepair(new Set(toCheck.filter((d) => found[d.deployment_id]?.status !== 'valid').map((d) => d.deployment_id)))
    } catch (e) {
      setError(message(e, 'Could not check the deployments.'))
    } finally {
      setChecking(false)
    }
  }

  async function handleRepair() {
    if (!collection) return
    const ids = chosenToRepair.map((d) => d.deployment_id)
    setError(null); setFinished(false); setOrder(ids)
    setRuns(Object.fromEntries(ids.map((id) => [id, EMPTY_RUN])))
    for (const id of ids) {
      setRepairing(id)
      try {
        await api.repairDeployment(projectId, collection.name, id, (event) => setRuns((r) => ({ ...r, [id]: reduceRun(r[id] ?? EMPTY_RUN, event) })))
      } catch (e) {
        setRuns((r) => ({ ...r, [id]: { ...(r[id] ?? EMPTY_RUN), error: message(e, 'The repair failed.') } }))
      }
      try {
        const state = await api.repairInspect(projectId, collection.name, id) // how it ended
        setStates((s) => ({ ...s, [id]: state }))
      } catch { /* the repair's own result says it */ }
    }
    setRepairing(null); setFinished(true)
    void api.repairCollections(projectId).then(({ results }) => setCollections(results)).catch(() => {})
  }

  const linkButton = 'text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50'
  const step2Status = !chosen ? 'locked' : checking ? 'running' : repairStarted ? 'done' : 'open'
  const step3Status = !repairStarted ? 'locked' : repairing !== null ? 'running' : 'done'
  const validCount = checkedList.length - notValid.length

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-8">
      <PageHeader icon={UTIL_ICONS.repair} title="Repair local deployments" parent="Utilities" onParent={onBack}
        description="Checks the deployments of a revision and repairs the ones that are not valid." />

      <WizardStep n={1} title="Choose what to check" status={chosen ? 'done' : 'open'} canEdit={!busy} onEdit={startOver}
                  summary={collection && <>{projectId} › {collectionName} · {toCheck.length} {toCheck.length === 1 ? 'deployment' : 'deployments'}</>}
                  description={projectId ? <>Select the revision and the deployments of the research project <strong className="font-mono">{projectId}</strong> that you want to check.</> : 'Select the revision and the deployments that you want to check.'}>
        {!projectId && <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">{projects.length === 0 ? 'Nothing is kept in the collections folder yet.' : 'There is no default research project: set it in the settings, with the card at the top right.'}</p>}

        {projectId && (
          <div className="mb-4">
            <p className={labelClass}>Revision</p>
            {collections.length === 0
              ? <p className="text-sm text-zinc-500 dark:text-zinc-400">No revisions yet.</p>
              : (
                <PickTable
                  items={[...collections].sort((x, y) => y.name.localeCompare(x.name))} keyOf={(c) => c.name} selectedKey={collectionName} onSelect={(c) => { if (!busy) chooseCollection(c?.name ?? '') }}
                  columns={[
                    { label: 'Revision', className: 'px-4 py-3 font-mono text-sm', cell: (c) => c.name },
                    { label: 'Deployments', cell: (c) => `${c.deployments.filter((d) => !d.synced).length} ${c.deployments.filter((d) => !d.synced).length === 1 ? 'deployment' : 'deployments'}` },
                    { label: 'Images', cell: (c) => c.deployments.filter((d) => !d.synced).reduce((n, d) => n + d.images, 0).toLocaleString('en-US') },
                  ]}
                  searchText={(c) => c.name}
                  renderLabel={(c, on, press) => (
                    <LabelFrame picked={on} name={`the revision ${c.name}`} onPress={press}>
                      <span className="flex items-start justify-between gap-2"><span className="font-mono text-sm font-semibold">{c.name}</span>{on && <PickedTick />}</span>
                      <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{c.deployments.length} {c.deployments.length === 1 ? 'deployment' : 'deployments'}</span>
                    </LabelFrame>)}
                  names={{ table: 'Revisions', search: 'Search the revisions', items: 'revisions', pick: (c) => `the revision ${c.name}`, pickPlaceholder: 'Type to pick a revision…' }}
                  optionLabel={(c) => `${c.name} · ${c.deployments.length} ${c.deployments.length === 1 ? 'deployment' : 'deployments'}`} searchPlaceholder="Search by revision…" empty="No revision matches." perPage={5} defaultView="search"
                />
              )}
          </div>
        )}

        {collection && (
          <div className="mb-4">
            <p className={labelClass}>Deployments</p>
            {deployments.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">This revision has no deployments of its own to repair.</p>}
            {deployments.length > 0 && (
              <PickTable
                items={deployments} keyOf={(d) => d.deployment_id}
                many={{ selected, onChange: setSelected, disabled: busy, noun: 'selected', detail: (ds) => `${ds.reduce((n, d) => n + d.images, 0).toLocaleString('en-US')} images` }}
                columns={[
                  { label: 'Deployment', className: 'px-4 py-3 font-mono text-sm', cell: (d) => d.deployment_id },
                  { label: 'Visit', cell: (d) => (fields[d.deployment_id]?.start_session ? `${fields[d.deployment_id].start_session} · ${fields[d.deployment_id].site}` : '—') },
                  { label: 'SD card', cell: (d) => fields[d.deployment_id]?.card ?? '—' },
                  { label: 'Images', className: 'px-4 py-3 text-right', cell: (d) => d.images },
                ]}
                searchText={(d) => d.deployment_id}
                renderLabel={(d, on, press) => (
                  <LabelFrame picked={on} name={d.deployment_id} onPress={press}>
                    <span className="flex items-start justify-between gap-2"><span className="font-mono text-sm font-semibold">{d.deployment_id}</span>{on && <PickedTick />}</span>
                    <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{fields[d.deployment_id]?.start_session ? `${fields[d.deployment_id].start_session} · ${fields[d.deployment_id].site}` : '—'}{fields[d.deployment_id]?.card ? ` · SD ${fields[d.deployment_id].card}` : ''} · {d.images} images</span>
                  </LabelFrame>)}
                names={{ table: 'Deployments', search: 'Search the deployments', items: 'deployments', pick: (d) => d.deployment_id, pickPlaceholder: 'Type to pick a deployment…' }}
                optionLabel={(d) => `${d.deployment_id} · ${d.images} images`} searchPlaceholder="Search by deployment…" empty="No deployment matches." perPage={8}
              />
            )}
          </div>
        )}

        {error && !chosen && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
        <div className={`flex items-center gap-3 ${onBack ? 'justify-between' : 'justify-end'}`}>
          {onBack && <BackButton onClick={onBack} disabled={busy} />}
          <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!collection || toCheck.length === 0} onClick={() => void handleCheck()}>
            <svg aria-hidden="true" className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 001.5.86l11-6.5a1 1 0 000-1.72l-11-6.5A1 1 0 008 5.5z" /></svg>
            Check the deployments
          </button>
        </div>
      </WizardStep>

      <WizardStep n={2} title="Check results" status={step2Status} canEdit={!busy} onEdit={() => { setRuns({}); setOrder([]); setFinished(false) }} expanded={step2Status === 'done'}
                  description="Which seals still match, and what is wrong with the others."
                  action={chosen && !checking && !repairStarted ? <button type="button" className={btnOutline} onClick={() => void handleCheck()}>Check again</button> : undefined}>
        {checking && checkedList.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-2"><SmallSpinner />Checking the deployments…</p>}
        {checkedList.length > 0 && (
          <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-700 mb-3">
            {!repairStarted && !checking && notValid.length > 0 && (
              <div className="flex items-center gap-3 flex-wrap px-3 py-2 text-xs border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                <span className="text-zinc-500 dark:text-zinc-400">{chosenToRepair.length} of {notValid.length} selected</span>
                <button type="button" className={linkButton} onClick={() => setToRepair(new Set(notValid.map((d) => d.deployment_id)))}>Select the not valid</button>
                <button type="button" className={linkButton} disabled={toRepair.size === 0} onClick={() => setToRepair(new Set())}>Select none</button>
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                  <th scope="col" className="px-3 py-2 w-10" />
                  <th scope="col" className="px-3 py-2 font-medium">Deployment</th>
                  <th scope="col" className="px-3 py-2 font-medium text-right">Images</th>
                  <th scope="col" className="px-3 py-2 font-medium">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                {checkedList.map((d) => {
                  const state = states[d.deployment_id]
                  return (
                    <tr key={d.deployment_id} className="align-top">
                      <td className="px-3 py-2">
                        {state.status !== 'valid' && (
                          <input type="checkbox" aria-label={`Repair ${d.deployment_id}`} checked={toRepair.has(d.deployment_id)} disabled={busy || repairStarted} onChange={() => toggleRepair(d.deployment_id)} />
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-zinc-900 dark:text-zinc-100">{d.deployment_id}</td>
                      <td className="px-3 py-2 text-right">{state.images}</td>
                      <td className="px-3 py-2">
                        <StateBadge state={state} repairing={repairing === d.deployment_id} />
                        {state.status !== 'valid' && state.problems.length > 0 && (
                          <ul className="mt-1 space-y-0.5 text-xs text-amber-700 dark:text-amber-400" aria-label={`Problems of ${d.deployment_id}`}>
                            {state.problems.map((p) => <li key={p}>• {p}</li>)}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {error && chosen && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
        {chosen && !checking && checkedList.length > 0 && (
          <p className={`text-sm mb-3 ${notValid.length ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {notValid.length === 0 ? mark('success', `All ${validCount} ${validCount === 1 ? 'deployment is' : 'deployments are'} valid — nothing to repair.`) : `${validCount} valid, ${notValid.length} not valid.`}
          </p>
        )}
        {chosen && !checking && !repairStarted && (
          <div className="flex items-center justify-between gap-3">
            <BackButton onClick={startOver} />
            {notValid.length > 0 && (
              <button type="button" className={btnPrimary} disabled={chosenToRepair.length === 0} onClick={() => void handleRepair()}>
                Repair {chosenToRepair.length} deployment{chosenToRepair.length === 1 ? '' : 's'}
              </button>
            )}
          </div>
        )}
      </WizardStep>

      <WizardStep n={3} title="Repairs" status={step3Status} canEdit={false} onEdit={() => {}} expanded
                  description={<>Only needed when some deployment is not valid. A deployment is <strong>valid</strong> when its <span className="font-mono">seal.json</span> still matches it. For the ones that are not, the metadata
                  files are written again from what the folder holds — the dates of the images, their camera, the location&rsquo;s details — and the images are validated and postvalidated again. If the
                  revision&rsquo;s <span className="font-mono">FileTimestampLog.csv</span> has the deployment, it says its period.</>}>
        <div className="space-y-3" aria-live="polite">
          {order.map((id) => {
            const run = runs[id] ?? EMPTY_RUN
            return (
              <section key={id} className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700" aria-label={`Repair of ${id}`}>
                <h5 className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">{id}</h5>
                <ol className="space-y-1 text-sm">
                  {STEPS.filter(({ step }) => run.steps[step]).map(({ step, label }) => {
                    const info = run.steps[step]!
                    return (
                      <li key={step} className={info.status === 'done' ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-600 dark:text-zinc-400'}>
                        {info.status === 'done' ? <Mark kind="success" /> : info.status === 'skipped' ? '– ' : '… '}<span className="font-medium">{label}</span> — {info.message}
                      </li>
                    )
                  })}
                </ol>
                {run.error && <p className="text-sm text-red-600 dark:text-red-400 mt-2"><Mark kind="warning" />{run.error}</p>}
                {run.result && (
                  <div className="mt-2 text-sm">
                    <p className={run.result.status === 'valid' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                      {run.result.status === 'valid' ? mark('success', 'Valid again') : mark('warning', 'Not valid yet')} — wrote {run.result.written.join(', ') || 'nothing'}.
                    </p>
                    {run.result.report_id && <ReportPanel reportId={run.result.report_id} />}
                  </div>
                )}
              </section>
            )
          })}
          {finished && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className={`text-sm ${failures ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {order.length - failures} deployment(s) repaired{failures ? `, ${failures} failed` : ''}.
              </p>
              <button type="button" className={btnOutline} onClick={startOver}>Check another revision</button>
            </div>
          )}
        </div>
      </WizardStep>
    </div>
  )
}
