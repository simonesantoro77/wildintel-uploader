import { useEffect, useState } from 'react'
import { api } from '../api'
import Combobox from '../components/Combobox'
import { SmallSpinner, btnOutline, btnPrimary } from './ImportDeploymentPage'
import { utc } from './FieldLogPage'
import type { CardDeployment, CardInspection, CardsStatus, LocalResearchProject, TreeFolder } from '../types'

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
 * its deployment, and copied — untouched and checked file by file — into the cards folder, ready for Import session. */
function TripCards() {
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

  const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

  async function chooseProject(id: string) {
    setProjectId(id); setCollections([]); setCollection(''); setStatus(null); setSeen(null); setError(null)
    if (!id) return
    try {
      const { results } = await api.ingestCollections(id)
      setCollections(results)
      if (results.length) void chooseCollection(id, results[0])
    } catch (e) { setError(message(e, 'Could not read the collections.')) }
  }

  async function chooseCollection(project: string, name: string) {
    setCollection(name); setStatus(null); setSeen(null); setError(null)
    if (!name) return
    try { setStatus(await api.ingestPrepare(project, name)) } catch (e) { setError(message(e, 'Could not prepare the cards folder.')) }
  }

  async function browse() {
    try {
      const { path } = await api.browseFolder('Select the SD card')
      if (path) { setSource(path); setSeen(null); setCopied(null) }
    } catch { /* no dialog here: type the path */ }
  }

  async function look() {
    setLooking(true); setSeen(null); setCopied(null); setError(null)
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
      })
      setCopied(chosen); setSeen(null); setSource(''); setLabel('')
      setStatus(await api.ingestStatus(projectId, collection))
    } catch (e) { setError(message(e, 'The copy failed.')) } finally { setCopying(null) }
  }

  const busy = looking || copying !== null
  const blocked = Boolean(seen?.already_copied.length)

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
                <label className={labelClass} htmlFor="cards-label">Label on the card</label>
                <input id="cards-label" className={`${inputClass} w-full font-mono`} value={label} disabled={busy} placeholder="e.g. 17A"
                       onChange={(e) => { setLabel(e.target.value); setSeen(null) }} />
              </div>
            </div>
            <p className={`${hintClass} mt-2`}>The card is only read. Its label, as written on it and noted in the field, helps find its deployment.</p>
            <div className="flex justify-end mt-3">
              <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!source.trim() || busy} onClick={() => void look()}>
                {looking && <SmallSpinner />}Look at the card
              </button>
            </div>

            {copied && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400" role="status">Card copied into {copied}. Put in the next one.</p>}

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
                          <input type="radio" name="cards-deployment" className="mt-1" checked={chosen === c.deployment_id} disabled={c.state === 'copied'}
                                 onChange={() => setChosen(c.deployment_id)} />
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

                {copying && <Progress done={copying.done} total={copying.total} name={copying.name} />}
                {!blocked && (
                  <div className="flex justify-end">
                    <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!chosen || busy} onClick={() => void copy()}>
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
              <span className={hintClass}>{status.counts.copied} copied · {status.counts.to_copy} to copy · {status.counts.out} camera(s) still out</span>
            </div>
            <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50">
                    {['Deployment', '', 'Card', 'Photos counted', 'Copied'].map((h, i) => <th key={i} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}
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
              {status.counts.to_copy === 0 && status.counts.copied > 0
                ? ' Every collected card is copied: import that folder with Import session to check and prepare the images.'
                : ' When every card is copied, import that folder with Import session to check and prepare the images.'}
            </p>
          </section>
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
export default function CardsPage() {
  const [mode, setMode] = useState<'trip' | 'tree'>('trip')
  return (
    <div className="max-w-screen-lg mx-auto px-4 py-8">
      <h2 className="text-xl font-bold mb-1 text-zinc-900 dark:text-zinc-100">Copy SD cards</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-5">
        Guided by the field records: each card is matched to its deployment, copied untouched and checked file by file, and a card is never copied twice
        or into two deployments. The copies are kept apart from the collections, ready for Import session.
      </p>
      <div className="flex gap-2 mb-6" role="tablist">
        {([['trip', 'Cards of a field trip'], ['tree', 'Folders from elsewhere']] as const).map(([value, text]) => (
          <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => setMode(value)}
                  className={`px-4 py-2 text-sm rounded-xl border ${mode === value ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' : 'border-zinc-300 dark:border-zinc-600'}`}>
            {text}
          </button>
        ))}
      </div>
      {mode === 'trip' ? <TripCards /> : <FoldersFromElsewhere />}
    </div>
  )
}
