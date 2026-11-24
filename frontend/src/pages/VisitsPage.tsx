import { inTheApp } from '../researchProjects'
import { formatLocal, formatVisitWhen } from '../dateFormat'
import { Glyph } from '../components/ViewSwitch'
import { DetectedFile, FILE_KINDS } from '../components/DetectedFile'
import { actionLabel, actionsLabel, revisionNumber } from '../visitActions'
import { useEffect, useRef, useState } from 'react'
import TimezoneCombobox from '../components/TimezoneCombobox'
import { api } from '../api'
import { download } from '../csvFile'
import visitsTemplate from '../visitsTemplate.csv?raw'
import BackButton from '../components/BackButton'
import PickTable, { LabelFrame, PickedTick } from '../components/PickTable'
import Combobox from '../components/Combobox'
import LocationPicker from '../components/LocationPicker'
import type { ReactNode } from 'react'
import TaskCard, { MENU_ICONS, PageHeader } from '../components/TaskCard'
import ResearchProjectPicker from '../components/ResearchProjectPicker'
import { useDefaultResearchProject } from '../components/DefaultResearchProject'
import ChoiceCards from '../components/ChoiceCards'
import FileRowResults from '../components/FileRowResults'
import Notice from '../components/Notice'
import WizardStep from '../components/WizardStep'
import IconButton from '../components/IconButton'
import VisitSummary, { type SummaryRow, type SummaryTone, type VisitSummaryData } from '../components/VisitSummary'
import { CamtrapDpContext, CamtrapDpTag, DateTimeField, FormCard, MoreDetailsForm, SectionCard, DETAILS_SECTIONS, FEATURE_TYPE_OPTIONS, SwitchRow, roundPill, btnOutline, btnPrimary, hintClass, inputClass, labelClass } from './ImportDeploymentPage'
import { shownErrors, validateDeployment } from '../deploymentValidation'
import { availabilityErrors, cameraAtSite, cardBlock, nextRevision, unfinishedRevision } from '../visitAvailability'
import { EMPTY_DEPLOYMENT_FIELDS } from '../types'
import type { Camera, DeploymentFields, LocalLocation, LocalResearchProject, SdCard, StoredVisit, Trapper, ClosedVisit, ClosedVisitTarget, VisitsCsvColumns, VisitsCsvFormat, VisitsCsvResult, CsvCreate, ImportCsvOptions } from '../types'
import { PAGE_CLASS } from '../components/PageBar'

export type VisitSource = 'manual' | 'wildintel-new' | 'csv'

/** The fields of a visit as the matching of the columns groups them: as the form of a visit entered by hand does, in its order. */
const MAPPING_FIELDS: Record<string, string[]> = {
  'Who and what was done': ['trappers', 'actions'],
  'Where': ['location_id', 'location_name', 'latitude', 'longitude', 'location_latitude', 'location_longitude', 'coordinate_uncertainty', 'timezone', 'daylight_saving'],
  'When': ['session', 'date', 'time', 'when', 'created_at'],
  'SD card': ['sd', 'card_status', 'num_photos', 'sd_brand', 'sd_capacity'],
  'Camera': ['camera_status', 'battery_status', 'date_time_ok', 'camera_id', 'camera_model', 'camera_interval', 'detection_distance', 'camera_height', 'camera_depth', 'camera_tilt', 'camera_heading', 'calibration'],
  'Site': ['feature_type', 'habitat', 'bait_use', 'timestamp_issues'],
  'Grouping and notes': ['deployment_groups', 'tags', 'comments'],
}
const MAPPING_GROUPS = [...Object.keys(MAPPING_FIELDS), 'Other']
const MAPPING_GROUP_OF: Record<string, string> = Object.fromEntries(Object.entries(MAPPING_FIELDS).flatMap(([g, fs]) => fs.map((f) => [f, g])))
const mappingRank = (field: string) => (MAPPING_FIELDS[MAPPING_GROUP_OF[field]] ?? []).indexOf(field)
const MAPPING_ICONS: Record<string, ReactNode> = {
  'Who and what was done': <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  'Where': <><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></>,
  'When': <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  'SD card': <><path d="M6 2h9l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" /><path d="M9 6v3M12 6v3M15 6v3" /></>,
  'Camera': <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>,
  'Site': <><path d="M3 20l5-9 4 6 3-4 6 7z" /><circle cx="17" cy="6" r="2" /></>,
  'Grouping and notes': <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></>,
  'Other': <><circle cx="12" cy="12" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
}

const SOURCE_OPTIONS: { value: VisitSource; icon: ReactNode; title: string; description: string }[] = [
  { value: 'manual', icon: <><path d="M18 11V6a2 2 0 0 0-4 0v4" /><path d="M14 10V4a2 2 0 0 0-4 0v6" /><path d="M10 10.5V6a2 2 0 0 0-4 0v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15" /></>, title: 'By hand', description: 'Enter one visit at a time: the location, when, who went and what was done.' },
  { value: 'csv', icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h8" /></>, title: 'From a file', description: 'A CSV with one row per visit: the one downloaded from the WildINTEL field form in Epicollect5, or any other spreadsheet. WildINTEL Uploader detects which one it is.' },
]

/** The icon of the SD card section, drawn as those of the sections of the details are. */
const SD_ICON = <><path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" /><path d="M8 6v3M11 6v3M14 7v2" /></>

/** The icons of the answers of By hand, drawn as line icons. */
const CAMERA_PATHS = {
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  alert: <><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 17.5v.01" /></>,
  anchor: <><circle cx="12" cy="5" r="2" /><path d="M12 7v14M5 12H2a10 10 0 0 0 20 0h-3M8 11h8" /></>,
  replace: <><path d="M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5" /></>,
  archive: <><path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  ban: <><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>,
  ok: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></>,
  altered: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
}

/** The states a camera that is there is found in, asked by By hand before what is done with it. */
const FOUND_STATES: { value: string; description: string; icon: ReactNode }[] = [
  { value: 'OK', description: 'All is well', icon: CAMERA_PATHS.ok },
  { value: 'Altered', description: 'Moved or changed', icon: CAMERA_PATHS.altered },
]

/** What was done at the visit — the values the field records read. */
const ACTIONS = ['SiteStart', 'Installation', 'Revision', 'Desinstallation', 'Stolen', 'Archive']
/** How a field is asked at a visit: it must be filled, it may be, or it does not apply (and is turned off). */
export type Ask = 'required' | 'optional' | 'off'

/** What is asked of a visit depends on what was done at it: an Installation puts up a new camera with a card and collects nothing, a
 * Revision looks at a camera and collects its photos, a Desinstallation takes the camera away with its card, and a Stolen camera is gone —
 * nothing is collected, nothing is left. A visit may do several things, and then each field is asked as strongly as any of them asks it. */
export interface ActionFields {
  /** Which camera it is. */
  camera: Ask
  /** The SD card left in the camera. */
  sdLeft: Ask
  /** The photos on the card collected, and how the card was. */
  photos: Ask
  card: Ask
  batteries: Ask
  /** Whether the clock of the camera was right. */
  dateTime: Ask
  /** How the camera was found. */
  status: Ask
  /** Whether the camera was calibrated: where a camera stays or is put up. */
  calibration: Ask
}

/** What the status of a visit that could not be made says: nothing was done at it — no camera was looked at, no card collected or left. */
export const NOT_VISITED = 'Not revised'
export const isNotVisited = (status: string | null | undefined) => ['not revised', 'no revisada', 'no revisado'].includes((status ?? '').trim().toLowerCase())

const OFF: ActionFields = { camera: 'off', sdLeft: 'off', photos: 'off', card: 'off', batteries: 'off', dateTime: 'off', status: 'off', calibration: 'off' }

function fieldsOf(action: string): ActionFields {
  switch (action) {
    case 'Installation': return { camera: 'required', sdLeft: 'required', photos: 'off', card: 'off', batteries: 'off', dateTime: 'off', status: 'off', calibration: 'required' }
    case 'Revision': return { camera: 'off', sdLeft: 'required', photos: 'required', card: 'required', batteries: 'required', dateTime: 'required', status: 'required', calibration: 'required' }
    case 'Desinstallation': return { camera: 'off', sdLeft: 'off', photos: 'required', card: 'optional', batteries: 'optional', dateTime: 'optional', status: 'optional', calibration: 'off' }
    case 'Stolen': return OFF
    default: return OFF
  }
}

const STRENGTH: Record<Ask, number> = { off: 0, optional: 1, required: 2 }

/** What is asked of a visit: what its actions ask — except that, with the card full, the photos are not counted, so their number is not asked at all. */
export function askedOf(v: { actions: string[]; card: CardState; status?: string }): ActionFields {
  const asked = fieldsFor(v.actions, isNotVisited(v.status))
  return v.card === 'Full' && asked.photos !== 'off' ? { ...asked, photos: 'off' } : asked
}

/** Whether a visit takes the camera away and puts none up: nothing of how a camera is set up is asked of it. */
export const takesAwayOnly = (actions: string[]) => actions.includes('Desinstallation') && !actions.includes('Installation')

/** Whether a visit has nothing to say but its notes: it does something, and that is neither an Installation nor a Revision — a Stolen camera, an Archive. */
export const onlyNotes = (actions: string[]) => actions.length > 0 && !actions.some((a) => a === 'Installation' || a === 'Revision')

export function fieldsFor(actions: string[], notVisited = false): ActionFields {
  const all = { ...OFF }
  if (notVisited) return all // a visit that could not be made asks for nothing
  for (const action of actions) {
    const f = fieldsOf(action)
    for (const key of Object.keys(all) as (keyof ActionFields)[]) if (STRENGTH[f[key]] > STRENGTH[all[key]]) all[key] = f[key]
  }
  // a camera that is taken away is not calibrated, and no card is left in it: the one that is there goes with it — unless another camera is put up, which is calibrated and has its card
  if (actions.includes('Desinstallation') && !actions.includes('Installation')) { all.calibration = 'off'; all.sdLeft = 'off' }
  return all
}

/** The tag beside a field's label: what is asked of it. */
function AskTag({ ask }: { ask: Ask }) {
  const text = ask === 'required' ? 'required' : ask === 'optional' ? 'optional' : 'not for this visit'
  // what is required is tagged in red, in every form
  const colour = ask === 'required' ? 'text-red-600 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400'
  return <span className={`ml-2 text-[11px] font-normal uppercase tracking-wide ${colour}`}>{text}</span>
}

/** What each action is, in a few words. */
const ACTION_HINTS: Record<string, string> = {
  SiteStart: 'The location begins here: the revisions before this one do not wait for a visit to it. A location starts once, with its first visit.',
  Installation: 'A camera is put up: nothing is collected, a card is left.',
  Revision: 'The card is collected and another is left; the camera stays.',
  Desinstallation: 'The camera is taken away, with its card.',
  Stolen: 'The camera is gone: nothing is collected and nothing is left.',
  Archive: 'The location is given up: it is archived for good, from this day. No camera can be left there.',
}

/** What a visit is, when it does several things at once — what the camera does, said as one: the parts of it taken together are not what each of them is alone. */
export function actionsHint(actions: string[]): string {
  const has = (a: string) => actions.includes(a)
  if (has('Revision') && has('Desinstallation') && has('Installation')) return 'The camera is looked at and taken away, with its card, and another is put up with a card of its own: it is replaced.'
  if (has('Revision') && has('Desinstallation')) return `The camera is looked at and taken away, with its card: nothing is left.${has('Archive') ? ' ' + ACTION_HINTS.Archive : ''}`
  return actions.map((a) => ACTION_HINTS[a]).join(' ')
}

/** The states a camera is found in. */
const CAMERA_STATUSES = ['OK', 'Altered']

export type CardState = '' | 'OK' | 'Full'
export type BatteriesState = '' | 'OK' | 'Missing'

/** How the batteries were (OK, or NoBatteries when there were none) — nothing when it is not said. */
export function batteryStatus(batteries: BatteriesState): StoredVisit['battery_status'] {
  return batteries === 'Missing' ? 'NoBatteries' : batteries === 'OK' ? 'OK' : null
}
/** How the SD card was (OK, or CardFull) — nothing when it is not said. */
export function cardStatus(card: CardState): StoredVisit['card_status'] {
  return card === 'Full' ? 'CardFull' : card === 'OK' ? 'OK' : null
}

/** A visit as the fieldwork datasheet keeps it (DateTime is worked out from Date and Time). What of it Camtrap DP has — who set the
 * camera up, its id, the notes and the optional details — is `details`, the form of More details in Import deployment; here is the rest. */
export interface Visit {
  /** Who went on the visit. */
  trappers: string
  session: string
  /** When the visit was, as an ISO local timestamp: 2026-10-02T08:14:05. */
  when: string
  site: string
  /** What was done at the visit: one or more of ACTIONS. */
  actions: string[]
  status: string
  card: CardState
  batteries: BatteriesState
  numPhotos: string
  sd: string
  dateTimeOK: string
  /** Whether the camera was calibrated: asked only by By hand, so it starts as not said. */
  calibration?: boolean | null
  longitude: string
  latitude: string
  details: DeploymentFields
}

const EMPTY_VISIT: Visit = {
  // What is found most is that all is well: the switches start on, and what is wrong is turned off.
  trappers: '', session: '', when: '', site: '', actions: [], status: '', card: 'OK', batteries: 'OK',
  numPhotos: '', sd: '', dateTimeOK: 'Yes', calibration: null, longitude: '', latitude: '', details: EMPTY_DEPLOYMENT_FIELDS,
}

/** The fields of the Camera, the Site and the Grouping sections of the form, taken from a visit kept — not the notes. The day and the time, what was
 * done, who went and the card and its photos are of the visit being entered. */
export function visitFrom(previous: StoredVisit, now: Visit): Visit {
  const details = { ...EMPTY_DEPLOYMENT_FIELDS }
  for (const key of Object.keys(details) as (keyof DeploymentFields)[]) {
    const value = (previous as unknown as Record<string, unknown>)[key]
    if (value !== undefined && value !== null && !['deployment_id', 'location_id', 'location_name', 'coordinate_uncertainty', 'start_date', 'end_date', 'latitude', 'longitude', 'comments'].includes(key)) {
      (details as Record<string, unknown>)[key] = value
    }
  }
  return {
    ...now,
    status: previous.camera_status ?? '', batteries: previous.battery_status === 'NoBatteries' ? 'Missing' : 'OK', dateTimeOK: previous.date_time_ok ?? 'Yes', details,
  }
}

/** What the form holds of what the actions do not ask — it is not kept, so it is put back to how it starts. */
export function withoutWhatIsNotAsked(v: Visit): Visit {
  const notVisited = isNotVisited(v.status)
  const asked = fieldsFor(v.actions, notVisited)
  if (v.actions.length === 0 && !notVisited) return v
  return {
    ...v,
    sd: asked.sdLeft === 'off' ? '' : v.sd, numPhotos: asked.photos === 'off' ? '' : v.numPhotos, status: asked.status === 'off' && !notVisited ? '' : v.status,
    card: asked.card === 'off' ? 'OK' : v.card, batteries: asked.batteries === 'off' ? 'OK' : v.batteries, dateTimeOK: asked.dateTime === 'off' ? 'Yes' : v.dateTimeOK,
    // a visit that is neither an Installation nor a Revision — a stolen camera, a site given up — has nothing of the camera, the site or the grouping: only its notes
    details: onlyNotes(v.actions) ? { ...EMPTY_DEPLOYMENT_FIELDS, setup_by: v.details.setup_by, comments: v.details.comments } : { ...(asked.camera === 'off' ? { ...v.details, camera_id: null, camera_model: null } : v.details),
               ...(takesAwayOnly(v.actions) ? { camera_height: null, camera_depth: null, camera_tilt: null, camera_heading: null, camera_interval: null, detection_distance: null } : {}),
               // the switch of the bait is off — "no" — until it is turned on: an Installation always has the answer
               ...(v.actions.includes('Installation') && v.details.bait_use == null ? { bait_use: false } : {}) },
  }
}

/** The session of the next visit to a location that has had `kept` — calculated, not asked: the first visit is R0001, the second R0002… */
export function sessionOf(kept: number): string {
  return `R${String(kept + 1).padStart(4, '0')}`
}

/** The session as the datasheet writes it: R0013 for 13, R13 or r0013. */
export function sessionName(text: string): string | null {
  const m = /^\s*r?\s*0*(\d+)\s*$/i.exec(text)
  return m ? `R${m[1].padStart(4, '0')}` : null
}

type ErrorKey = Exclude<keyof Visit, 'details'> | 'camera'

/** What is wrong with a visit, by field — nothing when it can be added. The first visit to a site (`first`) can only be an Installation. */
export function visitErrors(v: Visit, first = false): Partial<Record<ErrorKey, string>> {
  const errors: Partial<Record<ErrorKey, string>> = {}
  if (!v.when) errors.when = 'Required.'
  if (!v.site.trim()) errors.site = 'Required.'
  if (isNotVisited(v.status)) { /* nothing was done at it: it has no action */ }
  else if (v.actions.length === 0) errors.actions = 'Choose at least one.'
  else if (first && !isNotVisited(v.status) && !v.actions.every((a) => a === 'Installation' || a === 'SiteStart')) errors.actions = 'The first visit to a location can only be an Installation.'
  const asked = askedOf(v)
  if (asked.photos !== 'off') {
    if (!v.numPhotos.trim()) { if (asked.photos === 'required') errors.numPhotos = 'Required.' }
    else if (!/^\d+$/.test(v.numPhotos.trim())) errors.numPhotos = 'A whole number.'
  }
  if (asked.sdLeft === 'required' && !v.sd.trim()) errors.sd = 'Required.'
  if (asked.camera === 'required' && !v.details.camera_id) errors.camera = 'Required.'
  if (asked.status === 'required' && !v.status.trim()) errors.status = 'Required.'
  return errors
}

/** What is wrong with the optional details — the ranges and height-or-depth, as Import deployment says them. */
export function detailsErrors(details: DeploymentFields) {
  // The rest of a deployment's fields are not the visit's: given something valid so that only the details' own are left.
  const whole = { ...details, deployment_id: 'visit', latitude: 0, longitude: 0, start_date: '2000-01-01T00:00:00Z', end_date: '2000-01-02T00:00:00Z' }
  return shownErrors(validateDeployment(whole, 'UTC'))
}

/** What an Installation asks of the camera that the optional details do not: how it is mounted and aimed, its delay and whether there is bait — each is a
 * question of the field form. By field of the details, as `detailsErrors` gives them. */
export function installationErrors(v: Visit): Record<string, string> {
  if (!v.actions.includes('Installation')) return {}
  const d = v.details
  const errors: Record<string, string> = {}
  if (d.camera_height == null && d.camera_depth == null) errors.camera_height = 'Height or depth is required for Installation.'
  if (d.camera_interval == null) errors.camera_interval = 'Camera delay is required for Installation.'
  if (d.camera_tilt == null) errors.camera_tilt = 'Tilt is required for Installation.'
  if (d.camera_heading == null) errors.camera_heading = 'Heading is required for Installation.'
  return errors
}

/** The metres between two points of the Earth (haversine). */
export function distanceMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(a))
}

