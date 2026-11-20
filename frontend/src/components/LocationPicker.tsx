import { inTheApp } from '../researchProjects'
import { useEffect, useState } from 'react'
import TimezoneCombobox from './TimezoneCombobox'
import { api } from '../api'
import TrapperAccountNotice, { trapperAccountReady } from './TrapperAccountNotice'
import type { TrapperAccount, TrapperConnection } from './TrapperAccountNotice'
import CheckboxList from './CheckboxList'
import Combobox from './Combobox'
import OptionCards from './OptionCards'
import { isValidTimezone, knownTimezones } from '../deploymentValidation'
import type { Location, LocalLocation, ResearchProject } from '../types'
import {
  DESCRIPTIONS, DstSelect, FieldLabel, EMPTY_LOCATION_DRAFT, Field, FormCard, NO_CREDENTIALS, ORIGIN_SOURCE_OPTIONS, SmallSpinner, btnOutline, btnPrimary, hintClass,
  labelClass, rangeError,
} from '../pages/ImportDeploymentPage'
import type { OriginSource } from '../pages/ImportDeploymentPage'

interface Props {
  /** The acronym of the research project whose locations are asked for. */
  researchProjectId: string
  /** Its pk in Trapper when it came from there: the research project the locations are offered from, to start with. */
  trapperPk?: number | null
  /** The id of the location picked, or '' for none. */
  value: string
  /** The location picked — or undefined when it is cleared. */
  onSelect: (location: LocalLocation | undefined) => void
  /** Called with what went wrong (or null once it is gone), should the page want to say it too. */
  onError?: (message: string | null) => void
  /** When given, a new location is not made here but in the settings: the picker only points there — and has no card of its own, as the step says what it is. */
  onCreateInSettings?: () => void
}

const label = (l: { location_id: string; name?: string | null }) => `${l.location_id}${l.name ? ` — ${l.name}` : ''}`

/** The location of a research project, as the "Where and when was it taken?" step of Import deployment asks for it: one of those kept in the
 * collections folder, picked from a list that filters as you type — or a new one, by hand or taken from Trapper. */
