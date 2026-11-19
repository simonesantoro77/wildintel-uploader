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
        {added.length === 0 && <button type="button" className={btnOutline} onClick={onSkip}>Skip, I will do it later</button>}
      </div>
    </div>
  )
}

interface Outcome { added: string[]; skipped: string[]; problems: string[] }
interface Result { project: Outcome; trappers: Outcome; roles: Outcome; sites: Outcome; cameras: Outcome; cards: Outcome; made: boolean }

const CARD = 'rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/30 p-5'
const HEAD = 'flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-700 pb-3 mb-4 text-sm font-bold uppercase tracking-wide text-zinc-800 dark:text-zinc-100'
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
  const [acronym, setAcronym] = useState('')
  const [name, setName] = useState('')
  const [known, setKnown] = useState<string[]>([])   // the trappers that exist, to give roles to
  const [trappers, setTrappers] = useState<TrapperIn[]>([])
  const [roles, setRoles] = useState<RoleIn[]>([])
  const [sites, setSites] = useState<SiteIn[]>([])
  const [cameras, setCameras] = useState<ItemIn[]>([])
  const [cards, setCards] = useState<ItemIn[]>([])
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    api.getSettings().then((s) => setKnown((s.FIELDWORK?.trappers ?? []).map((t) => t.name))).catch(() => {})
  }, [])

  const code = acronym.trim()
  const draft = { ...EMPTY_RESEARCH_PROJECT, name, acronym: code }
  const errors = validateResearchProject(draft)
  const projectOk = !errors.name && !errors.acronym
  const people = [...new Set([...known, ...trappers.map((t) => t.name)])]

  const status = (n: number) => (n < step ? 'done' : n === step ? 'open' : 'locked') as 'done' | 'open' | 'locked'
  const summary = (list: string[], noun: string): ReactNode => (list.length === 0 ? 'Skipped — to be done later in Settings › Entities.' : `${list.length} ${list.length === 1 ? noun.slice(0, -1) : noun} entered: ${list.join(', ')}`)
  const next = () => setStep((s) => s + 1)
  const lower = (x: string) => x.trim().toLowerCase()

  /** What the review says is going to be done, line by line. */
  const plan: [string, ReactNode][] = [
    ['Research project', <><span className="font-mono">{code}</span> — {name.trim()}</>],
    ['Trappers', trappers.length ? trappers.map((t) => t.name).join(', ') : '—'],
    ['Roles', roles.length ? roles.map((r) => `${r.trapper} · ${roleName(r.role)}`).join(', ') : '—'],
    ['Sites', sites.length ? sites.map((x) => x.id).join(', ') : '—'],
    ['Cameras', cameras.length ? cameras.map((c) => c.label).join(', ') : '—'],
    ['SD cards', cards.length ? cards.map((c) => c.label).join(', ') : '—'],
  ]

  /** Keeps everything that was entered, a kind after the other, saying what each did: what is kept already is left as it is. The research project comes first — the rest hangs from it. */
  async function apply() {
    setApplying(true)
    const r: Result = { project: none(), trappers: none(), roles: none(), sites: none(), cameras: none(), cards: none(), made: false }
    try {
      const { results } = await api.listResearchProjects()
      if (results.some((p) => lower(p.acronym) === lower(code))) r.project.skipped.push(code)
      else { await api.saveResearchProject({ ...draft, trapper_pk: null }); r.project.added.push(code) }
    } catch (e) {
      r.project.problems.push(message(e, 'The research project could not be kept.'))
      setResult(r); setStep(8); setApplying(false)
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
    setResult(r); setStep(8); setApplying(false)
  }

  const lines: [string, ReactNode][] = result ? [
    ['Research project', result.project.added.length ? `${code} created` : result.project.skipped.length ? `${code} was kept already — left as it is` : '—'],
    ['Trappers added', result.trappers.added.join(', ') || '—'],
    ...(result.trappers.skipped.length ? [['Trappers kept already — left as they are', result.trappers.skipped.join(', ')] as [string, ReactNode]] : []),
    ['Roles added', result.roles.added.join(', ') || '—'],
    ['Sites added', result.sites.added.join(', ') || '—'],
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
        description="A guide that asks, step by step, for the research project, its trappers and their roles, its sites, its cameras and its SD cards." />

      <WizardStep n={1} title="The research project" status={status(1)} canEdit={false} onEdit={() => {}}
                  summary={<><span className="font-mono">{code}</span> — {name.trim()}</>} description="Its acronym — it names its folder — and its name. The rest is filled in later in Settings › Entities.">
        {step === 1 && (
          <form onSubmit={(e) => { e.preventDefault(); if (projectOk) next() }} className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="The research project">
            <div>
              <label className={labelClass} htmlFor="setup-acronym">Acronym *</label>
              <input id="setup-acronym" className={inputClass} value={acronym} onChange={(e) => setAcronym(e.target.value)} />
              {acronym && errors.acronym && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.acronym}</p>}
            </div>
            <div>
              <label className={labelClass} htmlFor="setup-name">Name *</label>
              <input id="setup-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="sm:col-span-2"><button type="submit" className={btnPrimary} disabled={!projectOk}>Continue<span aria-hidden="true"> →</span></button></div>
          </form>
        )}
      </WizardStep>

      <WizardStep n={2} title="The trappers" status={status(2)} canEdit={false} onEdit={() => {}} summary={summary(trappers.map((t) => t.name), 'trappers')} description="Who goes to the field. The username is what the trapper is called in the app.">
        {step === 2 && (
          <AddList noun="trapper" added={chips(trappers, (t) => t.name)} onRemove={(k) => setTrappers((l) => l.filter((t) => t.name !== k))} onContinue={next} onSkip={next}
            fields={[{ name: 'username', label: 'Username', required: true }, { name: 'name', label: 'Full name', required: true, hint: 'How a visit says who went.' }, { name: 'affiliation', label: 'Affiliation' }, { name: 'email', label: 'Email' }]}
            onAdd={(v) => {
              if (trappers.some((t) => lower(t.username) === lower(v.username))) throw new Error(`There is a trapper with the username ${v.username.trim()} already.`)
              setTrappers((l) => [...l, { username: v.username.trim(), name: v.name.trim(), affiliation: v.affiliation.trim(), email: v.email.trim() }])
            }} />
        )}
      </WizardStep>

      <WizardStep n={3} title="Their roles in the research project" status={status(3)} canEdit={false} onEdit={() => {}} summary={summary(roles.map((r) => `${r.trapper} · ${roleName(r.role)}`), 'roles')} description="What each trapper is in the research project.">
        {step === 3 && (people.length === 0
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

      <WizardStep n={4} title="The sites" status={status(4)} canEdit={false} onEdit={() => {}} summary={summary(sites.map((x) => x.id), 'sites')} description="Where the cameras are put up: an id, where it is and its timezone.">
        {step === 4 && (
          <AddList noun="site" added={chips(sites, (x) => x.id)} onRemove={(k) => setSites((l) => l.filter((x) => x.id !== k))} onContinue={next} onSkip={next}
            fields={[{ name: 'id', label: 'Site id', required: true }, { name: 'name', label: 'Name' }, { name: 'latitude', label: 'Latitude', required: true, type: 'number', hint: 'Decimal degrees, −90 to 90.' }, { name: 'longitude', label: 'Longitude', required: true, type: 'number', hint: 'Decimal degrees, −180 to 180.' }, { name: 'timezone', label: 'Timezone', type: 'zone', initial: 'UTC', required: true }, { name: 'ignore_dst', label: 'The cameras here ignore summer time', type: 'check', hint: 'Turn it on if their clocks stay the same all year; off, they follow summer time.', off: (v) => (isUtcZone(v.timezone) ? 'Summer time is not applied in UTC.' : null) }]}
            onAdd={(v) => {
              const latitude = Number(v.latitude), longitude = Number(v.longitude)
              if (!(latitude >= -90 && latitude <= 90) || !(longitude >= -180 && longitude <= 180)) throw new Error('The coordinates must lie within −90 to 90 and −180 to 180.')
              if (sites.some((x) => lower(x.id) === lower(v.id))) throw new Error(`There is a site ${v.id.trim()} already.`)
              setSites((l) => [...l, { id: v.id.trim(), name: v.name.trim(), latitude, longitude, timezone: v.timezone.trim(), ignoreDst: v.ignore_dst === 'yes' && !isUtcZone(v.timezone) }])
            }} />
        )}
      </WizardStep>

      <WizardStep n={5} title="The cameras" status={status(5)} canEdit={false} onEdit={() => {}} summary={summary(cameras.map((c) => c.label), 'cameras')} description="What each camera is called in the field, its serial number and its model.">
        {step === 5 && (
          <AddList noun="camera" added={chips(cameras, (c) => c.label)} onRemove={(k) => setCameras((l) => l.filter((c) => c.label !== k))} onContinue={next} onSkip={next}
            fields={[{ name: 'label', label: 'Label', required: true }, { name: 'camera_id', label: 'Serial number' }, { name: 'camera_model', label: 'Model' }]}
            onAdd={(v) => {
              if (cameras.some((c) => lower(c.label) === lower(v.label))) throw new Error(`There is a camera called ${v.label.trim()} already.`)
              setCameras((l) => [...l, { label: v.label.trim(), a: v.camera_id.trim(), b: v.camera_model.trim() }])
            }} />
        )}
      </WizardStep>

      <WizardStep n={6} title="The SD cards" status={status(6)} canEdit={false} onEdit={() => {}} summary={summary(cards.map((c) => c.label), 'SD cards')} description="Each card by its number or the label on it, its brand and its capacity.">
        {step === 6 && (
          <AddList noun="SD card" added={chips(cards, (c) => c.label)} onRemove={(k) => setCards((l) => l.filter((c) => c.label !== k))} onContinue={next} continueLabel="Review" onSkip={next}
            fields={[{ name: 'label', label: 'Label', required: true }, { name: 'brand', label: 'Brand' }, { name: 'capacity', label: 'Capacity', hint: 'For example 64 GB.' }]}
            onAdd={(v) => {
              if (cards.some((c) => lower(c.label) === lower(v.label))) throw new Error(`There is an SD card called ${v.label.trim()} already.`)
              setCards((l) => [...l, { label: v.label.trim(), a: v.brand.trim(), b: v.capacity.trim() }])
            }} />
        )}
      </WizardStep>

      {step >= 7 && (
        <WizardStep n={7} title="Review" status={step === 7 ? 'open' : 'done'} canEdit={false} onEdit={() => {}} summary="What was going to be done was done." description="What is going to be done, before it is.">
          {step === 7 && (
            <div className="space-y-4">
              <section aria-label="What is going to be done" className={CARD}>
                <h6 className={HEAD}>What is going to be done</h6>
                <table aria-label="Plan" className="w-full text-sm">
                  <tbody>
                    {plan.map(([label, value]) => (
                      <tr key={label} className="border-b border-zinc-200 dark:border-zinc-700 last:border-b-0">
                        <th scope="row" className="py-2 pr-4 text-left font-medium text-zinc-500 dark:text-zinc-400">{label}</th>
                        <td className="py-2 text-zinc-900 dark:text-zinc-100">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">What is kept already is left as it is. <span className="font-mono">{code}</span> becomes the default research project.</p>
              </section>
              <div className="flex justify-end">
                <button type="button" className={btnPrimary} disabled={applying} onClick={() => void apply()}>{applying ? 'Creating…' : 'Create it'}</button>
              </div>
            </div>
          )}
        </WizardStep>
      )}

      {step === 8 && result && (
        <WizardStep n={8} title="Review and continue" status="open" canEdit={false} onEdit={() => {}} description="What was saved, and what to do next.">
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
              <h6 className={HEAD}>What was saved</h6>
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
            {result.project.problems.length > 0 && <div><button type="button" className={btnOutline} onClick={() => { setResult(null); setStep(7) }}>Back to the review</button></div>}
          </div>
        </WizardStep>
      )}
    </div>
  )
}
