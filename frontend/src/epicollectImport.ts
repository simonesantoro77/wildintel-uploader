import type { DeploymentFields } from './types'
import { stampTimezone } from './deploymentValidation'

/** An entry of the Epicollect5 form, as the backend reads it through the mapping — one row is one deployment. The day and the time of
 * the start and of the end come apart, as the form asks them apart. */
export interface EpicollectEntry {
  uuid: string | null
  title: string
  created_at: string
  fields: EntryFields
}

export interface EntryFields extends Partial<Omit<DeploymentFields, 'start_date' | 'end_date'>> {
  revision?: number
  start_date?: string
  start_time?: string
  end_date?: string
  end_time?: string
}

/** What the entry fills in directly. The location's own — its id, name and coordinates — come from the location chosen, and the camera model and id
 * only complete what the images did not give. */
const FILLED = [
  'camera_interval', 'detection_distance', 'camera_height', 'camera_depth', 'camera_tilt', 'camera_heading',
  'feature_type', 'habitat', 'setup_by', 'bait_use', 'timestamp_issues', 'deployment_groups', 'comments',
] as const satisfies readonly (keyof DeploymentFields)[]

/** The date and time of one end of the period. A day with no time takes the time the images gave on that same day — else the whole day:
 * from its first second for the start, to its last for the end. */
function moment(day: string | undefined, time: string | undefined, current: string | null | undefined, fallback: string, timezone: string): string | null {
  if (!day) return null
  const sameDay = current && current.slice(0, 10) === day ? current.slice(11, 19) : ''
  return stampTimezone(`${day}T${time || sameDay || fallback}`, timezone)
}

/** `current` filled in from an entry: its period, camera, site and notes. What the entry leaves blank stays as it was. */
export function applyEntry(current: DeploymentFields, fields: EntryFields, timezone: string): DeploymentFields {
  const next: DeploymentFields = { ...current }
  for (const key of FILLED) {
    const value = fields[key]
    if (value !== undefined && value !== null) (next as unknown as Record<string, unknown>)[key] = value
  }
  if (fields.tags?.length) next.tags = fields.tags
  next.camera_model = current.camera_model || fields.camera_model || current.camera_model
  next.camera_id = current.camera_id || fields.camera_id || current.camera_id
  next.start_date = moment(fields.start_date, fields.start_time, current.start_date, '00:00:00', timezone) ?? current.start_date
  next.end_date = moment(fields.end_date, fields.end_time, current.end_date, '23:59:59', timezone) ?? current.end_date
  return next
}

/** "4 Sep 2024" — an entry told apart from another by when it was sent. */
export function entryLabel(entry: EpicollectEntry): string {
  const sent = entry.created_at ? new Date(entry.created_at) : null
  const when = sent && !Number.isNaN(sent.getTime()) ? sent.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
  return [entry.title || 'Entry', when && `sent ${when}`].filter(Boolean).join(' · ')
}
