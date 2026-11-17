import { actionLabel } from '../visitActions'
import { useEffect, useState } from 'react'
import { api } from '../api'
import type { BookVisit, Camera, SdCard, StoredVisit } from '../types'
import { FEATURE_TYPE_OPTIONS, btnOutline, btnPrimary, inputClass } from '../pages/ImportDeploymentPage'
import Combobox from './Combobox'

const ACTIONS = ['SiteStart', 'Installation', 'Revision', 'Desinstallation', 'Stolen', 'Archive'] as const
const CAMERA_STATUSES = ['', 'OK', 'Altered', 'Knocked down', 'Damaged', 'Stolen', 'Not revised', 'New site', 'Inactive site'] as const
const BATTERY_CODES = ['', 'OK', 'NoBatteries'] as const
const CARD_CODES = ['', 'OK', 'CardFull'] as const

/** What the book says of a row that is not what a visit keeps. */
const BOOK_ONLY = ['deployment', 'deployment_status', 'deployment_no_images', 'uploaded_at', 'on_trapper', 'not_done', 'not_visited', 'unknown', 'locked', 'state', 'when']

const label = 'block text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1'
const cameraKey = (c: Camera) => c.camera_id || c.label
const inUse = (status?: string) => !status || status === 'active' || status === 'ready'
const names = (text: string) => text.split(',').map((n) => n.trim()).filter(Boolean)
const number = (t: string) => (t.trim() === '' ? null : Number(t))
const text = (t: string) => t.trim() || null
const yesNo = (v: boolean | null | undefined) => (v == null ? '' : v ? 'yes' : 'no')
const fromYesNo = (t: string) => (t === '' ? null : t === 'yes')
const str = (v: unknown) => (v == null ? '' : String(v))

/** Edits a visit that is kept — its site and its revision are its key and do not change — or fills an unknown one, which has nothing yet. Its camera, its SD card
 * and who went are picked from the entities of the research project and the trappers: one that does not exist cannot be put. The rules of a visit are the server's: what
 * the change would make wrong, in the visit and in the ones after it, is shown as it says it, and nothing is changed. */