/** How far the GPS of the note is from the coordinates of the location, in metres — nothing when either is not known. */
export function gpsDistance(v: Visit, location: { latitude?: number | null; longitude?: number | null } | undefined): number | null {
  const lat = v.latitude.trim() === '' ? NaN : Number(v.latitude), lon = v.longitude.trim() === '' ? NaN : Number(v.longitude)
  if (!location || location.latitude == null || location.longitude == null || Number.isNaN(lat) || Number.isNaN(lon)) return null
  return Math.round(distanceMetres(lat, lon, location.latitude, location.longitude))
}

/** The farthest the GPS of the note may be from its location, in metres: farther is an error. */
export const GPS_TOLERANCE_M = 1000

/** A visit as the visits file keeps it: the numbers as numbers, what is left blank as none. */
export function toStored(v: Visit): StoredVisit {
  const text = (t: string) => t.trim() || null
  const number = (t: string) => (t.trim() ? Number(t) : null)
  const { deployment_id, location_id, location_name, coordinate_uncertainty, start_date, end_date, latitude, longitude, ...details } = v.details
  void deployment_id; void location_id; void location_name; void coordinate_uncertainty; void start_date; void end_date; void latitude; void longitude
  const notVisited = isNotVisited(v.status)
  const asked = fieldsFor(v.actions, notVisited)
  return {
    ...details,
    // a visit that could not be made looked at no camera
    ...(notVisited ? { camera_id: null, camera_model: null } : {}),
    location_id: v.site.trim(), session: sessionName(v.session)!, date: v.when.slice(0, 10), time: v.when.slice(11, 19), actions: (notVisited ? [] : v.actions) as StoredVisit['actions'],
    trappers: text(v.trappers), camera_status: notVisited ? NOT_VISITED : asked.status !== 'off' ? text(v.status) : null,
    // only what the action asks is kept, whatever was typed before it was changed
    battery_status: batteryStatus(asked.batteries !== 'off' ? v.batteries : ''), card_status: cardStatus(asked.card !== 'off' ? v.card : ''),
    num_photos: asked.photos !== 'off' ? number(v.numPhotos) : null, sd: asked.sdLeft !== 'off' ? text(v.sd) : null, date_time_ok: asked.dateTime !== 'off' ? text(v.dateTimeOK) : null,
    calibration: asked.calibration !== 'off' ? v.calibration ?? null : null,
    latitude: number(v.latitude), longitude: number(v.longitude),
  }
}

