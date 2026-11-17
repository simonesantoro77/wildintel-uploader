import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { api } from '../api'
import { download, readItems, toCsv } from '../csvFile'
import Notice from '../components/Notice'
import { PageHeader, UTIL_ICONS } from '../components/TaskCard'
import WizardStep from '../components/WizardStep'
import { EMPTY_RESEARCH_PROJECT } from '../types'
import type { TrapperRoleName } from '../types'
import { validateResearchProject } from '../researchProjectValidation'
import { btnOutline, btnPrimary, hintClass, inputClass, labelClass } from './ImportDeploymentPage'

const ROLES: { value: TrapperRoleName; label: string }[] = [
  { value: 'principalInvestigator', label: 'Principal investigator' },
  { value: 'contact', label: 'Contact' },
  { value: 'rightsHolder', label: 'Rights holder' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'contributor', label: 'Contributor' },
]

const STEPS = ['Research project', 'Trappers', 'Roles', 'Sites', 'Cameras', 'SD cards'] as const

const ZONES: string[] = typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl ? (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone') : ['UTC']

interface Field { name: string; label: string; required?: boolean; type?: 'text' | 'number' | 'select' | 'zone'; options?: { value: string; label: string }[]; hint?: string; initial?: string }

/** A step that adds things one by one: a small form, and the list of what was added — kept as it is added, so nothing is lost by leaving. */
function AddList({ noun, fields, onAdd, added, onContinue, continueLabel = 'Continue', onSkip }: {
  noun: string; fields: Field[]; onAdd: (values: Record<string, string>) => Promise<string>; added: string[]; onContinue: () => void; continueLabel?: string; onSkip: () => void
}) {
  const empty = () => Object.fromEntries(fields.map((f) => [f.name, f.initial ?? '']))
  const [values, setValues] = useState<Record<string, string>>(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = fields.every((f) => !f.required || values[f.name].trim() !== '')
  const file = useRef<HTMLInputElement>(null)
  const [report, setReport] = useState<string[]>([])

  /** The rows of a CSV file are added one by one, as the form adds them: the columns are found by the name or the label of the fields; what is wrong is said and left out. */
  async function importCsv(e: ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0]
    e.target.value = ''
    if (!chosen || busy) return
    setBusy(true); setError(null); setReport([])
    const { items, problems } = readItems<Record<string, string | null>>(await chosen.text(), fields.map((f) => ({ key: f.name, label: f.label, strict: f.required, kind: f.type === 'select' ? 'select' : undefined, options: f.options })), empty(), noun)
    const lines = [...problems]
    let added = 0
    for (const [i, item] of items.entries()) {
      try {
        await onAdd(Object.fromEntries(fields.map((f) => [f.name, item[f.name] ?? f.initial ?? ''])) as Record<string, string>)
        added += 1
      } catch (err) {
        lines.push(`Row ${i + 2}: ${err instanceof Error ? err.message : `the ${noun} could not be added.`}`)
      }
    }
    setReport([`${added} ${noun}${added === 1 ? '' : 's'} added from ${chosen.name}.`, ...lines])
    setBusy(false)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true); setError(null)
    try {
      await onAdd(values)
      setValues(empty())
    } catch (err) {
      setError(err instanceof Error ? err.message : `The ${noun} could not be added.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <form onSubmit={(e) => void submit(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label={`Add a ${noun}`}>
        {fields.map((f) => (
          <div key={f.name}>
            <label className={labelClass} htmlFor={`setup-${noun}-${f.name}`}>{f.label}{f.required ? ' *' : ''}</label>
            {f.type === 'select' ? (
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
          <button type="submit" className={btnOutline} disabled={!ready || busy}>{busy ? 'Adding…' : `Add the ${noun}`}</button>
          <span className="mx-3 text-sm text-zinc-500 dark:text-zinc-400">or</span>
          <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" aria-label={`CSV file of ${noun}s`} tabIndex={-1} onChange={(e) => void importCsv(e)} />
          <button type="button" className={btnOutline} disabled={busy} onClick={() => file.current?.click()}>Import from CSV</button>
          <button type="button" className="ml-3 text-sm text-blue-600 dark:text-blue-400 hover:underline" onClick={() => download(`${noun.replace(' ', '_')}s_template.csv`, toCsv([fields.map((f) => f.name)]))}>Download a template</button>
        </div>
      </form>
      {report.length > 0 && (
        <div role="status" className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
          <p>{report[0]}</p>
          {report.length > 1 && <ul className="mt-1 list-disc pl-5 text-amber-700 dark:text-amber-400">{report.slice(1).map((r) => <li key={r}>{r}</li>)}</ul>}
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {added.length > 0 && (
        <ul aria-label={`The ${noun}s added`} className="mt-4 flex flex-wrap gap-2">
          {added.map((a) => <li key={a} className="rounded-full border border-emerald-600/50 bg-emerald-100 dark:bg-emerald-950/60 px-3 py-1 text-sm text-zinc-800 dark:text-zinc-100">{a}</li>)}
        </ul>
      )}
      <div className="mt-5 flex gap-2">
        <button type="button" className={btnPrimary} onClick={onContinue}>{continueLabel}<span aria-hidden="true"> →</span></button>
        {added.length === 0 && <button type="button" className={btnOutline} onClick={onSkip}>Skip, I will do it later</button>}
      </div>
    </div>
  )
}

/** The initial setup: a guide that asks, step by step, for the research project, its trappers and their roles, its sites, its cameras and its SD cards. Each is kept as it is added. */
export default function SetupWizardPage({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState(1)
  const [project, setProject] = useState<{ acronym: string; name: string } | null>(null)
  const [acronym, setAcronym] = useState('')
  const [name, setName] = useState('')
  const [projectError, setProjectError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [known, setKnown] = useState<string[]>([])   // the trappers that exist, to give roles to
  const [trappers, setTrappers] = useState<string[]>([])
  const [roles, setRoles] = useState<string[]>([])
  const [sites, setSites] = useState<string[]>([])
  const [cameras, setCameras] = useState<string[]>([])
  const [cards, setCards] = useState<string[]>([])

  useEffect(() => {
    api.getSettings().then((s) => setKnown((s.FIELDWORK?.trappers ?? []).map((t) => t.name))).catch(() => {})
  }, [])

  const draft = { ...EMPTY_RESEARCH_PROJECT, name, acronym: acronym.trim() }
  const errors = validateResearchProject(draft)
  const projectOk = !errors.name && !errors.acronym

  async function saveProject(e: FormEvent) {
    e.preventDefault()
    if (!projectOk || saving) return
    setSaving(true); setProjectError(null)
    try {
      await api.saveResearchProject({ ...draft, trapper_pk: null })
      setProject({ acronym: draft.acronym, name: name.trim() })
      setStep(2)
    } catch (err) {
      setProjectError(err instanceof Error ? err.message : 'The research project could not be kept.')
    } finally {
      setSaving(false)
    }
  }

  const status = (n: number) => (n < step ? 'done' : n === step ? 'open' : 'locked') as 'done' | 'open' | 'locked'
  const summary = (list: string[], noun: string): ReactNode => (list.length === 0 ? 'Skipped — to be done later in Settings › Entities.' : `${list.length} ${noun} added: ${list.join(', ')}`)
  const next = () => setStep((s) => s + 1)
  const people = [...new Set([...known, ...trappers.map((t) => t)])]

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-8 pt-3">
      <datalist id="setup-zones">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
      <PageHeader icon={UTIL_ICONS.setup} title="Initial setup" parent="Utilities" onParent={onBack}
        description="A guide that asks, step by step, for the research project, its trappers and their roles, its sites, its cameras and its SD cards." />

      <WizardStep n={1} title="The research project" status={status(1)} canEdit={false} onEdit={() => {}}
                  summary={project && <><span className="font-mono">{project.acronym}</span> — {project.name}</>} description="Its acronym — it names its folder — and its name. The rest is filled in later in Settings › Entities.">
        {step === 1 && (<>
        <form onSubmit={(e) => void saveProject(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="The research project">
          <div>
            <label className={labelClass} htmlFor="setup-acronym">Acronym *</label>
            <input id="setup-acronym" className={inputClass} value={acronym} onChange={(e) => setAcronym(e.target.value)} />
            {acronym && errors.acronym && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.acronym}</p>}
          </div>
          <div>
            <label className={labelClass} htmlFor="setup-name">Name *</label>
            <input id="setup-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="sm:col-span-2"><button type="submit" className={btnPrimary} disabled={!projectOk || saving}>{saving ? 'Keeping…' : 'Keep it and continue'}<span aria-hidden="true"> →</span></button></div>
        </form>
        {projectError && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{projectError}</p>}
      
        </>)}
      </WizardStep>

      <WizardStep n={2} title="The trappers" status={status(2)} canEdit={false} onEdit={() => {}} summary={summary(trappers, 'trappers')} description="Who goes to the field. The username is what the trapper is called in the app.">
        {step === 2 && (<>
        <AddList noun="trapper" added={trappers} onContinue={next} onSkip={next}
          fields={[{ name: 'username', label: 'Username', required: true }, { name: 'name', label: 'Full name', required: true, hint: 'How a visit says who went.' }, { name: 'affiliation', label: 'Affiliation' }, { name: 'email', label: 'Email' }]}
          onAdd={async (v) => {
            const result = await api.setupTrappers([{ username: v.username.trim(), name: v.name.trim(), affiliation: v.affiliation.trim() || undefined, email: v.email.trim() || undefined }])
            if (result.skipped.length) throw new Error(`There is a trapper with the username ${v.username.trim()} already.`)
            setTrappers((t) => [...t, v.name.trim()])
            return v.name
          }} />
      
        </>)}
      </WizardStep>

      <WizardStep n={3} title="Their roles in the research project" status={status(3)} canEdit={false} onEdit={() => {}} summary={summary(roles, 'roles')} description="What each trapper is in the research project.">
        {step === 3 && (<>
        {people.length === 0
          ? <><p className="text-sm text-zinc-600 dark:text-zinc-300">There are no trappers to give a role to.</p><div className="mt-4"><button type="button" className={btnOutline} onClick={next}>Continue<span aria-hidden="true"> →</span></button></div></>
          : (
            <AddList noun="role" added={roles} onContinue={next} onSkip={next}
              fields={[{ name: 'trapper', label: 'Trapper', type: 'select', initial: people[0], options: people.map((p) => ({ value: p, label: p })) }, { name: 'role', label: 'Role', type: 'select', initial: 'contributor', options: ROLES }]}
              onAdd={async (v) => {
                await api.setupRoles(project!.acronym, [{ trapper: v.trapper, role: v.role }])
                const label = `${v.trapper} · ${ROLES.find((r) => r.value === v.role)?.label ?? v.role}`
                setRoles((r) => [...r, label])
                return label
              }} />
          )}
      
        </>)}
      </WizardStep>

      <WizardStep n={4} title="The sites" status={status(4)} canEdit={false} onEdit={() => {}} summary={summary(sites, 'sites')} description="Where the cameras are put up: an id, where it is and its timezone.">
        {step === 4 && (<>
        <AddList noun="site" added={sites} onContinue={next} onSkip={next}
          fields={[{ name: 'id', label: 'Site id', required: true }, { name: 'name', label: 'Name' }, { name: 'latitude', label: 'Latitude', required: true, type: 'number', hint: 'Decimal degrees, −90 to 90.' }, { name: 'longitude', label: 'Longitude', required: true, type: 'number', hint: 'Decimal degrees, −180 to 180.' }, { name: 'timezone', label: 'Timezone', type: 'zone', initial: 'UTC', required: true }]}
          onAdd={async (v) => {
            const latitude = Number(v.latitude), longitude = Number(v.longitude)
            if (!(latitude >= -90 && latitude <= 90) || !(longitude >= -180 && longitude <= 180)) throw new Error('The coordinates must lie within −90 to 90 and −180 to 180.')
            await api.saveLocalLocation(project!.acronym, { location_id: v.id.trim(), name: v.name.trim() || null, timezone: v.timezone.trim(), ignore_dst: false, latitude, longitude, coordinate_uncertainty: null, trapper_pk: null, status: 'ready' })
            setSites((s) => [...s, v.id.trim()])
            return v.id
          }} />
      
        </>)}
      </WizardStep>

      <WizardStep n={5} title="The cameras" status={status(5)} canEdit={false} onEdit={() => {}} summary={summary(cameras, 'cameras')} description="What each camera is called in the field, its serial number and its model.">
        {step === 5 && (<>
        <AddList noun="camera" added={cameras} onContinue={next} onSkip={next}
          fields={[{ name: 'label', label: 'Label', required: true }, { name: 'camera_id', label: 'Serial number' }, { name: 'camera_model', label: 'Model' }]}
          onAdd={async (v) => {
            const result = await api.setupFieldItems(project!.acronym, 'cameras', [{ label: v.label.trim(), camera_id: v.camera_id.trim() || undefined, camera_model: v.camera_model.trim() || undefined }])
            if (result.skipped.length) throw new Error(`There is a camera called ${v.label.trim()} already.`)
            setCameras((c) => [...c, v.label.trim()])
            return v.label
          }} />
      
        </>)}
      </WizardStep>

      <WizardStep n={6} title="The SD cards" status={status(6)} canEdit={false} onEdit={() => {}} summary={summary(cards, 'SD cards')} description="Each card by its number or the label on it, its brand and its capacity.">
        {step === 6 && (<>
        <AddList noun="SD card" added={cards} onContinue={next} continueLabel="Finish" onSkip={next}
          fields={[{ name: 'label', label: 'Label', required: true }, { name: 'brand', label: 'Brand' }, { name: 'capacity', label: 'Capacity', hint: 'For example 64 GB.' }]}
          onAdd={async (v) => {
            const result = await api.setupFieldItems(project!.acronym, 'sd_cards', [{ label: v.label.trim(), brand: v.brand.trim() || undefined, capacity: v.capacity.trim() || undefined }])
            if (result.skipped.length) throw new Error(`There is an SD card called ${v.label.trim()} already.`)
            setCards((c) => [...c, v.label.trim()])
            return v.label
          }} />
      
        </>)}
      </WizardStep>

      {step > STEPS.length && project && (
        <Notice kind="success" role="status" className="mt-4" action={<button type="button" className={btnOutline} onClick={onBack}>Back to Utilities</button>}>
          <strong className="font-mono">{project.acronym}</strong> is set up: {trappers.length} trappers, {roles.length} roles, {sites.length} sites, {cameras.length} cameras and {cards.length} SD cards. Anything else is added or changed in Settings › Entities.
        </Notice>
      )}
    </div>
  )
}
