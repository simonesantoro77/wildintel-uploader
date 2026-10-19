import { useEffect, useState } from 'react'
import { api } from '../api'
import TrapperAccountNotice, { trapperAccountReady } from './TrapperAccountNotice'
import type { TrapperAccount, TrapperConnection } from './TrapperAccountNotice'
import CheckboxList from './CheckboxList'
import Combobox from './Combobox'
import OptionCards from './OptionCards'
import { RESEARCH_PROJECT_LIMITS, shownProjectErrors, validateResearchProject } from '../researchProjectValidation'
import { EMPTY_RESEARCH_PROJECT } from '../types'
import type { LocalResearchProject, ResearchProject } from '../types'
import {
  ANIMAL_TYPES_OPTIONS, BAIT_USE_OPTIONS, Field, FormCard, ORIGIN_SOURCE_OPTIONS, SAMPLING_DESIGN_OPTIONS, SENSOR_METHOD_OPTIONS,
  SelectField, SmallSpinner, TextAreaField, btnOutline, btnPrimary, hintClass, labelClass,
} from '../pages/ImportDeploymentPage'
import type { OriginSource } from '../pages/ImportDeploymentPage'

interface Props {
  /** The acronym of the research project picked, or '' for none. */
  value: string
  /** The research project picked — or undefined when it is cleared. */
  onSelect: (project: LocalResearchProject | undefined) => void
  /** Called with what went wrong (or null once it is gone), should the page want to say it too. */
  onError?: (message: string | null) => void
}

const byAcronym = (a: LocalResearchProject, b: LocalResearchProject) => a.acronym.toLowerCase().localeCompare(b.acronym.toLowerCase())

/** The research project the images were taken for, as the "Where was it taken?" step of Import deployment asks for it: one of those kept in
 * the collections folder, picked from a list that filters as you type — or a new one, by hand or taken from Trapper. */
