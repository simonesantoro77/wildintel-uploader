const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "October 2026" from a month (2026-10). */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

/** "4 Sep 2024" (or "4 Sep", without the year) from an ISO date or date-time — the same in every locale. */
export function formatDay(iso: string, year = true): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}${year ? ` ${y}` : ''}`
}

/** "1 May → 12 Jun 2025" — the year once, when both ends share it. */
export function formatPeriod(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return '—'
  const sameYear = Boolean(end) && start.slice(0, 4) === end!.slice(0, 4)
  return `${formatDay(start, !sameYear)} → ${end ? formatDay(end, true) : '…'}`
}

/** The days between two days (YYYY-MM-DD, or a date and time) — nothing when either is not one. */
export function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`), b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / 86400000)
}

const stamp = (iso: string) => `${formatDay(iso, true)}, ${iso.slice(11, 16)}`

/** The day and the time of a wall clock reading (2026-09-14T08:30:00) with its timezone beside when it is known — 14 Sep 2026, 08:30 (Europe/Madrid). A day alone is told as a day. */
export function formatLocal(iso: string | null | undefined, timezone?: string | null): string {
  if (!iso) return ''
  if (iso.length < 16) return formatDay(iso)
  return `${stamp(iso)}${timezone ? ` (${timezone})` : ''}`
}

/** An instant (2026-09-14T11:15:00+00:00) told on the wall clock of a timezone — the browser's when none is given — as 14 Sep 2026, 13:15 (Europe/Madrid). */
export function formatInstant(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  let zone = timeZone || ''
  if (!zone) { try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone } catch { zone = '' } }
  zone = zone || 'UTC'
  let parts: Intl.DateTimeFormatPart[]
  try { parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).formatToParts(at) }
  catch { zone = 'UTC'; parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).formatToParts(at) }
  const n = (t: string) => parts.find((x) => x.type === t)?.value ?? ''
  return `${Number(n('day'))} ${MONTHS[Number(n('month')) - 1]} ${n('year')}, ${n('hour')}:${n('minute')} (${zone})`
}

/** The period of a deployment as a line — 14 Sep 2026, 08:30 → 19 Oct 2026, 08:30 (Europe/Madrid) —: the day and the time on the wall clock of its location, with the
 * timezone of the location beside, when they are known; the instants (UTC) otherwise. An end that is not there yet is told as "…". */
export function formatDeploymentPeriod(d: { start: string; end: string | null; start_local?: string | null; end_local?: string | null; timezone?: string | null }): string {
  const start = d.start_local ?? d.start
  const end = d.start_local ? d.end_local : d.end
  return `${stamp(start)} → ${end ? stamp(end) : '…'}${d.start_local && d.timezone ? ` (${d.timezone})` : ''}`
}

/** The day and the time of a visit as a line — 14 Sep 2026, 08:30 (Europe/Madrid) —: on the wall clock of its location, with the timezone of the location beside when it is known. */
export function formatVisitWhen(visit: { date: string; time: string; timezone?: string | null }): string {
  return `${stamp(`${visit.date}T${visit.time}`)}${visit.timezone ? ` (${visit.timezone})` : ''}`
}
