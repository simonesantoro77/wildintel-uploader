/** Client-side mirror of core.schemas.requests.DeploymentFields — the
 * Camtrap DP "deployments" table (deployments-table-schema.json): what's
 * required, numeric ranges, integer types, the ISO 8601 dates with a
 * timezone designator, and cameraHeight/cameraDepth being mutually
 * exclusive. The backend enforces the same rules; this just tells the user
 * before a request is made. */
import type { DeploymentFields } from './types'

/** ISO 8601 with a timezone designator — YYYY-MM-DDThh:mm:ssZ or ±hh:mm. */
export const ISO_8601_WITH_TIMEZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/

/** UTC has no summer time: what a location says of it does not apply there. */
export const isUtcZone = (zone: string) => /^(utc|etc\/utc|etc\/uct|uct|gmt|etc\/gmt|zulu|etc\/zulu|universal|etc\/universal|z)$/i.test(zone.trim())

export function isValidTimezone(name: string): boolean {
  if (!name) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return true
  } catch {
    return false
  }
}

/** Every IANA timezone the browser knows, for suggestions. */
export function knownTimezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  try {
    const zones = intl.supportedValuesOf?.('timeZone') ?? []
    // the list of the browser has no UTC, which is the zone of the cameras that are not set to a local time
    return zones.length > 0 && !zones.includes('UTC') ? ['UTC', ...zones] : zones
  } catch {
    return []
  }
}

/** The UTC offset ("+02:00", or "Z" for UTC) a timezone had at a local
 * wall-clock moment, or null if the timezone or moment isn't valid. */
export function offsetAt(timezone: string, local: string): string | null {
  if (!isValidTimezone(timezone)) return null
  const asUtc = Date.parse(`${local.slice(0, 19)}Z`)
  if (Number.isNaN(asUtc)) return null
  const minutesAt = (instant: number) => {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
      .formatToParts(new Date(instant)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
    const match = /GMT(?:([+-])(\d{2}):(\d{2}))?/.exec(part)
    if (!match || !match[1]) return 0
    return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
  }
  // The offset is looked up for the instant the local time refers to, which
  // needs the offset itself — one refinement settles it except in the hour
  // a clock change skips or repeats.
  const minutes = minutesAt(asUtc - minutesAt(asUtc) * 60_000)
  if (minutes === 0) return 'Z'
  const abs = Math.abs(minutes)
  return `${minutes < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

/** A local timestamp ("2024-09-04T13:10:00") with the timezone's offset at
 * that moment appended ("…+02:00"). Without a valid timezone it's left as
 * the bare local timestamp. Whatever designator it had is replaced. */
export function stampTimezone(value: string, timezone: string): string {
  if (!value) return value
  const local = value.slice(0, 19)
  const offset = offsetAt(timezone, local)
  return offset ? `${local}${offset}` : local
}

export type DeploymentErrors = Partial<Record<keyof DeploymentFields | 'timezone', string>>

const REQUIRED = 'Required'

/** The problems with a deployment's fields, by field — an empty object
 * when it conforms. A required field left empty is reported as "Required"
 * (so a form can tell it apart from a wrong value). `timezone` is the
 * separate IANA timezone the dates' designators are derived from. */
export function validateDeployment(d: DeploymentFields, timezone: string): DeploymentErrors {
  const errors: DeploymentErrors = {}

  if (!d.deployment_id.trim()) errors.deployment_id = REQUIRED

  const number = (key: 'latitude' | 'longitude', min: number, max: number) => {
    const value = d[key]
    if (value == null) errors[key] = REQUIRED
    else if (!Number.isFinite(value) || value < min || value > max) errors[key] = `Must be between ${min} and ${max}.`
  }
  number('latitude', -90, 90)
  number('longitude', -180, 180)

  if (!timezone) errors.timezone = REQUIRED
  else if (!isValidTimezone(timezone)) errors.timezone = 'Not a known IANA timezone (e.g. Europe/Madrid).'

  for (const key of ['start_date', 'end_date'] as const) {
    if (!d[key]) errors[key] = REQUIRED
    else if (!errors.timezone && !ISO_8601_WITH_TIMEZONE.test(d[key]!)) errors[key] = 'Must be a valid date and time.'
  }

  // The deployment starts before it ends — as instants, so the designators count.
  if (!errors.start_date && !errors.end_date && d.start_date && d.end_date
      && ISO_8601_WITH_TIMEZONE.test(d.start_date) && ISO_8601_WITH_TIMEZONE.test(d.end_date)
      && Date.parse(d.start_date) >= Date.parse(d.end_date)) {
    errors.end_date = 'Must be later than the start date.'
  }

  const integer = (key: 'coordinate_uncertainty' | 'camera_interval' | 'camera_tilt' | 'camera_heading', min: number, max?: number) => {
    const value = d[key]
    if (value == null) return
    if (!Number.isInteger(value)) errors[key] = 'Must be a whole number.'
    else if (value < min || (max !== undefined && value > max)) errors[key] = max === undefined ? `Must be at least ${min}.` : `Must be between ${min} and ${max}.`
  }
  integer('coordinate_uncertainty', 1)
  integer('camera_interval', 0)
  integer('camera_tilt', -90, 90)
  integer('camera_heading', 0, 360)

  for (const key of ['camera_height', 'camera_depth', 'detection_distance'] as const) {
    const value = d[key]
    if (value != null && (!Number.isFinite(value) || value < 0)) errors[key] = 'Must be 0 or more.'
  }
  if (d.camera_height != null && d.camera_depth != null) {
    errors.camera_height ??= 'Not to be combined with camera depth.'
    errors.camera_depth ??= 'Not to be combined with camera height.'
  }

  return errors
}

/** Errors worth showing next to a field — everything but "left empty". */
export function shownErrors(errors: DeploymentErrors): DeploymentErrors {
  return Object.fromEntries(Object.entries(errors).filter(([, message]) => message !== REQUIRED)) as DeploymentErrors
}
