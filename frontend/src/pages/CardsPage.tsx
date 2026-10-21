import { useEffect, useState } from 'react'
import { api } from '../api'
import Combobox from '../components/Combobox'
import BackButton from '../components/BackButton'
import { SmallSpinner, btnOutline, btnPrimary } from './ImportDeploymentPage'
import NextStep from '../components/NextStep'
import { utc } from './FieldLogPage'
import type { CollectionTarget } from './FieldLogPage'
import type { TimeFixTarget } from './TimeFixPage'
import type { CardDeployment, CardInspection, CardsStatus, FieldCorrection, LocalResearchProject, TreeFolder } from '../types'

const labelClass = 'block text-sm font-semibold mb-1.5 text-zinc-700 dark:text-zinc-300'
const inputClass = 'rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60'
const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400'
const panel = 'rounded-xl border border-zinc-200 dark:border-zinc-700 p-4'

export function size(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1e3))} kB`
}

/** "2026-03-29T12:00:00" (the cameras' clock) as "2026-03-29 12:00". */
function clock(iso: string | null): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '—'
}

const STATE: Record<CardDeployment['state'], [string, string]> = {
  out: ['Camera still out', 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'],
  to_copy: ['Card to copy', 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300'],
  copied: ['✔ Copied', 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'],
  processed: ['✔ Processed', 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'],
}

/** Whether the label on the card in hand is not the one noted in the field for that deployment. */
export function labelMismatch(fieldCard: string | null, label: string): boolean {
  return Boolean(fieldCard) && fieldCard!.trim().toLowerCase() !== label.trim().toLowerCase()
}

/** Where Process collection opens, when it is reached from here: the collection's cards folder. */
export interface ProcessTarget extends CollectionTarget {
  folder: string
}

interface TripProps {
  onFixDates?: (target: TimeFixTarget) => void
  onProcess?: (target: ProcessTarget) => void
  /** The collection to open on, when Copy SD cards is reached from Field records. */
  initial?: CollectionTarget
  /** Out of the task, back to the menu. */
  onBack?: () => void
}

function StateBadge({ state }: { state: CardDeployment['state'] }) {
  const [text, tone] = STATE[state]
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{text}</span>
}

function Progress({ done, total, name }: { done: number; total: number; name: string }) {
  const pct = total ? Math.round((100 * done) / total) : 0
  return (
    <div className="space-y-1" role="status" aria-label="Copy progress">
      <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
        <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className={hintClass}>{done} of {total} files · {name}</p>
    </div>
  )
}

/** The research projects kept in the collections folder, to pick one. */
function useProjects(onError: (m: string) => void) {
  const [projects, setProjects] = useState<LocalResearchProject[]>([])
  useEffect(() => {
    api.listResearchProjects().then(({ results }) => setProjects(results)).catch((e) => onError(e instanceof Error ? e.message : 'Could not read the collections folder.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return projects
}

/** The cards of a field trip: the collection's deployments as the field records say them, a card looked at and matched to
 * its deployment, and copied — untouched and checked file by file — into the cards folder, ready for Process collection. */
/** Whether a copied card's first and last image fall outside its deployment's period (an hour of leeway) — both read as
 * the same clock, UTC. Fix dates and times looks at every image; this is only a first sign. */
export function datesOff(d: CardDeployment): boolean {
  if (!d.copy?.first || !d.copy.last || !d.start || !d.end) return false
  const t = (iso: string) => Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`)
  const hour = 3_600_000
  return t(d.copy.first) < t(d.start) - hour || t(d.copy.last) > t(d.end) + hour
}