export default function LocationPicker({ researchProjectId, trapperPk, value, onSelect, onError, onCreateInSettings }: Props) {
  const [locations, setLocations] = useState<LocalLocation[]>([])
  const [adding, setAdding] = useState(false)
  const [source, setSource] = useState<OriginSource | null>(null)
  const [draft, setDraft] = useState(EMPTY_LOCATION_DRAFT)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The Trapper account is the one saved in the settings: nothing is asked for here.
  const [account, setAccount] = useState<TrapperAccount | null>(null)
  const [conn, setConn] = useState<TrapperConnection>({ status: 'idle', message: '' })
  const [trapperProjects, setTrapperProjects] = useState<ResearchProject[]>([])
  const [trapperProjectPk, setTrapperProjectPk] = useState('')
  const [trapperLocations, setTrapperLocations] = useState<Location[]>([])
  const [trapperPks, setTrapperPks] = useState<string[]>([])
  const [loadingTrapper, setLoadingTrapper] = useState(false)

  function setErrorMessage(message: string | null) {
    setError(message)
    onError?.(message)
  }

  useEffect(() => {
    let cancelled = false
    setLocations([]); setAdding(false)
    api.listLocalLocations(researchProjectId)
      .then(({ results }) => { if (!cancelled) setLocations(results.filter(inTheApp)) })
      .catch((e) => { if (!cancelled) setErrorMessage(e instanceof Error ? e.message : 'Could not read the locations.') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [researchProjectId])

  useEffect(() => {
    api.trapperGetConfig()
      .then(setAccount)
      .catch(() => setAccount(null))
  }, [])

  const errors = {
    location_id: draft.location_id.trim() ? undefined : 'Required',
    ignore_dst: draft.ignore_dst ? undefined : 'Required',
    timezone: !draft.timezone.trim() ? 'Required' : !isValidTimezone(draft.timezone) ? 'Not a known IANA timezone (e.g. Europe/Madrid).' : undefined,
    latitude: rangeError(draft.latitude, -90, 90, true),
    longitude: rangeError(draft.longitude, -180, 180, true),
    coordinate_uncertainty: draft.coordinate_uncertainty.trim() === ''
      ? undefined
      : (Number.isInteger(Number(draft.coordinate_uncertainty)) && Number(draft.coordinate_uncertainty) >= 1 ? undefined : 'Must be a whole number, 1 or more.'),
  }
  const canSave = source === 'manual' && Object.values(errors).every((e) => !e) && !saving
  const lacksCoordinates = (l: LocalLocation | undefined) => !!l && (l.latitude == null || l.longitude == null)
  const picked = locations.find((l) => l.location_id === value)

  function startAdding() {
    setAdding(true); setSource(null); setDraft(EMPTY_LOCATION_DRAFT)
    setTrapperProjectPk(''); setTrapperLocations([]); setTrapperPks([]); setErrorMessage(null)
  }

  function changeSource(next: OriginSource) {
    setSource(next); setDraft(EMPTY_LOCATION_DRAFT); setTrapperPks([])
  }

  async function handleTestConnection() {
    setConn({ status: 'testing', message: '' })
    try {
      const result = await api.trapperTestConnection(NO_CREDENTIALS)
      const { results } = await api.trapperResearchProjects(NO_CREDENTIALS)
      setTrapperProjects(results)
      setConn({ status: 'ok', message: `Connected — ${result.research_projects_count} research project(s) available.` })
    } catch (e) {
      setConn({ status: 'error', message: e instanceof Error ? e.message : 'Could not connect to TRAPPER.' })
    }
  }

  // Adding from Trapper connects, with the account of the settings, as soon as it is asked for.
  const wantsTrapper = adding && source === 'trapper'
  useEffect(() => {
    if (wantsTrapper && trapperAccountReady(account) && conn.status === 'idle') void handleTestConnection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsTrapper, account, conn.status])

  /** From Trapper: the locations of the chosen Trapper research project. */
  async function handleTrapperProjectChange(pk: string) {
    setTrapperProjectPk(pk)
    setTrapperLocations([]); setTrapperPks([]); setErrorMessage(null)
    if (!pk) return
    setLoadingTrapper(true)
    try {
      const { results } = await api.trapperLocations(NO_CREDENTIALS, Number(pk))
      setTrapperLocations(results)
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Could not load the research project's locations.")
    } finally {
      setLoadingTrapper(false)
    }
  }

  // The research project of Trapper the project came from is the one offered first.
  useEffect(() => {
    if (!wantsTrapper || conn.status !== 'ok' || trapperProjectPk || !trapperPk) return
    void handleTrapperProjectChange(String(trapperPk))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsTrapper, conn.status, trapperProjectPk, trapperPk])

  /** Keeps a location in the research project's folder and picks it. */
  async function add(location: LocalLocation) {
    setSaving(true); setErrorMessage(null)
    try {
      const saved = await api.saveLocalLocation(researchProjectId, location)
      setLocations((list) => [...list, saved])
      setAdding(false)
      onSelect(saved)
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'Could not save the location.')
    } finally {
      setSaving(false)
    }
  }

  function handleSave() {
    return add({
      location_id: draft.location_id.trim(), name: draft.name.trim() || null,
      timezone: draft.timezone.trim(), ignore_dst: draft.ignore_dst === 'yes', trapper_pk: null,
      latitude: Number(draft.latitude), longitude: Number(draft.longitude),
      coordinate_uncertainty: draft.coordinate_uncertainty.trim() ? Number(draft.coordinate_uncertainty) : null,
    })
  }

  /** From Trapper: the locations ticked there are simply added — no form, as many as are ticked. One already kept here is
   * just picked. The first is the one picked afterwards. */
  async function handleAddFromTrapper() {
    setSaving(true); setErrorMessage(null)
    const problems: string[] = []
    const chosen: LocalLocation[] = []
    const added: LocalLocation[] = []
    for (const pk of trapperPks) {
      const loc = trapperLocations.find((l) => String(l.pk) === pk)
      if (!loc) continue
      const already = locations.find((l) => l.location_id.toLowerCase() === loc.location_id.toLowerCase())
      if (already) { chosen.push(already); continue }
      if (loc.latitude == null || loc.longitude == null) {
        problems.push(`“${loc.location_id}” has no coordinates in TRAPPER, and a deployment needs them. Add it by hand instead.`)
        continue
      }
      try {
        const saved = await api.saveLocalLocation(researchProjectId, {
          location_id: loc.location_id, name: loc.name || null,
          timezone: loc.timezone && isValidTimezone(loc.timezone) ? loc.timezone : 'UTC', ignore_dst: loc.ignore_dst ?? false, trapper_pk: loc.pk,
          latitude: loc.latitude, longitude: loc.longitude, coordinate_uncertainty: null, status: 'pending',
        })
        added.push(saved); chosen.push(saved)
      } catch (e) {
        problems.push(`“${loc.location_id}”: ${e instanceof Error ? e.message : 'could not be saved.'}`)
      }
    }
    if (added.length) setLocations((list) => [...list, ...added])
    setSaving(false)
    if (chosen.length) { setAdding(false); onSelect(chosen[0]) }
    if (problems.length) setErrorMessage(problems.join(' '))
  }

  const connectionForm = <TrapperAccountNotice account={account} conn={conn} onRetry={handleTestConnection} />

  const content = (
    <>
      {!adding ? (
        <>
          <label className={labelClass} htmlFor="origin-location">Location</label>
          <Combobox
            id="origin-location" options={locations.filter((l) => l.status !== 'archived').map((l) => ({ value: l.location_id, label: label(l) }))}
            value={value} onChange={(id) => onSelect(locations.find((l) => l.location_id === id))}
            placeholder={locations.length === 0 ? 'No locations yet' : 'Select a location…'}
            clearLabel="Clear location"
          />
          {locations.length === 0 && <p className={hintClass}>{researchProjectId} has no locations yet — add the first one.</p>}
          {lacksCoordinates(picked) && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">{value} has no coordinates, and a deployment needs them — pick another location.</p>
          )}
          {onCreateInSettings ? (
            <p className={`${hintClass} mt-3`}>
              The location is not here? A new location is created in the settings:{' '}
              <button type="button" className="text-blue-600 dark:text-blue-400 hover:underline" onClick={onCreateInSettings}>go to Settings › Locations</button>.
            </p>
          ) : (
            <div className="mt-3">
              <button type="button" className={btnOutline} onClick={startAdding}>➕ Add a new location</button>
            </div>
          )}
        </>
      ) : (
        <div>
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 mb-1">New location</p>
          <p className={`${hintClass} mb-3`}>Create a new location linked to the research project {researchProjectId}.</p>
          <OptionCards options={ORIGIN_SOURCE_OPTIONS} selected={source} onChoose={changeSource} />

          {source === 'trapper' && (
            <div className="mt-4">
              {conn.status !== 'ok' ? connectionForm : (
                <>
                  <div className="mb-4">
                    <label className={labelClass} htmlFor="trapper-location-project">TRAPPER research project</label>
                    <Combobox
                      id="trapper-location-project" options={trapperProjects.map((p) => ({ value: String(p.pk), label: p.acronym ? `${p.acronym} — ${p.name}` : p.name }))}
                      value={trapperProjectPk} onChange={handleTrapperProjectChange}
                      placeholder={trapperProjects.length === 0 ? 'No research projects found' : 'Select a research project…'}
                      clearLabel="Clear TRAPPER research project"
                    />
                  </div>
                  {trapperProjectPk && (
                    <div>
                      <p className={labelClass}>TRAPPER locations</p>
                      <CheckboxList
                        filterLabel="Filter TRAPPER locations" emptyText={loadingTrapper ? 'Loading locations…' : 'No locations found.'}
                        disabled={loadingTrapper || saving}
                        options={trapperLocations.map((l) => ({ value: String(l.pk), label: label(l) }))}
                        selected={trapperPks} onChange={setTrapperPks}
                      />
                      <p className={hintClass}>Tick one or more — they are added to {researchProjectId} as they are, and the first one is picked.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {source === 'manual' && (
            <div className="grid grid-cols-2 gap-4 mt-4">
              <Field label="Location id" required placeholder="e.g. DONA_01" hint={DESCRIPTIONS.locationID} value={draft.location_id}
                     onChange={(v) => setDraft((d) => ({ ...d, location_id: v }))} />
              <Field label="Location name" placeholder="e.g. Doñana site 1" hint={DESCRIPTIONS.locationName} value={draft.name}
                     onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
              <Field label="Latitude" type="number" required min={-90} max={90} step="any" placeholder="e.g. 52.70442"
                     hint={DESCRIPTIONS.latitude} error={draft.latitude ? errors.latitude : undefined} value={draft.latitude}
                     onChange={(v) => setDraft((d) => ({ ...d, latitude: v }))} />
              <Field label="Longitude" type="number" required min={-180} max={180} step="any" placeholder="e.g. 23.84995"
                     hint={DESCRIPTIONS.longitude} error={draft.longitude ? errors.longitude : undefined} value={draft.longitude}
                     onChange={(v) => setDraft((d) => ({ ...d, longitude: v }))} />
              <Field label="Coordinate uncertainty (m)" type="number" min={1} step={1} placeholder="e.g. 100"
                     hint={DESCRIPTIONS.coordinateUncertainty} error={errors.coordinate_uncertainty} value={draft.coordinate_uncertainty}
                     onChange={(v) => setDraft((d) => ({ ...d, coordinate_uncertainty: v }))} />
              <div>
                <FieldLabel id="location-timezone" label="Timezone (IANA)" required />
                <TimezoneCombobox id="location-timezone" value={draft.timezone} invalid={!draft.timezone} onChange={(v) => setDraft((d) => ({ ...d, timezone: v }))} />
                <p className={hintClass}>The location's own — every deployment there is read in it.</p>
              </div>
              <DstSelect value={draft.ignore_dst} error={draft.ignore_dst ? undefined : errors.ignore_dst} onChange={(v) => setDraft((d) => ({ ...d, ignore_dst: v }))} />
              <datalist id="timezone-options">
                {knownTimezones().map((tz) => <option key={tz} value={tz} />)}
              </datalist>
            </div>
          )}

          <div className="flex items-center gap-3 mt-4">
            {source === 'manual' && (
              <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!canSave} onClick={handleSave}>
                {saving && <SmallSpinner />}
                Save location
              </button>
            )}
            {source === 'trapper' && conn.status === 'ok' && (
              <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={trapperPks.length === 0 || saving} onClick={handleAddFromTrapper}>
                {saving && <SmallSpinner />}
                {`Add ${trapperPks.length} location${trapperPks.length === 1 ? '' : 's'}`}
              </button>
            )}
            <button type="button" className={btnOutline} onClick={() => { setAdding(false); setErrorMessage(null) }}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400 mt-3">{error}</p>}
    </>
  )
  return onCreateInSettings ? <div>{content}</div> : <FormCard title="Location" description={`Locations of ${researchProjectId}, found in the collections folder.`}>{content}</FormCard>
}