/** The wall clock of a timezone `minutes` ago, as the date and time of a visit (YYYY-MM-DDTHH:mm:ss) — the browser's own when the timezone is not known. */
export function wallClockAgo(timezone: string | null | undefined, minutes: number, now = new Date()): string {
  const at = new Date(now.getTime() - minutes * 60000)
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone || undefined, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at)
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at)
  }
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`
}

/** The cards of the step that tells what was kept, as the one of Import deployment has them. */
/** The summary of what a file of visits does: a row for each thing, and the first visits of it. */
function SummaryTable({ lines, visits }: { lines: [string, ReactNode][]; visits: { session: string; location_id: string; date: string; time: string; actions: string[] }[] }) {
  const shown = visits.slice(0, 10)
  return (
    <>
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
      {shown.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table aria-label="Visits added" className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 dark:text-zinc-400">
                <th className="pr-3 py-1 font-medium">Revision</th><th className="pr-3 font-medium">When</th><th className="pr-3 font-medium">Location</th><th className="font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => (
                <tr key={`${v.session}|${v.location_id}|${v.date}|${v.time}`} className="border-t border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200">
                  <td className="pr-3 py-1.5">{v.session}</td><td className="pr-3">{formatVisitWhen(v as never)}</td><td className="pr-3">{v.location_id}</td>
                  <td>{v.actions.length === 0 ? 'Not visited' : actionsText(v.actions as never)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visits.length > shown.length && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">…and {visits.length - shown.length} more.</p>}
        </div>
      )}
    </>
  )
}

const REVIEW_CARD = 'rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/30 p-5'
const REVIEW_HEAD = 'flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-700 pb-3 mb-4 text-sm font-bold uppercase tracking-wide text-zinc-800 dark:text-zinc-100'

/** What a visit says, in the groups of cards to read before it is kept: only what was filled in. */
export function visitSummary(v: Visit, session: string, timezone?: string | null): VisitSummaryData {
  const asked = askedOf(v)
  const d = v.details
  const notVisitedVisit = isNotVisited(v.status)
  type Cell = [string, string | null | undefined | false, SummaryTone?]
  const rows = (cells: Cell[]): SummaryRow[] => cells
    .filter((c): c is [string, string, SummaryTone?] => typeof c[1] === 'string' && c[1] !== '')
    .map(([label, value, tone]) => ({ label, value, tone }))
  const yes = (on: boolean): SummaryTone => (on ? 'good' : 'bad')
  const tilt = d.camera_tilt != null ? `${d.camera_tilt}°` : ''
  const heading = d.camera_heading != null ? `${d.camera_heading}°` : ''
  const feature = FEATURE_TYPE_OPTIONS.find((o) => o.value === d.feature_type)?.label
  const groups = (d.deployment_groups ?? '').split('|').map((g) => g.trim()).filter(Boolean).join(', ')
  const [camera, site, notes] = DETAILS_SECTIONS
  return {
    overview: rows([
      ['Location', v.site.trim()],
      ['Revision code', session, 'code'],
      ['When', v.when ? formatLocal(v.when, timezone) : ''],
      ['Who went', namesOf(v.trappers).join(', ')],
      ['Action performed', notVisitedVisit ? 'Not visited' : actionsLabel(v.actions)],
    ]),
    gps: v.latitude && v.longitude ? `${v.latitude}, ${v.longitude}` : '',
    sections: [
      { key: 'camera', title: camera.label, icon: camera.icon, rows: rows([
        ['Camera id', d.camera_id, 'code'],
        ['Camera model', d.camera_model],
        ['State of the camera', asked.status !== 'off' && !notVisitedVisit && v.status.trim()],
        ['Batteries condition', asked.batteries !== 'off' && v.batteries, yes(v.batteries === 'OK')],
        ['Camera time synced', asked.dateTime !== 'off' && v.dateTimeOK, yes(v.dateTimeOK === 'Yes')],
        ['Calibration', v.calibration === true && 'Done', 'good'],
        [d.camera_depth != null && d.camera_height == null ? 'Depth below the surface' : 'Mounting height', d.camera_height != null ? `${d.camera_height} m` : d.camera_depth != null ? `${d.camera_depth} m` : ''],
        ['Tilt', tilt],
        ['Heading', heading],
        ['Camera trigger delay', d.camera_interval != null && `${d.camera_interval} s`],
        ['Detection distance', d.detection_distance != null && `${d.detection_distance} m`],
      ]) },
      { key: 'sd', title: 'SD card', icon: SD_ICON, rows: rows([
        ['SD card left', asked.sdLeft !== 'off' && v.sd.trim()],
        ['Images collected', asked.photos !== 'off' && v.numPhotos.trim()],
        ['Card condition', asked.card !== 'off' && v.card, yes(v.card === 'OK')],
      ]) },
      { key: 'site', title: site.label, icon: site.icon, rows: rows([
        ['Feature type', feature],
        ['Habitat', d.habitat],
        ['Bait used', v.actions.includes('Installation') && d.bait_use != null && (d.bait_use ? 'Yes' : 'No'), 'neutral'],
        ['Image dates may be wrong', d.timestamp_issues === true && 'Yes', 'bad'],
      ]) },
      { key: 'notes', title: notes.label, icon: notes.icon, optional: true, rows: rows([
        ['Groups', groups],
        ['Tags', d.tags.length > 0 && d.tags.join(', ')],
        ['Notes', d.comments],
      ]) },
    ],
  }
}

/** The names of a list of trappers typed as text — separated by commas. */
export function namesOf(text: string): string[] {
  return text.split(',').map((n) => n.trim()).filter(Boolean)
}

/** The text with a name added (once, whatever its case). */
export function addName(text: string, name: string): string {
  const names = namesOf(text)
  return (names.some((n) => n.toLowerCase() === name.toLowerCase()) ? names : [...names, name]).join(', ')
}

/** The text without a name. */
export function removeName(text: string, name: string): string {
  return namesOf(text).filter((n) => n.toLowerCase() !== name.toLowerCase()).join(', ')
}

/** The actions of a visit, as text. */
function actionsText(actions: string[]): string {
  return actionsLabel(actions)
}

/** The latest of the visits kept, by the day and time of the visit. */
function latest(visits: StoredVisit[]): StoredVisit | undefined {
  return [...visits].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).at(-1)
}

function Field({ id, label, ask, error, children }: { id: string; label: string; ask?: Ask; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline"><label htmlFor={id} className={labelClass}>{label}</label>{ask && <AskTag ask={ask} />}</div>
      {children}
      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
    </div>
  )
}

/** A field laid out as the switches are: what it is, and what is asked of it, on the left — and where it is filled in, on the right. */
function ControlRow({ id, label, ask, hint, error, children }: { id: string; label: string; ask?: Ask; hint?: React.ReactNode; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/40 px-5 py-4">
        <div className="flex-1 min-w-0">
          <p className="flex items-baseline gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
            <label htmlFor={id}>{label}</label>
            {ask === 'required' && <span className="text-[11px] uppercase tracking-wide text-red-600 dark:text-red-400">Required</span>}
          </p>
          {hint && <p className={`${hintClass} mt-0.5`}>{hint}</p>}
        </div>
        <div className="w-60 sm:w-80 shrink-0">{children}</div>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
    </div>
  )
}

interface Props {
  /** Back to the menu of the visits. */
  onBack: () => void
  /** Back to the main menu: offered, beside the menu of the visits, when the visits have just been registered. */
  onMainMenu?: () => void
  /** Opens the settings, on the section given — the page is left as it is under them. */
  onOpenSettings?: (section: 'trappers' | 'sdcards' | 'cameras' | 'locations' | 'general', researchProjectId?: string) => void
  /** Whether the settings are open: the trappers are read again when they are closed, as they may have been changed. */
  settingsOpen?: boolean
  /** Goes to Import deployment for a visit that was just closed: its research project and the visit whose card was collected. */
  onImportImages?: (target: ClosedVisitTarget) => void
  /** Goes to Import deployment on a research project: its revisions with visits closed, to import their images. */
  onImportImagesOf?: (researchProjectId: string) => void
  /** A visit that was planned, to be created: the register opens by hand on its research project and its location. */
  start?: { researchProjectId: string; site: string }
}

/** Register the visits to the camera traps, in steps — the first asks where they come from. */
/** What a visit keeps of its camera: its serial number, or its label when it has none. */
const cameraKey = (c: Camera) => c.camera_id || c.label

export default function VisitsPage({ onBack, onMainMenu, onOpenSettings, settingsOpen = false, onImportImages, onImportImagesOf, start }: Props) {
  const [source, setSource] = useState<VisitSource | null>(null)
  const byHand = source === 'manual'
  const [visit, setVisit] = useState<Visit>(EMPTY_VISIT)
  // By hand asks what the visit did as a question — do you see the camera? — and works the actions out from the answers.
  const [seeCamera, setSeeCamera] = useState<'yes' | 'stolen' | 'cannot' | null>(null)
  const [afterRevision, setAfterRevision] = useState<'stay' | 'replace' | 'take' | 'remove'>('stay')
  const [afterTheft, setAfterTheft] = useState<'replace' | 'archive' | 'nothing'>('nothing')
  const [archiveReason, setArchiveReason] = useState('Repeated thefts')
  const [tried, setTried] = useState(false)
  const [visits, setVisits] = useState<Visit[]>([])
  // Where the visit was: a research project of the collections folder and one of its locations (the site of the visit).
  const [project, setProject] = useState<LocalResearchProject | undefined>(undefined)
  // The visits are of the default research project of the settings — it is not picked here, as in Import deployment.
  const { project: defaultProject } = useDefaultResearchProject(settingsOpen)
  useEffect(() => { if (defaultProject && project?.acronym !== defaultProject.acronym) setProject(defaultProject) }, [defaultProject, project])
  const [location, setLocation] = useState<LocalLocation | undefined>(undefined)
  // A planned visit is created from the book: it opens by hand, on its research project and its location.
  useEffect(() => {
    if (!start) return
    let cancelled = false
    setSource('manual')
    Promise.all([api.listResearchProjects(), api.listLocalLocations(start.researchProjectId)]).then(([projects, locations]) => {
      if (cancelled) return
      const picked = projects.results.find((p) => p.acronym === start.researchProjectId)
      const place = locations.results.find((l) => l.location_id.toLowerCase() === start.site.toLowerCase())
      if (picked) setProject(picked)
      if (place) selectLocation(place)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [start]) // eslint-disable-line react-hooks/exhaustive-deps
  const [editingWhere, setEditingWhere] = useState(false)
  // When the visit was is confirmed with Continue, not as soon as the picker holds a value (it does while the digits are still being typed).
  const [whenConfirmed, setWhenConfirmed] = useState(false)
  // The visits already kept to the location: the one being registered is the next.
  const [kept, setKept] = useState<StoredVisit[] | null>(null)
  // The visits to the location that were made: one that could not be made does not count — with none made, this is the first time at the site.
  const made = kept?.filter((w) => !isNotVisited(w.camera_status) && w.actions.length > 0) ?? null
  // Every visit kept to the research project: where its cameras and its SD cards are is worked out from them.
  const [allVisits, setAllVisits] = useState<StoredVisit[] | null>(null)
  // The locations of the research project: a revision is one visit to each of them, and cannot start before the one before it is finished.
  const [projectLocations, setProjectLocations] = useState<LocalLocation[]>([])
  // The visits the ones just added closed — their card was collected — each with a way to import its images.
  const [justClosed, setJustClosed] = useState<ClosedVisit[]>([])
  // The session of the visit the form was filled in from, when it was.
  const [filledFrom, setFilledFrom] = useState<string | null>(null)
  // A visit was just added: what is shown is that, and the choice of adding another or going back — the form comes back when another is wanted.
  const [justAdded, setJustAdded] = useState(false)
  // the timezone of the location of each visit just added, to tell its day and time: the form is empty again once it is kept
  const [zones, setZones] = useState<Record<string, string | null | undefined>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  // The trappers kept in the settings, offered as who went.
  const [trappers, setTrappers] = useState<Trapper[]>([])
  // The SD cards kept in the settings, to pick the one of the visit from.
  const [allSdCards, setSdCards] = useState<SdCard[]>([])
  // And the cameras, to pick the one of the visit from.
  const [allCameras, setCameras] = useState<Camera[]>([])
  // Which sources of visits are used, as the settings say: one that is not, is not offered.
  const [sourcesUsed, setSourcesUsed] = useState({ epicollect: false })
  // Only those of the research project: each belongs to one.
  const ofProject = (rp: string | null) => !!project && (rp ?? '').toLowerCase() === project.acronym.toLowerCase()
  // ...and only those still in use: an archived one (lost, stolen, broken…) is not offered, unless the visit already has it.
  const inUse = (status: string | undefined) => !status || status === 'active' || status === 'ready'
  const cameras = allCameras.filter((c) => ofProject(c.research_project) && (inUse(c.status) || cameraKey(c) === visit.details.camera_id))
  // From a CSV file: its text, what reading it gave, and what was kept of it.
  const [csvName, setCsvName] = useState<string | null>(null)
  // The file step stays open — with what it can create — until Continue: choosing the file does not move on.
  const [fileConfirmed, setFileConfirmed] = useState(false)
  // The file is read, and ready to be checked: the check waits for Continue — it is what opens the step that checks.
  const [fileReady, setFileReady] = useState(false)
  // The groups of the matching that are folded away, as there are many fields.
  const [foldedGroups, setFoldedGroups] = useState<string[]>([])
  // Custom CSV: where the file is — on this computer, or in the Epicollect5 project of the settings.
  const [csvOrigin, setCsvOrigin] = useState<'file' | 'epicollect'>('file')
  const [importRulesOpen, setImportRulesOpen] = useState(false)
  const [draggingCsv, setDraggingCsv] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [csvText, setCsvText] = useState('')
  // Whether the file is being checked again — with the visits kept now, the locations now, the settings now.
  const [rechecking, setRechecking] = useState(false)
  const [csvResult, setCsvResult] = useState<VisitsCsvResult | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)
  const [csvSaving, setCsvSaving] = useState(false) // a save is running: the button waits, so that it is not pressed again
  const [csvSaved, setCsvSaved] = useState<number | null>(null)
  // From a CSV file: its columns, and the one that gives each field of a visit.
  const [csvColumns, setCsvColumns] = useState<VisitsCsvColumns | null>(null)
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({})
  // What to create when the file names a location, a camera or an SD card that does not exist, and the value of a field the file has no column for.
  const [csvCreate, setCsvCreate] = useState<CsvCreate>({ locations: false, cameras: false, sd_cards: false, trappers: false })
  const [csvDefaults, setCsvDefaults] = useState<Record<string, string>>({})
  // The revision before the ones of the file is closed when it has locations still planned: they are marked as not visited, as when a visit by hand asks for it.
  const [csvClose, setCsvClose] = useState(false)
  // A row with no coordinates of the visit takes those of its location: on, unless it is turned off.
  const [csvLocationCoordinates, setCsvLocationCoordinates] = useState(true)
  // The photos on the cards were not counted (an old datasheet): a Revision or a Desinstallation with no count is accepted as it is.
  const [csvPhotosNotCounted, setCsvPhotosNotCounted] = useState(false)
  const [closeAndRead, setCloseAndRead] = useState(false)   // the revision before is to be closed and the file read again, once the option is on
  // A location that is created starts as UTC, following summer time, unless the file or the defaults say otherwise.
  useEffect(() => {
    if (csvCreate.locations) setCsvDefaults((d) => ({ timezone: 'UTC', daylight_saving: 'no', ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== '')) }))
  }, [csvCreate.locations]) // eslint-disable-line react-hooks/exhaustive-deps
  const csvFormat: VisitsCsvFormat = source === 'wildintel-new' ? 'epicollect-csv' : 'mapped'
  const chosen = SOURCE_OPTIONS.find((o) => o.value === (source === 'wildintel-new' ? 'csv' : source))
  const continueLabel = fileReady && csvColumns ? `Continue with ${FILE_KINDS[source === 'wildintel-new' ? 'form' : 'other'].title}` : 'Continue'
  const keepFile = useRef(false)   // the type of the file changes after it is read: the file stays
  // A camera put up while it is somewhere else, or a card left while it is in another camera, cannot be kept — said as soon as it is chosen.
  // The revision of the next visit to the location: the latest, when the location is still planned in it, and the one after it otherwise (see nextRevision).
  const nextOne = allVisits && visit.site.trim() ? nextRevision(allVisits, visit.site.trim()) : null
  const nextSession = nextOne?.session ?? (kept ? sessionOf(kept.length) : undefined)
  const cardOptions = { cards: allSdCards, session: visit.session || nextSession }
  const conflicts = allVisits ? availabilityErrors(allVisits, visit, cardOptions) : {}
  // Only the cards that are ready — the settings say so: not planned (they are only there), not archived, not active (in a camera) —, and that no visit puts in another camera, not collected by this revision. The one already chosen stays, to show why it cannot be.
  const sdCards = allSdCards.filter((c) => ofProject(c.research_project) && (c.label === visit.sd || ((!c.status || c.status === 'ready') && !cardBlock(allVisits ?? [], c.label, visit, cardOptions))))
  // A Revision, a Desinstallation or a stolen camera is of the camera that is at the site: which one is not asked nor kept — the visit before says it —, unless the visit also installs another.
  const siteCamera = allVisits && visit.site.trim() ? cameraAtSite(allVisits, visit.site.trim(), visit.when || '9999-12-31T23:59:59') : null
  const ofTheSiteCamera = Boolean(siteCamera) && !visit.actions.includes('Installation') && visit.actions.some((x) => ['Revision', 'Desinstallation', 'Stolen'].includes(x))
  // what the visit before says is there is told whenever the visit looks at it, takes it away or finds it stolen — also when it puts another up
  const thereWas = Boolean(siteCamera) && visit.actions.some((x) => ['Revision', 'Desinstallation', 'Stolen'].includes(x))
  // Where no camera is known — a first visit, or after one was taken away or stolen — the visit can only install one, and nothing is asked.
  const noCamera = Boolean(allVisits) && !siteCamera
  const guided = byHand
  // The first visit ever to a site, in a revision after the first, may be where the site starts — or the site was there before and its earlier visits are not in the app. In the first
  // revision it is where it starts: nothing came before. Nothing is asked of it then; the first visit of a site is the one that says it.
  const firstEver = Boolean(allVisits) && visit.site.trim() !== '' && !(allVisits ?? []).some((v) => v.location_id.toLowerCase() === visit.site.trim().toLowerCase())
  const inRevision = revisionNumber(visit.session || nextSession)
  const [siteStarts, setSiteStarts] = useState(false)
  const pendingSite = projectLocations.find((l) => l.location_id.toLowerCase() === visit.site.trim().toLowerCase())?.status === 'pending'   // in WildINTEL Uploader, not started: its first visit starts it
  const startsSite = guided && noCamera && firstEver && (pendingSite || inRevision === 1 || siteStarts)
  // A camera taken away with no other put up, or stolen with none put up, gives the location up: it is archived — for good — with the reason.
  const archiving = guided && !noCamera && ((seeCamera === 'yes' && afterRevision === 'remove') || (seeCamera === 'stolen' && afterTheft === 'archive'))
  const notVisited = guided && seeCamera === 'cannot'
  const guidedActions = !guided ? null
    : notVisited ? [] // the visit that could not be made: nothing was done at it, so it has no action (its status says it was not revised)
    : noCamera ? (startsSite ? ['SiteStart', 'Installation'] : ['Installation'])
    : seeCamera === 'yes' ? (!visit.status ? [] : afterRevision === 'replace' ? ['Revision', 'Desinstallation', 'Installation'] : afterRevision === 'take' ? ['Revision', 'Desinstallation'] : afterRevision === 'remove' ? ['Revision', 'Desinstallation', 'Archive'] : ['Revision'])
    : seeCamera === 'stolen' ? (afterTheft === 'replace' ? ['Stolen', 'Installation'] : afterTheft === 'archive' ? ['Stolen', 'Archive'] : ['Stolen'])
    : []
  // The coordinates of where the user is now, asked of the browser — which asks the user for permission.
  const [locating, setLocating] = useState<'idle' | 'asking' | string>('idle')
  const useMyPosition = () => {
    if (!navigator.geolocation) { setLocating('This browser cannot tell where you are.'); return }
    setLocating('asking')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setVisit((v) => ({ ...v, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) }))
        setLocating('idle')
      },
      (e) => setLocating(e.code === e.PERMISSION_DENIED ? 'The browser was not allowed to tell where you are: allow it for this page, or type the coordinates.' : 'The browser could not get where you are: try again, or type the coordinates.'),
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }
  // "Set up by" is who went (step 3) until it is written over: it follows the trappers as they are chosen, and what was typed there is left alone.
  const setupFrom = useRef('')
  useEffect(() => {
    const who = namesOf(visit.trappers).join(', ')
    const before = setupFrom.current   // read now: the update below runs later
    setVisit((v) => {
      const now = v.details.setup_by ?? ''
      return now === '' || now === before ? { ...v, details: { ...v.details, setup_by: who || null } } : v
    })
    setupFrom.current = who
  }, [visit.trappers])
  const guidedKey = guidedActions?.join('+')
  // What a theft takes: the camera at the site, and the card that was left in it — which are marked as not available when the visit is kept.
  const theft = guided && !noCamera && seeCamera === 'stolen' && siteCamera ? siteCamera.camera : null
  const stolenCamera = theft ? (allCameras.find((c) => cameraKey(c) === theft || c.label === theft)?.label ?? theft) : null
  const stolenCard = theft && allVisits
    ? [...allVisits].filter((v) => v.location_id.toLowerCase() === visit.site.trim().toLowerCase() && v.sd && `${v.date}T${v.time}` < (visit.when || '9999-12-31T23:59:59') && v.actions.some((a) => a === 'Installation' || a === 'Revision'))
        .sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`))[0]?.sd ?? null
    : null
  useEffect(() => {
    if (!guidedActions) return
    // in the order the flow does them: the camera is revised, then the new one is installed
    const actions = guidedActions
    setVisit((v) => {
      if (v.actions.join('+') === actions.join('+')) return v
      const next = withoutWhatIsNotAsked({ ...v, actions, calibration: fieldsFor(actions).calibration !== 'off' ? v.calibration ?? false : null })
      // The camera of a visit that installs another is not the one at the site: the stolen one must not stay chosen.
      const there = siteCamera?.camera
      return actions.includes('Installation') && there && (next.details.camera_id ?? '') === there ? { ...next, details: { ...next.details, camera_id: null, camera_model: null } } : next
    })
  }, [guidedKey, visit.actions.join('+')]) // eslint-disable-line react-hooks/exhaustive-deps
  // The visit that could not be made says so with its status; any other answer takes it away.
  useEffect(() => {
    if (!guided) return
    setVisit((v) => (seeCamera === 'cannot' ? withoutWhatIsNotAsked({ ...v, status: NOT_VISITED }) : isNotVisited(v.status) ? { ...v, status: '' } : v))
  }, [seeCamera]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSeeCamera(null); setAfterRevision('stay'); setAfterTheft('nothing'); setVisit((v) => (v.status && guided ? { ...v, status: '' } : v)) }, [visit.site]) // eslint-disable-line react-hooks/exhaustive-deps
  const archiveFields = (
    <div className="max-w-md pt-1">
      <label htmlFor="archive-reason" className={labelClass}>Why is it archived?</label>
      <input id="archive-reason" className={inputClass} value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} />
      <p className={hintClass}>{visit.site} will be kept as an archived location, with this reason, from the day of the visit. An archived location is archived for good: it never goes back to active, and it can no longer be changed.</p>
    </div>
  )
  const gapM = gpsDistance(visit, location)
  const errors = { ...visitErrors(visit, made?.length === 0), ...conflicts, ...(gapM != null && gapM > GPS_TOLERANCE_M ? { latitude: `The GPS is ${gapM} m from the location.` } : {}) }
  const moreErrors = { ...detailsErrors(visit.details), ...installationErrors(visit) }
  const shown = (field: ErrorKey) => (tried ? errors[field] : undefined)
  // What the visit needs and does not have yet is in red from the start, not only once adding it was tried.
  const red = 'border-red-500 dark:border-red-500'
  const err = (field: ErrorKey) => (shown(field) ? red : '')

  useEffect(() => {
    let cancelled = false
    api.getSettings()
      .then((settings) => {
        if (cancelled) return
        setTrappers((settings.FIELDWORK?.trappers ?? []).filter((t) => !t.status || t.status === 'active'))
        setSdCards(settings.FIELDWORK?.sd_cards ?? [])
        setCameras(settings.FIELDWORK?.cameras ?? [])
        setSourcesUsed({ epicollect: settings.EPICOLLECT5?.enabled ?? false })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [settingsOpen])

  useEffect(() => {
    setAllVisits(null); setProjectLocations([])
    if (!project) return
    let cancelled = false
    Promise.resolve().then(() => api.listLocalLocations(project.acronym))
      .then(({ results }) => { if (!cancelled) setProjectLocations(results.filter(inTheApp)) })
      .catch(() => {})
    Promise.resolve().then(() => api.listVisits(project.acronym))
      .then(({ results }) => { if (!cancelled) setAllVisits(results) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [project])

  useEffect(() => {
    if (!project || !location) { setKept(null); return }
    let cancelled = false
    api.listVisits(project.acronym, location.location_id)
      .then(({ results }) => { if (!cancelled) setKept(results) })
      .catch(() => { if (!cancelled) setKept(null) })
    return () => { cancelled = true }
  }, [project, location])

  function selectProject(picked: LocalResearchProject | undefined) {
    setProject(picked); setLocation(undefined)
    setVisit((v) => ({ ...v, site: '', latitude: '', longitude: '' }))
    setEditingWhere(true)
  }

  /** The location is the site of the visit; its coordinates are where the camera is, unless the visit says otherwise. */
  function selectLocation(picked: LocalLocation | undefined) {
    setLocation(picked); setFilledFrom(null)
    setVisit((v) => ({
      ...v, site: picked?.location_id ?? '',
      latitude: picked?.latitude != null ? String(picked.latitude) : '', // the GPS of the note starts as the location's, to be corrected
      longitude: picked?.longitude != null ? String(picked.longitude) : '',
    }))
    setEditingWhere(!picked)
  }

  // Another way to read the visits starts again from the file.
  useEffect(() => {
    if (keepFile.current) keepFile.current = false
    else { forgetCsv(); setCsvName(null) }
    setImportRulesOpen(false)
    // the options of what is created start all marked in the WildINTEL CSV, where the form says everything but the timezone; in a custom CSV creating asks for more columns, so they start off
    const on = source === 'wildintel-new'
    setCsvCreate({ locations: on, cameras: on, sd_cards: on, trappers: on }); setCsvDefaults(on ? { timezone: 'UTC', daylight_saving: 'no' } : {})
    setCsvClose(true); setCsvLocationCoordinates(true); setCsvPhotosNotCounted(on)   // closing the revision before starts on in both: a revision left open for sites that were skipped is found weeks later
  }, [source]) // eslint-disable-line react-hooks/exhaustive-deps

  // What a custom CSV is asked besides its columns — the entities to create and the defaults —, said only when there is something.
  // (in the WildINTEL CSV the defaults are the timezone of the new locations: nothing is said of it when no location is created)
  const defaultsGiven = source === 'wildintel-new' && !csvCreate.locations ? {} : Object.fromEntries(Object.entries(csvDefaults).filter(([, v]) => v.trim()).map(([f, v]) => [f, v.trim()]))
  const csvOptions: ImportCsvOptions | undefined = (source === 'csv' || source === 'wildintel-new') && (Object.values(csvCreate).some(Boolean) || Object.keys(defaultsGiven).length > 0 || csvClose || !csvLocationCoordinates || csvPhotosNotCounted)
    ? { ...(Object.values(csvCreate).some(Boolean) ? { create: csvCreate } : {}), ...(Object.keys(defaultsGiven).length > 0 ? { defaults: defaultsGiven } : {}), ...(csvClose ? { close_revisions: true } : {}), ...(csvLocationCoordinates ? {} : { coordinates_from_location: false }), ...(csvPhotosNotCounted ? { photos_not_counted: true } : {}) } : undefined
  // What follows the mapping in the call that reads the file: the options, when there are any (so none is sent when none is given)
  const readTail: [options?: ImportCsvOptions] = csvOptions ? [csvOptions] : []
  const csvReading = useRef(0)
  // the options the file shown was read with
  const readWith = useRef<string | null>(null)
  // the file is being read: nothing of an earlier reading is shown meanwhile
  const [checking, setChecking] = useState(false)
  // the visits are to be confirmed: the step that says what is going to be done
  const [savedOpen, setSavedOpen] = useState(false)
  // the visits are to be reviewed and confirmed: the step after the check
  const [csvConfirming, setCsvConfirming] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  function forgetCsv() {
    csvReading.current++ // what an older file is still being answered is left out
    setChecking(false); setSavedOpen(false); setCsvConfirming(false); setNotesOpen(false)
    setCsvResult(null); setCsvError(null); setCsvSaved(null); setCsvColumns(null); setCsvMapping({}); setFileConfirmed(false); setFileReady(false)
  }

  async function readCsv(file: File | undefined) {
    forgetCsv()
    const reading = ++csvReading.current
    if (!file || !project) { setCsvName(null); return }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setCsvName(null)
      setCsvError('Choose a CSV file.')
      return
    }
    setCsvName(file.name)
    try {
      const text = await file.text()
      if (reading !== csvReading.current) return
      setCsvText(text)
      // the file of another CSV has its columns matched next; the others are checked when Continue is pressed
      const found = await api.visitsCsvColumns(text)
      if (reading === csvReading.current) { applyDetected(found); setFileReady(true) }
    } catch (e) {
      if (reading === csvReading.current) { setCsvError(e instanceof Error ? e.message : 'Could not read the file.'); setChecking(false) }
    }
  }

  /** The file is read: its columns are kept and the type detected is the one to go on with, unless the user says the other. */
  function applyDetected(found: VisitsCsvColumns) {
    setCsvColumns(found); setCsvMapping(found.mapping)
    chooseKind(found.kind === 'form' ? 'wildintel-new' : 'csv')
  }

  /** Goes on as the field form of Epicollect5 or as another CSV, with the file already read. */
  function chooseKind(next: 'wildintel-new' | 'csv') {
    if (next !== source) keepFile.current = true
    setSource(next)
  }

  /** Checks the file chosen — what Continue of the step of the file does for the ones that have no columns to match. */
  async function checkFile() {
    if (!project || !csvText) return
    const reading = ++csvReading.current
    readWith.current = JSON.stringify(csvOptions ?? null)
    const tail: [mapping?: Record<string, string>, options?: ImportCsvOptions] = csvOptions ? [undefined, csvOptions] : []
    setCsvResult(null); setCsvError(null); setChecking(true)
    try {
      const result = await api.importVisitsCsv(project.acronym, csvText, false, csvFormat, ...tail)
      if (reading === csvReading.current) setCsvResult(result)
    } catch (e) {
      if (reading === csvReading.current) setCsvError(e instanceof Error ? e.message : 'Could not read the file.')
    } finally {
      if (reading === csvReading.current) setChecking(false)
    }
  }

  /** Custom CSV, from Epicollect: the entries of the project of the settings are downloaded as a CSV and go on as any file does — its columns are matched next. */
  async function downloadEpicollect() {
    forgetCsv()
    if (!project) return
    const reading = ++csvReading.current
    setCsvName('Epicollect5'); setDownloading(true)
    try {
      const { csv } = await api.epicollectVisitsDownload()
      if (reading !== csvReading.current) return
      setCsvText(csv)
      const found = await api.visitsCsvColumns(csv)
      if (reading === csvReading.current) { applyDetected(found); setFileReady(true) }
    } catch (e) {
      if (reading === csvReading.current) setCsvError(e instanceof Error ? e.message : 'Could not read Epicollect5.')
    } finally { setDownloading(false) }
  }

  /** Reads the file again with the same options — after the settings were open, where the missing locations may have been added. */
  async function recheckCsv() {
    if (!project || !csvText) return
    setRechecking(true)
    readWith.current = JSON.stringify(csvOptions ?? null)
    try {
      setCsvResult(await api.importVisitsCsv(project.acronym, csvText, false, source === 'csv' ? 'mapped' : csvFormat, source === 'csv' ? csvMapping : undefined, ...readTail))
      setCsvError(null)
    } catch (e) {
      setCsvError(e instanceof Error ? e.message : 'Could not read the file.')
    } finally {
      setRechecking(false)
    }
  }
  const missingLocations = (csvResult?.new_sites.length ?? 0) > 0
  // The rows of a revision that cannot start because the one before it is not finished: what is still to be visited there, and the way to finish it.
  const unfinishedBefore = (() => {
    if (csvClose) return null
    const found = (csvResult?.problems ?? []).map((p) => /^(R\d{4}) cannot start: (R\d{4}) is not finished, \d+ location\(s\) still to be visited in it: (.*)\.$/.exec(p.message)).filter((m): m is RegExpExecArray => m !== null)
    if (found.length === 0) return null
    const revisions = [...new Set(found.map((m) => m[2]))]
    return { starts: [...new Set(found.map((m) => m[1]))], revisions, sites: [...new Set(found.flatMap((m) => m[3].split(', ')))] }
  })()
  function closeBeforeAndRead() {
    setCsvClose(true)
    if (source !== 'wildintel-new') setCloseAndRead(true)   // the file of the new form is read again by itself when the option changes
  }
  useEffect(() => { if (closeAndRead) { setCloseAndRead(false); void recheckCsv() } }, [closeAndRead]) // eslint-disable-line react-hooks/exhaustive-deps
  // What is odd in the visits is told in the rows it is about; the notice keeps what no row has.
  const noticeWarnings = (csvResult?.rows?.length ?? 0) > 0 ? (csvResult?.loose_warnings ?? []) : (csvResult?.warnings ?? [])
  // The rows of the file are told by the row-by-row results; when there are none, the problems are listed.
  const listedProblems = (csvResult?.rows?.length ?? 0) > 0 ? [] : (csvResult?.problems ?? [])
  useEffect(() => { if (!settingsOpen && missingLocations) void recheckCsv() }, [settingsOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  // The file of the new form is read again when what is created changes — it has no matching of columns to press Check in.
  useEffect(() => {
    if (source !== 'wildintel-new' || !csvText || !csvResult) return
    if (readWith.current !== JSON.stringify(csvOptions ?? null)) void recheckCsv()
  }, [csvCreate, csvDefaults, csvClose, csvLocationCoordinates, csvPhotosNotCounted]) // eslint-disable-line react-hooks/exhaustive-deps

  /** From another CSV file: reads the visits with the columns as they are mapped. */
  async function readMapped() {
    if (!project) return
    setCsvError(null)
    setChecking(true)
    try {
      setCsvResult(await api.importVisitsCsv(project.acronym, csvText, false, 'mapped', csvMapping, ...readTail))
    } catch (e) {
      setCsvError(e instanceof Error ? e.message : 'Could not read the file.')
    } finally {
      setChecking(false)
    }
  }

  async function addCsvVisits() {
    if (!project || csvSaving) return
    setCsvError(null)
    setCsvSaving(true)
    try {
      const done = await api.importVisitsCsv(project.acronym, csvText, true, csvFormat, source === 'csv' ? csvMapping : undefined, ...readTail)
      setCsvResult(done); setCsvSaved(done.saved)
      void findClosed(done.visits)
    } catch (e) {
      setCsvError(e instanceof Error ? e.message : 'Could not save the visits.')
    } finally {
      setCsvSaving(false)
    }
  }

  // A visit needs a site, what was done, and when: a date and a time, the two in one column, or the time the entry was created.
  // A field is given by a column or by a default value.
  const given = (field: string) => !!csvMapping[field] || !!csvDefaults[field]?.trim()
  // What creating asks for: the fields each entity that is created needs.
  // The fields that are asked: those of an entity only when it is created.
  const fieldsShown = (csvColumns?.fields ?? []).filter((f) => f.field !== 'setup_by' && (!f.entity || csvCreate[f.entity])) // who set up is who went: one field
  const createdNeeds = (csvColumns?.fields ?? []).filter((f) => (f.required_with ?? []).some((e) => csvCreate[e]))
  // every option of the box, marked or cleared together
  const optionsOn = [...Object.values(csvCreate), csvPhotosNotCounted, csvLocationCoordinates, csvClose].filter(Boolean).length
  const everyOption = optionsOn === 7
  const allOptions = (on: boolean) => { setCsvCreate({ locations: on, cameras: on, sd_cards: on, trappers: on }); setCsvPhotosNotCounted(on); setCsvLocationCoordinates(on); setCsvClose(on) }
  const defaultOptions = source === 'wildintel-new' ? everyOption : optionsOn === 2 && !Object.values(csvCreate).some(Boolean) && !csvPhotosNotCounted && csvLocationCoordinates && csvClose
  const defaultTimezone = !csvCreate.locations || source !== 'wildintel-new' || ((csvDefaults.timezone ?? 'UTC') === 'UTC' && (csvDefaults.daylight_saving ?? 'no') === 'no')
  const createSwitches = (
    <div className="space-y-3">
      {source === 'wildintel-new' && csvCreate.locations && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 border-b border-zinc-200 dark:border-zinc-700 pb-5 sm:grid-cols-2">
          <div>
            <label htmlFor="epicollect-timezone" className={labelClass}>Timezone of the new locations</label>
            <p className={hintClass}>Only for the locations this file adds. Their coordinates are those of their first visit.</p>
          </div>
          <div>
            <TimezoneCombobox id="epicollect-timezone" value={csvDefaults.timezone ?? 'UTC'}
                              onChange={(timezone) => setCsvDefaults((d) => ({ ...d, timezone, daylight_saving: timezone.trim().toUpperCase() === 'UTC' ? 'no' : ((d.timezone ?? 'UTC').trim().toUpperCase() === 'UTC' ? 'yes' : d.daylight_saving ?? 'yes') }))} />
            {(csvDefaults.timezone ?? 'UTC').trim().toUpperCase() !== 'UTC' && (
              <div className="mt-4">
                <span id="epicollect-dst-label" className={labelClass}>Their cameras follow summer time</span>
                <div role="group" aria-labelledby="epicollect-dst-label" className="inline-flex w-full gap-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900/60 p-1">
                  {(['yes', 'no'] as const).map((v) => (
                    <button key={v} type="button" aria-pressed={(csvDefaults.daylight_saving ?? 'yes') === v} onClick={() => setCsvDefaults((d) => ({ ...d, daylight_saving: v }))}
                            className={`flex-1 px-5 py-2 text-sm font-semibold rounded-lg transition-colors ${(csvDefaults.daylight_saving ?? 'yes') === v ? 'bg-blue-600 text-white shadow' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100'}`}>{v === 'yes' ? 'Yes' : 'No'}</button>
                  ))}
                </div>
                <p className={hintClass}>Yes if the camera clocks are moved forward one hour in summer.</p>
              </div>
            )}
          </div>
        </div>
      )}
      <h6 className="pt-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Add what WildINTEL Uploader does not have yet (4)</h6>
      {([
        ['locations', 'Create the locations that do not exist', 'A location the file names that the research project does not have yet is added. From the WildINTEL form it takes the coordinates of its first visit; from a custom CSV it needs its coordinates and timezone.'],
        ['cameras', 'Create the cameras that do not exist', 'A camera the file names that WildINTEL Uploader does not have yet is added. From a custom CSV it needs its model.'],
        ['sd_cards', 'Create the SD cards that do not exist', 'A card the file names that WildINTEL Uploader does not have yet is added, with its name as written: 7b and 7B are two cards. From a custom CSV it needs its brand.'],
        ['trappers', 'Create the trappers that do not exist', 'A name in the file that is not a trapper yet is added as one: the username is made from the name (Ana Pérez becomes ana.perez). Complete them later in Settings › Trappers.'],
      ] as const).map(([entity, label, hint]) => {
        const toSet = (on: boolean) => setCsvCreate((c) => ({ ...c, [entity]: on }))
        return <SwitchRow key={entity} label={label} hint={hint} checked={csvCreate[entity]} onChange={toSet} />
      })}
      <h6 className="pt-4 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Rows with something missing (3)</h6>
      <SwitchRow label="The images were not counted" hint="For old datasheets: a visit that collected a card but has no image count is accepted, and the count is left empty." checked={csvPhotosNotCounted} onChange={setCsvPhotosNotCounted} />
      <SwitchRow label="Use the coordinates of the location when a row has none" hint="A row with no coordinates takes those of its location. Off, a row with no coordinates is refused." checked={csvLocationCoordinates} onChange={setCsvLocationCoordinates} />
      <SwitchRow label="Close the revision before when it has locations still planned" hint="A revision can only be added when the one before it is complete. On, the locations with no visit in the revision before are marked as not visited." checked={csvClose} onChange={setCsvClose} />
    </div>
  )
  const mappedEnough = given('location_id') && given('actions') && (given('when') || given('created_at') || (given('date') && given('time'))) && createdNeeds.every((f) => given(f.field))
  // What is still to be matched before the visits can be read: the site, the actions and when — a date and a time, or one column with both, or the time the entry was created.
  const inOneColumn = given('when') || given('created_at')
  const stillToMap = [
    !given('location_id') && 'the location', !given('actions') && 'the actions',
    ...(inOneColumn ? [] : !given('date') && !given('time') ? ['the date and the time (or one column with both)'] : [!given('date') && 'the date', !given('time') && 'the time']),
    ...createdNeeds.filter((f) => !given(f.field) && !['location_id', 'actions', 'date', 'time'].includes(f.field)).map((f) => f.label.replace(/ \(.*$/, '').toLowerCase()),
  ].filter(Boolean) as string[]

  // The revision of the visit is the next of its location; it cannot start while the one before it has locations still to be visited.
  const revisionBlock = allVisits && location && !editingWhere && nextOne?.starts && nextOne.latest !== null
    ? unfinishedRevision(nextOne.latest + 1, allVisits, projectLocations, visit.when.slice(0, 10)) : null
  const whereDone = !!project && !!location && !editingWhere && !revisionBlock
  const [marking, setMarking] = useState(false)
  // Marking the locations as not visited finishes the revision before: it is asked again before it is done.
  const [confirmingMark, setConfirmingMark] = useState(false)
  // The locations of the revision before that were not visited are marked as such — the visits that could not be made — and the revision is finished.
  async function markNotVisited() {
    if (!project || !revisionBlock) return
    setMarking(true)
    try {
      setConfirmingMark(false)
      await api.markNotVisited(project.acronym, revisionBlock.previous)
      setAllVisits((await api.listVisits(project.acronym)).results)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'The locations could not be marked as not visited.')
    } finally {
      setMarking(false)
    }
  }
  const whenDone = whereDone && whenConfirmed && !!visit.when
  const asked = askedOf(visit)
  // What the last visit to the location left in the camera: the card the one that is collected now was.
  // A visit that could not be made says nothing of the camera, the site or the card: the last one that was made is the one that does.
  const lastVisit = made ? latest(made) : undefined
  // The card in the camera is the one the latest visit that left one says — a later visit that left none (or could not be made) does not take it out.
  const cardVisit = kept ? latest(kept.filter((w) => w.sd?.trim())) : undefined
  const inCamera = cardVisit?.sd ?? null
  const on = (ask: Ask) => ask !== 'off'
  const sdValues = [...(on(asked.sdLeft) ? [visit.sd] : []), ...(on(asked.photos) ? [visit.numPhotos] : []), ...(on(asked.card) ? [visit.card] : [])]
  const cameraValues = [...(on(asked.batteries) ? [visit.batteries] : []), ...(on(asked.status) ? [visit.status] : []), ...(on(asked.dateTime) ? [visit.dateTimeOK] : [])]

  function set<K extends keyof Visit>(field: K, value: Visit[K]) {
    setVisit((v) => ({ ...v, [field]: value }))
  }

  /** The camera of the visit is one of the settings: its id and its model go with the visit. */
  function pickCamera(label: string) {
    const camera = cameras.find((c) => c.label === label)
    setVisit((v) => ({ ...v, details: { ...v.details, camera_id: camera ? cameraKey(camera) : null, camera_model: camera?.camera_model ?? null } }))
  }

  function setDetail<K extends keyof DeploymentFields>(key: K, value: DeploymentFields[K]) {
    setVisit((v) => ({ ...v, details: { ...v.details, [key]: value } }))
  }

  /** The visits the ones just kept closed — their card was collected — so that their images can be imported. */
  // Each visit the ones just added closed: its card was collected, so its images can be imported — a card of its own, with the way in on the right.

  const closedLinks = onImportImages && project && justClosed.length > 0 && (
    <section aria-label="Deployments" className={REVIEW_CARD}>
      <h6 className={`${REVIEW_HEAD} justify-between`}>
        <span className="flex items-center gap-2">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-sky-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{MENU_ICONS.deployment}</svg>
          Deployments
        </span>
        <span className="rounded-full px-2.5 py-1 text-xs font-semibold normal-case tracking-normal bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">To create</span>
      </h6>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">The visits whose cards were collected by the ones just added can have their images imported now, or later from the deployments menu.</p>
      <div className="space-y-3">
        {justClosed.map((c) => (
          <div key={`${c.visit.location_id}|${c.visit.date}|${c.visit.time}`} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">The visit <strong>{c.visit.session}</strong> to {c.visit.location_id} has its card collected on {formatVisitWhen(c.end)}.</p>
            <button type="button" className={`${btnPrimary} inline-flex shrink-0 items-center justify-center gap-2 !h-12`} aria-label={`Import the images of the visit ${c.visit.session} to ${c.visit.location_id}`} onClick={() => onImportImages({ researchProjectId: project.acronym, visit: c.visit })}>
              <Glyph className="h-5 w-5">{MENU_ICONS.deployment}</Glyph>Import the images
            </button>
          </div>
        ))}
      </div>
    </section>
  )

  async function findClosed(by: { location_id: string; date: string; time: string }[]) {
    if (!project) return
    try {
      const { results } = await api.closedVisits(project.acronym)
      setJustClosed(results.filter((c) => by.some((v) => v.location_id.toLowerCase() === c.end.location_id.toLowerCase() && v.date === c.end.date && v.time === c.end.time)))
    } catch { setJustClosed([]) }
  }

  /** What stops the visit being added yet — nothing when it is complete. */
  const incomplete = Object.keys(errors).length > 0 || Object.keys(moreErrors).length > 0 || !project || !kept
    || (guided && seeCamera === 'yes' && !visit.status)
  // A visit cannot be changed once it is created: it is asked again before it is kept.
  const [confirming, setConfirming] = useState(false)
  function review() {
    setTried(true)
    if (incomplete) return
    setSaveError(null)
    setConfirming(true)
  }

  async function add() {
    setTried(true)
    setConfirming(false)
    if (incomplete) return
    setSaveError(null)
    // The session is worked out from the visits kept to the location, as its coordinates come from the location.
    const complete: Visit = { ...visit, session: nextSession ?? sessionOf(kept.length), site: visit.site.trim() }
    try {
      await api.saveVisit(project.acronym, toStored(complete))
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save the visit.')
      return
    }
    // A camera found stolen, and the card that was in it, are marked as not available.
    if (theft) {
      const day = complete.when.slice(0, 10)
      try {
        await api.setFieldItemStatus(project.acronym, 'cameras', theft, 'stolen', day, 'Stolen')
        if (stolenCard) await api.setFieldItemStatus(project.acronym, 'sd_cards', stolenCard, 'stolen', day, 'Stolen with the camera')
        setCameras((list) => list.map((c) => (cameraKey(c) === theft || c.label === theft ? { ...c, status: 'archived' as const, archive_reason: 'stolen' as const, status_date: day } : c)))
        if (stolenCard) setSdCards((list) => list.map((c) => (c.label === stolenCard ? { ...c, status: 'archived' as const, archive_reason: 'stolen' as const, status_date: day } : c)))
      } catch (e) {
        setSaveError(e instanceof Error ? `The visit is kept, but the camera or the card could not be marked as stolen: ${e.message}` : 'The visit is kept, but the camera or the card could not be marked as stolen.')
      }
    }
    // The visit archived the location (its Archive action): the reason is what its note says.
    if (archiving) {
      try {
        await api.updateLocalLocation(project.acronym, complete.site, { status_note: archiveReason.trim() || null })
      } catch (e) {
        setSaveError(e instanceof Error ? `The visit is kept and the location archived, but its reason could not be noted: ${e.message}` : 'The visit is kept and the location archived, but its reason could not be noted.')
      }
    }
    setVisits((list) => [...list, complete])
    setZones((z) => ({ ...z, [`${complete.session}|${complete.site}`]: location?.timezone }))
    setJustAdded(true)
    setJustClosed([])
    setAllVisits((list) => (list ? [...list, toStored(complete)] : list))
    void findClosed([toStored(complete)])
    // The next visit is usually of the same trip: keep who went.
    // The research project stays too; the next visit is to another site, so the location is asked again.
    setVisit({ ...EMPTY_VISIT, trappers: visit.trappers })
    setFilledFrom(null)
    setLocation(undefined)
    setEditingWhere(true)
    setWhenConfirmed(false)
    setTried(false)
  }

  return (
    <div className={PAGE_CLASS}>
      <PageHeader icon={<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />} title="Register the visits" description="Bring in the visits to the camera traps. From them WildINTEL Uploader knows which images belong to which camera, location and period." parent="Menu" onParent={onBack} />
      <WizardStep
        n={1} title="Where do the visits come from?" status={justAdded ? 'locked' : source ? 'done' : 'open'} sealed={csvSaved !== null} canEdit={!justAdded && csvSaved === null} onEdit={() => setSource(null)} lockedSummary
        description="Load them from a file, or enter them one by one."
        summary={chosen?.title}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SOURCE_OPTIONS.map((o) => <TaskCard key={o.value} icon={o.icon} title={o.title} description={o.description} selected={chosen?.value === o.value} onClick={() => setSource(o.value)} />)}
        </div>
      </WizardStep>

      {byHand && (
        <>
          {justAdded && visits.length > 0 && (() => {
            const last = visits[visits.length - 1]
            return (
              <>
                <WizardStep n={2} title="Where was the visit?" status="locked" lockedSummary canEdit={false} onEdit={() => {}} description="" summary={<>{project?.acronym} · {last.site}</>} />
                <WizardStep n={3} title="Who went, and when?" status="locked" lockedSummary canEdit={false} onEdit={() => {}} description=""
                            summary={<>{last.trappers.trim() ? `${last.trappers.trim()} · ` : ''}{formatLocal(last.when, zones[`${last.session}|${last.site}`])}</>} />
                <WizardStep n={4} title="Enter the visit" status="locked" lockedSummary canEdit={false} onEdit={() => {}} description=""
                            summary={[last.actions.length === 0 ? 'Not visited' : actionsText(last.actions), last.details.camera_id && `camera ${last.details.camera_id}`, last.sd && `SD card ${last.sd}`].filter(Boolean).join(' · ')} />
                <WizardStep n={5} title="Check and add the visit" status="locked" lockedSummary canEdit={false} onEdit={() => {}} description=""
                            summary={`${visits.length} ${visits.length === 1 ? 'visit' : 'visits'} added · ${last.session}`} />
              </>
            )
          })()}
          {!justAdded && (
          <>
          <WizardStep
            n={2} title="Where was the visit?" status={whereDone ? 'done' : 'open'} canEdit onEdit={() => setEditingWhere(true)}
            description={defaultProject
              ? `Select the location of the visit within the research project ${defaultProject.acronym}.`
              : 'The research project and the location of the visit. They are kept in the collections folder — pick one that is already there, or add a new research project.'}
            summary={project && <>
              {project.acronym} · {visit.site}{location?.name ? `, ${location.name}` : ''}
              {kept && <><br />Revision {nextSession}{latest(made!) && <> — the last was on {formatVisitWhen(latest(made!)!)} ({actionsText(latest(made!)!.actions)})</>}</>}
            </>}
          >
            {!defaultProject && <ResearchProjectPicker value={project?.acronym ?? ''} onSelect={selectProject} />}
            {revisionBlock && !confirmingMark && (
              <Notice kind="warning" role="alert" className="mb-3" action={<button type="button" className={btnOutline} disabled={marking} onClick={() => setConfirmingMark(true)}>Mark them as not visited</button>}>
                {revisionBlock.message} This visit cannot be made until it is. Do you want to mark as not visited the locations of {revisionBlock.previous} that still are not visited: {revisionBlock.missing.join(', ')}?
              </Notice>
            )}
            {revisionBlock && confirmingMark && (
              <Notice kind="warning" role="alert" className="mb-3" action={(
                <span className="flex gap-2">
                  <button type="button" className={btnOutline} disabled={marking} onClick={() => setConfirmingMark(false)}>Cancel</button>
                  <button type="button" className={btnPrimary} disabled={marking} onClick={() => void markNotVisited()}>Yes, mark them as not visited</button>
                </span>
              )}>
                Once this is done, the visit book of <strong>{revisionBlock.previous}</strong> will be consolidated and it cannot be modified. Do you want to mark {revisionBlock.missing.join(', ')} as not visited?
              </Notice>
            )}
            {project && <LocationPicker researchProjectId={project.acronym} trapperPk={project.trapper_pk} value={visit.site} onSelect={selectLocation} onCreateInSettings={onOpenSettings && (() => onOpenSettings('locations'))} />}
          </WizardStep>

          <WizardStep
            n={3} title="Who went, and when?" status={!whereDone ? 'locked' : whenDone ? 'done' : 'open'} canEdit onEdit={() => setWhenConfirmed(false)}
            description={!location?.timezone
              ? 'Who made the visit, and the day and the time of it.'
              : <>Who made the visit, and the day and the time of it. Times are in <strong>{location.timezone}</strong>, which <strong>{location.ignore_dst ? 'has no daylight saving time' : 'follows daylight saving time'}</strong>.</>}
            summary={visit.when && <>{visit.trappers.trim() ? `${visit.trappers.trim()} · ` : ''}{formatLocal(visit.when, location?.timezone)}</>}
          >
            {/* who went is the deployment's setupBy, and when it was is where it starts and ends: fields of Camtrap DP */}
            <CamtrapDpContext.Provider value>
            <FormCard title="Who" tag={<CamtrapDpTag />} description="The trappers kept in the settings.">
              {(() => {
                const chosen = namesOf(visit.trappers)
                const picked = new Set(trappers.filter((t) => chosen.some((n) => n === t.name)).map((t) => t.name))
                // what the list picks replaces the names of the list that are on the visit; a name that is not in it — typed in a file — is left as it is
                const pick = (next: Set<string>) => {
                  const listed = new Set(trappers.map((t) => t.name))
                  const outside = chosen.filter((n) => !listed.has(n))
                  set('trappers', [...outside, ...trappers.filter((t) => next.has(t.name)).map((t) => t.name)].join(', '))
                }
                return (
                  <>
                    {trappers.length > 0 && (
                      <PickTable
                        items={trappers} keyOf={(t) => t.name} defaultView="search" perPage={5}
                        many={{ selected: picked, onChange: pick, noun: 'trappers' }}
                        columns={[
                          { label: 'Name', className: 'px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-200', cell: (t) => t.name },
                          { label: 'Username', className: 'px-4 py-3 font-mono', cell: (t) => t.username },
                          { label: 'Affiliation', cell: (t) => t.affiliation ?? '—' },
                        ]}
                        searchText={(t) => [t.name, t.username, t.affiliation].filter(Boolean).join(' ')}
                        renderLabel={(t, isPicked, press) => (
                          <LabelFrame picked={isPicked} name={t.name} onPress={press}>
                            <span className="flex items-center justify-between gap-3"><strong className="text-zinc-900 dark:text-white">{t.name}</strong>{isPicked && <PickedTick />}</span>
                            <span className="mt-1 block text-sm text-zinc-500 dark:text-zinc-400">{[t.username, t.affiliation].filter(Boolean).join(' · ')}</span>
                          </LabelFrame>
                        )}
                        names={{ table: 'Trappers', search: 'Filter the trappers', items: 'trappers', pick: (t) => t.name, pickPlaceholder: 'Select a trapper…' }}
                        optionLabel={(t) => [t.name, t.affiliation].filter(Boolean).join(' — ')}
                        searchPlaceholder="Search by name, username, affiliation…" empty="No trapper matches."
                      />
                    )}
                    {trappers.length === 0 && <p className={hintClass}>The settings have no trappers yet.</p>}
                    {onOpenSettings && (
                      <p className={`${hintClass} mt-3`}>
                        The trapper is not here? A new trapper is created in the settings:{' '}
                        <button type="button" className="text-blue-600 dark:text-blue-400 hover:underline" onClick={() => onOpenSettings('trappers')}>go to Settings › Trappers</button>.
                      </p>
                    )}
                    {chosen.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3" role="list" aria-label="Who went">
                        {chosen.map((name) => (
                          <span key={name} role="listitem" className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 dark:border-zinc-600 px-3 py-1 text-sm text-zinc-700 dark:text-zinc-300">
                            {name}
                            <button type="button" aria-label={`Remove ${name}`} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => set('trappers', removeName(visit.trappers, name))}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )
              })()}
            </FormCard>
            <FormCard title="When">
              <div className="max-w-2xl">
                <DateTimeField label="Date and time of the visit" required value={visit.when} onChange={(v) => set('when', v)} error={shown('when')}
                               extra={<div className="contents" role="group" aria-label="Quick times">
                                 {[[0, 'Now'], [5, '5 min ago'], [10, '10 min ago']].map(([min, text]) => (
                                   <button key={min} type="button" className={roundPill(false)} onClick={() => set('when', wallClockAgo(location?.timezone, min as number))}>{text}</button>
                                 ))}
                               </div>} />
              </div>
            </FormCard>
            </CamtrapDpContext.Provider>
            {visit.site && (
              <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-6 py-5">
                <h5 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">GPS where the note was taken <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">to check the location</span></h5>
                <p className={hintClass}>The coordinates of the GPS where the note was taken. They start as those of the location, and are compared with those of {visit.site}{location?.latitude != null && location?.longitude != null ? ` (${location.latitude}, ${location.longitude})` : ''}.</p>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] items-end gap-4 mt-3 max-w-xl">
                  <Field id="visit-latitude" label="Latitude"><input id="visit-latitude" type="number" step="any" min={-90} max={90} className={inputClass} value={visit.latitude} onChange={(e) => set('latitude', e.target.value)} /></Field>
                  <Field id="visit-longitude" label="Longitude"><input id="visit-longitude" type="number" step="any" min={-180} max={180} className={inputClass} value={visit.longitude} onChange={(e) => set('longitude', e.target.value)} /></Field>
                  <IconButton label="Use my current position" title={locating === 'asking' ? 'Asking the browser…' : 'Use my current position'} disabled={locating === 'asking'} onClick={useMyPosition}
                              path={<><circle cx="12" cy="12" r="3" className={locating === 'asking' ? 'animate-pulse' : ''} /><circle cx="12" cy="12" r="8" /><path d="M12 1v4M12 19v4M1 12h4M19 12h4" /></>} />
                </div>
                {locating !== 'idle' && locating !== 'asking' && <Notice kind="error" role="alert" className="mt-3">{locating}</Notice>}
                {gapM != null && (gapM > GPS_TOLERANCE_M
                  ? <Notice kind="error" role="alert" className="mt-3">These coordinates are {gapM < 1000 ? `${gapM} m` : `${(gapM / 1000).toFixed(1)} km`} from {visit.site}, more than {GPS_TOLERANCE_M / 1000} km: check that the location is the right one, or the coordinates.</Notice>
                  : <Notice kind="success" className="mt-3">{gapM} m from {visit.site}: the location matches.</Notice>)}
              </div>
            )}
            <div className="flex justify-between items-center mt-4">
              <button type="button" className={btnOutline} onClick={() => setEditingWhere(true)}><span aria-hidden="true">← </span>Back</button>
              <button type="button" aria-label="Continue to the visit" className={btnPrimary} disabled={!visit.when} onClick={() => setWhenConfirmed(true)}>Continue<span aria-hidden="true"> →</span></button>
            </div>
          </WizardStep>

          <WizardStep n={4} title="Enter the visit" status={confirming ? 'done' : whenDone ? 'open' : 'locked'} canEdit={confirming} onEdit={() => setConfirming(false)} summary="What was entered is in the next step." description={<>What was done at this visit. The fields tagged <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">Camtrap DP</span> are those of the deployments table of the Camtrap Data Package; the others are the visit&rsquo;s own.</>}>
            <form noValidate onSubmit={(e) => { e.preventDefault(); review() }}>
              {lastVisit && (
                <div className="mb-4">
                  {filledFrom === lastVisit.session ? (
                    <Notice kind="success" role="status" action={<button type="button" className={btnOutline} onClick={() => { setVisit((v) => ({ ...EMPTY_VISIT, trappers: v.trappers, session: v.session, when: v.when, site: v.site, actions: v.actions, latitude: v.latitude, longitude: v.longitude })); setFilledFrom(null) }}>Start empty</button>}>
                      The Camera, Site and Grouping sections are filled in from the visit <strong>{lastVisit.session}</strong>, except the notes. What the actions do not ask is left out when the visit is kept.
                    </Notice>
                  ) : (
                    <Notice kind="info" action={<button type="button" className={btnOutline} onClick={() => { setVisit((v) => withoutWhatIsNotAsked(visitFrom(lastVisit, v))); setFilledFrom(lastVisit.session) }}>Fill in from {lastVisit.session}</button>}>
                      This is not the first visit to <strong>{visit.site}</strong>: the last was <strong>{lastVisit.session}</strong>, on {formatVisitWhen(lastVisit)} ({actionsText(lastVisit.actions)}). Fill in the Camera, Site and Grouping sections with what it said (not the notes).
                    </Notice>
                  )}
                </div>
              )}
              <FormCard title={guided ? undefined : 'The visit'}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {guided ? (
                    <fieldset className="sm:col-span-2" aria-describedby="visit-actions-hint">
                      <legend className={labelClass}>Do you see the camera?</legend>
                      {noCamera ? (
                        <ChoiceCards<'install' | 'cannot'> label="Do you see the camera?" value={seeCamera === 'cannot' ? 'cannot' : 'install'} onChange={(v) => setSeeCamera(v === 'cannot' ? 'cannot' : null)}
                          choices={[
                            { value: 'install', label: 'Of course not, I am going to install it', description: `No camera is known at ${visit.site}`, icon: CAMERA_PATHS.plus },
                            { value: 'cannot', label: 'No, I cannot make the visit', description: 'The visit could not be done', icon: CAMERA_PATHS.ban },
                          ]} />
                      ) : (
                        <ChoiceCards<'yes' | 'stolen' | 'cannot'> label="Do you see the camera?" value={seeCamera} onChange={setSeeCamera}
                          choices={[
                            { value: 'yes', label: 'Yes, I see it', description: 'The camera is there', icon: CAMERA_PATHS.eye },
                            { value: 'stolen', label: 'No, it was stolen', description: 'The camera is gone', icon: CAMERA_PATHS.alert, tone: 'red' },
                            { value: 'cannot', label: 'No, I cannot make the visit', description: 'The visit could not be done', icon: CAMERA_PATHS.ban },
                          ]} />
                      )}
                      {!noCamera && seeCamera === 'yes' && (
                        <div className="reveal mt-5 space-y-3" role="group" aria-label="What state is the camera in?">
                          <p className="text-sm font-semibold">What state is the camera in?</p>
                          <ChoiceCards<string> label="What state is the camera in?" value={visit.status || null} onChange={(v) => set('status', v)}
                            choices={FOUND_STATES.map((f) => ({ value: f.value, label: f.value, description: f.description, icon: f.icon }))} />
                          {tried && !visit.status && <p className="text-xs text-red-600 dark:text-red-400">Say what state the camera is in.</p>}
                        </div>
                      )}
                      {!noCamera && seeCamera === 'yes' && visit.status && (
                        <div className="reveal mt-5 space-y-3" role="group" aria-label="What do you do with the camera?">
                          <p className="text-sm font-semibold">What do you do with the camera?</p>
                          <ChoiceCards<'stay' | 'replace' | 'take' | 'remove'> label="What do you do with the camera?" size="compact" value={afterRevision} onChange={setAfterRevision}
                            choices={[
                              { value: 'stay', label: 'Leave it where it is', icon: CAMERA_PATHS.anchor },
                              { value: 'replace', label: 'Replace it with another', icon: CAMERA_PATHS.replace },
                              { value: 'take', label: 'Take it away', description: 'The location stays active', icon: CAMERA_PATHS.minus },
                              { value: 'remove', label: 'Take it away, and archive the location', icon: CAMERA_PATHS.archive },
                            ]} />
                          {afterRevision === 'remove' && archiveFields}
                        </div>
                      )}
                      {!noCamera && seeCamera === 'stolen' && (
                        <div className="reveal mt-5 space-y-3" role="group" aria-label="What now?">
                          <p className="text-sm font-semibold">What now?</p>
                          <ChoiceCards<'replace' | 'archive' | 'nothing'> label="What now?" size="compact" value={afterTheft} onChange={setAfterTheft}
                            choices={[
                              { value: 'replace', label: 'Install a new camera', icon: CAMERA_PATHS.plus, tone: 'red' },
                              { value: 'archive', label: 'Archive the location', icon: CAMERA_PATHS.ban, tone: 'red' },
                              { value: 'nothing', label: 'Nothing yet', description: 'Only the theft is noted', icon: CAMERA_PATHS.anchor, tone: 'red' },
                            ]} />
                          {afterTheft === 'archive' && archiveFields}
                        </div>
                      )}
                      <p id="visit-actions-hint" className="mt-5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800/60 px-4 py-3 text-xs sm:text-sm text-zinc-600 dark:text-zinc-300">
                        {notVisited ? <>The visit is kept as <strong>not visited</strong>: nothing was done at it, so it has no action, and no camera, card or images are asked.</> : visit.actions.length === 0 ? 'Answer the question: the rest of the form depends on it.' : <>The visit is kept as <strong>{actionsText(visit.actions)}</strong>. {actionsHint(visit.actions)}</>}
                      </p>
                      {shown('actions') && <p className="text-xs text-red-600 dark:text-red-400 mt-1">Say whether you see the camera.</p>}
                    </fieldset>
                  ) : (
                  <fieldset className="sm:col-span-2" aria-describedby="visit-actions-hint">
                    <legend className={labelClass}>Actions</legend>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      {ACTIONS.map((a) => (
                        <label key={a} className="inline-flex items-center gap-2 text-sm">
                          <input
                            type="checkbox" checked={visit.actions.includes(a)}
                            onChange={(e) => setVisit((v) => withoutWhatIsNotAsked({ ...v, actions: ACTIONS.filter((x) => (x === a ? e.target.checked : v.actions.includes(x))) }))}
                          />
                          {actionLabel(a)}
                        </label>
                      ))}
                    </div>
                    <p id="visit-actions-hint" className={hintClass}>
                      {visit.actions.length === 0 ? 'Choose what was done — more than one if the visit did several things: the rest of the form depends on it.' : visit.actions.map((a) => ACTION_HINTS[a]).join(' ')}
                    </p>
                    {shown('actions') && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{shown('actions')}</p>}
                  </fieldset>
                  )}
                </div>
                {made && made.length === 0 && !notVisited && (
                  <p role="status" className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                    This is the first visit to {visit.site}: it can only be an Installation, as no camera is known to be there yet.
                  </p>
                )}
                {guided && noCamera && firstEver && pendingSite && !notVisited && (
                  <p role="status" className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{visit.site} is pending: its first visit starts it, so the revisions before it do not wait for a visit to it.</p>
                )}
                {guided && noCamera && firstEver && !pendingSite && inRevision !== null && inRevision > 1 && !notVisited && (
                  <label className="mt-3 flex items-start gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                    <input type="checkbox" className="mt-1" checked={siteStarts} onChange={(e) => setSiteStarts(e.target.checked)} />
                    <span>
                      <strong className="font-semibold">This is where {visit.site || 'the site'} starts</strong>
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">The location did not exist before this revision, so the revisions before it do not wait for a visit to it. Leave it off if the location was there before and its earlier visits are not here.</span>
                    </span>
                  </label>
                )}
              </FormCard>

              {notVisited ? (
                <FormCard title="Why could the visit not be made?" description="Optional. Nothing else is asked of this visit.">
                  <label className="sr-only" htmlFor="not-visited-reason">Reason</label>
                  <textarea id="not-visited-reason" rows={3} className={inputClass} placeholder="e.g. the road was flooded" value={visit.details.comments ?? ''} onChange={(e) => setDetail('comments', e.target.value || null)} />
                </FormCard>
              ) : onlyNotes(visit.actions) ? (
                <FormCard title="Notes" description="Optional. Nothing else is asked of this visit: no camera, card or site details.">
                  {stolenCamera && <Notice kind="info" className="mb-4">The camera <strong>{stolenCamera}</strong> was stolen and will be archived.</Notice>}
                  {stolenCard && <Notice kind="info" className="mb-4">The SD card <strong>{stolenCard}</strong>, which was in the camera, was stolen with it and will be archived.</Notice>}
                  <label className="sr-only" htmlFor="visit-notes">Comments</label>
                  <textarea id="visit-notes" rows={3} className={inputClass} placeholder="e.g. the lock was cut" value={visit.details.comments ?? ''} onChange={(e) => setDetail('comments', e.target.value || null)} />
                </FormCard>
              ) : (
              <MoreDetailsForm deployment={visit.details} errors={{ ...detailsErrors(visit.details), ...Object.fromEntries(Object.keys(installationErrors(visit)).map((k) => [k, ''])) }} onField={setDetail} camtrapTags hideSetupBy hideSetup={takesAwayOnly(visit.actions)} requiredKeys={[...Object.keys(installationErrors(visit)), ...(visit.actions.includes('Installation') ? ['bait_use'] : [])]} cameraMissing={errors.camera ? 1 : 0}
                afterCamera={(on(asked.sdLeft) || on(asked.photos) || on(asked.card)) ? (
              <SectionCard
                title="SD card" icon={SD_ICON} total={sdValues.length} filled={sdValues.filter((v) => v.trim()).length} missing={(errors.sd ? 1 : 0) + (errors.numPhotos === 'Required.' ? 1 : 0)}
                summary={[on(asked.sdLeft) && visit.sd.trim() && `left ${visit.sd.trim()}`, on(asked.photos) && visit.numPhotos.trim() && `${visit.numPhotos.trim()} images`, on(asked.card) && `card ${visit.card === 'Full' ? 'full' : 'OK'}`].filter(Boolean).join(' · ')}
              >
                {stolenCard && <Notice kind="info" className="mb-4">The SD card <strong>{stolenCard}</strong>, which was in the camera, was stolen with it and will be archived.</Notice>}
                {on(asked.card) || on(asked.photos) ? (inCamera && cardVisit
                  ? <Notice kind="info" className="mb-4">Tell the state and the number of images obtained when removing the SD card <strong>{inCamera}</strong> from the camera (it was left there on {formatVisitWhen(cardVisit)}).</Notice>
                  : <Notice kind="info" className="mb-4">Tell the state and the number of images obtained when removing the SD card from the camera (no card is known to have been left in it).</Notice>) : null}
                {on(asked.card) && (
                <div className="space-y-3 mb-4">
                  <SwitchRow label="Card OK" hint="Off if the card was full." required={asked.card === 'required'} checked={visit.card === 'OK'} onChange={(on) => set('card', on ? 'OK' : 'Full')} />
                </div>
                )}
                <div className="space-y-3">
                  {on(asked.photos) && (
                  <ControlRow id="visit-photos" label="Images on the card collected" ask={asked.photos} error={shown('numPhotos')}
                              hint={inCamera && cardVisit ? <>SD card collected: <strong>{inCamera}</strong> (left on {formatVisitWhen(cardVisit)}).</> : 'No card is known to have been left in the camera.'}>
                    <input id="visit-photos" inputMode="numeric" className={`${inputClass} ${err('numPhotos') || (asked.photos === 'required' && !visit.numPhotos.trim() ? red : '')}`} value={visit.numPhotos} onChange={(e) => set('numPhotos', e.target.value)} />
                  </ControlRow>
                  )}
                  {on(asked.sdLeft) && (
                  <div>
                    <ControlRow id="visit-sd" label="SD card left in the camera" ask={asked.sdLeft}>
                    <Combobox
                      id="visit-sd" options={sdCards.filter((c) => !stolenCard || !visit.actions.includes('Installation') || c.label !== stolenCard).map((c) => ({ value: c.label, label: [c.label, [c.brand, c.capacity].filter(Boolean).join(' ')].filter(Boolean).join(' — ') }))}
                      value={visit.sd} onChange={(label) => set('sd', label)} invalid={asked.sdLeft === 'required' && !visit.sd.trim()}
                      placeholder={sdCards.length === 0 ? 'No SD cards yet' : 'Select an SD card…'} clearLabel="Clear SD card"
                    />
                    </ControlRow>
                    {conflicts.sd ? <Notice kind="error" role="alert" className="mt-2">{conflicts.sd}</Notice> : shown('sd') && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{shown('sd')}</p>}
                    {allSdCards.every((c) => !ofProject(c.research_project)) && <p className={hintClass}>The settings have no SD cards yet.</p>}
                    {sdCards.length === 0 && allSdCards.some((c) => ofProject(c.research_project)) && <p className={hintClass}>No SD card is ready: they are planned, archived, in a camera or were collected in this revision.</p>}
                    {onOpenSettings && (
                      <p className={`${hintClass} mt-3`}>
                        The SD card is not here? A new SD card is created in the settings:{' '}
                        <button type="button" className="text-blue-600 dark:text-blue-400 hover:underline" onClick={() => onOpenSettings('sdcards')}>go to Settings › SD cards</button>.
                      </p>
                    )}
                  </div>
                  )}
                </div>
              </SectionCard>
                ) : null}
                cameraNotice={thereWas || stolenCamera ? (
                  <div>
                    {stolenCamera && <Notice kind="info" className="mb-4">The camera <strong>{stolenCamera}</strong> was stolen and will be archived.</Notice>}
                    {thereWas && siteCamera && !stolenCamera && <Notice kind="info" className="mb-4">According to the visit <strong>{siteCamera.session}</strong>, the camera <strong>{siteCamera.camera}</strong> is installed at <strong>{visit.site.trim()}</strong>.</Notice>}
                  </div>
                ) : null}
                cameraPicker={(
                  <div className={on(asked.camera) ? 'mt-5' : undefined}>
                    {on(asked.camera) && (<>
                    <div className="flex items-baseline gap-2 mb-1.5">
                      <label htmlFor="visit-camera" className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Which camera will be installed?</label>
                      <AskTag ask={asked.camera} />
                      <CamtrapDpTag />
                    </div>
                    <Combobox
                      id="visit-camera" options={cameras.filter((c) => !theft || !visit.actions.includes('Installation') || (cameraKey(c) !== theft && c.label !== theft)).filter((c) => !ofTheSiteCamera || cameraKey(c) === siteCamera!.camera || c.label === siteCamera!.camera).map((c) => ({ value: c.label, label: c.camera_model ? `${c.label} — ${c.camera_model}` : c.label }))}
                      value={cameras.find((c) => cameraKey(c) === visit.details.camera_id)?.label ?? ''} onChange={pickCamera} invalid={asked.camera === 'required' && !visit.details.camera_id}
                      placeholder={cameras.length === 0 ? 'No cameras yet' : 'Select a camera…'} clearLabel="Clear camera"
                    />
                    {conflicts.camera ? <Notice kind="error" role="alert" className="mt-2">{conflicts.camera}</Notice> : shown('camera') && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{shown('camera')}</p>}
                    {visit.details.camera_model && <p className={hintClass}>Model: {visit.details.camera_model}</p>}
                    {cameras.length === 0 && <p className={hintClass}>The settings have no cameras yet.</p>}
                    {onOpenSettings && (
                      <p className={`${hintClass} mt-3`}>
                        The camera is not here? A new camera is created in the settings:{' '}
                        <button type="button" className="text-blue-600 dark:text-blue-400 hover:underline" onClick={() => onOpenSettings('cameras')}>go to Settings › Cameras</button>.
                      </p>
                    )}
                    </>)}
                  </div>
                )}
                beforeMounted={guided && asked.calibration !== 'off' ? (
                  <SwitchRow label="Calibration done" hint="On if the camera was calibrated at this visit." required={asked.calibration === 'required'} checked={visit.calibration === true} onChange={(on) => set('calibration', on)} />
                ) : null}
                cameraExtra={{
                show: on(asked.status) && !guided || on(asked.batteries) || on(asked.dateTime),
                title: siteCamera ? `How did it go with the camera ${siteCamera.camera}?` : 'How did it go with the camera?',
                total: cameraValues.length, filled: cameraValues.filter((v) => v.trim()).length,
                children: (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {!guided && on(asked.status) && (
                    <Field id="visit-status" label="Status of the camera" ask={asked.status} error={shown('status')}>
                        <select id="visit-status" className={`${inputClass} ${asked.status === 'required' && !visit.status.trim() ? red : ''}`} value={visit.status} onChange={(e) => set('status', e.target.value)}>
                          <option value="">—</option>
                          {CAMERA_STATUSES.map((a) => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </Field>
                    )}
                    {(on(asked.batteries) || on(asked.dateTime)) && (
                    <section className="sm:col-span-2 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/30 p-5" aria-label="General health and time status">
                      <h6 className="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-700 pb-3 mb-4 text-sm font-bold uppercase tracking-wide text-zinc-800 dark:text-zinc-100">
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-amber-500" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="18" height="10" rx="2" /><path d="M22 11v2M6 10v4" /></svg>
                        General health &amp; time status
                      </h6>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {on(asked.batteries) && <SwitchRow tone="green" label="Batteries OK" hint="Off if the camera had no batteries." required={asked.batteries === 'required'} checked={visit.batteries === 'OK'} onChange={(on) => set('batteries', on ? 'OK' : 'Missing')} />}
                        {on(asked.dateTime) && <SwitchRow tone="green" label="Date and time of the camera OK" hint="Off if the clock of the camera was wrong." required={asked.dateTime === 'required'} checked={visit.dateTimeOK === 'Yes'} onChange={(on) => set('dateTimeOK', on ? 'Yes' : 'No')} />}
                      </div>
                    </section>
                    )}
                  </div>
                ),
              }} />
              )}

              {tried && (Object.keys(errors).length > 0 || Object.keys(moreErrors).length > 0) && (
                <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
                  The visit cannot be added yet: {[...Object.values(errors), ...Object.values(moreErrors)].join(' ')} (a section that is shut may have the field).
                </p>
              )}
              {saveError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{saveError}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className={btnOutline} onClick={() => { setVisit({ ...EMPTY_VISIT, site: visit.site, latitude: visit.latitude, longitude: visit.longitude, when: visit.when }); setTried(false); setFilledFrom(null) }}>Clear</button>
                <button type="submit" className={btnPrimary} disabled={!kept}>Review the visit<span aria-hidden="true"> →</span></button>
              </div>
            </form>
          </WizardStep>

          <WizardStep n={5} title="Check and add the visit" status={confirming ? 'open' : 'locked'} canEdit={false} onEdit={() => {}} description="What is going to be kept, before it is.">
            <VisitSummary data={visitSummary(visit, nextSession ?? '', location?.timezone)} />
            <div role="status" className="mt-4 mb-4 flex items-start gap-4 rounded-2xl border border-amber-300 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 px-6 py-5 text-amber-900 dark:text-amber-200">
              <span className="mt-0.5 text-amber-500"><Glyph className="h-6 w-6"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Glyph></span>
              <div>
                <p className="text-lg font-semibold">A visit cannot be changed once it is created</p>
                <p className="text-base leading-relaxed">Do you want to add the {notVisited ? 'visit that could not be made' : 'visit'} to <strong>{visit.site}</strong> ({nextSession ?? ''}, {formatLocal(visit.when, location?.timezone)})?</p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <button type="button" className={`${btnOutline} flex items-center gap-2 !h-14 !px-6 text-lg`} onClick={() => setConfirming(false)}>
                <Glyph className="h-5 w-5"><path d="M19 12H5M11 6l-6 6 6 6" /></Glyph>Back to the form
              </button>
              <button type="button" className={`${btnPrimary} flex items-center gap-2 !h-14 !px-6 text-lg`} onClick={() => void add()}>
                <Glyph className="h-5 w-5"><path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M8 3v5h7V3M7 21v-7h10v7" /></Glyph>Yes, add the visit
              </button>
            </div>
          </WizardStep>

          </>
          )}

          {visits.length > 0 && (
            <WizardStep n={6} title="Review and continue" status="open" canEdit={false} onEdit={() => {}} description="What was saved, and what to do next.">
              <div className="space-y-4">
                <div role="status" className="rounded-xl border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-6 py-4 text-emerald-900 dark:text-emerald-100">
                  <p className="text-lg font-semibold">{visits.length === 1 ? 'Visit saved' : 'Visits saved'}</p>
                  <p className="text-sm text-emerald-800/90 dark:text-emerald-200/80">
                    {visits.length === 1
                      ? <><span className="font-mono font-semibold">{visits[0].session} · {visits[0].site}</span> is now kept in the visits file of {project?.acronym}.</>
                      : <>The visits are now kept in the visits file of {project?.acronym}.</>}
                  </p>
                </div>

                <section aria-label="What was saved" className={REVIEW_CARD}>
                  <h6 className={REVIEW_HEAD}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-emerald-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
                    What was saved
                  </h6>
                  <p className="mb-3 text-base text-zinc-900 dark:text-zinc-100">{visits.length} {visits.length === 1 ? 'visit' : 'visits'} added</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-zinc-500 dark:text-zinc-400">
                          <th className="pr-3 py-1 font-medium">Revision</th><th className="pr-3 font-medium">When</th>
                          <th className="pr-3 font-medium">Location</th><th className="pr-3 font-medium">Camera</th><th className="font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visits.map((v, i) => (
                          <tr key={i} className="border-t border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200">
                            <td className="pr-3 py-1.5">{v.session}</td><td className="pr-3">{formatLocal(v.when, zones[`${v.session}|${v.site}`])}</td>
                            <td className="pr-3">{v.site}</td><td className="pr-3">{v.details.camera_id}</td><td>{v.actions.length === 0 ? 'Not visited' : actionsText(v.actions)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Kept in the visits file of {project?.acronym}.</p>
                </section>

                {closedLinks}

                {justAdded && (
                  <div role="group" aria-label="What next">
                    <section aria-label="Next" className={REVIEW_CARD}>
                      <h6 className={REVIEW_HEAD}>
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-sky-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                        Next
                      </h6>
                      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">Do you want to add another visit?</p>
                      <button type="button" className={`${btnPrimary} inline-flex w-full items-center justify-center gap-2 !h-14 text-base`} onClick={() => { setJustAdded(false); setVisits([]); setJustClosed([]) }}>
                        <Glyph className="h-5 w-5"><path d="M12 5v14M5 12h14" /></Glyph>Add another visit
                      </button>
                    </section>
                    <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-zinc-500 dark:text-zinc-400">
                      <span>Or go back to</span>
                      <button type="button" aria-label={onMainMenu ? 'Back to the visits menu' : 'Back to the menu'} className="text-zinc-800 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400" onClick={onBack}><span aria-hidden="true">← </span>{onMainMenu ? 'Visits menu' : 'Menu'}</button>
                      {onMainMenu && <button type="button" aria-label="Back to the main menu" className="text-zinc-800 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400" onClick={onMainMenu}><span aria-hidden="true">← </span>Main menu</button>}
                    </div>
                  </div>
                )}
              </div>
            </WizardStep>
          )}
        </>
      )}

      {source !== null && !byHand && (
        <>
          {/* the file is of the default research project: nothing to pick — the step is only for when there is none */}
          {!defaultProject && (
            <WizardStep
              n={2} title="Which research project?" status={project ? 'done' : 'open'} sealed={csvSaved !== null} canEdit={csvSaved === null} onEdit={() => { setProject(undefined); forgetCsv(); setCsvName(null) }}
              description="The research project the visits belong to. The locations in the file must be locations of this project, or be added when the file is loaded."
              summary={project?.acronym}
            >
              <ResearchProjectPicker value={project?.acronym ?? ''} onSelect={(picked) => { setProject(picked); forgetCsv(); setCsvName(null) }} />
            </WizardStep>
          )}

          <WizardStep
            n={defaultProject ? 2 : 3} title={'Choose the spreadsheet file'} status={!project ? 'locked' : (csvResult || csvColumns || checking) && fileConfirmed ? 'done' : 'open'} sealed={csvSaved !== null} canEdit={csvSaved === null} onEdit={() => { forgetCsv(); setCsvName(null) }}
            description="The CSV downloaded from the WildINTEL form in Epicollect5, or any other with one row per visit. WildINTEL Uploader detects which one it is."
            summary={csvName}
          >
            {!(fileReady && csvColumns) && sourcesUsed.epicollect && (
              <div role="radiogroup" aria-label="Where the CSV is" className="flex gap-2 mb-4">
                {([['file', 'A file on this computer'], ['epicollect', 'Epicollect5 project']] as const).map(([v, label]) => (
                  <button key={v} type="button" role="radio" aria-checked={csvOrigin === v} onClick={() => { setCsvOrigin(v); forgetCsv(); setCsvName(null) }}
                          className={`px-4 h-10 rounded-lg border text-sm font-medium ${csvOrigin === v ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300'}`}>{label}</button>
                ))}
              </div>
            )}
            {fileReady && csvColumns && csvText ? (
              <DetectedFile name={csvName ?? 'file.csv'} text={csvText} found={csvColumns} kind={source === 'wildintel-new' ? 'form' : 'other'} onKind={(k) => chooseKind(k === 'form' ? 'wildintel-new' : 'csv')} onReplace={() => { forgetCsv(); setCsvName(null) }} />
            ) : sourcesUsed.epicollect && csvOrigin === 'epicollect' ? (
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-6 py-5 space-y-3">
                <h5 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Epicollect5 project</h5>
                <div className="flex items-center gap-4 flex-wrap">
                  <button type="button" className={btnPrimary} disabled={downloading} onClick={() => void downloadEpicollect()}>{downloading ? 'Downloading…' : csvColumns ? 'Download again' : 'Download the entries'}</button>
                  {csvName && <span className="text-sm font-mono text-zinc-600 dark:text-zinc-400">{csvName}</span>}
                </div>
                <p className={hintClass}>Downloads the entries of the Epicollect5 project set in Settings › Visit sources › Epicollect5 connection, one row per entry. In the next step you say which column is each field.</p>
              </div>
            ) : (
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-6 py-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h5 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Spreadsheet file</h5>
                <button type="button" className={`${btnOutline} inline-flex items-center gap-2`} onClick={() => download('visits_template.csv', visitsTemplate)}>
                  <Glyph className="h-4 w-4"><path d="M12 4v12M7 11l5 5 5-5M4 20h16" /></Glyph>Download a template
                </button>
              </div>
              <label htmlFor="visits-csv" aria-label="Drop CSV file" onDragOver={(e) => { e.preventDefault(); setDraggingCsv(true) }}
                     onDragLeave={() => setDraggingCsv(false)}
                     onDrop={(e) => {
                       e.preventDefault(); setDraggingCsv(false)
                       if (e.dataTransfer.files.length !== 1) {
                         forgetCsv(); setCsvName(null); setCsvError('Drop one CSV file.')
                       } else {
                         void readCsv(e.dataTransfer.files[0])
                       }
                     }}
                     className={`flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors ${draggingCsv ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950/40 hover:border-blue-400'}`}>
                <span className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-3 text-zinc-600 dark:text-zinc-300">
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
                </span>
                <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Drag &amp; drop your .csv file here</span>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">or click to <span className="text-blue-600 dark:text-blue-400 underline">browse</span></span>
                <span className="text-sm font-mono text-zinc-600 dark:text-zinc-400">{csvName ?? 'No file chosen'}</span>
                <input id="visits-csv" aria-label="CSV file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; void readCsv(file) }} />
              </label>
              <p className={hintClass}>A visit WildINTEL Uploader already has (the same revision and location) is not loaded again, so the same file can be read more than once. A row with no revision gets the next one of its location.</p>
            </div>
            )}
            {fileReady && (source === 'csv' || source === 'wildintel-new') && (
              <fieldset className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 mt-4">
                <legend className="sr-only">Create what does not exist yet</legend>
                <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Options of the import</span>
                      <span className="rounded-md border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400">{importRulesOpen ? 'Expanded' : defaultOptions && defaultTimezone ? 'Default preset' : 'Customized'}</span>
                    </div>
                    <h5 className="mt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">Import &amp; auto-creation rules</h5>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400"><span aria-label="Options marked">Options on: {optionsOn} of 7</span>{source === 'wildintel-new' && csvCreate.locations && <> · Timezone: {csvDefaults.timezone || 'UTC'}</>}</p>
                  </div>
                  <button type="button" className={`${btnOutline} inline-flex items-center gap-2`} aria-expanded={importRulesOpen} aria-controls="visit-import-rules" onClick={() => setImportRulesOpen((open) => !open)}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 text-sky-500 dark:text-sky-400" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h7M15 6h5M4 12h3M11 12h9M4 18h9M17 18h3M11 4v4M7 10v4M13 16v4" /></svg>
                    {importRulesOpen ? 'Done' : 'Customize'}
                  </button>
                </div>
                {importRulesOpen && <div id="visit-import-rules" className="border-t border-zinc-200 dark:border-zinc-700 px-6 py-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">Mark or clear all options</span>
                    <button type="button" role="switch" aria-checked={everyOption} aria-label="Mark all the options" onClick={() => allOptions(!everyOption)}
                            className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${everyOption ? 'bg-blue-600' : optionsOn > 0 ? 'bg-blue-400/60' : 'bg-zinc-300 dark:bg-zinc-600'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${everyOption || optionsOn > 0 ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>
                  {source === 'csv' && <p className={`${hintClass} mb-3`}>Adding new locations, cameras or cards asks for more columns in the next step, or a default value.</p>}
                  {createSwitches}
                </div>}
              </fieldset>
            )}
            {csvError && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{csvError}</p>}
            <div className="flex justify-between items-center mt-4">
              <button type="button" className={btnOutline} onClick={() => { forgetCsv(); setCsvName(null); if (defaultProject) setSource(null); else setProject(undefined) }}><span aria-hidden="true">← </span>Back</button>
              <button type="button" aria-label={continueLabel} className={btnPrimary} disabled={!fileReady || downloading || checking || (source === 'wildintel-new' && !!csvColumns?.form_error)} onClick={() => { setFileConfirmed(true); if (source !== 'csv') void checkFile() }}>{continueLabel}<span aria-hidden="true"> →</span></button>
            </div>
          </WizardStep>

          {source === 'csv' && (
            <WizardStep
              n={defaultProject ? 3 : 4} title="Match the columns" status={!csvColumns || !fileConfirmed ? 'locked' : csvResult ? 'done' : 'open'} sealed={csvSaved !== null} summary={csvSaved !== null ? 'The columns of the file' : undefined} canEdit={csvSaved === null} onEdit={() => { setCsvResult(null); setCsvSaved(null) }}
              description="For each field of a visit, choose the column of the file that has it. Columns with the same name are already chosen. Leave a field empty if the file does not have it."
            >
              {csvColumns && (
                <>
                  <div aria-label="Columns of the file and fields of the visit" className="space-y-5">
                    {MAPPING_GROUPS.map((group) => {
                      const shown = fieldsShown.filter((f) => (MAPPING_GROUP_OF[f.field] ?? 'Other') === group).sort((x, y) => mappingRank(x.field) - mappingRank(y.field))
                      if (shown.length === 0) return null
                      const folded = foldedGroups.includes(group)
                      return (
                        <section key={group} aria-label={group} className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-transparent shadow-sm dark:shadow-none">
                          <header className={`bg-zinc-100/70 dark:bg-transparent ${folded ? '' : 'border-b border-zinc-200 dark:border-zinc-700'}`}>
                            <button type="button" aria-expanded={!folded} aria-label={`${group}, ${shown.filter((f) => given(f.field)).length} of ${shown.length} matched`} onClick={() => setFoldedGroups((g) => (g.includes(group) ? g.filter((x) => x !== group) : [...g, group]))}
                                    className="flex w-full items-center gap-3 px-6 py-4 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800/50">
                              <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${folded ? '-rotate-90 text-zinc-400' : 'text-blue-600 dark:text-blue-400'}`}><path d="M6 9l6 6 6-6" /></svg>
                              <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-blue-600 dark:text-blue-400">{MAPPING_ICONS[group]}</svg>
                              <h5 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{group}</h5>
                              <span className="ml-auto text-sm text-zinc-500 dark:text-zinc-400">{shown.filter((f) => given(f.field)).length} of {shown.length} matched</span>
                            </button>
                          </header>
                          {!folded && <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
                            {shown.map(({ field, label, required, required_with }) => {
                              const at = csvColumns.columns.indexOf(csvMapping[field] ?? '')
                              const example = at >= 0 ? csvColumns.sample[0]?.[at] ?? '' : ''
                              const needed = required || (required_with ?? []).some((e) => csvCreate[e]) || (!inOneColumn && (field === 'date' || field === 'time'))
                              const [, title, hint] = /^(.*?)\s*\((.*)\)\s*$/.exec(label) ?? [label, label, '']
                              return (
                                <div key={field} className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 px-6 py-4 items-center">
                                  <div>
                                    <label htmlFor={`map-${field}`} className="flex flex-wrap items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                                      {title}
                                      {needed && <span className="rounded-md border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/50 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">required</span>}
                                    </label>
                                    {hint && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{hint}</p>}
                                    {example !== '' && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">e.g. <span className="font-mono" aria-label={`Example of ${label}`}>{example}</span></p>}
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <select id={`map-${field}`} aria-label={label} className={inputClass} value={csvMapping[field] ?? ''}
                                            onChange={(e) => setCsvMapping((m) => ({ ...m, [field]: e.target.value }))}>
                                      <option value="">Not matched</option>
                                      {csvColumns.columns.map((c, i) => <option key={i} value={c}>{c}</option>)}
                                    </select>
                                    <input className={inputClass} aria-label={`Default for ${label}`} placeholder="Default value if missing…" value={csvDefaults[field] ?? ''}
                                           onChange={(e) => setCsvDefaults((d) => ({ ...d, [field]: e.target.value }))} />
                                  </div>
                                </div>
                              )
                            })}
                          </div>}
                        </section>
                      )
                    })}
                  </div>
                  <p className={hintClass}>A default value is what the field is when the file has no column for it, and in the rows where its cell is empty.</p>
                  <p className={hintClass}>A visit needs the site, the actions and when: a date and a time, the two in one column, or the time the entry was created.</p>
                  {stillToMap.length > 0 && <p role="status" className="mt-2 text-sm text-amber-700 dark:text-amber-400">To read the visits, match also {stillToMap.join(', ')}.</p>}
                  <div className="mt-4 flex justify-end">
                    <button type="button" className={btnPrimary} disabled={!mappedEnough} onClick={() => void readMapped()}>Read the visits</button>
                  </div>
                </>
              )}
            </WizardStep>
          )}

          <WizardStep n={(source === 'csv' ? 5 : 4) - (defaultProject ? 1 : 0)} title="Check the visits of the file" status={(csvConfirming || csvSaved !== null) && csvResult ? 'done' : (checking || rechecking) ? 'running' : (csvResult && fileConfirmed) ? 'open' : 'locked'} sealed={csvSaved !== null} summary={csvSaved !== null ? `${csvSaved} ${csvSaved === 1 ? 'visit' : 'visits'} added` : csvConfirming && csvResult ? `${csvResult.visits.length} ${csvResult.visits.length === 1 ? 'visit' : 'visits'} to add` : undefined} canEdit={csvSaved === null} onEdit={() => setCsvConfirming(false)} description="WildINTEL Uploader checks every row. Nothing is saved yet."
                      action={csvResult && csvSaved == null && fileConfirmed && !csvConfirming && (
                        <button type="button" className={`${btnOutline} flex items-center gap-2`} disabled={rechecking} onClick={() => void recheckCsv()}
                                title="Check the file again, for example after adding locations in the settings">
                          <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 fill-none stroke-current ${rechecking ? 'animate-spin' : ''}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12a8 8 0 11-2.3-5.7M20 4v5h-5" /></svg>
                          {rechecking ? 'Checking…' : 'Check again'}
                        </button>
                      )}>
            {csvSaved === null && (checking || rechecking) && (
              <div>
                <p role="status" className="text-base text-zinc-600 dark:text-zinc-300">Checking the file… this can take some minutes for a long history.</p>
                {/* the check is one request that does not say how far it is: the bar moves, with no end */}
                <div role="progressbar" aria-label="Checking the file" aria-busy="true" className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                  <div className="h-full w-1/3 rounded-full bg-blue-500 animate-indeterminate motion-reduce:animate-none" />
                </div>
              </div>
            )}
            {csvSaved === null && csvResult && !checking && !rechecking && (
              <>
                <p className="text-base">
                  <strong>{csvResult.visits.length}</strong> {csvResult.visits.length === 1 ? 'visit' : 'visits'} to add
                  {csvResult.skipped > 0 && <> · {csvResult.skipped} already kept</>}
                  {csvResult.problems.length > 0 && <> · <span className="text-red-600 dark:text-red-400">{csvResult.problems.length} {csvResult.problems.length === 1 ? 'row' : 'rows'} with a problem</span></>}
                </p>
                {unfinishedBefore && (
                  <Notice kind="warning" role="alert" className="mt-4 !items-start" action={<button type="button" className={btnPrimary} disabled={rechecking} onClick={closeBeforeAndRead}>Mark them as not visited and read again</button>}>
                    <strong>{unfinishedBefore.revisions.join(', ')}</strong> {unfinishedBefore.revisions.length === 1 ? 'is' : 'are'} not finished, so the rows of {unfinishedBefore.starts.join(', ')} are not added: {unfinishedBefore.sites.length} {unfinishedBefore.sites.length === 1 ? 'location is' : 'locations are'} still to be visited there ({unfinishedBefore.sites.join(', ')}).
                    {' '}Marking {unfinishedBefore.sites.length === 1 ? 'it' : 'them'} as not visited closes {unfinishedBefore.revisions.length === 1 ? 'that revision' : 'those revisions'}, which cannot be changed afterwards. Or correct the file and read it again.
                  </Notice>
                )}
                {listedProblems.length > 0 && (
                  <ul className="mt-4 mb-5 space-y-2 text-base text-red-600 dark:text-red-400 list-disc pl-6" aria-label="Rows with a problem">
                    {listedProblems.map((p) => <li key={p.row}>Row {p.row}: {p.message}</li>)}
                  </ul>
                )}
                {(csvResult.rows?.length ?? 0) > 0 && <FileRowResults rows={csvResult.rows!} labels={Object.fromEntries((csvColumns?.fields ?? []).map((f) => [f.field, f.label.replace(/\s*\(.*$/, '')]))} />}
                {(csvResult.notes?.length ?? 0) > 0 && (
                  <Notice kind="info" className="mt-3 !items-start !rounded-2xl !px-6 !py-5 !text-base leading-relaxed" role="status">
                    <div>
                      <button type="button" aria-expanded={notesOpen} onClick={() => setNotesOpen((o) => !o)} className="flex items-center gap-2 font-semibold">
                        <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 fill-none stroke-current transition-transform ${notesOpen ? '' : '-rotate-90'}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                        Worth knowing ({csvResult.notes!.length})
                      </button>
                      {notesOpen && <ul aria-label="Notes on the visits" className="mt-2 list-disc pl-6 space-y-1">{csvResult.notes!.map((n) => <li key={n}>{n}</li>)}</ul>}
                    </div>
                  </Notice>
                )}
                {noticeWarnings.length > 0 && (
                  <Notice kind="warning" className="mt-3 !items-start !rounded-2xl !px-6 !py-5 !text-base leading-relaxed" role="status">
                    <div>
                      <strong className="font-semibold">{noticeWarnings.length === 1 ? 'One thing' : `${noticeWarnings.length} things`} to check in the field data.</strong> The visits are kept as the field wrote them.
                      <ul aria-label="What to check" className="mt-2 list-disc pl-6 space-y-1">{noticeWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
                    </div>
                  </Notice>
                )}
                {csvResult.new_sites.length > 0 && (
                  <Notice kind="warning" className="mt-3 !items-start !rounded-2xl !px-6 !py-5 !text-base leading-relaxed" role="status">
                    <div>
                      <strong className="font-semibold">{csvResult.new_sites.length === 1 ? 'A site is' : `${csvResult.new_sites.length} sites are`} not a location of {project?.acronym}.</strong> Their visits are held.
                      {' '}To make them locations turn on <em>Create the locations that do not exist</em> and read the file again; if one is a site misnamed in the field, correct its id in the file.
                      <p className="mt-2 font-mono text-sm break-words" aria-label="Sites that are not locations yet">{csvResult.new_sites.map((x) => x.site).join(', ')}</p>
                    </div>
                  </Notice>
                )}
                {missingLocations && (
                  <Notice kind="info" className="mt-3 !items-start !rounded-2xl !px-6 !py-5 !text-base leading-relaxed">
                    You can also create the locations by hand, from a spreadsheet file or from TRAPPER. The file is checked again when you come back.
                    {onOpenSettings && project && (
                      <div className="mt-4">
                        <button type="button" className="px-6 h-12 rounded-xl border border-zinc-300 dark:border-zinc-600 bg-white/5 text-base font-medium text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" onClick={() => onOpenSettings('locations', project.acronym)}>Go to the locations of {project.acronym}</button>
                      </div>
                    )}
                  </Notice>
                )}
                <div className="mt-4 flex justify-end">
                  <button type="button" className={btnPrimary} disabled={csvResult.visits.length === 0} onClick={() => setCsvConfirming(true)}>Continue to the review<span aria-hidden="true"> →</span></button>
                </div>
              </>
            )}
          </WizardStep>
          {(csvConfirming || csvSaved !== null) && csvResult && (() => {
            const added = csvResult.visits
            const sessions = [...new Set(added.map((v) => v.session))].sort()
            const sites = [...new Set(added.map((v) => v.location_id))]
            const made = csvResult.create
            const madeLine = (kind: 'locations' | 'cameras' | 'sd_cards' | 'trappers', key: string) => (made?.[kind] ?? []).map((e) => String(e[key])).join(', ')
            const lines: [string, ReactNode][] = [
              [csvSaved === null ? 'Visits to add' : 'Visits added', csvSaved ?? added.length],
              ['Revisions', sessions.join(', ') || '—'],
              ['Sites', `${sites.length}${sites.length > 0 && sites.length <= 6 ? ` · ${sites.join(', ')}` : ''}`],
              ...(csvResult.skipped > 0 ? [['Already kept — left as they are', csvResult.skipped] as [string, ReactNode]] : []),
              ...((csvResult.closed?.length ?? 0) > 0 ? [['Marked as not visited — to close the revision before', csvResult.closed!.map((m) => `${m.location_id} (${m.session})`).join(', ')] as [string, ReactNode]] : []),
              ...(csvResult.problems.length > 0 ? [['Rows with a problem — not added', csvResult.problems.length] as [string, ReactNode]] : []),
              ...((made?.locations.length ?? 0) > 0 ? [[csvSaved === null ? 'Locations to create' : 'Locations created', madeLine('locations', 'location_id')] as [string, ReactNode]] : []),
              ...((made?.cameras.length ?? 0) > 0 ? [[csvSaved === null ? 'Cameras to create' : 'Cameras created', madeLine('cameras', 'camera_id')] as [string, ReactNode]] : []),
              ...((made?.sd_cards.length ?? 0) > 0 ? [[csvSaved === null ? 'SD cards to create' : 'SD cards created', madeLine('sd_cards', 'label')] as [string, ReactNode]] : []),
              ...((made?.trappers?.length ?? 0) > 0 ? [[csvSaved === null ? 'Trappers to create' : 'Trappers created', madeLine('trappers', 'name')] as [string, ReactNode]] : []),
              ...(csvSaved !== null && justClosed.length > 0 ? [['Visits whose cards were collected — their deployment can be created', justClosed.length] as [string, ReactNode]] : []),
            ]
            const shownVisits = added.slice(0, 10)
            return (
              <WizardStep n={(source === 'csv' ? 6 : 5) - (defaultProject ? 1 : 0)} title={csvSaved === null ? 'Review and confirm' : 'Review and continue'} status="open" canEdit={false} onEdit={() => {}} description={csvSaved === null ? 'What will be saved. Nothing is saved until you confirm.' : 'What was saved, and what to do next.'}>
                {csvSaved === null ? (
                  <>
                    <section aria-label="What is going to be saved" className={REVIEW_CARD}>
                      <h6 className={REVIEW_HEAD}>
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-emerald-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
                        What is going to be saved
                      </h6>
                      <SummaryTable lines={lines} visits={added} />
                    </section>
                    <div role="status" className="mt-4 mb-4 flex items-start gap-4 rounded-2xl border border-amber-300 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 px-6 py-5 text-amber-900 dark:text-amber-200">
                      <span className="mt-0.5 text-amber-500"><Glyph className="h-6 w-6"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Glyph></span>
                      <div>
                        <p className="text-lg font-semibold">The visits cannot be changed once they are created</p>
                        <p className="text-base leading-relaxed">Do you want to save {added.length === 1 ? '1 visit' : `${added.length} visits`} in <strong>{project?.acronym}</strong>?</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <button type="button" className={`${btnOutline} flex items-center gap-2 !h-14 !px-6 text-lg`} disabled={csvSaving} onClick={() => setCsvConfirming(false)}>
                        <Glyph className="h-5 w-5"><path d="M19 12H5M11 6l-6 6 6 6" /></Glyph>Back
                      </button>
                      <button type="button" className={`${btnPrimary} flex items-center gap-2 !h-14 !px-6 text-lg`} disabled={added.length === 0 || csvSaving} aria-busy={csvSaving} onClick={() => void addCsvVisits()}>
                        {csvSaving
                          ? <span aria-hidden="true" className="h-5 w-5 rounded-full border-2 border-white/40 border-t-white animate-spin motion-reduce:animate-none" />
                          : <Glyph className="h-5 w-5"><path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M8 3v5h7V3M7 21v-7h10v7" /></Glyph>}
                        {csvSaving ? `Saving ${added.length === 1 ? '1 visit' : `${added.length} visits`}… this can take some minutes` : `Add ${added.length === 1 ? '1 visit' : `${added.length} visits`}`}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                <div className="space-y-4">
                  <div role="status" className="rounded-xl border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-6 py-4 text-emerald-900 dark:text-emerald-100">
                    <p className="text-lg font-semibold">{csvSaved === 1 ? 'Visit saved' : 'Visits saved'}</p>
                    <p className="text-sm text-emerald-800/90 dark:text-emerald-200/80">
                      <strong>{csvSaved} {csvSaved === 1 ? 'visit' : 'visits'} added</strong> to the visits file of {project?.acronym}.
                    </p>
                  </div>

                  <section aria-label="What was saved" className={REVIEW_CARD}>
                    <button type="button" aria-expanded={savedOpen} onClick={() => setSavedOpen((o) => !o)} className={`${REVIEW_HEAD} w-full text-left !mb-0 ${savedOpen ? '!pb-3 !mb-4' : '!border-b-0 !pb-0'}`}>
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-emerald-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
                      What was saved
                      <svg aria-hidden="true" viewBox="0 0 24 24" className={`ml-auto h-4 w-4 fill-none stroke-current transition-transform ${savedOpen ? '' : '-rotate-90'}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                    </button>
                    {savedOpen && <>
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
                    {shownVisits.length > 0 && (
                      <div className="mt-4 overflow-x-auto">
                        <table aria-label="Visits added" className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-zinc-500 dark:text-zinc-400">
                              <th className="pr-3 py-1 font-medium">Revision</th><th className="pr-3 font-medium">When</th><th className="pr-3 font-medium">Site</th><th className="font-medium">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {shownVisits.map((v) => (
                              <tr key={`${v.session}|${v.location_id}|${v.date}|${v.time}`} className="border-t border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200">
                                <td className="pr-3 py-1.5">{v.session}</td><td className="pr-3">{formatVisitWhen(v)}</td><td className="pr-3">{v.location_id}</td>
                                <td>{v.actions.length === 0 ? 'Not visited' : actionsText(v.actions)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {added.length > shownVisits.length && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">…and {added.length - shownVisits.length} more.</p>}
                      </div>
                    )}
                    {csvResult.report && <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">The report of the import is with the other reports: <a className="font-medium underline" href={api.reportUrl(csvResult.report, 'csv')} download>Download report</a>.</p>}
                    </>}
                  </section>

                  {justClosed.length > 0 && (
                    <section aria-label="Deployments" className={REVIEW_CARD}>
                      <h6 className={`${REVIEW_HEAD} justify-between`}>
                        <span className="flex items-center gap-2">
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-sky-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{MENU_ICONS.deployment}</svg>
                          Deployments
                        </span>
                        <span className="rounded-full px-2.5 py-1 text-xs font-semibold normal-case tracking-normal bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">To create</span>
                      </h6>
                      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
                        As a result of {csvSaved === 1 ? 'this new visit' : 'these new visits'}, {justClosed.length} other {justClosed.length === 1 ? 'visit has its card' : 'visits have their cards'} collected. Import their images now, or do it later from the deployments menu.
                      </p>
                      {/* one deployment goes to Import deployment, with its visit chosen; several go to Import deployments, all at once or one after another */}
                      {project && (justClosed.length === 1 ? onImportImages : onImportImagesOf) && (
                        <button type="button" className={`${btnPrimary} inline-flex w-full items-center justify-center gap-2 !h-14 text-base`}
                                onClick={() => (justClosed.length === 1 && onImportImages ? onImportImages({ researchProjectId: project.acronym, visit: justClosed[0].visit }) : onImportImagesOf?.(project.acronym))}>
                          <Glyph className="h-5 w-5">{MENU_ICONS.deployment}</Glyph>Import the images
                        </button>
                      )}
                    </section>
                  )}

                  <div role="group" aria-label="What next">
                    <section aria-label="Next" className={REVIEW_CARD}>
                      <h6 className={REVIEW_HEAD}>
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-sky-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                        Next
                      </h6>
                      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">Do you want to register more visits?</p>
                      <button type="button" className={`${btnPrimary} inline-flex w-full items-center justify-center gap-2 !h-14 text-base`} onClick={() => { forgetCsv(); setCsvName(null); setProject(undefined); setSource(null) }}>
                        <Glyph className="h-5 w-5"><path d="M12 5v14M5 12h14" /></Glyph>Register more visits
                      </button>
                    </section>
                    <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-zinc-500 dark:text-zinc-400">
                      <span>Or go back to</span>
                      <button type="button" aria-label={onMainMenu ? 'Back to the visits menu' : 'Back to the menu'} className="text-zinc-800 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400" onClick={onBack}><span aria-hidden="true">← </span>{onMainMenu ? 'Visits menu' : 'Menu'}</button>
                      {onMainMenu && <button type="button" aria-label="Back to the main menu" className="text-zinc-800 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400" onClick={onMainMenu}><span aria-hidden="true">← </span>Main menu</button>}
                    </div>
                  </div>
                </div>
                  </>
                )}
              </WizardStep>
            )
          })()}

        </>
      )}

      {/* once the visits are kept the step of the end has its own way back: "Or go back to" */}
      {!justAdded && csvSaved === null && !csvConfirming && (
        <div className="mt-6">
          <BackButton onClick={onBack} disabled={csvSaving} />
        </div>
      )}
    </div>
  )
}
