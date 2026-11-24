import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { api } from '../api'
import { download, readItems, toCsv } from '../csvFile'
import { PageHeader, UTIL_ICONS } from '../components/TaskCard'
import WizardStep from '../components/WizardStep'
import { DEFAULT_PROJECT_CHANGED } from '../components/DefaultResearchProject'
import { EMPTY_RESEARCH_PROJECT } from '../types'
import type { TrapperRoleName } from '../types'
import { isUtcZone } from '../deploymentValidation'
import { validateResearchProject } from '../researchProjectValidation'
import { btnOutline, btnPrimary, hintClass, inputClass, labelClass } from './ImportDeploymentPage'
import { PAGE_CLASS } from '../components/PageBar'
import { Glyph } from '../components/ViewSwitch'

const ROLES: { value: TrapperRoleName; label: string }[] = [
  { value: 'principalInvestigator', label: 'Principal investigator' },
  { value: 'contact', label: 'Contact' },
  { value: 'rightsHolder', label: 'Rights holder' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'contributor', label: 'Contributor' },
]

const ZONES: string[] = typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl ? (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone') : ['UTC']

interface Field { name: string; label: string; required?: boolean; type?: 'text' | 'number' | 'select' | 'zone' | 'check'; /** When it does not apply, given what is entered: it is off and cannot be changed. */ off?: (values: Record<string, string>) => string | null; options?: { value: string; label: string }[]; hint?: string; initial?: string }

/** A step that collects things one by one: a small form — or a CSV file — and the list of what was entered, each with its way to take it out. Nothing is kept until the review. */
function AddList({ noun, fields, onAdd, added, onRemove, onContinue, continueLabel = 'Continue', onSkip }: {
  noun: string; fields: Field[]; onAdd: (values: Record<string, string>) => string | void; added: { key: string; label: string }[]; onRemove: (key: string) => void; onContinue: () => void; continueLabel?: string; onSkip: () => void
}) {
  const empty = () => Object.fromEntries(fields.map((f) => [f.name, f.initial ?? '']))
  const [values, setValues] = useState<Record<string, string>>(empty)
  const [error, setError] = useState<string | null>(null)
  const ready = fields.every((f) => !f.required || values[f.name].trim() !== '')
  const file = useRef<HTMLInputElement>(null)
  const [report, setReport] = useState<string[]>([])

  /** The rows of a CSV file are entered one by one, as the form enters them: the columns are found by the name or the label of the fields; what is wrong is said and left out. */
  async function importCsv(e: ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0]
    e.target.value = ''
    if (!chosen) return
    setError(null); setReport([])
    const { items, problems } = readItems<Record<string, string | null>>(await chosen.text(), fields.map((f) => ({ key: f.name, label: f.label, strict: f.required, kind: f.type === 'select' ? 'select' : f.type === 'check' ? 'bool' : undefined, options: f.options })), empty(), noun)
    const lines = [...problems]
    let entered = 0
    for (const [i, item] of items.entries()) {
      try {
        onAdd(Object.fromEntries(fields.map((f) => [f.name, item[f.name] ?? f.initial ?? ''])) as Record<string, string>)
        entered += 1
      } catch (err) {
        lines.push(`Row ${i + 2}: ${err instanceof Error ? err.message : `the ${noun} could not be entered.`}`)
      }
    }
    setReport([`${entered} ${noun}${entered === 1 ? '' : 's'} entered from ${chosen.name}.`, ...lines])
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!ready) return
    setError(null)
    try {
      onAdd(values)
      setValues(empty())
    } catch (err) {
      setError(err instanceof Error ? err.message : `The ${noun} could not be entered.`)
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label={`Add a ${noun}`}>
        {fields.map((f) => (
          <div key={f.name}>
            {f.type === 'check' ? (
              <label className="flex items-start gap-2 pt-7 text-sm text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" className="mt-0.5" checked={!f.off?.(values) && values[f.name] === 'yes'} disabled={!!f.off?.(values)} onChange={(e) => setValues({ ...values, [f.name]: e.target.checked ? 'yes' : '' })} />
                <span>{f.label}{f.off?.(values) && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{f.off(values)}</span>}</span>
              </label>
            ) : (
              <label className={labelClass} htmlFor={`setup-${noun}-${f.name}`}>{f.label}{f.required ? ' *' : ''}</label>
            )}
            {f.type === 'check' ? null : f.type === 'select' ? (
              <select id={`setup-${noun}-${f.name}`} className={inputClass} value={values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input id={`setup-${noun}-${f.name}`} className={inputClass} type={f.type === 'number' ? 'number' : 'text'} step={f.type === 'number' ? 'any' : undefined}
                     list={f.type === 'zone' ? 'setup-zones' : undefined} value={values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
            )}
            {f.hint && <p className={hintClass}>{f.hint}</p>}
          </div>
        ))}
        <div className="sm:col-span-2">
          <button type="submit" className={btnOutline} disabled={!ready}>Add the {noun}</button>
          <span className="mx-3 text-sm text-zinc-500 dark:text-zinc-400">or</span>
          <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" aria-label={`CSV file of ${noun}s`} tabIndex={-1} onChange={(e) => void importCsv(e)} />
          <button type="button" className={btnOutline} onClick={() => file.current?.click()}>Import from CSV</button>
          <button type="button" className="ml-3 text-sm text-blue-600 dark:text-blue-400 hover:underline" onClick={() => download(`${noun.replace(' ', '_')}s_template.csv`, toCsv([fields.map((f) => f.name)]))}>Download a template</button>
        </div>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {report.length > 0 && (
        <div role="status" className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
          <p>{report[0]}</p>
          {report.length > 1 && <ul className="mt-1 list-disc pl-5 text-amber-700 dark:text-amber-400">{report.slice(1).map((r) => <li key={r}>{r}</li>)}</ul>}
        </div>
      )}
      {added.length > 0 && (
        <ul aria-label={`The ${noun}s entered`} className="mt-4 flex flex-wrap gap-2">
          {added.map((a) => (
            <li key={a.key} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/50 bg-emerald-100 dark:bg-emerald-950/60 px-3 py-1 text-sm text-zinc-800 dark:text-zinc-100">
              {a.label}
              <button type="button" aria-label={`Remove ${a.label}`} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => onRemove(a.key)}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex gap-2">
        <button type="button" className={btnPrimary} onClick={onContinue}>{continueLabel}<span aria-hidden="true"> →</span></button>
        {added.length === 0 && <button type="button" className={btnOutline} onClick={onSkip}>Skip this step</button>}
      </div>
    </div>
  )
}

interface Outcome { added: string[]; skipped: string[]; problems: string[] }
interface Result { project: Outcome; trappers: Outcome; roles: Outcome; sites: Outcome; cameras: Outcome; cards: Outcome; made: boolean; dataDir?: string }

const CARD = 'rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/30 p-5'
const HEAD = 'flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-700 pb-3 mb-4 text-sm font-bold uppercase tracking-wide text-zinc-800 dark:text-zinc-100'
/** The book that heads the cards of what is going to be done and of what was done, as in the review of the visits. */
const BOOK = <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-emerald-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
const BIG = `${btnPrimary} inline-flex w-full items-center justify-center gap-2 !h-14 text-base`

const none = (): Outcome => ({ added: [], skipped: [], problems: [] })
const roleName = (r: string) => ROLES.find((x) => x.value === r)?.label ?? r
const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

interface TrapperIn { username: string; name: string; affiliation: string; email: string }
interface RoleIn { trapper: string; role: string }
interface SiteIn { id: string; name: string; latitude: number; longitude: number; timezone: string; ignoreDst: boolean }
interface ItemIn { label: string; a: string; b: string }   // a camera: its serial number and its model; an SD card: its brand and its capacity

/** The initial setup: a guide that asks, step by step, for the research project, its trappers and their roles, its sites, its cameras and its SD cards; then says what it is going to do, does it, and says what was done. */
export default function SetupWizardPage({ onBack, onMainMenu, onRegisterVisit }: { onBack: () => void; onMainMenu?: () => void; onRegisterVisit?: () => void }) {
  const [step, setStep] = useState(1)
  const [optional, setOptional] = useState(false)   // the optional steps (3–7) were gone through: the review goes back to the last of them, not to the data folder
  const [acronym, setAcronym] = useState('')
  const [name, setName] = useState('')
  const [dataDir, setDataDir] = useState('')   // starts as the one WildINTEL Uploader has now
  const [currentDir, setCurrentDir] = useState('')
  const [browsing, setBrowsing] = useState(false)
  const [projectCount, setProjectCount] = useState<number | null>(null)   // how many research projects there are: the data folder is asked for only with the first
  const [known, setKnown] = useState<string[]>([])   // the trappers that exist, to give roles to
  const [trappers, setTrappers] = useState<TrapperIn[]>([])
  const [roles, setRoles] = useState<RoleIn[]>([])
  const [sites, setSites] = useState<SiteIn[]>([])
  const [cameras, setCameras] = useState<ItemIn[]>([])
  const [cards, setCards] = useState<ItemIn[]>([])
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    api.listResearchProjects().then((r) => setProjectCount(r.results.length)).catch(() => setProjectCount(0))
    api.getSettings().then((s) => { setKnown((s.FIELDWORK?.trappers ?? []).map((t) => t.name)); setCurrentDir(s.DATA?.dir ?? ''); setDataDir((d) => d || (s.DATA?.dir ?? '')) }).catch(() => {})
  }, [])

  const code = acronym.trim()
  const draft = { ...EMPTY_RESEARCH_PROJECT, name, acronym: code }
  const errors = validateResearchProject(draft)
  const projectOk = !errors.name && !errors.acronym
  const folderStep = !(projectCount && projectCount > 0)   // the data folder is common to every research project: it is asked for with the first one, and not again
  const num = (n: number) => (folderStep ? n : n - 1)   // the number a step shows
  const range = `${num(3)}–${num(7)}`
  const dataDirError = dataDir.trim() === '' ? 'The data folder is needed.' : !/^(\/|~|[A-Za-z]:[\\/]|\\\\)/.test(dataDir.trim()) ? 'An absolute path (or one starting with ~).' : null
  const chosenDir = dataDir.trim()
  const choices = (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={btnOutline} disabled={dataDirError !== null} onClick={() => { setOptional(true); setStep(3) }}>Configure optional entities ({range})<span aria-hidden="true"> →</span></button>
      <button type="button" className={btnPrimary} disabled={dataDirError !== null} onClick={() => { setOptional(false); setStep(8) }}>Finish setup &amp; skip optional steps<span aria-hidden="true"> →</span></button>
    </div>
  )
  const optionalNote = <p className={hintClass}>Steps {range} are optional: the trappers, roles, locations, cameras and SD cards are created automatically when you load your first field file.</p>
  const people = [...new Set([...known, ...trappers.map((t) => t.name)])]

  const status = (n: number) => (n < step ? 'done' : n === step ? 'open' : 'locked') as 'done' | 'open' | 'locked'
  const summary = (list: string[], noun: string): ReactNode => (list.length === 0 ? 'Skipped: they can be added later in Settings › Entities, or created from the field files.' : `${list.length} ${list.length === 1 ? noun.slice(0, -1) : noun} entered: ${list.join(', ')}`)
  const next = () => setStep((s) => s + 1)
  /** A step passed is opened again, to change what was entered, until the setup is made: the ones after it wait for it again, with what they had. */
  const canEdit = step <= 8 && !applying
  const edit = (n: number) => { if (n >= 3) setOptional(true); setStep(n) }
  const lower = (x: string) => x.trim().toLowerCase()

  /** What the review says is going to be done, line by line. */
  const plan: [string, ReactNode][] = [
    ['Research project', <><span className="font-mono">{code}</span> — {name.trim()}</>],
    ['Data folder', <span className="font-mono">{chosenDir || '—'}</span>],
    ['Trappers', trappers.length ? trappers.map((t) => t.name).join(', ') : '—'],
    ['Roles', roles.length ? roles.map((r) => `${r.trapper} · ${roleName(r.role)}`).join(', ') : '—'],
    ['Locations', sites.length ? sites.map((x) => x.id).join(', ') : '—'],
    ['Cameras', cameras.length ? cameras.map((c) => c.label).join(', ') : '—'],
    ['SD cards', cards.length ? cards.map((c) => c.label).join(', ') : '—'],
  ]

  /** Keeps everything that was entered, a kind after the other, saying what each did: what is kept already is left as it is. The research project comes first — the rest hangs from it. */
  async function apply() {
    setApplying(true)
    const r: Result = { project: none(), trappers: none(), roles: none(), sites: none(), cameras: none(), cards: none(), made: false }
    if (dataDir.trim() && dataDir.trim() !== currentDir) {
      try { await api.setDataDir(dataDir); r.dataDir = dataDir.trim() } catch (e) {
        r.project.problems.push(message(e, 'The data folder could not be changed.'))
        setResult(r); setStep(9); setApplying(false)
        return   // the research project would be made in the wrong folder
      }
    }
    try {
      const { results } = await api.listResearchProjects()
      if (results.some((p) => lower(p.acronym) === lower(code))) r.project.skipped.push(code)
      else { await api.saveResearchProject({ ...draft, trapper_pk: null }); r.project.added.push(code) }
    } catch (e) {
      r.project.problems.push(message(e, 'The research project could not be kept.'))
      setResult(r); setStep(9); setApplying(false)
      return   // nothing else can be kept without it
    }
    if (trappers.length) {
      try {
        const done = await api.setupTrappers(trappers.map((t) => ({ username: t.username, name: t.name, affiliation: t.affiliation || undefined, email: t.email || undefined })))
        const byUser = new Map(trappers.map((t) => [lower(t.username), t.name]))
        r.trappers.added = done.added.map((u) => byUser.get(lower(u)) ?? u)
        r.trappers.skipped = done.skipped.map((u) => byUser.get(lower(u)) ?? u)
      } catch (e) { r.trappers.problems.push(message(e, 'The trappers could not be kept.')) }
    }
    if (roles.length) {
      try { r.roles.added = (await api.setupRoles(code, roles)).added.map(([t, role]) => `${t} · ${roleName(role)}`) } catch (e) { r.roles.problems.push(message(e, 'The roles could not be kept.')) }
    }
    for (const site of sites) {
      try {
        await api.saveLocalLocation(code, { location_id: site.id, name: site.name || null, timezone: site.timezone, ignore_dst: site.ignoreDst, latitude: site.latitude, longitude: site.longitude, coordinate_uncertainty: null, trapper_pk: null, status: 'pending' })
        r.sites.added.push(site.id)
      } catch (e) { r.sites.problems.push(`${site.id}: ${message(e, 'it could not be kept.')}`) }
    }
    for (const [kind, list, out] of [['cameras', cameras, r.cameras], ['sd_cards', cards, r.cards]] as const) {
      if (!list.length) continue
      try {
        const done = await api.setupFieldItems(code, kind, list.map((i) => (kind === 'cameras' ? { label: i.label, camera_id: i.a || undefined, camera_model: i.b || undefined } : { label: i.label, brand: i.a || undefined, capacity: i.b || undefined })))
        out.added = done.added; out.skipped = done.skipped
      } catch (e) { out.problems.push(message(e, `The ${kind === 'cameras' ? 'cameras' : 'SD cards'} could not be kept.`)) }
    }
    try { await api.setDefaultResearchProject(code); window.dispatchEvent(new Event(DEFAULT_PROJECT_CHANGED)); r.made = true } catch { /* the project is kept: it is chosen in the header */ }
    setResult(r); setStep(9); setApplying(false)
  }

  const lines: [string, ReactNode][] = result ? [
    ['Research project', result.project.added.length ? `${code} created` : result.project.skipped.length ? `${code} was kept already — left as it is` : '—'],
    ...(result.dataDir ? [['Data folder', result.dataDir] as [string, ReactNode]] : []),
    ['Trappers added', result.trappers.added.join(', ') || '—'],
    ...(result.trappers.skipped.length ? [['Trappers kept already — left as they are', result.trappers.skipped.join(', ')] as [string, ReactNode]] : []),
    ['Roles added', result.roles.added.join(', ') || '—'],
    ['Locations added', result.sites.added.join(', ') || '—'],
    ['Cameras added', result.cameras.added.join(', ') || '—'],
    ...(result.cameras.skipped.length ? [['Cameras kept already — left as they are', result.cameras.skipped.join(', ')] as [string, ReactNode]] : []),
    ['SD cards added', result.cards.added.join(', ') || '—'],
    ...(result.cards.skipped.length ? [['SD cards kept already — left as they are', result.cards.skipped.join(', ')] as [string, ReactNode]] : []),
    ...(result.made ? [['Default research project', code] as [string, ReactNode]] : []),
  ] : []
  const problems = result ? [...result.project.problems, ...result.trappers.problems, ...result.roles.problems, ...result.sites.problems, ...result.cameras.problems, ...result.cards.problems] : []

  const chips = <T,>(list: T[], label: (x: T) => string) => list.map((x) => ({ key: label(x), label: label(x) }))

  return (
    <div className={PAGE_CLASS}>
      <datalist id="setup-zones">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
      <PageHeader icon={UTIL_ICONS.setup} title="Initial setup" parent="Utilities" onParent={onBack}
        description="Set up a research project and say where WildINTEL Uploader keeps what it makes. The trappers, roles, locations, cameras and SD cards are optional: they can be created later, from the field files or in Settings." />

      <WizardStep n={1} title="The research project" required status={status(1)} canEdit={canEdit} sealed={step === 9} onEdit={() => edit(1)}
                  summary={<><span className="font-mono">{code}</span> — {name.trim()}</>} description="A short acronym (it also names its folder, for example DONA_24) and its full name. Everything else can be filled in later in Settings › Entities.">
        {step === 1 && (
          <form onSubmit={(e) => { e.preventDefault(); if (projectOk && folderStep) next() }} className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="The research project">
            <div>
              <label className={labelClass} htmlFor="setup-acronym">Acronym *</label>
              <input id="setup-acronym" className={inputClass} value={acronym} onChange={(e) => setAcronym(e.target.value)} />
              {acronym && errors.acronym && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.acronym}</p>}
            </div>
            <div>
              <label className={labelClass} htmlFor="setup-name">Name *</label>
              <input id="setup-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {folderStep
              ? <div className="sm:col-span-2"><button type="submit" className={btnPrimary} disabled={!projectOk || projectCount === null}>Continue<span aria-hidden="true"> →</span></button></div>
              : <div className="space-y-3 sm:col-span-2">
                  <p className={hintClass}>The data folder is <span className="font-mono">{currentDir}</span>, the same for every research project: it is changed in Settings › General.</p>
                  <div className="flex justify-end">{projectOk ? choices : <button type="button" className={btnPrimary} disabled>Continue<span aria-hidden="true"> →</span></button>}</div>
                  {optionalNote}
                </div>}
          </form>
        )}
      </WizardStep>

      {folderStep && (
      <WizardStep n={2} title="The data folder" required status={status(2)} canEdit={canEdit} sealed={step === 9} onEdit={() => edit(2)}
                  summary={<span className="font-mono">{chosenDir}</span>} description="Where WildINTEL Uploader keeps everything it makes: the collections, the reports and the packages. You can keep the one it has, or choose another, for example on another disk.">
        {step === 2 && (
          <div className="space-y-3">
            <label className={labelClass} htmlFor="setup-data-dir">Data folder</label>
            <div className="flex flex-wrap items-center gap-2">
              <input id="setup-data-dir" className={`${inputClass} font-mono !w-auto min-w-0 flex-1 basis-72`} value={dataDir} onChange={(e) => setDataDir(e.target.value)} />
              <button type="button" className={btnOutline} aria-label="Browse for the data folder" disabled={browsing}
                      onClick={async () => { setBrowsing(true); try { const { path } = await api.browseFolder('Select the data folder'); if (path) setDataDir(path) } catch { /* no native dialog: the path can be typed */ } finally { setBrowsing(false) } }}>{browsing ? 'Browsing…' : 'Choose folder…'}</button>
              <button type="button" className={btnOutline} onClick={() => setDataDir(currentDir)} disabled={dataDir === currentDir}>Use the proposed one</button>
            </div>
            {dataDirError && dataDir !== '' && <p className="text-xs text-red-600 dark:text-red-400">{dataDirError}</p>}
            <p className={hintClass}>The one WildINTEL Uploader proposes is already filled in: keep it, or choose another. What is already kept in another folder is not moved.</p>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button type="button" className={btnOutline} onClick={() => setStep(1)}><span aria-hidden="true">← </span>Back</button>
              {choices}
            </div>
            {optionalNote}
          </div>
        )}
      </WizardStep>
      )}

      <WizardStep n={num(3)} title="The trappers" optional="Optional · From visits CSV or Settings" status={status(3)} skipped={trappers.length === 0} canEdit={canEdit} sealed={step === 9} onEdit={() => edit(3)} summary={summary(trappers.map((t) => t.name), 'trappers')} description="The trappers who go to the field. Add them now, load them from a CSV, or skip this step: they are created from the field files when the visits are loaded. If you add them here, write their full names exactly as the field files do.">
        {step === 3 && (
          <AddList noun="trapper" added={chips(trappers, (t) => t.name)} onRemove={(k) => setTrappers((l) => l.filter((t) => t.name !== k))} onContinue={next} onSkip={next}
            fields={[{ name: 'username', label: 'Username', required: true, hint: 'Short, with no spaces, for example ana.perez. It is how WildINTEL Uploader and TRAPPER know the trapper.' }, { name: 'name', label: 'Full name', required: true, hint: 'As it is written in the field form, for example Ana Pérez.' }, { name: 'affiliation', label: 'Affiliation' }, { name: 'email', label: 'Email' }]}
            onAdd={(v) => {
              if (trappers.some((t) => lower(t.username) === lower(v.username))) throw new Error(`There is a trapper with the username ${v.username.trim()} already.`)
              setTrappers((l) => [...l, { username: v.username.trim(), name: v.name.trim(), affiliation: v.affiliation.trim(), email: v.email.trim() }])
            }} />
        )}
      </WizardStep>

      <WizardStep n={num(4)} title="Their roles in the research project" optional="Optional · In Settings" status={status(4)} skipped={roles.length === 0} canEdit={canEdit} sealed={step === 9} onEdit={() => edit(4)} summary={summary(roles.map((r) => `${r.trapper} · ${roleName(r.role)}`), 'roles')} description="Optional. What each trapper is in the research project (principal investigator, contact, rights holder…), as it will appear in the published data.">
        {step === 4 && (people.length === 0
          ? <><p className="text-sm text-zinc-600 dark:text-zinc-300">There are no trappers to give a role to.</p><div className="mt-4"><button type="button" className={btnOutline} onClick={next}>Continue<span aria-hidden="true"> →</span></button></div></>
          : (
            <AddList noun="role" added={chips(roles, (r) => `${r.trapper} · ${roleName(r.role)}`)} onRemove={(k) => setRoles((l) => l.filter((r) => `${r.trapper} · ${roleName(r.role)}` !== k))} onContinue={next} onSkip={next}
              fields={[{ name: 'trapper', label: 'Trapper', type: 'select', initial: people[0], options: people.map((p) => ({ value: p, label: p })) }, { name: 'role', label: 'Role', type: 'select', initial: 'contributor', options: ROLES }]}
              onAdd={(v) => {
                if (roles.some((r) => r.trapper === v.trapper && r.role === v.role)) throw new Error(`${v.trapper} has that role already.`)
                setRoles((l) => [...l, { trapper: v.trapper, role: v.role }])
              }} />
          ))}
      </WizardStep>

      <WizardStep n={num(5)} title="The locations" optional="Optional · From visits CSV or Settings" status={status(5)} skipped={sites.length === 0} canEdit={canEdit} sealed={step === 9} onEdit={() => edit(5)} summary={summary(sites.map((x) => x.id), 'sites')} description="The places where the cameras are put up: an id, the coordinates and the timezone. Skip this step if they come from TRAPPER or from the field files. If you add them here, write their ids exactly as the field files do (DONA_0012), or they will be taken as new ones.">
        {step === 5 && (
          <AddList noun="location" added={chips(sites, (x) => x.id)} onRemove={(k) => setSites((l) => l.filter((x) => x.id !== k))} onContinue={next} onSkip={next}
            fields={[{ name: 'id', label: 'Location id', required: true }, { name: 'name', label: 'Name' }, { name: 'latitude', label: 'Latitude', required: true, type: 'number', hint: 'Decimal degrees, −90 to 90.' }, { name: 'longitude', label: 'Longitude', required: true, type: 'number', hint: 'Decimal degrees, −180 to 180.' }, { name: 'timezone', label: 'Timezone', type: 'zone', initial: 'UTC', required: true }, { name: 'ignore_dst', label: 'The cameras here ignore summer time', type: 'check', hint: 'On if the camera clocks are not changed in summer.', off: (v) => (isUtcZone(v.timezone) ? 'Summer time is not applied in UTC.' : null) }]}
            onAdd={(v) => {
              const latitude = Number(v.latitude), longitude = Number(v.longitude)
              if (!(latitude >= -90 && latitude <= 90) || !(longitude >= -180 && longitude <= 180)) throw new Error('The coordinates must lie within −90 to 90 and −180 to 180.')
              if (sites.some((x) => lower(x.id) === lower(v.id))) throw new Error(`There is a location ${v.id.trim()} already.`)
              setSites((l) => [...l, { id: v.id.trim(), name: v.name.trim(), latitude, longitude, timezone: v.timezone.trim(), ignoreDst: v.ignore_dst === 'yes' && !isUtcZone(v.timezone) }])
            }} />
        )}
      </WizardStep>

      <WizardStep n={num(6)} title="The cameras" optional="Optional · From visits CSV or Settings" status={status(6)} skipped={cameras.length === 0} canEdit={canEdit} sealed={step === 9} onEdit={() => edit(6)} summary={summary(cameras.map((c) => c.label), 'cameras')} description="Each camera by the name it has in the field, with its serial number and model if you know them. Skip this step to create them from the field files. If you add them here, write their names exactly as the field files do.">
        {step === 6 && (
          <AddList noun="camera" added={chips(cameras, (c) => c.label)} onRemove={(k) => setCameras((l) => l.filter((c) => c.label !== k))} onContinue={next} onSkip={next}
            fields={[{ name: 'label', label: 'Label', required: true }, { name: 'camera_id', label: 'Serial number' }, { name: 'camera_model', label: 'Model' }]}
            onAdd={(v) => {
              if (cameras.some((c) => lower(c.label) === lower(v.label))) throw new Error(`There is a camera called ${v.label.trim()} already.`)
              setCameras((l) => [...l, { label: v.label.trim(), a: v.camera_id.trim(), b: v.camera_model.trim() }])
            }} />
        )}
      </WizardStep>

      <WizardStep n={num(7)} title="The SD cards" optional="Optional · From visits CSV or Settings" status={status(7)} skipped={cards.length === 0} canEdit={canEdit} sealed={step === 9} onEdit={() => edit(7)} summary={summary(cards.map((c) => c.label), 'SD cards')} description="Each card by the name written on it (7, 7b, 10B). Brand and capacity are optional. Skip this step to create them from the field files. If you add them here, write their names exactly as the field files do: 7b and 7B are two cards.">
        {step === 7 && (
          <AddList noun="SD card" added={chips(cards, (c) => c.label)} onRemove={(k) => setCards((l) => l.filter((c) => c.label !== k))} onContinue={next} continueLabel="Review" onSkip={next}
            fields={[{ name: 'label', label: 'Label', required: true }, { name: 'brand', label: 'Brand' }, { name: 'capacity', label: 'Capacity', hint: 'For example 64 GB.' }]}
            onAdd={(v) => {
              if (cards.some((c) => lower(c.label) === lower(v.label))) throw new Error(`There is an SD card called ${v.label.trim()} already.`)
              setCards((l) => [...l, { label: v.label.trim(), a: v.brand.trim(), b: v.capacity.trim() }])
            }} />
        )}
      </WizardStep>

      {step >= 8 && (
        <WizardStep n={num(8)} title="Review" status={step === 8 ? 'open' : 'done'} canEdit={false} sealed onEdit={() => {}} summary="What was going to be done was done." description="Check what is going to be created. Nothing is created until you confirm.">
          {step === 8 && (
            <div className="space-y-4">
              <section aria-label="What is going to be done" className={CARD}>
                <h6 className={HEAD}>{BOOK}What is going to be done</h6>
                <table aria-label="Plan" className="w-full text-sm">
                  <tbody>
                    {plan.map(([label, value]) => (
                      <tr key={label} className="border-b border-zinc-200 dark:border-zinc-700 last:border-b-0">
                        <th scope="row" className="py-2 pr-4 text-left font-medium text-zinc-500 dark:text-zinc-400">{label}</th>
                        <td className="py-2 font-mono text-zinc-900 dark:text-zinc-100">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">What is kept already is left as it is. <span className="font-mono">{code}</span> becomes the default research project.</p>
              </section>
              <div role="status" className="flex items-start gap-4 rounded-2xl border border-sky-300 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-950/30 px-6 py-5 text-sky-900 dark:text-sky-200">
                <span className="mt-0.5 text-sky-500"><Glyph className="h-6 w-6"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Glyph></span>
                <div>
                  <p className="text-lg font-semibold">Nothing is created until you confirm</p>
                  <p className="text-base leading-relaxed">Do you want to create <strong>{code}</strong> in <span className="font-mono">{chosenDir}</span>?</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <button type="button" className={`${btnOutline} flex items-center gap-2 !h-14 !px-6 text-lg`} disabled={applying} onClick={() => setStep(optional ? 7 : folderStep ? 2 : 1)}>
                  <Glyph className="h-5 w-5"><path d="M19 12H5M11 6l-6 6 6 6" /></Glyph>Back
                </button>
                <button type="button" className={`${btnPrimary} flex items-center gap-2 !h-14 !px-6 text-lg`} disabled={applying} aria-busy={applying} onClick={() => void apply()}>
                  {applying
                    ? <span aria-hidden="true" className="h-5 w-5 rounded-full border-2 border-white/40 border-t-white animate-spin motion-reduce:animate-none" />
                    : <Glyph className="h-5 w-5"><path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M8 3v5h7V3M7 21v-7h10v7" /></Glyph>}
                  {applying ? 'Creating…' : 'Create it'}
                </button>
              </div>
            </div>
          )}
        </WizardStep>
      )}

      {step === 9 && result && (
        <WizardStep n={num(9)} title="Review and continue" status="open" canEdit={false} onEdit={() => {}} description="What was saved, and what to do next.">
          <div className="space-y-4">
            {result.project.problems.length === 0 ? (
              <div role="status" className="rounded-xl border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-6 py-4 text-emerald-900 dark:text-emerald-100">
                <p className="text-lg font-semibold">{problems.length === 0 ? 'The initial setup is done' : 'The initial setup is done, with some problems'}</p>
                <p className="text-sm text-emerald-800/90 dark:text-emerald-200/80"><strong className="font-mono">{code}</strong> is set up. Anything else is added or changed in Settings › Entities.</p>
              </div>
            ) : (
              <div role="alert" className="rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-6 py-4 text-red-900 dark:text-red-100">
                <p className="text-lg font-semibold">The research project could not be kept</p>
                <p className="text-sm">{result.project.problems[0]} Nothing else was done.</p>
              </div>
            )}

            <section aria-label="What was saved" className={CARD}>
              <h6 className={HEAD}>{BOOK}What was saved</h6>
              <table aria-label="Summary" className="w-full text-sm">
                <tbody>
                  {lines.map(([label, value]) => (
                    <tr key={label} className="border-b border-zinc-200 dark:border-zinc-700 last:border-b-0">
                      <th scope="row" className="py-2 pr-4 text-left font-medium text-zinc-500 dark:text-zinc-400">{label}</th>
                      <td className="py-2 font-mono text-zinc-900 dark:text-zinc-100">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {problems.length > 0 && result.project.problems.length === 0 && (
                <ul aria-label="Problems" className="mt-3 list-disc pl-5 text-sm text-amber-700 dark:text-amber-400">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
              )}
            </section>

            {result.project.problems.length === 0 && (
              <div role="group" aria-label="What next">
                <section aria-label="Next" className={CARD}>
                  <h6 className={HEAD}>Next</h6>
                  <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">Do you want to register the first visit?</p>
                  {onRegisterVisit && <button type="button" className={BIG} onClick={onRegisterVisit}>Register the first visit</button>}
                </section>
                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-zinc-500 dark:text-zinc-400">
                  <span>Or go back to</span>
                  <button type="button" aria-label="Back to Utilities" className="text-zinc-800 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400" onClick={onBack}><span aria-hidden="true">← </span>Utilities</button>
                  {onMainMenu && <button type="button" aria-label="Back to the main menu" className="text-zinc-800 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400" onClick={onMainMenu}><span aria-hidden="true">← </span>Main menu</button>}
                </div>
              </div>
            )}
            {result.project.problems.length > 0 && <div><button type="button" className={btnOutline} onClick={() => { setResult(null); setStep(8) }}>Back to the review</button></div>}
          </div>
        </WizardStep>
      )}
    </div>
  )
}