export default function ResearchProjectPicker({ value, onSelect, onError }: Props) {
  const [projects, setProjects] = useState<LocalResearchProject[]>([])
  const [adding, setAdding] = useState(false)
  const [source, setSource] = useState<OriginSource | null>(null)
  const [draft, setDraft] = useState(EMPTY_RESEARCH_PROJECT)
  const [trapperPks, setTrapperPks] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The Trapper account is the one saved in the settings: nothing is asked for here.
  const [account, setAccount] = useState<TrapperAccount | null>(null)
  const [conn, setConn] = useState<TrapperConnection>({ status: 'idle', message: '' })
  const [trapperProjects, setTrapperProjects] = useState<ResearchProject[]>([])

  useEffect(() => {
    let cancelled = false
    api.listResearchProjects()
      .then(({ results }) => { if (!cancelled) setProjects(results) })
      .catch((e) => { if (!cancelled) setErrorMessage(e instanceof Error ? e.message : 'Could not read the collections folder.') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    api.trapperGetConfig()
      .then(setAccount)
      .catch(() => setAccount(null))
  }, [])

  function setErrorMessage(message: string | null) {
    setError(message)
    onError?.(message)
  }

  const errors = validateResearchProject(draft)
  const shownErrors = shownProjectErrors(errors)
  const canSave = source !== null && Object.keys(errors).length === 0 && !saving

  function update<K extends keyof typeof EMPTY_RESEARCH_PROJECT>(key: K, valueOfField: (typeof EMPTY_RESEARCH_PROJECT)[K]) {
    setDraft((p) => ({ ...p, [key]: valueOfField }))
  }

  function startAdding() {
    setAdding(true); setSource(null); setDraft(EMPTY_RESEARCH_PROJECT); setTrapperPks([]); setErrorMessage(null)
  }

  function changeSource(next: OriginSource) {
    setSource(next); setDraft(EMPTY_RESEARCH_PROJECT); setTrapperPks([])
  }

  async function handleTestConnection() {
    setConn({ status: 'testing', message: '' })
    try {
      const result = await api.trapperTestConnection({})
      const { results } = await api.trapperResearchProjects({})
      setTrapperProjects(results)
      setConn({ status: 'ok', message: `Connected — ${result.research_projects_count} research project(s) available.` })
    } catch (e) {
      setConn({ status: 'error', message: e instanceof Error ? e.message : 'Could not connect to Trapper.' })
    }
  }

  // Adding from Trapper connects, with the account of the settings, as soon as it is asked for.
  const wantsTrapper = adding && source === 'trapper'
  useEffect(() => {
    if (wantsTrapper && trapperAccountReady(account) && conn.status === 'idle') void handleTestConnection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsTrapper, account, conn.status])

  /** Keeps a research project in the collections folder and picks it. */
  async function add(project: LocalResearchProject) {
    setSaving(true); setErrorMessage(null)
    try {
      const saved = await api.saveResearchProject(project)
      setProjects((list) => [...list, saved].sort(byAcronym))
      setAdding(false)
      onSelect(saved)
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'Could not save the research project.')
    } finally {
      setSaving(false)
    }
  }

  function handleSave() {
    return add({ ...draft, name: draft.name.trim(), acronym: draft.acronym.trim(), event_interval: draft.event_interval ?? 0, trapper_pk: null })
  }

  /** From Trapper: the research projects ticked there are simply added — no form, as many as are ticked.
   * One already kept here is just picked. The first is the one marked by default afterwards. */
  async function handleAddFromTrapper() {
    setSaving(true); setErrorMessage(null)
    const problems: string[] = []
    const chosen: LocalResearchProject[] = []
    const added: LocalResearchProject[] = []
    for (const pk of trapperPks) {
      const rp = trapperProjects.find((p) => String(p.pk) === pk)
      if (!rp) continue
      const already = projects.find((p) => p.acronym === rp.acronym)
      if (already) { chosen.push(already); continue }
      const project: LocalResearchProject = { ...EMPTY_RESEARCH_PROJECT, name: rp.name, acronym: rp.acronym ?? '', trapper_pk: rp.pk }
      const problem = validateResearchProject(project)
      if (problem.name || problem.acronym) {
        problems.push(`“${rp.name}” can't be added from Trapper as it is: ${problem.acronym ?? problem.name} Add it by hand instead.`)
        continue
      }
      try {
        const saved = await api.saveResearchProject(project)
        added.push(saved); chosen.push(saved)
      } catch (e) {
        problems.push(`“${rp.name}”: ${e instanceof Error ? e.message : 'could not be saved.'}`)
      }
    }
    if (added.length) setProjects((list) => [...list, ...added].sort(byAcronym))
    setSaving(false)
    if (chosen.length) { setAdding(false); onSelect(chosen[0]) }
    if (problems.length) setErrorMessage(problems.join(' '))
  }

  const connectionForm = <TrapperAccountNotice account={account} conn={conn} onRetry={handleTestConnection} />

  return (
    <FormCard title="Research project" description="Those found in the collections folder.">
      {!adding ? (
        <>
          <label className="sr-only" htmlFor="origin-research-project">Research project</label>
          <Combobox
            id="origin-research-project" options={projects.map((p) => ({ value: p.acronym, label: `${p.acronym} — ${p.name}` }))}
            value={value} onChange={(id) => onSelect(projects.find((p) => p.acronym === id))}
            placeholder={projects.length === 0 ? 'No research projects yet' : 'Select a research project…'}
            clearLabel="Clear research project"
          />
          {projects.length === 0 && <p className={hintClass}>The collections folder has no research projects yet — add the first one.</p>}
          <div className="mt-3">
            <button type="button" className={btnOutline} onClick={startAdding}>➕ Add a new research project</button>
          </div>
        </>
      ) : (
        <div>
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-3">New research project</p>
          <OptionCards options={ORIGIN_SOURCE_OPTIONS} selected={source} onChoose={changeSource} />

          {source === 'trapper' && (
            <div className="mt-4">
              {conn.status !== 'ok' ? connectionForm : (
                <>
                  <p className={labelClass}>Trapper research projects</p>
                  <CheckboxList
                    filterLabel="Filter Trapper research projects" emptyText="No research projects found in Trapper." disabled={saving}
                    options={trapperProjects.map((p) => ({ value: String(p.pk), label: p.acronym ? `${p.acronym} — ${p.name}` : p.name }))}
                    selected={trapperPks} onChange={setTrapperPks}
                  />
                  <p className={hintClass}>Tick one or more — they are added to the collections folder as they are, and the first one is picked.</p>
                </>
              )}
            </div>
          )}

          {source === 'manual' && (
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="col-span-2">
                <Field label="Name" required maxLength={RESEARCH_PROJECT_LIMITS.name} value={draft.name} error={shownErrors.name}
                       onChange={(v) => update('name', v)} />
              </div>
              <Field label="Acronym" required maxLength={RESEARCH_PROJECT_LIMITS.acronymMax} placeholder="e.g. DONA" value={draft.acronym}
                     hint={`Between ${RESEARCH_PROJECT_LIMITS.acronymMin} and ${RESEARCH_PROJECT_LIMITS.acronymMax} characters. It names the project's folder.`} error={shownErrors.acronym}
                     onChange={(v) => update('acronym', v)} />
              <Field label="Event interval" type="number" required min={0} step={1} value={draft.event_interval?.toString() ?? ''}
                     error={shownErrors.event_interval} onChange={(v) => update('event_interval', v ? Number(v) : null)} />
              <SelectField label="Sampling design" allowEmpty={false} options={SAMPLING_DESIGN_OPTIONS} value={String(draft.sampling_design)}
                           onChange={(v) => update('sampling_design', Number(v))} />
              <SelectField label="Sensor method" allowEmpty={false} options={SENSOR_METHOD_OPTIONS} value={String(draft.sensor_method)}
                           onChange={(v) => update('sensor_method', Number(v))} />
              <SelectField label="Animal types" allowEmpty={false} options={ANIMAL_TYPES_OPTIONS} value={String(draft.animal_types)}
                           onChange={(v) => update('animal_types', Number(v))} />
              <SelectField label="Bait use" allowEmpty={false} options={BAIT_USE_OPTIONS} value={String(draft.bait_use)}
                           onChange={(v) => update('bait_use', Number(v))} />
              <div className="col-span-2">
                <Field label="Keywords" hint="Comma or space delimited tags." value={draft.keywords} onChange={(v) => update('keywords', v)} />
              </div>
              <div className="col-span-2">
                <TextAreaField label="Abstract" maxLength={RESEARCH_PROJECT_LIMITS.text} value={draft.abstract} error={shownErrors.abstract}
                               onChange={(v) => update('abstract', v)} />
              </div>
              <div className="col-span-2">
                <TextAreaField label="Methods" maxLength={RESEARCH_PROJECT_LIMITS.text} value={draft.methods} error={shownErrors.methods}
                               onChange={(v) => update('methods', v)} />
              </div>
              <div className="col-span-2">
                <TextAreaField label="Description" maxLength={RESEARCH_PROJECT_LIMITS.text} value={draft.description} error={shownErrors.description}
                               onChange={(v) => update('description', v)} />
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 mt-4">
            {source === 'manual' && (
              <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!canSave} onClick={handleSave}>
                {saving && <SmallSpinner />}
                Save research project
              </button>
            )}
            {source === 'trapper' && conn.status === 'ok' && (
              <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={trapperPks.length === 0 || saving} onClick={handleAddFromTrapper}>
                {saving && <SmallSpinner />}
                {`Add ${trapperPks.length} research project${trapperPks.length === 1 ? '' : 's'}`}
              </button>
            )}
            <button type="button" className={btnOutline} onClick={() => { setAdding(false); setErrorMessage(null) }}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400 mt-3">{error}</p>}
    </FormCard>
  )
}