export default function EditVisitDialog({ projectId, visit, onClose, onSaved }: { projectId: string; visit: BookVisit; onClose: () => void; onSaved: () => void }) {
  const filling = Boolean(visit.unknown)
  const [form, setForm] = useState({
    date: visit.date || '', time: (visit.time || '').slice(0, 8), actions: filling ? ['Installation'] : [...visit.actions], camera: visit.camera_id ?? '', status: visit.camera_status ?? '',
    card: visit.card_status ?? '', battery: visit.battery_status ?? '', photos: str(visit.num_photos), sd: visit.sd ?? '', dateTimeOk: visit.date_time_ok ?? '', calibration: yesNo(visit.calibration),
    trappers: visit.trappers ?? '', latitude: str(visit.latitude), longitude: str(visit.longitude),
    interval: str(visit.camera_interval), height: str(visit.camera_height), depth: str(visit.camera_depth), tilt: str(visit.camera_tilt), heading: str(visit.camera_heading), distance: str(visit.detection_distance),
    timestampIssues: yesNo(visit.timestamp_issues), bait: yesNo(visit.bait_use), feature: visit.feature_type ?? '', habitat: visit.habitat ?? '', groups: visit.deployment_groups ?? '',
    tags: (visit.tags ?? []).join(', '), comments: visit.comments ?? '',
  })
  const [entities, setEntities] = useState<{ cameras: Camera[]; cards: SdCard[]; trappers: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  const toggle = (a: string) => set({ actions: form.actions.includes(a) ? form.actions.filter((x) => x !== a) : [...form.actions, a] })

  useEffect(() => {
    let cancelled = false
    api.getSettings().then((s) => {
      if (cancelled) return
      const own = (rp: string | null | undefined) => (rp ?? '').toLowerCase() === projectId.toLowerCase()
      setEntities({
        cameras: (s.FIELDWORK?.cameras ?? []).filter((c) => own(c.research_project)),
        cards: (s.FIELDWORK?.sd_cards ?? []).filter((c) => own(c.research_project)),
        trappers: (s.FIELDWORK?.trappers ?? []).filter((t) => !t.status || t.status === 'active').map((t) => t.name),
      })
    }).catch(() => { if (!cancelled) setError('Could not read the cameras, the SD cards and the trappers.') })
    return () => { cancelled = true }
  }, [projectId])

  const cameras = (entities?.cameras ?? []).filter((c) => inUse(c.status) || cameraKey(c) === form.camera)
  const cards = (entities?.cards ?? []).filter((c) => inUse(c.status) || c.label === form.sd)
  // those who went: the trappers of the settings, and the ones the visit already has, so that they can be taken away
  const people = [...new Set([...(entities?.trappers ?? []), ...names(form.trappers)])]
  const went = names(form.trappers)
  const model = (entities?.cameras ?? []).find((c) => cameraKey(c) === form.camera)?.camera_model ?? visit.camera_model ?? null
  const ready = Boolean(entities) && Boolean(form.date && form.time) && (form.actions.length > 0 || /not revised/i.test(form.status))

  async function save() {
    setSaving(true); setError(null)
    const kept = Object.fromEntries(Object.entries(visit).filter(([k]) => !BOOK_ONLY.includes(k))) as unknown as StoredVisit
    const stored = {
      ...(filling ? { location_id: visit.location_id, session: visit.session, tags: [] } : kept),
      date: form.date, time: form.time.length === 5 ? `${form.time}:00` : form.time, actions: form.actions,
      camera_id: text(form.camera), camera_model: form.camera ? model : null, camera_status: text(form.status), battery_status: form.battery || null, card_status: form.card || null,
      num_photos: form.card === 'CardFull' ? null : number(form.photos), sd: text(form.sd), date_time_ok: text(form.dateTimeOk), calibration: fromYesNo(form.calibration), trappers: text(form.trappers), setup_by: text(form.trappers),
      latitude: number(form.latitude), longitude: number(form.longitude), camera_interval: number(form.interval), camera_height: number(form.height), camera_depth: number(form.depth),
      camera_tilt: number(form.tilt), camera_heading: number(form.heading), detection_distance: number(form.distance), timestamp_issues: fromYesNo(form.timestampIssues), bait_use: fromYesNo(form.bait),
      feature_type: form.feature || null, habitat: text(form.habitat), deployment_groups: text(form.groups), tags: form.tags.split(/[,|]/).map((t) => t.trim()).filter(Boolean), comments: text(form.comments),
    } as unknown as StoredVisit
    try {
      if (filling) await api.saveVisit(projectId, stored)
      else await api.updateVisit(projectId, stored)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the visit.')
      setSaving(false)
    }
  }

  const field = (id: string, name: string, key: keyof typeof form, type = 'text', extra: object = {}) => (
    <div><label className={label} htmlFor={id}>{name}</label><input id={id} type={type} className={inputClass} value={form[key] as string} onChange={(e) => set({ [key]: e.target.value } as Partial<typeof form>)} {...extra} /></div>
  )
  const choice = (id: string, name: string, key: keyof typeof form, options: { value: string; label: string }[]) => (
    <div>
      <label className={label} htmlFor={id}>{name}</label>
      <select id={id} className={inputClass} value={form[key] as string} onChange={(e) => set({ [key]: e.target.value } as Partial<typeof form>)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
  const yesNoOptions = [{ value: '', label: 'Not said' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]
  const title = filling ? `Fill in ${visit.session} of ${visit.location_id}` : `Edit ${visit.session} of ${visit.location_id}`
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" role="presentation">
      <section role="dialog" aria-modal="true" aria-label={title} className="my-8 w-full max-w-3xl rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 space-y-5">
        <div>
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {filling ? 'Nothing is known of this visit yet. What you say here takes the place of the unknown one.' : 'The site and the revision are the key of the visit: they do not change.'}
            {' '}The camera, the SD card and who went are the ones of the settings, and the rules of a visit are checked with the visits before and after it.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('ev-date', 'Day', 'date', 'date')}
          {field('ev-time', 'Time', 'time', 'time', { step: 1 })}
        </div>
        <fieldset>
          <legend className={label}>What was done</legend>
          <div className="flex flex-wrap gap-2">
            {ACTIONS.map((a) => (
              <button key={a} type="button" aria-pressed={form.actions.includes(a)} onClick={() => toggle(a)} disabled={a === 'Archive' && !filling}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-colors disabled:opacity-50 ${form.actions.includes(a) ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-zinc-200 dark:border-zinc-700'}`}>{actionLabel(a)}</button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className={label}>Who went</legend>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Who went">
            {people.length === 0 && <span className="text-sm text-zinc-500">No trapper in the settings.</span>}
            {people.map((p) => (
              <button key={p} type="button" aria-pressed={went.includes(p)} onClick={() => set({ trappers: (went.includes(p) ? went.filter((x) => x !== p) : [...went, p]).join(', ') })}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${went.includes(p) ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-zinc-200 dark:border-zinc-700'}`}>{p}</button>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={label} htmlFor="ev-camera">Camera</label>
            <Combobox id="ev-camera" options={cameras.map((c) => ({ value: cameraKey(c), label: c.label === cameraKey(c) ? c.label : `${c.label} (${cameraKey(c)})` }))} value={form.camera} onChange={(v) => set({ camera: v })}
                      placeholder={entities ? 'Pick a camera' : 'Reading the cameras…'} clearLabel="Clear camera" />
            {model && <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Model: {model}</p>}
          </div>
          <div>
            <label className={label} htmlFor="ev-sd">SD card left</label>
            <Combobox id="ev-sd" options={cards.map((c) => ({ value: c.label, label: c.label }))} value={form.sd} onChange={(v) => set({ sd: v })} placeholder={entities ? 'Pick an SD card' : 'Reading the SD cards…'} clearLabel="Clear SD card" />
          </div>
          {field('ev-photos', 'Photos on the card collected', 'photos', 'number', { min: 0, disabled: form.card === 'CardFull', placeholder: form.card === 'CardFull' ? 'Not counted: the card is full' : undefined })}
          {choice('ev-battery', 'Batteries', 'battery', BATTERY_CODES.map((c) => ({ value: c, label: c || 'Not said' })))}
          {choice('ev-card', 'SD card', 'card', CARD_CODES.map((c) => ({ value: c, label: c || 'Not said' })))}
          {choice('ev-status', 'Status of the camera', 'status', CAMERA_STATUSES.map((c) => ({ value: c, label: c || 'Not said' })))}
          {field('ev-dtok', 'Camera date and time OK', 'dateTimeOk')}
          {choice('ev-calibration', 'Camera calibrated', 'calibration', yesNoOptions)}
          {field('ev-latitude', 'Latitude', 'latitude', 'number', { step: 'any' })}
          {field('ev-longitude', 'Longitude', 'longitude', 'number', { step: 'any' })}
          {field('ev-interval', 'Camera delay (s)', 'interval', 'number', { min: 0 })}
          {field('ev-height', 'Camera height (m)', 'height', 'number', { min: 0, step: 'any' })}
          {field('ev-depth', 'Camera depth (m)', 'depth', 'number', { min: 0, step: 'any' })}
          {field('ev-tilt', 'Camera tilt (°)', 'tilt', 'number', { min: -90, max: 90 })}
          {field('ev-heading', 'Camera heading (°)', 'heading', 'number', { min: 0, max: 360 })}
          {field('ev-distance', 'Detection distance (m)', 'distance', 'number', { min: 0, step: 'any' })}
          {choice('ev-timestamp', 'Timestamp issues', 'timestampIssues', yesNoOptions)}
          {choice('ev-bait', 'Bait use', 'bait', yesNoOptions)}
          {choice('ev-feature', 'Feature type', 'feature', [{ value: '', label: 'Not said' }, ...FEATURE_TYPE_OPTIONS])}
          {field('ev-habitat', 'Habitat', 'habitat')}
          {field('ev-groups', 'Deployment groups', 'groups')}
          {field('ev-tags', 'Tags (separated by commas)', 'tags')}
        </div>
        <div><label className={label} htmlFor="ev-comments">Notes</label><textarea id="ev-comments" rows={3} className={inputClass} value={form.comments} onChange={(e) => set({ comments: e.target.value })} /></div>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" className={btnOutline} onClick={onClose}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={!ready || saving} onClick={() => void save()}>{filling ? 'Fill in' : 'Save changes'}</button>
        </div>
      </section>
    </div>
  )
}