function TripCards({ onFixDates, onProcess, initial }: TripProps) {
  const [error, setError] = useState<string | null>(null)
  const projects = useProjects(setError)
  const [projectId, setProjectId] = useState('')
  const [collections, setCollections] = useState<string[]>([])
  const [collection, setCollection] = useState('')
  const [status, setStatus] = useState<CardsStatus | null>(null)
  const [source, setSource] = useState('')
  const [label, setLabel] = useState('')
  const [looking, setLooking] = useState(false)
  const [seen, setSeen] = useState<CardInspection | null>(null)
  const [chosen, setChosen] = useState('')
  const [copying, setCopying] = useState<{ done: number; total: number; name: string } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  // What the dates of the card just copied look like: their problems, when there are any.
  const [dateCheck, setDateCheck] = useState<{ deploymentId: string; problems: string[] } | null>(null)
  // The card in hand has another label than the one noted in the field, and the user says it is the right card.
  const [labelConfirmed, setLabelConfirmed] = useState(false)
  // What happened when the card was ejected after its copy.
  const [ejected, setEjected] = useState<{ ejected: boolean; message: string } | null>(null)
  const [corrections, setCorrections] = useState<FieldCorrection[]>([])

  useEffect(() => {
    if (initial) void chooseProject(initial.researchProjectId, initial.collection)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

  async function chooseProject(id: string, wanted?: string) {
    setProjectId(id); setCollections([]); setCollection(''); setStatus(null); setSeen(null); setError(null)
    if (!id) return
    try {
      const { results } = await api.ingestCollections(id)
      setCollections(results)
      const pick = wanted && results.includes(wanted) ? wanted : results[0]
      if (pick) void chooseCollection(id, pick)
    } catch (e) { setError(message(e, 'Could not read the collections.')) }
  }

  async function readCorrections(project: string, name: string) {
    try { setCorrections((await api.ingestCorrections(project, name)).results) } catch { setCorrections([]) }
  }

  async function chooseCollection(project: string, name: string) {
    setCollection(name); setStatus(null); setSeen(null); setError(null); setCorrections([])
    if (!name) return
    try {
      setStatus(await api.ingestPrepare(project, name))
      void readCorrections(project, name)
    } catch (e) { setError(message(e, 'Could not prepare the cards folder.')) }
  }

  async function browse() {
    try {
      const { path } = await api.browseFolder('Select the SD card')
      if (path) { setSource(path); setSeen(null); setCopied(null); setEjected(null) }
    } catch { /* no dialog here: type the path */ }
  }

  async function look() {
    setLooking(true); setSeen(null); setCopied(null); setError(null); setEjected(null); setLabelConfirmed(false)
    try {
      const result = await api.ingestInspect(projectId, collection, source.trim(), label.trim())
      setSeen(result)
      setChosen(result.already_copied.length ? '' : result.candidates.find((c) => c.state === 'to_copy')?.deployment_id ?? '')
    } catch (e) { setError(message(e, 'Could not read the card.')) } finally { setLooking(false) }
  }

  async function copy() {
    if (!seen || !chosen) return
    setError(null); setCopying({ done: 0, total: seen.file_count, name: '' })
    try {
      await api.ingestCopy(projectId, collection, seen.source, label.trim(), chosen, (event) => {
        if (event.type === 'copy') setCopying({ done: event.index, total: event.total, name: event.name })
      }, false, mismatch && labelConfirmed)
      const card = seen.source
      setCopied(chosen); setSeen(null); setSource(''); setLabel(''); setDateCheck(null); setLabelConfirmed(false)
      setStatus(await api.ingestStatus(projectId, collection))
      if (mismatch) void readCorrections(projectId, collection)
      try { setEjected(await api.ingestEject(card)) } catch { setEjected({ ejected: false, message: 'Eject the card from the system before taking it out.' }) }
      try {
        const timeline = await api.timefixTimeline(projectId, collection, chosen)
        if (!timeline.ok) setDateCheck({ deploymentId: chosen, problems: timeline.problems })
      } catch { /* the dates are checked again when the collection is processed */ }
    } catch (e) { setError(message(e, 'The copy failed.')) } finally { setCopying(null) }
  }

  const busy = looking || copying !== null
  const blocked = Boolean(seen?.already_copied.length)
  const chosenCandidate = seen?.candidates.find((c) => c.deployment_id === chosen)
  const mismatch = Boolean(chosenCandidate) && labelMismatch(chosenCandidate!.card, label)
  const allDone = status !== null && status.counts.to_copy === 0 && (status.counts.copied > 0 || status.counts.processed > 0)

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass} htmlFor="cards-research-project">Research project</label>
          <Combobox id="cards-research-project" options={projects.map((p) => ({ value: p.acronym, label: `${p.acronym} — ${p.name}` }))}
                    value={projectId} onChange={(v) => void chooseProject(v)} disabled={busy}
                    placeholder={projects.length ? 'Select a research project…' : 'No research projects yet'} clearLabel="Clear research project" />
        </div>
        <div>
          <label className={labelClass} htmlFor="cards-collection">Collection</label>
          <Combobox id="cards-collection" options={collections.map((c) => ({ value: c, label: c }))}
                    value={collection} onChange={(v) => void chooseCollection(projectId, v)} disabled={busy || !projectId}
                    placeholder={projectId && !collections.length ? 'No field records yet — run Field records first' : 'Select a collection…'} clearLabel="Clear collection" />
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}

      {status && (
        <>
          <section className={panel} aria-label="Copy a card">
            <h3 className="font-semibold mb-3">Copy a card</h3>
            <div className="grid sm:grid-cols-[1fr_12rem] gap-4">
              <div>
                <label className={labelClass} htmlFor="cards-source">The card</label>
                <div className="flex gap-2">
                  <input id="cards-source" className={`${inputClass} flex-1 min-w-0 font-mono`} value={source} disabled={busy} placeholder="E:\ or /Volumes/NO NAME"
                         onChange={(e) => { setSource(e.target.value); setSeen(null) }} />
                  <button type="button" className={btnOutline} disabled={busy} onClick={() => void browse()}>Browse…</button>
                </div>
              </div>
              <div>
                <label className={labelClass} htmlFor="cards-label">Label on the card <span className="text-red-600">*</span></label>
                <input id="cards-label" className={`${inputClass} w-full font-mono`} value={label} disabled={busy} placeholder="e.g. 17A" required
                       onChange={(e) => { setLabel(e.target.value); setSeen(null) }} />
              </div>
            </div>
            <p className={`${hintClass} mt-2`}>The card is only read. Type the label written on it: it is checked against the one noted in the field.</p>
            <div className="flex justify-end mt-3">
              <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!source.trim() || !label.trim() || busy} onClick={() => void look()}>
                {looking && <SmallSpinner />}Look at the card
              </button>
            </div>

            {copied && (
              <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400" role="status">
                Card copied into {copied}. {ejected?.ejected ? `${ejected.message} Put in the next one.` : 'Put in the next one.'}
              </p>
            )}
            {copied && ejected && !ejected.ejected && <p className={`${hintClass} mt-1`}>{ejected.message}</p>}
            {dateCheck && (
              <div className="mt-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm" role="alert" aria-label="Dates of the card">
                <p className="font-semibold text-amber-900 dark:text-amber-200">The dates of {dateCheck.deploymentId} don&rsquo;t look right:</p>
                <ul className="list-disc pl-5 text-amber-900/90 dark:text-amber-200/90">{dateCheck.problems.map((p) => <li key={p}>{p}</li>)}</ul>
                {onFixDates && (
                  <button type="button" className={`${btnOutline} mt-2`} onClick={() => onFixDates({ researchProjectId: projectId, collection, deploymentId: dateCheck.deploymentId })}>
                    Check and fix dates and times of {dateCheck.deploymentId}
                  </button>
                )}
              </div>
            )}

            {seen && (
              <div className="mt-4 space-y-4">
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    ['Files', `${seen.file_count} · ${size(seen.total_bytes)}`],
                    ['Images · videos', `${seen.image_count} · ${seen.video_count}`],
                    ['First → last image', `${clock(seen.first)} → ${clock(seen.last)}`],
                    ['Camera', seen.camera_models.join(', ') || '—'],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-2 min-w-0">
                      <dt className={hintClass}>{k}</dt>
                      <dd className="text-sm font-semibold tabular-nums break-words">{v}</dd>
                    </div>
                  ))}
                </dl>
                {seen.undated > 0 && <p className="text-sm text-amber-800 dark:text-amber-300">{seen.undated} image(s) have no date in their EXIF.</p>}

                {blocked && (
                  <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-800 dark:text-red-300" role="alert">
                    This card was copied already, as <strong className="font-mono">{seen.already_copied[0].deployment_id}</strong> ({seen.already_copied[0].copied_at}). It is not copied twice.
                  </div>
                )}

                {!blocked && (
                  <fieldset>
                    <legend className={labelClass}>Which deployment is it?</legend>
                    {seen.candidates.length === 0 && <p className="text-sm text-zinc-600 dark:text-zinc-300">No deployment of {seen.collection} has its card collected.</p>}
                    <div className="space-y-2">
                      {seen.candidates.map((c, i) => (
                        <label key={c.deployment_id} className={`flex gap-3 rounded-lg border p-3 cursor-pointer ${chosen === c.deployment_id ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30' : 'border-zinc-200 dark:border-zinc-700'}`}>
                          <input type="radio" name="cards-deployment" className="mt-1" checked={chosen === c.deployment_id}
                                 onChange={() => { setChosen(c.deployment_id); setLabelConfirmed(false) }} />
                          <span className="flex-1 min-w-0">
                            <span className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-semibold">{c.deployment_id}</span>
                              {i === 0 && c.problems.length === 0 && <span className="text-xs text-emerald-700 dark:text-emerald-400">best match</span>}
                              <span className={hintClass}>card {c.card ?? '—'} · {utc(c.start)} → {utc(c.end)}</span>
                            </span>
                            {c.fits.map((f) => <span key={f} className="block text-xs text-emerald-700 dark:text-emerald-400">✓ {f}</span>)}
                            {c.problems.map((p) => <span key={p} className="block text-xs text-amber-800 dark:text-amber-300">⚠ {p}</span>)}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}

                {!blocked && mismatch && chosenCandidate && (
                  <div className="rounded-lg border-2 border-red-500 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-800 dark:text-red-300" role="alert" aria-label="Card label">
                    <p className="font-semibold">
                      The label does not match: the card in your hand is <span className="font-mono">{label.trim()}</span>, but the field records
                      say <span className="font-mono">{chosenCandidate.card}</span> for {chosenCandidate.deployment_id}.
                    </p>
                    <p className="mt-1">Check the card. If it is the right one, confirm it: the difference is written down in the copy record and in the list of corrections for the field data.</p>
                    <label className="mt-2 flex items-center gap-2 font-semibold">
                      <input type="checkbox" checked={labelConfirmed} onChange={(e) => setLabelConfirmed(e.target.checked)} />
                      It is the card of {chosenCandidate.deployment_id}: copy it anyway
                    </label>
                  </div>
                )}

                {copying && <Progress done={copying.done} total={copying.total} name={copying.name} />}
                {!blocked && (
                  <div className="flex justify-end">
                    <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!chosen || busy || (mismatch && !labelConfirmed)} onClick={() => void copy()}>
                      {copying && <SmallSpinner />}{chosen ? `Copy into ${chosen}` : 'Choose its deployment'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          <section aria-label="Cards of the collection">
            <div className="flex items-center gap-3 flex-wrap mb-2">
              <h3 className="font-semibold mr-auto">Cards of {status.collection}</h3>
              <span className={hintClass}>
                {status.counts.copied} copied · {status.counts.to_copy} to copy · {status.counts.out} camera(s) still out
                {status.counts.processed > 0 && ` · ${status.counts.processed} processed`}
              </span>
            </div>
            <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50">
                    {['Deployment', '', 'Card (field)', 'Photos counted', 'Copied'].map((h, i) => <th key={i} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                  {status.deployments.map((d) => (
                    <tr key={d.deployment_id}>
                      <td className="px-3 py-2 font-mono whitespace-nowrap">{d.deployment_id}</td>
                      <td className="px-3 py-2"><StateBadge state={d.state} /></td>
                      <td className="px-3 py-2 font-mono">{d.card ?? '—'}</td>
                      <td className="px-3 py-2 tabular-nums">{d.photos_counted ?? '—'}</td>
                      <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                        {d.copy ? `${d.copy.file_count} files · ${size(d.copy.total_bytes)} · ${utc(d.copy.copied_at)}${d.copy.card_label ? ` · card ${d.copy.card_label}` : ''}` : ''}
                        {datesOff(d) && (
                          <span className="block text-amber-800 dark:text-amber-300">
                            ⚠ Images outside its period{' '}
                            {onFixDates && <button type="button" className="underline" onClick={() => onFixDates({ researchProjectId: projectId, collection: status.collection, deploymentId: d.deployment_id })}>Fix dates</button>}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {status.unexpected.map((u) => (
                    <tr key={u.deployment_id}>
                      <td className="px-3 py-2 font-mono">{u.deployment_id}</td>
                      <td className="px-3 py-2" colSpan={4}><span className="text-xs text-amber-800 dark:text-amber-300">Copied, but not in the field records of {status.collection}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={`${hintClass} mt-2`}>
              The cards are copied into <span className="font-mono break-all">{status.cards_dir}</span>, with the collection&rsquo;s FileTimestampLog beside them.
            </p>
          </section>

          {corrections.length > 0 && (
            <section className="rounded-xl border-2 border-red-400 dark:border-red-700 p-4" aria-label="Corrections for the field data">
              <h3 className="font-semibold text-red-800 dark:text-red-300">Corrections for the field data</h3>
              <p className={`${hintClass} mb-2`}>
                What the cards showed differently from the field records. Correct it in the field data (the field app and the datasheet); the list is kept
                in <span className="font-mono">field_corrections.csv</span> in the cards folder.
              </p>
              <ul className="text-sm space-y-1">
                {corrections.map((c, i) => (
                  <li key={i}><span className="font-mono">{c.deployment}</span>: {c.what} is <span className="font-mono font-semibold">{c.found}</span>, not <span className="font-mono">{c['field records say']}</span> as noted in the field.</li>
                ))}
              </ul>
            </section>
          )}

          <NextStep n={3} title="Process collection"
                    onGo={allDone ? (onProcess && (() => onProcess({ researchProjectId: projectId, collection: status.collection, folder: status.cards_dir }))) : undefined}>
            {allDone
              ? 'Every collected card is copied. Process the cards folder to check the images and prepare the deployments for Trapper.'
              : `Copy the ${status.counts.to_copy} card(s) left first. If a card\u2019s dates look wrong, check and fix them from the warning, then come back here.`}
          </NextStep>
        </>
      )}
    </div>
  )
}

/** Folders that come from elsewhere — a deployment per folder, somewhere in a tree organized another way: each one gets
 * its collection and site (guessed from its path) and is copied into the cards folder like a card. */
function FoldersFromElsewhere() {
  const [error, setError] = useState<string | null>(null)
  const projects = useProjects(setError)
  const [projectId, setProjectId] = useState('')
  const [root, setRoot] = useState('')
  const [folders, setFolders] = useState<(TreeFolder & { include: boolean; result?: string; failed?: boolean })[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [copying, setCopying] = useState<{ index: number; done: number; total: number; name: string } | null>(null)

  const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

  async function browse() {
    try {
      const { path } = await api.browseFolder('Select the folder that holds the images')
      if (path) { setRoot(path); setFolders(null) }
    } catch { /* type it */ }
  }

  async function scan() {
    setScanning(true); setError(null); setFolders(null)
    try {
      const { folders: found } = await api.ingestScanTree(root.trim(), projectId || null)
      setFolders(found.map((f) => ({ ...f, include: Boolean(f.deployment_id) })))
    } catch (e) { setError(message(e, 'Could not read the folder.')) } finally { setScanning(false) }
  }

  const update = (i: number, change: Partial<TreeFolder & { include: boolean }>) => setFolders((fs) => fs && fs.map((f, j) => {
    if (j !== i) return f
    const next = { ...f, ...change }
    const collection = (next.collection ?? '').trim().toUpperCase()
    const site = (next.site ?? '').trim()
    return { ...next, deployment_id: /^R\d{4}$/.test(collection) && site ? `${collection}-${site}` : null }
  }))

  const chosen = (folders ?? []).filter((f) => f.include && f.deployment_id && !f.result)

  async function copyAll() {
    if (!folders) return
    setError(null)
    for (let i = 0; i < folders.length; i++) {
      const f = folders[i]
      if (!f.include || !f.deployment_id || f.result) continue
      setCopying({ index: i, done: 0, total: f.file_count, name: '' })
      try {
        await api.ingestCopy(projectId, f.deployment_id.slice(0, 5), f.path, '', f.deployment_id, (event) => {
          if (event.type === 'copy') setCopying({ index: i, done: event.index, total: event.total, name: event.name })
        }, true)
        setFolders((fs) => fs && fs.map((x, j) => (j === i ? { ...x, result: 'Copied' } : x)))
      } catch (e) {
        setFolders((fs) => fs && fs.map((x, j) => (j === i ? { ...x, result: message(e, 'The copy failed.'), failed: true } : x)))
      }
    }
    setCopying(null)
  }

  const busy = scanning || copying !== null
  return (
    <div className="space-y-5">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        For images organized some other way — say, a folder per site with a folder per collection inside. Each folder with images is a deployment: give it its
        collection and site (guessed from its path when the names say them) and it is copied into the cards folder as <span className="font-mono">R000N/R000N-SITE</span>,
        the same as a card. The folders you choose are only read.
      </p>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass} htmlFor="tree-research-project">Research project</label>
          <Combobox id="tree-research-project" options={projects.map((p) => ({ value: p.acronym, label: `${p.acronym} — ${p.name}` }))}
                    value={projectId} onChange={(v) => { setProjectId(v); setFolders(null) }} disabled={busy}
                    placeholder="Select a research project…" clearLabel="Clear research project" />
        </div>
        <div>
          <label className={labelClass} htmlFor="tree-root">Folder</label>
          <div className="flex gap-2">
            <input id="tree-root" className={`${inputClass} flex-1 min-w-0 font-mono`} value={root} disabled={busy} onChange={(e) => { setRoot(e.target.value); setFolders(null) }} />
            <button type="button" className={btnOutline} disabled={busy} onClick={() => void browse()}>Browse…</button>
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!projectId || !root.trim() || busy} onClick={() => void scan()}>
          {scanning && <SmallSpinner />}Find the folders with images
        </button>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}

      {folders && (
        <div className="space-y-3">
          {folders.length === 0 && <p className="text-sm text-zinc-600 dark:text-zinc-300">No folder with images there.</p>}
          {folders.length > 0 && (
            <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50">
                    {['', 'Folder', 'Images', 'Collection', 'Site', 'Deployment', ''].map((h, i) => <th key={i} scope="col" className="px-3 py-2 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                  {folders.map((f, i) => (
                    <tr key={f.path}>
                      <td className="px-3 py-2"><input type="checkbox" aria-label={`Copy ${f.relative}`} checked={f.include} disabled={busy || Boolean(f.result)} onChange={(e) => update(i, { include: e.target.checked })} /></td>
                      <td className="px-3 py-2 font-mono text-xs break-all">{f.relative}</td>
                      <td className="px-3 py-2 tabular-nums">{f.image_count}</td>
                      <td className="px-3 py-2"><input aria-label={`Collection of ${f.relative}`} className={`${inputClass} w-24 font-mono py-1`} value={f.collection ?? ''} placeholder="R0001" disabled={busy || Boolean(f.result)} onChange={(e) => update(i, { collection: e.target.value })} /></td>
                      <td className="px-3 py-2"><input aria-label={`Site of ${f.relative}`} className={`${inputClass} w-36 font-mono py-1`} value={f.site ?? ''} placeholder="DONA_0007" disabled={busy || Boolean(f.result)} onChange={(e) => update(i, { site: e.target.value })} /></td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{f.deployment_id ?? '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        {copying?.index === i ? `${copying.done}/${copying.total}` : f.result && <span className={f.failed ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}>{f.result}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex justify-end">
            <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={chosen.length === 0 || busy} onClick={() => void copyAll()}>
              {copying && <SmallSpinner />}Copy {chosen.length} folder(s)
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Copying the SD cards — between the field records and the import. */
export default function CardsPage({ onFixDates, onProcess, initial, onBack }: TripProps = {}) {
  const [mode, setMode] = useState<'trip' | 'tree'>('trip')
  return (
    <div className="max-w-screen-lg mx-auto px-4 py-8">
      <h2 className="text-xl font-bold mb-1 text-zinc-900 dark:text-zinc-100">Copy SD cards</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-5">
        Guided by the field records: each card is matched to its deployment, copied untouched and checked file by file, and a card is never copied twice
        or into two deployments. The copies are kept apart from the collections, ready for Process collection.
      </p>
      <div className="flex gap-2 mb-6" role="tablist">
        {([['trip', 'Cards of a field trip'], ['tree', 'Folders from elsewhere']] as const).map(([value, text]) => (
          <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => setMode(value)}
                  className={`px-4 py-2 text-sm rounded-xl border ${mode === value ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' : 'border-zinc-300 dark:border-zinc-600'}`}>
            {text}
          </button>
        ))}
      </div>
      {mode === 'trip' ? <TripCards onFixDates={onFixDates} onProcess={onProcess} initial={initial} /> : <FoldersFromElsewhere />}
      {onBack && <div className="mt-10"><BackButton onClick={onBack} /></div>}
    </div>
  )
}
