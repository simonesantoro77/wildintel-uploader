import { Fragment, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import Combobox from '../components/Combobox'
import WizardStep from '../components/WizardStep'
import { SmallSpinner, btnOutline, btnPrimary } from './ImportDeploymentPage'
import type { FieldDeployment, FieldlogResult, LocalResearchProject, ResearchProject } from '../types'

const labelClass = 'block text-sm font-semibold mb-1.5 text-zinc-700 dark:text-zinc-300'
const inputClass = 'flex-1 min-w-0 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400'

/** "2026-03-30T08:15:00Z" as "2026-03-30 08:15 UTC" — every time of the field records is UTC. */
export function utc(iso: string | null): string {
  if (!iso) return '—'
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?Z$/.exec(iso)
  return m ? `${m[1]} ${m[2]}${m[3] && m[3] !== ':00' ? m[3] : ''} UTC` : iso
}

function StatusBadge({ status }: { status: FieldDeployment['status'] }) {
  return status === 'closed'
    ? <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">Card collected</span>
    : <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">Camera still out</span>
}

/** A file path with the button that picks it in the OS's own dialog. */
function FileField({ id, label, hint, value, onChange, onBrowse, disabled }: {
  id: string; label: string; hint: string; value: string; onChange: (v: string) => void; onBrowse: () => void; disabled: boolean
}) {
  return (
    <div className="mb-4">
      <label className={labelClass} htmlFor={id}>{label}</label>
      <div className="flex gap-2">
        <input id={id} className={inputClass} value={value} disabled={disabled} placeholder="Path to the file" onChange={(e) => onChange(e.target.value)} />
        <button type="button" className={btnOutline} disabled={disabled} onClick={onBrowse}>Browse…</button>
      </div>
      <p className={`${hintClass} mt-1`}>{hint}</p>
    </div>
  )
}

/** Field records, the first step of the workflow: the Epicollect download of a field trip and the fieldwork datasheet are read
 * together — the trip's visits are added to the datasheet, each deployment of the collection gets its start and end (UTC),
 * who set it up, its camera and its card, and the data are checked (sites that are not locations yet, a camera at two
 * sites…). Nothing is written until "Write the files": the updated datasheet beside the original, and the collection's
 * FileTimestampLog and FieldworkLog in its folder. */
export default function FieldLogPage() {
  const [projects, setProjects] = useState<LocalResearchProject[]>([])
  const [projectId, setProjectId] = useState('')
  const [epicollect, setEpicollect] = useState('')
  const [datasheet, setDatasheet] = useState('')
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<FieldlogResult | null>(null)
  const [writing, setWriting] = useState(false)
  const [written, setWritten] = useState<FieldlogResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'closed' | 'open'>('all')
  const [showNotes, setShowNotes] = useState(false)
  // The research projects of the Trapper account (null: not asked yet or no account), and what choosing one brought.
  const [trapperProjects, setTrapperProjects] = useState<ResearchProject[] | null>(null)
  const [taking, setTaking] = useState<{ busy: boolean; done?: string; error?: string } | null>(null)
  // The new sites ticked to be saved, with their coordinates as typed.
  const [newSites, setNewSites] = useState<Record<string, { tick: boolean; lat: string; lon: string }>>({})
  const [savingSites, setSavingSites] = useState<{ busy: boolean; error?: string; done?: string }>({ busy: false })

  const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

  useEffect(() => {
    api.listResearchProjects().then(({ results }) => setProjects(results)).catch((e) => setError(message(e, 'Could not read the collections folder.')))
    api.trapperResearchProjects({}).then(({ results }) => setTrapperProjects(results)).catch(() => setTrapperProjects(null))
    api.fieldlogLast()
      .then((last) => {
        if (last.research_project_id) setProjectId(last.research_project_id)
        if (last.datasheet) setDatasheet(last.datasheet)
      })
      .catch(() => {})
  }, [])

  function changed() { setResult(null); setWritten(null); setError(null) }

  /** Choosing a research project: one of Trapper's brings itself and its locations into the collections folder — the missing
   * ones added, the ones there kept as they are (those saved from the field too). */
  async function chooseProject(acronym: string) {
    setProjectId(acronym); changed(); setTaking(null)
    const inTrapper = trapperProjects?.find((p) => (p.acronym ?? String(p.pk)) === acronym)
    if (!inTrapper) return
    setTaking({ busy: true })
    try {
      const done = await api.fieldlogTakeProject({ pk: inTrapper.pk, name: inTrapper.name, acronym: inTrapper.acronym ?? undefined })
      setProjects((await api.listResearchProjects()).results)
      setTaking({ busy: false, done: done.created.length ? `Locations from Trapper: ${done.created.length} added, ${done.kept.length} already here.` : `Locations up to date with Trapper (${done.kept.length}).` })
    } catch (e) {
      setTaking({ busy: false, error: message(e, 'Could not take the locations from Trapper.') })
    }
  }

  const projectOptions = useMemo(() => {
    const options = new Map<string, string>()
    for (const p of trapperProjects ?? []) options.set(p.acronym ?? String(p.pk), `${p.acronym ?? p.pk} — ${p.name} (Trapper)`)
    for (const p of projects) if (!options.has(p.acronym)) options.set(p.acronym, `${p.acronym} — ${p.name} (only here)`)
    return [...options].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [trapperProjects, projects])

  useEffect(() => {
    setNewSites(Object.fromEntries((result?.new_sites ?? []).map((s) => [s.site, { tick: false, lat: s.latitude == null ? '' : String(s.latitude), lon: s.longitude == null ? '' : String(s.longitude) }])))
  }, [result])

  const coordinate = (v: string, max: number) => (/^-?\d+(\.\d+)?$/.test(v.trim()) && Math.abs(Number(v)) <= max ? Number(v) : null)
  const tickedSites = Object.entries(newSites).filter(([, v]) => v.tick)
  const sitesValid = tickedSites.every(([, v]) => coordinate(v.lat, 90) !== null && coordinate(v.lon, 180) !== null)

  async function saveSites() {
    setSavingSites({ busy: true })
    try {
      const saved = await api.fieldlogAddLocations(projectId, tickedSites.map(([site, v]) => ({ location_id: site, latitude: Number(v.lat), longitude: Number(v.lon) })))
      await handleCheck()
      setSavingSites({ busy: false, done: `${saved.results.length} location(s) saved. The upload creates them in Trapper.` })
    } catch (e) {
      setSavingSites({ busy: false, error: message(e, 'Could not save the locations.') })
    }
  }

  async function browse(kind: 'epicollect' | 'datasheet') {
    try {
      const { path } = await api.fieldlogPickFile(kind)
      if (path) { (kind === 'epicollect' ? setEpicollect : setDatasheet)(path); changed() }
    } catch {
      // No native dialog here: the path can still be typed.
    }
  }

  async function handleCheck() {
    changed(); setChecking(true)
    try {
      setResult(await api.fieldlogAnalyze(epicollect.trim(), datasheet.trim(), projectId || null))
    } catch (e) {
      setError(message(e, 'Could not read the field records.'))
    } finally {
      setChecking(false)
    }
  }

  async function handleWrite() {
    setError(null); setWriting(true)
    try {
      const done = await api.fieldlogApply(epicollect.trim(), datasheet.trim(), projectId)
      setWritten(done); setResult(done)
    } catch (e) {
      setError(message(e, 'Could not write the files.'))
    } finally {
      setWriting(false)
    }
  }

  const busy = checking || writing
  const ready = epicollect.trim() !== '' && datasheet.trim() !== ''
  const shown = useMemo(() => {
    const own = (result?.deployments ?? []).filter((d) => result?.collections.includes(d.collection))
    return filter === 'all' ? own : own.filter((d) => d.status === filter)
  }, [result, filter])
  const own = (result?.deployments ?? []).filter((d) => result?.collections.includes(d.collection))
  const closedCount = own.filter((d) => d.status === 'closed').length
  const openCount = own.length - closedCount
  const running = (result?.deployments ?? []).filter((d) => !result?.collections.includes(d.collection)).length
  const otherWarnings = (result?.warnings ?? []).filter((w) => !w.startsWith('Sites not among the locations'))
  const step2Status = checking ? 'running' : !result ? 'locked' : written ? 'done' : 'open'
  const linkButton = 'text-blue-600 dark:text-blue-400 hover:underline'

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-8">
      <h2 className="text-xl font-bold mb-1 text-zinc-900 dark:text-zinc-100">Field records</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
        After each field trip: the Epicollect download and the fieldwork datasheet, read together. The trip&rsquo;s visits are added to the datasheet, each
        deployment of the collection gets its start and end, who set it up, its camera and its card, and the field data are checked before any card is copied.
        Every time is <strong>UTC</strong>. Nothing is written until you press <strong>Write the files</strong>.
      </p>

      <WizardStep n={1} title="Choose the files" status={result ? 'done' : 'open'} canEdit={!busy} onEdit={changed}
                  summary={result && <>{projectId || 'No research project'} · {result.datasheet}</>}
                  description="The research project, the Epicollect download of the trip and the datasheet as it is now.">
        <div className="mb-4">
          <label className={labelClass} htmlFor="fieldlog-research-project">Research project</label>
          <Combobox
            id="fieldlog-research-project" options={projectOptions}
            value={projectId} onChange={(v) => void chooseProject(v)} disabled={busy || Boolean(taking?.busy)}
            placeholder={projectOptions.length === 0 ? 'No research projects — set the Trapper account in Settings' : 'Select a research project…'} clearLabel="Clear research project"
          />
          <p className={`${hintClass} mt-1`}>
            {trapperProjects ? 'The research projects of your Trapper account: choosing one brings its locations, keeping the ones already here. ' : 'The research projects kept in your collections folder (set the Trapper account in Settings to choose from Trapper). '}
            Its locations are what the sites of the trip are checked against, and its folder is where the files go.
          </p>
          {taking?.busy && <p className="text-sm mt-1 flex items-center gap-2"><SmallSpinner />Taking the locations from Trapper…</p>}
          {taking?.done && <p className="text-sm mt-1 text-emerald-700 dark:text-emerald-400" role="status">{taking.done}</p>}
          {taking?.error && <p className="text-sm mt-1 text-red-600 dark:text-red-400" role="alert">{taking.error}</p>}
        </div>
        <FileField id="fieldlog-epicollect" label="Epicollect download (CSV)" value={epicollect} disabled={busy}
                   onChange={(v) => { setEpicollect(v); changed() }} onBrowse={() => void browse('epicollect')}
                   hint="The CSV downloaded from the Epicollect project — the whole project or just this trip's entries." />
        <FileField id="fieldlog-datasheet" label="Fieldwork datasheet (.xlsx)" value={datasheet} disabled={busy}
                   onChange={(v) => { setDatasheet(v); changed() }} onBrowse={() => void browse('datasheet')}
                   hint="The datasheet as it is now, e.g. TatraFieldSheet_R0001-R0013.xlsx. It is only read: the updated one is a new file beside it." />
        {error && !result && <p className="text-sm text-red-600 dark:text-red-400 mb-3" role="alert">{error}</p>}
        <div className="flex justify-end">
          <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!ready || busy} onClick={() => void handleCheck()}>
            {checking && <SmallSpinner />}Check the field records
          </button>
        </div>
      </WizardStep>

      <WizardStep n={2} title="What the field trip says" status={step2Status} canEdit={false} onEdit={() => {}} expanded={Boolean(written)}
                  description="The visits added, the checks and each deployment of the collection."
                  action={result && !written && !busy ? <button type="button" className={btnOutline} onClick={() => void handleCheck()}>Check again</button> : undefined}>
        {result && (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ['Datasheet', `${result.sessions[0]}–${result.sessions[1]}`],
                ['Visits added', String(result.new_rows)],
                ['Collection', result.collections.join(', ')],
                ['Cards to copy', `${closedCount} of ${own.length}`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-2">
                  <dt className={hintClass}>{k}</dt>
                  <dd className="text-base font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>

            {result.in_trapper && result.in_trapper.length > 0 && (
              <p className="text-sm rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-amber-900 dark:text-amber-200" role="alert">
                Trapper already has the collection {result.in_trapper.join(', ')}: some of its deployments may be uploaded already. Check the collection before copying its cards.
              </p>
            )}

            {result.new_sites.length > 0 && (
              <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-4" role="alert" aria-label="New sites">
                <p className="font-semibold text-amber-900 dark:text-amber-200">{result.new_sites.length === 1 ? '1 site is' : `${result.new_sites.length} sites are`} not among the locations of {projectId}</p>
                <p className="text-sm text-amber-900/80 dark:text-amber-200/80 mt-1">
                  Check each one is <strong>really new</strong> and not a known site misnamed in the field — look at the nearest location and the similar ids. If it is new,
                  tick it, check its coordinates (those of its installation) and save it: the upload creates it in Trapper. If it is misnamed, correct it in Epicollect or in the
                  datasheet and check again.
                </p>
                <div className="overflow-x-auto mt-3">
                  <table className="text-sm">
                    <thead>
                      <tr className="text-left text-xs text-amber-900/70 dark:text-amber-200/70">
                        {['', 'Site', 'Installed', 'Latitude', 'Longitude', 'Is it really new?'].map((h, i) => <th key={i} className="pr-4 py-1 font-medium">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {result.new_sites.map((s) => {
                        const v = newSites[s.site] ?? { tick: false, lat: '', lon: '' }
                        const set = (change: Partial<typeof v>) => setNewSites((all) => ({ ...all, [s.site]: { ...v, ...change } }))
                        const close = s.nearest && s.nearest.distance_m < 500
                        return (
                          <tr key={s.site} className="align-top">
                            <td className="pr-4 py-1"><input type="checkbox" aria-label={`Save ${s.site} as a new location`} checked={v.tick} disabled={savingSites.busy} onChange={(e) => set({ tick: e.target.checked })} /></td>
                            <td className="pr-4 py-1 font-mono">{s.site}</td>
                            <td className="pr-4 py-1 whitespace-nowrap">{s.session} · {s.action}<span className={`block ${hintClass}`}>{utc(s.when)} · {s.visits} visit(s)</span></td>
                            <td className="pr-4 py-1"><input aria-label={`Latitude of ${s.site}`} className={`${inputClass} w-28 py-1`} value={v.lat} disabled={savingSites.busy} onChange={(e) => set({ lat: e.target.value })} /></td>
                            <td className="pr-4 py-1"><input aria-label={`Longitude of ${s.site}`} className={`${inputClass} w-28 py-1`} value={v.lon} disabled={savingSites.busy} onChange={(e) => set({ lon: e.target.value })} /></td>
                            <td className="py-1 text-xs">
                              {s.nearest && <span className={`block ${close ? 'font-semibold text-red-700 dark:text-red-400' : ''}`}>{close ? '⚠ ' : ''}{s.nearest.distance_m} m from {s.nearest.location_id}</span>}
                              {s.similar.length > 0 && <span className="block font-semibold text-red-700 dark:text-red-400">⚠ Like {s.similar.join(', ')} — a typo?</span>}
                              {!s.nearest && s.similar.length === 0 && <span className={hintClass}>No known location to compare with.</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center gap-3 flex-wrap mt-3">
                  {savingSites.error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{savingSites.error}</p>}
                  {!sitesValid && <p className="text-sm text-red-600 dark:text-red-400">Coordinates in decimal degrees: latitude −90 to 90, longitude −180 to 180.</p>}
                  <button type="button" className={`${btnPrimary} ml-auto flex items-center gap-2`} disabled={!projectId || tickedSites.length === 0 || !sitesValid || savingSites.busy} onClick={() => void saveSites()}>
                    {savingSites.busy && <SmallSpinner />}Save {tickedSites.length} as new location(s)
                  </button>
                </div>
              </div>
            )}
            {savingSites.done && <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">{savingSites.done}</p>}
            {!result.locations_known && (
              <p className="text-sm text-zinc-600 dark:text-zinc-300 rounded-lg bg-zinc-100 dark:bg-zinc-800 px-4 py-3">
                {projectId ? `${projectId} has no locations kept yet` : 'No research project chosen'}, so the sites of the trip are not checked against them.
              </p>
            )}

            {otherWarnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 p-4">
                <p className="font-semibold text-sm mb-2">To look at ({otherWarnings.length})</p>
                <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                  {otherWarnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
                <p className={`${hintClass} mt-2`}>Correct them in Epicollect and download it again, or in the datasheet, then check again.</p>
              </div>
            )}

            <div>
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <p className="font-semibold text-sm mr-auto">Deployments of {result.collections.join(', ')}</p>
                {(['all', 'closed', 'open'] as const).map((f) => (
                  <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
                          className={`text-xs px-3 py-1 rounded-full border ${filter === f ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' : 'border-zinc-300 dark:border-zinc-600'}`}>
                    {f === 'all' ? `All (${own.length})` : f === 'closed' ? `Card collected (${closedCount})` : `Camera still out (${openCount})`}
                  </button>
                ))}
              </div>
              <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50">
                      {['Deployment', '', 'Start', 'End', 'Set up by', 'Camera', 'Card', 'Photos'].map((h, i) => <th key={i} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                    {shown.map((d) => (
                      <Fragment key={d.deployment_id}>
                      <tr className={d.comments ? '[&>td]:pb-1' : ''}>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">{d.deployment_id}</td>
                        <td className="px-3 py-2"><StatusBadge status={d.status} /></td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">{utc(d.start)}</td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">{utc(d.end)}</td>
                        <td className="px-3 py-2">{d.setup_by ?? '—'}</td>
                        <td className="px-3 py-2 tabular-nums">{d.camera_id ?? '—'}</td>
                        <td className="px-3 py-2 font-mono">{d.card ?? '—'}</td>
                        <td className="px-3 py-2 tabular-nums text-right whitespace-nowrap">{d.photos_counted ?? (d.status === 'closed' ? 'not counted' : '')}</td>
                      </tr>
                      {d.comments && (
                        <tr className="!border-t-0" style={{ borderTopWidth: 0 }}>
                          <td colSpan={8} className="px-3 pb-2 pt-0 text-xs text-zinc-600 dark:text-zinc-300">{d.comments}</td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={`${hintClass} mt-2`}>
                The camera and the card are the ones the start visit left; the photos are the end visit&rsquo;s count.
                {running > 0 && ` ${running} deployment(s) of the next collection are already running.`}
              </p>
            </div>

            <div>
              <button type="button" className={`${linkButton} text-sm`} aria-expanded={showNotes} onClick={() => setShowNotes((s) => !s)}>
                {showNotes ? 'Hide the details' : 'Show the details'}
              </button>
              {showNotes && (
                <ul className="mt-2 text-xs text-zinc-600 dark:text-zinc-300 space-y-1 font-mono">
                  {result.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              )}
            </div>

            {!written && (
              <>
                {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
                {!projectId && <p className="text-sm text-zinc-600 dark:text-zinc-300">Choose the research project to write the files.</p>}
                <div className="flex justify-end">
                  <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!projectId || busy} onClick={() => void handleWrite()}>
                    {writing && <SmallSpinner />}Write the files
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </WizardStep>

      <WizardStep n={3} title="Files written" status={written ? 'open' : 'locked'} canEdit={false} onEdit={() => {}}
                  description="The updated datasheet beside the original, and the collection's files in its folder.">
        {written && (
          <div className="space-y-3">
            <ul className="space-y-2">
              {(written.files ?? []).map((f) => (
                <li key={f} className="flex items-center gap-3 rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-2">
                  <span className="font-mono text-sm break-all flex-1 min-w-0">{f}</span>
                  <button type="button" className={btnOutline} onClick={() => void api.fieldlogOpenFolder(f).catch((e) => setError(message(e, 'Could not open the folder.')))}>Open folder</button>
                </li>
              ))}
            </ul>
            {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Next: copy the cards of the {closedCount} deployment(s) whose card was collected. When the rest of the collection is visited, download Epicollect
              again and run the field records once more — nothing is added twice.
            </p>
          </div>
        )}
      </WizardStep>
    </div>
  )
}
