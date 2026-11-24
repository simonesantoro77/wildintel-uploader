import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import ChoiceCards from '../components/ChoiceCards'
import Combobox from '../components/Combobox'
import PickTable, { LabelFrame, PickedTick } from '../components/PickTable'
import { formatBytes } from '../components/PrepareFiles'
import { PageHeader, UTIL_ICONS } from '../components/TaskCard'
import WizardStep from '../components/WizardStep'
import { defaultResearchProject } from '../defaultResearchProject'
import { formatInstant } from '../dateFormat'
import type { BackupManifest, BackupProjectInfo, BackupRead, LocalResearchProject, RestoreSummary } from '../types'
import { SmallSpinner, btnOutline, btnPrimary, hintClass } from './ImportDeploymentPage'
import { PAGE_CLASS } from '../components/PageBar'

type Mode = 'backup' | 'restore'

interface Props {
  onBack: () => void
  onOpenSettings?: (section?: 'general') => void
  settingsOpen?: boolean
}

const when = (iso: string) => formatInstant(iso)
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** A row with a check: what it is, a few words more, and a note at the right. */
function CheckRow({ label, hint, note, checked, onChange, disabled = false }: { label: string; hint?: ReactNode; note?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 rounded-lg px-3 py-2.5 ${disabled ? 'opacity-50' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60 cursor-pointer'}`}>
      <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
        {hint && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
      </span>
      {note && <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">{note}</span>}
    </label>
  )
}

/** The switch of an option. */
function Option({ label, hint, checked, onChange, disabled = false }: { label: string; hint: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-6 rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{label}</p>
        <p className={`${hintClass} mt-0.5`}>{hint}</p>
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
              className={`relative w-11 h-6 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-600'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  )
}

/** What a backup holds, as a list — for the one just read and the one just made. */
function ManifestList({ manifest }: { manifest: BackupManifest }) {
  const { scope, counts } = manifest
  const items = [
    scope.settings && 'The global settings (without passwords)',
    scope.project_files && `The data of ${scope.research_project}: ${[counts.locations != null && plural(counts.locations, 'location', 'locations'), counts.cameras != null && plural(counts.cameras, 'camera', 'cameras'), counts.sd_cards != null && plural(counts.sd_cards, 'SD card', 'SD cards')].filter(Boolean).join(', ')}`,
    scope.visits && `The list of visits of ${scope.research_project}${counts.visits != null ? ` (${counts.visits})` : ''}`,
    scope.deployments.length > 0 && `${plural(scope.deployments.length, 'deployment', 'deployments')} of ${scope.research_project}, ${scope.images ? 'with their images' : 'without their images'}`,
  ].filter(Boolean) as string[]
  return <ul className="list-disc pl-5 text-sm space-y-0.5">{items.map((i) => <li key={i}>{i}</li>)}</ul>
}

/** Backups and their restoration: the global settings and the data of a research project — its locations, cameras, SD cards, visits and the deployments chosen, with or
 * without their images — in a .zip that says what it holds; and the restoration of what is picked from one. */
export default function BackupPage({ onBack, settingsOpen }: Props) {
  const [mode, setMode] = useState<Mode | null>(null)

  // ── making a backup ──
  const [projects, setProjects] = useState<LocalResearchProject[]>([])
  const [projectId, setProjectId] = useState('')
  const [info, setInfo] = useState<BackupProjectInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [withSettings, setWithSettings] = useState(true)
  const [withProjectFiles, setWithProjectFiles] = useState(true)
  const [withVisits, setWithVisits] = useState(true)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  // the revisions picked: their deployments are the ones that can be chosen — all of them at first
  const [pickedRevisions, setPickedRevisions] = useState<Set<string>>(new Set())
  const [withImages, setWithImages] = useState(false)
  const [selectionDone, setSelectionDone] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null)
  const [made, setMade] = useState<{ path: string; bytes: number; manifest: BackupManifest; download: string | null } | null>(null)

  // ── restoring ──
  const [filePath, setFilePath] = useState('')
  const [read, setRead] = useState<BackupRead | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [rSettings, setRSettings] = useState(false)
  const [rProjectFiles, setRProjectFiles] = useState(false)
  const [rVisits, setRVisits] = useState(false)
  const [rChosen, setRChosen] = useState<Set<string>>(new Set())
  const [rImages, setRImages] = useState(false)
  const [replace, setReplace] = useState(false)
  const [restored, setRestored] = useState<RestoreSummary | null>(null)

  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listResearchProjects().then(({ results }) => setProjects(results)).catch(() => {})
    void defaultResearchProject().then((acronym) => { if (acronym) setProjectId((p) => p || acronym) }).catch(() => {})
  }, [settingsOpen])

  useEffect(() => {
    setInfo(null); setInfoError(null); setChosen(new Set()); setPickedRevisions(new Set()); setSelectionDone(false)
    if (!projectId || mode !== 'backup') return
    let cancelled = false
    api.backupProjectInfo(projectId)
      .then((found) => { if (!cancelled) setInfo(found) })
      .catch((e) => { if (!cancelled) setInfoError(e instanceof Error ? e.message : 'Could not read the research project.') })
    return () => { cancelled = true }
  }, [projectId, mode])

  function startOver() {
    setMode(null); setSelectionDone(false); setMade(null); setRestored(null); setRead(null); setFilePath(''); setError(null); setReadError(null); setProgress(null)
  }

  // ── what goes in ──
  const allDeployments = (info?.collections ?? []).flatMap((c) => c.deployments)
  const picked = allDeployments.filter((d) => chosen.has(d.id))
  // the deployments of the revisions picked, with the revision they are of
  const everyDeployment = (info?.collections ?? []).filter((c) => pickedRevisions.has(c.name)).flatMap((c) => c.deployments.map((d) => ({ ...d, revision: c.name })))
  const imageBytes = picked.reduce((n, d) => n + d.image_bytes, 0)
  const pickedBytes = picked.reduce((n, d) => n + d.bytes - (withImages ? 0 : d.image_bytes), 0)
  const hasProject = Boolean(projectId)
  const somethingToBackUp = withSettings || (hasProject && (withProjectFiles || withVisits || chosen.size > 0))
  const toggle = (set: Set<string>, id: string, on: boolean) => { const next = new Set(set); if (on) next.add(id); else next.delete(id); return next }

  async function makeBackup() {
    setError(null); setRunning(true); setProgress(null); setMade(null)
    try {
      await api.backupCreate({
        settings: withSettings, research_project_id: hasProject ? projectId : null, project_files: hasProject && withProjectFiles, visits: hasProject && withVisits,
        deployments: hasProject ? [...chosen] : [], images: withImages,
      }, (e) => {
        if (e.type === 'file') setProgress({ index: e.index, total: e.total })
        if (e.type === 'done') { setMade({ path: e.path, bytes: e.bytes, manifest: e.manifest, download: e.download ?? null }); if (e.download) saveFile(e.download) }
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The backup failed.')
    } finally {
      setRunning(false)
    }
  }

  /** Asks the browser for the backup: it shows what it shows for a download. */
  function saveFile(name: string) {
    const link = document.createElement('a')
    link.href = api.backupDownloadUrl(name)
    link.download = name
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  // ── what comes out ──
  async function chooseFile() {
    setReadError(null); setRead(null); setRestored(null)
    let path: string | null
    try {
      path = (await api.backupPickFile()).path
    } catch (e) {
      setReadError(e instanceof Error ? e.message : 'Could not open the file dialog.')
      return
    }
    if (!path) return
    setFilePath(path)
    try {
      const found = await api.backupRead(path)
      setRead(found)
      const scope = found.manifest.scope
      setRSettings(scope.settings); setRProjectFiles(scope.project_files); setRVisits(scope.visits)
      setRChosen(new Set(scope.deployments.map((d) => d.id)))
      setRImages(Object.values(found.has_images).some(Boolean)); setReplace(false)
    } catch (e) {
      setReadError(e instanceof Error ? e.message : 'Could not read that file.')
    }
  }

  const conflicts = read ? [
    ...(rProjectFiles && read.here.project ? ['the research project'] : []),
    ...(rVisits && read.here.visits.already > 0 ? [`${plural(read.here.visits.already, 'visit', 'visits')}`] : []),
    ...[...rChosen].filter((id) => read.here.deployments[id]).map((id) => id),
  ] : []

  async function restore() {
    if (!read) return
    setError(null); setRunning(true); setProgress(null); setRestored(null)
    try {
      await api.backupRestore({
        path: filePath, settings: rSettings, project_files: rProjectFiles, visits: rVisits, deployments: [...rChosen], images: rImages, replace,
      }, (e) => {
        if (e.type === 'file') setProgress({ index: e.index, total: e.total })
        if (e.type === 'done') setRestored(e.summary)
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The restoration failed.')
    } finally {
      setRunning(false)
    }
  }

  const scope = read?.manifest.scope
  const somethingToRestore = rSettings || rProjectFiles || rVisits || rChosen.size > 0
  const bar = progress && (
    <div role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.index} className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
      <div className="h-2 bg-blue-500" style={{ width: `${Math.round((progress.index / progress.total) * 100)}%` }} />
    </div>
  )

  return (
    <div className={PAGE_CLASS}>
      <PageHeader icon={UTIL_ICONS.backup} title="Backup and restore" parent="Utilities" onParent={onBack}
        description="Keep a research project in a file, and restore it from there." />

      <WizardStep n={1} title="What do you want to do?" status={mode ? 'done' : 'open'} canEdit={!running} onEdit={startOver}
                  summary={mode === 'backup' ? 'Make a backup' : mode === 'restore' ? 'Restore a backup' : undefined} description="Make a copy of what you have, or put back what a copy holds.">
        <ChoiceCards<Mode> label="What do you want to do?" value={mode} onChange={setMode}
          choices={[
            { value: 'backup', label: 'Make a backup', description: 'Keep the settings and the data of a research project in a file', icon: <><path d="M12 3v12M8 11l4 4 4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></> },
            { value: 'restore', label: 'Restore a backup', description: 'Put back what a backup file holds', icon: <><path d="M12 21V9M8 13l4-4 4 4" /><path d="M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" /></> },
          ]} />
      </WizardStep>

      {mode === 'backup' && (
        <>
          <WizardStep n={2} title="What do you want to back up?" status={selectionDone ? 'done' : 'open'} canEdit={!running} onEdit={() => { setSelectionDone(false); setMade(null) }}
                      summary={made === null && selectionDone ? `${[withSettings && 'settings', hasProject && withProjectFiles && 'project data', hasProject && withVisits && 'visits', hasProject && chosen.size > 0 && plural(chosen.size, 'deployment', 'deployments')].filter(Boolean).join(' · ')}${withImages && chosen.size > 0 ? ' · with images' : ''}` : undefined}
                      description="The settings, and the data of a research project: its visits and the deployments you choose.">
            <div className="space-y-4">
              <CheckRow label="The global settings" hint="Without passwords or secrets, and without the folders of this computer." checked={withSettings} onChange={setWithSettings} />
              <div>
                <label htmlFor="backup-project" className="block text-sm font-semibold mb-1.5 text-zinc-700 dark:text-zinc-300">Research project</label>
                <Combobox id="backup-project" options={projects.map((p) => ({ value: p.acronym, label: `${p.acronym} — ${p.name}` }))} value={projectId} onChange={setProjectId}
                          placeholder={projects.length === 0 ? 'No research projects yet' : 'Select a research project…'} clearLabel="Clear research project" />
                <p className={hintClass}>Leave it empty to back up only the settings.</p>
                {infoError && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{infoError}</p>}
              </div>
              {hasProject && !info && !infoError && <p className="text-sm text-zinc-500 dark:text-zinc-400">Reading {projectId}…</p>}
              {hasProject && info && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-2">
                    <CheckRow label="The data of the research project" hint="The research project itself, its locations, its cameras and its SD cards."
                              note={`${plural(info.locations, 'location', 'locations')} · ${plural(info.cameras, 'camera', 'cameras')} · ${plural(info.sd_cards, 'SD card', 'SD cards')}`} checked={withProjectFiles} onChange={setWithProjectFiles} />
                    <CheckRow label="The list of visits" note={plural(info.visits, 'visit', 'visits')} checked={withVisits} onChange={setWithVisits} />
                  </div>
                  {info.collections.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">{projectId} has no deployments yet.</p>}
                  {info.collections.length > 0 && (
                    <>
                      <div>
                        <p className="mb-2 text-sm font-semibold">Revisions</p>
                        <PickTable
                          items={info.collections} keyOf={(c) => c.name}
                          many={{
                            selected: pickedRevisions, noun: 'revisions', selectable: (c) => c.deployments.length > 0,
                            detail: (rs) => plural(rs.reduce((n, c) => n + c.deployments.length, 0), 'deployment', 'deployments'),
                            // picking a revision puts its deployments in the backup — they are then chosen among —, and letting it go takes them out
                            onChange: (next) => {
                              setChosen((cur) => {
                                const out = new Set(cur)
                                for (const c of info.collections) {
                                  const was = pickedRevisions.has(c.name), now = next.has(c.name)
                                  if (was !== now) c.deployments.forEach((d) => (now ? out.add(d.id) : out.delete(d.id)))
                                }
                                return out
                              })
                              setPickedRevisions(next)
                            },
                          }}
                          columns={[
                            { label: 'Revision', className: 'px-4 py-3 font-mono text-sm', cell: (c) => c.name },
                            { label: 'Deployments', cell: (c) => plural(c.deployments.length, 'deployment', 'deployments') },
                            { label: 'Size', className: 'px-4 py-3 whitespace-nowrap', cell: (c) => formatBytes(c.deployments.reduce((n, d) => n + d.bytes, 0)) },
                          ]}
                          searchText={(c) => c.name}
                          renderLabel={(c, on, press) => (
                            <LabelFrame picked={on} name={`Revision ${c.name}`} onPress={press}>
                              <span className="flex items-start justify-between gap-2"><span className="font-mono text-sm font-semibold">{c.name}</span>{on && <PickedTick />}</span>
                              <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{plural(c.deployments.length, 'deployment', 'deployments')} · {formatBytes(c.deployments.reduce((n, d) => n + d.bytes, 0))}</span>
                            </LabelFrame>)}
                          names={{ table: 'Revisions', search: 'Search the revisions', items: 'revisions', pick: (c) => `Revision ${c.name}`, pickPlaceholder: 'Type to pick a revision…' }}
                          optionLabel={(c) => `${c.name} · ${plural(c.deployments.length, 'deployment', 'deployments')}`} searchPlaceholder="Search by revision…" empty="No revision matches." perPage={5}
                        />
                      </div>
                      <div>
                        <p className="mb-2 text-sm font-semibold">Deployments</p>
                        {everyDeployment.length === 0 ? <p className="text-sm text-zinc-500 dark:text-zinc-400">Pick a revision to choose among its deployments.</p> : (
                        <PickTable
                          items={everyDeployment} keyOf={(d) => d.id}
                          many={{ selected: chosen, onChange: setChosen, noun: 'deployments', detail: (ds) => formatBytes(ds.reduce((n, d) => n + d.bytes, 0)) }}
                          columns={[
                            { label: 'Deployment', className: 'px-4 py-3 font-mono text-sm', cell: (d) => d.id },
                            { label: 'Revision', cell: (d) => d.revision },
                            { label: 'Size', className: 'px-4 py-3 whitespace-nowrap', cell: (d) => formatBytes(d.bytes) },
                            { label: 'Images', className: 'px-4 py-3 whitespace-nowrap', cell: (d) => (d.images > 0 ? plural(d.images, 'image', 'images') : '—') },
                          ]}
                          searchText={(d) => `${d.id} ${d.revision}`}
                          renderLabel={(d, on, press) => (
                            <LabelFrame picked={on} name={d.id} onPress={press}>
                              <span className="flex items-start justify-between gap-2"><span className="font-mono text-sm font-semibold">{d.id}</span>{on && <PickedTick />}</span>
                              <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{d.revision} · {formatBytes(d.bytes)}{d.images > 0 ? ` · ${plural(d.images, 'image', 'images')}` : ''}</span>
                            </LabelFrame>)}
                          names={{ table: 'Deployments', search: 'Search the deployments', items: 'deployments', pick: (d) => d.id, pickPlaceholder: 'Type to pick a deployment…' }}
                          optionLabel={(d) => `${d.id} · ${formatBytes(d.bytes)}`} searchPlaceholder="Search by deployment or revision…" empty="No deployment matches." perPage={8}
                        />
                        )}
                      </div>
                    </>
                  )}
                  <Option label="Include the images of the deployments" checked={withImages} onChange={setWithImages} disabled={chosen.size === 0}
                          hint={chosen.size === 0 ? 'Choose a deployment first.' : withImages ? `The images go in: ${formatBytes(imageBytes)} more. The backup is about ${formatBytes(pickedBytes)}.` : `Off: only what describes each deployment goes in (${formatBytes(pickedBytes)}); its images (${formatBytes(imageBytes)}) stay out.`} />
                </div>
              )}
              <div className="flex justify-end">
                <button type="button" className={btnPrimary} disabled={!somethingToBackUp || (hasProject && !info)} onClick={() => setSelectionDone(true)}>Continue<span aria-hidden="true"> →</span></button>
              </div>
            </div>
          </WizardStep>

          <WizardStep n={3} title="Make the backup" status={!selectionDone ? 'locked' : running ? 'running' : made ? 'done' : error ? 'error' : 'open'} canEdit={false} onEdit={() => {}} expanded={Boolean(made)}
                      description="What is going to be done. The backup is a .zip that your browser downloads.">
            <div className="space-y-4">
              <section aria-label="What the backup will hold" className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/30 p-5">
                <h6 className="mb-3 border-b border-zinc-200 dark:border-zinc-700 pb-3 text-sm font-bold uppercase tracking-wide text-zinc-800 dark:text-zinc-100">It will hold</h6>
                <ul className="space-y-1.5 text-sm text-zinc-800 dark:text-zinc-200">
                  {withSettings && <li>The global settings <span className="text-zinc-500 dark:text-zinc-400">(without the passwords)</span></li>}
                  {hasProject && withProjectFiles && info && <li>The data of <span className="font-mono">{projectId}</span>: {plural(info.locations, 'location', 'locations')}, {plural(info.cameras, 'camera', 'cameras')}, {plural(info.sd_cards, 'SD card', 'SD cards')}</li>}
                  {hasProject && withVisits && info && <li>The list of visits of <span className="font-mono">{projectId}</span> ({info.visits})</li>}
                  {hasProject && chosen.size > 0 && (
                    <li>{plural(chosen.size, 'deployment', 'deployments')} of <span className="font-mono">{projectId}</span>, {withImages ? 'with their images' : 'without their images'}
                      <span className="text-zinc-500 dark:text-zinc-400"> — about {formatBytes(pickedBytes)}</span></li>
                  )}
                </ul>
              </section>
              <div className="flex items-center justify-between gap-3">
                <button type="button" className={`${btnOutline} inline-flex items-center gap-2`} disabled={running} onClick={() => { setSelectionDone(false); setMade(null); setError(null) }}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
                  Back
                </button>
                <div className="flex items-center gap-3">
                  {running && <span className="inline-flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400"><SmallSpinner />Making the backup…</span>}
                  <button type="button" className={`${btnPrimary} inline-flex items-center gap-2`} disabled={running || !somethingToBackUp} onClick={() => void makeBackup()}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v12M7 11l5 5 5-5M4 20h16" /></svg>
                    Make the backup
                  </button>
                </div>
              </div>
              {bar}
              {error && !made && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              {made && (
                <div role="status" className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-4 text-emerald-900 dark:text-emerald-200">
                  <p className="text-sm font-semibold">Backup made — {formatBytes(made.bytes)}</p>
                  <p className="mt-1 text-xs">Your browser is downloading it{made.download ? <>: <span className="font-mono break-all">{made.download}</span></> : '.'}</p>
                  <div className="mt-3 text-emerald-900 dark:text-emerald-200"><ManifestList manifest={made.manifest} /></div>
                  <div className="mt-3 flex gap-2">
                    {made.download && <button type="button" className={btnOutline} onClick={() => saveFile(made.download!)}>Download again</button>}
                    <button type="button" className={btnOutline} onClick={startOver}>Done</button>
                  </div>
                </div>
              )}
            </div>
          </WizardStep>
        </>
      )}

      {mode === 'restore' && (
        <>
          <WizardStep n={2} title="Which backup?" status={read ? 'done' : 'open'} canEdit={!running} onEdit={() => { setRead(null); setRestored(null) }} summary={filePath}
                      description="The file a backup was kept in. It says what it holds.">
            <div className="space-y-4">
              <button type="button" className={btnOutline} onClick={() => void chooseFile()}>Choose the backup…</button>
              {readError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{readError}</p>}
            </div>
          </WizardStep>

          <WizardStep n={3} title="What do you want to restore?" status={!read ? 'locked' : running ? 'running' : restored ? 'done' : error ? 'error' : 'open'} canEdit={false} onEdit={() => {}} expanded={Boolean(restored)}
                      description="What the backup holds, and what of it you want back.">
            {read && scope && (
              <div className="space-y-4">
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                  <p className="text-sm font-semibold">Made on {when(read.manifest.created_at)}, by version {read.manifest.app_version}</p>
                  <p className="mt-0.5 mb-2 text-xs text-zinc-500 dark:text-zinc-400">{scope.research_project ? `Of the research project ${scope.research_project}` : 'Of the settings only'} — it holds:</p>
                  <ManifestList manifest={read.manifest} />
                </div>
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-2">
                  {scope.settings && <CheckRow label="The global settings" hint="The passwords and the folders of this computer are kept as they are." checked={rSettings} onChange={setRSettings} />}
                  {scope.project_files && <CheckRow label="The data of the research project" hint="The research project, its locations, cameras and SD cards." note={read.here.project ? 'already here' : undefined} checked={rProjectFiles} onChange={setRProjectFiles} />}
                  {scope.visits && <CheckRow label="The list of visits" note={read.here.visits.already > 0 ? `${read.here.visits.already} of ${read.here.visits.in_backup} already here` : plural(read.here.visits.in_backup, 'visit', 'visits')} checked={rVisits} onChange={setRVisits} />}
                  {scope.deployments.length > 0 && (
                    <div role="group" aria-label="Deployments in the backup" className="border-t border-zinc-200 dark:border-zinc-700 pt-1">
                      {scope.deployments.map((d) => (
                        <CheckRow key={d.id} label={d.id} note={read.here.deployments[d.id] ? 'already here' : read.has_images[d.id] ? 'with images' : undefined} checked={rChosen.has(d.id)} onChange={(on) => setRChosen((cur) => toggle(cur, d.id, on))} />
                      ))}
                    </div>
                  )}
                </div>
                {scope.deployments.length > 0 && (
                  <Option label="Restore the images of the deployments" checked={rImages && Object.values(read.has_images).some(Boolean)} onChange={setRImages} disabled={!Object.values(read.has_images).some(Boolean)}
                          hint={Object.values(read.has_images).some(Boolean) ? 'Off: only what describes each deployment is restored.' : 'This backup was made without the images.'} />
                )}
                <Option label="Replace what is already here" checked={replace} onChange={setReplace}
                        hint={conflicts.length === 0 ? 'Nothing of what you chose is here yet.' : replace ? `What the backup holds wins over: ${conflicts.join(', ')}. What is archived stays archived.` : `Off: what is already here is left as it is (${conflicts.join(', ')}); only what is missing is added.`} />
                <div className="flex items-center gap-3">
                  <button type="button" className={btnPrimary} disabled={!somethingToRestore || running} onClick={() => void restore()}>Restore</button>
                  {running && <span className="inline-flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400"><SmallSpinner />Restoring…</span>}
                </div>
                {bar}
                {error && !restored && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                {restored && (
                  <div role="status" className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-4 text-sm text-emerald-900 dark:text-emerald-200">
                    <p className="font-semibold">Restored</p>
                    <ul className="mt-1 list-disc pl-5 space-y-0.5">
                      {restored.settings && <li>The settings</li>}
                      {restored.project_files.research_project && <li>The research project: {restored.project_files.research_project === 'written' ? 'written' : 'kept as it was'}</li>}
                      {(['locations', 'cameras', 'sd_cards'] as const).map((k) => restored.project_files[k] && <li key={k}>{k === 'sd_cards' ? 'SD cards' : k[0].toUpperCase() + k.slice(1)}: {restored.project_files[k]!.added} added, {restored.project_files[k]!.replaced} replaced, {restored.project_files[k]!.kept} kept</li>)}
                      {restored.visits.added != null && <li>Visits: {restored.visits.added} added, {restored.visits.replaced} replaced, {restored.visits.kept} kept</li>}
                      {(restored.deployments.restored.length > 0 || restored.deployments.skipped.length > 0) && <li>Deployments: {restored.deployments.restored.length} restored{restored.deployments.skipped.length > 0 ? `, ${restored.deployments.skipped.length} left as they were (${restored.deployments.skipped.join(', ')})` : ''}</li>}
                    </ul>
                    <div className="mt-3"><button type="button" className={btnOutline} onClick={startOver}>Done</button></div>
                  </div>
                )}
              </div>
            )}
          </WizardStep>
        </>
      )}

      {/* the step that makes the backup has its own Back, level with the button that makes it */}
      {!(mode === 'backup' && selectionDone) && (
        <div className="mt-10">
          <button type="button" className={btnOutline} onClick={onBack}><span aria-hidden="true">← </span>Back</button>
        </div>
      )}
    </div>
  )
}
