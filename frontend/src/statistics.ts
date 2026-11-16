import type { DailyImages, LongestSequence, StatisticsMetrics, StatisticsRow } from './types'

/** The median of numbers — 0 when there are none. */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The median of what [[value, how many]…] counts. */
export function medianOfCounts(counts: [number, number][]): number {
  const total = counts.reduce((n, [, c]) => n + c, 0)
  if (total === 0) return 0
  const sorted = [...counts].sort((a, b) => a[0] - b[0])
  const at = (rank: number) => { let seen = 0; for (const [v, c] of sorted) { seen += c; if (seen > rank) return v } return sorted[sorted.length - 1][0] }
  return total % 2 ? at((total - 1) / 2) : (at(total / 2 - 1) + at(total / 2)) / 2
}

/** "4m 12s", "1h 38m", "2d 3h" — a duration in seconds as the two units that matter. */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  if (s < 86400) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
}

/** What a set of deployments adds up to: the figures of the cards at the top of the page. */
export interface Totals {
  deployments: number
  /** The days from the first image to the last, of the deployments that have them. */
  cameraDays: number
  avgDays: number | null
  minDays: number | null
  maxDays: number | null
  images: number
  imagesPerDeployment: number
  meanPerDay: number | null
  /** The median of the images of each day, over all the days of all the deployments. */
  medianPerDay: number
  peak: { images: number; deploymentId: string; date: string } | null
  sequences: number
  meanPerSequence: number | null
  medianPerSequence: number
  longest: { deploymentId: string; sequence: LongestSequence } | null
}

export function totalsOf(rows: StatisticsRow[]): Totals {
  const withDays = rows.filter((r) => r.metrics.days !== null)
  const days = withDays.map((r) => r.metrics.days as number)
  const cameraDays = days.reduce((a, b) => a + b, 0)
  const images = rows.reduce((n, r) => n + r.metrics.image_count, 0)
  const daily = rows.flatMap((r) => (r.metrics.daily ?? []).map((d) => ({ ...d, deploymentId: r.deployment_id })))
  let peak: Totals['peak'] = null
  for (const d of daily) if (!peak || d.images > peak.images) peak = { images: d.images, deploymentId: d.deploymentId, date: d.date }
  const merged = new Map<number, number>()
  for (const r of rows) for (const [length, n] of r.metrics.sequence_lengths ?? []) merged.set(length, (merged.get(length) ?? 0) + n)
  const counts = [...merged.entries()] as [number, number][]
  const sequences = rows.reduce((n, r) => n + r.metrics.sequence_count, 0)
  let longest: Totals['longest'] = null
  for (const r of rows) {
    const l = r.metrics.longest_sequence
    if (l && (!longest || l.images > longest.sequence.images)) longest = { deploymentId: r.deployment_id, sequence: l }
  }
  return {
    deployments: rows.length, cameraDays,
    avgDays: days.length ? cameraDays / days.length : null, minDays: days.length ? Math.min(...days) : null, maxDays: days.length ? Math.max(...days) : null,
    images, imagesPerDeployment: rows.length ? images / rows.length : 0,
    meanPerDay: cameraDays > 0 ? withDays.reduce((n, r) => n + r.metrics.image_count, 0) / cameraDays : null,
    medianPerDay: median(daily.map((d) => d.images)), peak,
    sequences, meanPerSequence: sequences > 0 ? images / sequences : null, medianPerSequence: medianOfCounts(counts), longest,
  }
}

/** A column of a histogram of the images of each day: the range of images in a day, the days that fall in it and which deployments they are of. */
export interface DayBin { label: string; min: number; max: number; days: number; percent: number; contributors: [string, number][] }

/** A round step at or above the value: 1, 2 or 5 times a power of ten. */
function niceStep(value: number): number {
  if (value <= 1) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  return [1, 2, 5, 10].map((m) => m * power).find((m) => m >= value) ?? 10 * power
}

/** The days of the deployments (the images of each) in `count` equal ranges from 0 — the last one holds its upper end. `edge` is the top of the last range. */
export function dayBins(rows: StatisticsRow[], count: number): { bins: DayBin[]; edge: number } {
  const days = rows.flatMap((r) => (r.metrics.daily ?? []).map((d: DailyImages) => ({ images: d.images, id: r.deployment_id })))
  if (days.length === 0) return { bins: [], edge: 0 }
  const step = niceStep(Math.max(...days.map((d) => d.images)) / count)
  const bins = Array.from({ length: count }, (_, i) => {
    const min = i * step, max = (i + 1) * step
    const inside = days.filter((d) => (i === count - 1 ? d.images >= min && d.images <= max : d.images >= min && d.images < max))
    const by = new Map<string, number>()
    for (const d of inside) by.set(d.id, (by.get(d.id) ?? 0) + 1)
    return { label: `${min}–${max}`, min, max, days: inside.length, percent: (inside.length / days.length) * 100, contributors: [...by.entries()].sort((a, b) => b[1] - a[1]) as [string, number][] }
  })
  return { bins, edge: step * count }
}

/** A column of a histogram of the sequences: the range of images a sequence has, how many sequences and how many images they hold. */
export interface SizeBin { label: string; sequences: number; images: number }

const SIZE_BINS: [number, number | null][] = [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 10], [11, 20], [21, 50], [51, 100], [101, null]]

/** How many sequences have each number of images, in bins — 1, 2… 5, 6–10, 11–20… 101+ — up to the last one that has any. */
export function sizeBins(rows: StatisticsRow[]): SizeBin[] {
  const merged = new Map<number, number>()
  for (const r of rows) for (const [length, n] of r.metrics.sequence_lengths ?? []) merged.set(length, (merged.get(length) ?? 0) + n)
  const bins = SIZE_BINS.map(([lo, hi]) => {
    let sequences = 0, images = 0
    for (const [length, n] of merged) if (length >= lo && (hi === null || length <= hi)) { sequences += n; images += length * n }
    return { label: hi === null ? `${lo}+` : lo === hi ? String(lo) : `${lo}–${hi}`, sequences, images }
  })
  while (bins.length > 1 && bins[bins.length - 1].sequences === 0) bins.pop()
  return bins
}

/** The deployments as a CSV, one row each, to be saved. */
export function toCsv(rows: StatisticsRow[]): string {
  const head = ['deployment_id', 'revision', 'images', 'days', 'images_per_day', 'sequences', 'images_per_sequence_mean', 'images_per_sequence_median', 'longest_sequence_images', 'longest_sequence_seconds', 'previous_revisions', 'state']
  const n = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? '' : Number.isInteger(v) ? String(v) : v.toFixed(digits))
  const lines = rows.map((r) => [
    r.deployment_id, r.revision, r.metrics.image_count, n(r.metrics.days), n(r.metrics.images_per_day), r.metrics.sequence_count, n(r.metrics.sequence_length), n(r.metrics.sequence_median),
    r.metrics.longest_sequence?.images ?? '', n(r.metrics.longest_sequence?.seconds, 0), r.revisions.length - 1, r.status,
  ].join(','))
  return [head.join(','), ...lines].join('\n')
}

/** What a calendar day adds up to, over the deployments in scope — and how much of it each of them has. */
export interface DayTotal { value: number; by: Map<string, number> }

/** The images — or the sequences that began — of each calendar day, over the deployments: by date (YYYY-MM-DD). */
export function perDay(rows: StatisticsRow[], key: 'daily' | 'sequences_daily'): Map<string, DayTotal> {
  const out = new Map<string, DayTotal>()
  for (const r of rows) {
    for (const d of (r.metrics[key] ?? []) as { date: string; images?: number; sequences?: number }[]) {
      const n = (key === 'daily' ? d.images : d.sequences) ?? 0
      const day = out.get(d.date) ?? { value: 0, by: new Map<string, number>() }
      day.value += n
      if (n > 0) day.by.set(r.deployment_id, (day.by.get(r.deployment_id) ?? 0) + n)
      out.set(d.date, day)
    }
  }
  return out
}

/** The months (YYYY-MM) the dates fall in, oldest first. */
export function monthsOf(dates: Iterable<string>): string[] {
  return [...new Set([...dates].map((d) => d.slice(0, 7)))].sort()
}

/** Every day (YYYY-MM-DD) of a month (YYYY-MM). */
export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

/** A number compact enough to go over a thin column: 12,345 is 12k. */
export function compact(value: number): string {
  return value >= 10000 ? `${Math.round(value / 1000)}k` : value.toLocaleString('en-US')
}

// ── Compare a deployment with the earlier ones ───────────────────────────────────────────────────────────────

/** What a deployment is compared with: the revision before it of its location, all the ones before, the other deployments of its revision, or every other one known. */
export type Reference = 'previous' | 'history' | 'peers' | 'global' | `revision:${string}`

/** A reference that is one revision of the location of the deployment, the one given (its deployment id). */
export const revisionReference = (deploymentId: string): Reference => `revision:${deploymentId}`

/** "R0003" from a revision number. */
export const revisionName = (revision: number) => `R${String(revision).padStart(4, '0')}`

/** The revisions of a location before the one of a row, oldest first. */
const earlier = (row: StatisticsRow) => row.revisions.slice(0, -1)

/** The revisions of a location before the one of a row, oldest first — each can be what it is compared with. */
export const earlierRevisions = (row: StatisticsRow) => earlier(row)

/** Which references a deployment can be compared with: the ones of its location need an earlier revision of it. */
export function referencesOf(row: StatisticsRow, all: StatisticsRow[]): Reference[] {
  const out: Reference[] = []
  if (earlier(row).length > 0) out.push('previous', 'history')
  if (all.some((r) => r.deployment_id !== row.deployment_id)) out.push('peers')
  out.push('global')
  return out
}

/** The deployments a reference is made of: what to call them, what to say of them, and their metrics. */
export function poolOf(row: StatisticsRow, all: StatisticsRow[], reference: Reference): { label: string; sub: string; metrics: StatisticsMetrics[] } {
  const before = earlier(row)
  if (reference.startsWith('revision:')) {
    const found = before.find((r) => r.deployment_id === reference.slice('revision:'.length))
    if (found) return { label: found.deployment_id, sub: `${revisionName(found.revision)} of ${row.location}`, metrics: [found.metrics] }
  }
  if ((reference === 'previous' || reference.startsWith('revision:')) && before.length > 0) {
    const last = before[before.length - 1]
    return { label: last.deployment_id, sub: `${revisionName(last.revision)} of ${row.location}`, metrics: [last.metrics] }
  }
  if (reference === 'history' && before.length > 0) {
    return { label: 'Mean of the previous revisions', sub: `${before.length} earlier ${before.length === 1 ? 'revision' : 'revisions'} of ${row.location}`, metrics: before.map((r) => r.metrics) }
  }
  if (reference === 'peers') {
    const others = all.filter((r) => r.deployment_id !== row.deployment_id)
    return { label: `Mean of the rest of ${revisionName(row.revision)}`, sub: `${others.length} other ${others.length === 1 ? 'deployment' : 'deployments'} of the revision`, metrics: others.map((r) => r.metrics) }
  }
  const known = new Map<string, StatisticsMetrics>()
  for (const r of all) for (const v of r.revisions) if (v.deployment_id !== row.deployment_id) known.set(v.deployment_id, v.metrics)
  for (const r of all) if (r.deployment_id !== row.deployment_id) known.set(r.deployment_id, r.metrics)
  return { label: 'Mean of the project', sub: `${known.size} other ${known.size === 1 ? 'deployment' : 'deployments'}, in all the revisions known`, metrics: [...known.values()] }
}

/** One of the metrics that are put side by side: its name and unit, what the deployment has, what the reference has on average, and how they differ. */
export interface CompareRow {
  key: 'days' | 'image_count' | 'images_per_day' | 'sequence_count' | 'sequence_length' | 'sequence_max'
  label: string; unit: string; digits: number
  current: number; reference: number; diff: number; percent: number
}

const COMPARED: { key: CompareRow['key']; label: string; unit: string; digits: number }[] = [
  { key: 'days', label: 'Length', unit: 'days', digits: 1 },
  { key: 'image_count', label: 'Images', unit: 'images', digits: 0 },
  { key: 'images_per_day', label: 'Images per day', unit: 'a day', digits: 1 },
  { key: 'sequence_count', label: 'Sequences', unit: 'sequences', digits: 0 },
  { key: 'sequence_length', label: 'Images per sequence', unit: 'a sequence', digits: 1 },
  { key: 'sequence_max', label: 'Longest sequence', unit: 'images', digits: 0 },
]

export function compareMetrics(current: StatisticsMetrics, pool: StatisticsMetrics[]): CompareRow[] {
  return COMPARED.map((m) => {
    const values = pool.map((p) => p[m.key] as number | null).filter((v): v is number => v !== null && v !== undefined)
    const reference = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
    const now = (current[m.key] as number | null) ?? 0
    return { ...m, current: now, reference, diff: now - reference, percent: reference > 0 ? ((now - reference) / reference) * 100 : 0 }
  })
}

/** How a deployment's images a day compare with what was usual: the label, the change in %, what it is of and its tone — for the table, and the head of the comparison. */
export type Trend = 'baseline' | 'higher' | 'stable' | 'peak' | 'lower' | 'drop'
export interface TrendOf { trend: Trend; label: string; percent: number; against: string }

export function trendOf(row: StatisticsRow, all: StatisticsRow[]): TrendOf {
  const before = earlier(row)
  const now = row.metrics.images_per_day ?? 0
  if (before.length === 0) {
    const peers = all.filter((r) => r.deployment_id !== row.deployment_id).map((r) => r.metrics.images_per_day).filter((v): v is number => v !== null)
    const mean = peers.length ? peers.reduce((a, b) => a + b, 0) / peers.length : 0
    return { trend: 'baseline', label: 'First revision', percent: mean > 0 ? ((now - mean) / mean) * 100 : 0, against: `the rest of ${revisionName(row.revision)}` }
  }
  const last = before[before.length - 1]
  const base = last.metrics.images_per_day ?? 0
  const percent = base > 0 ? ((now - base) / base) * 100 : 0
  const trend: Trend = percent > 45 ? 'peak' : percent >= 12 ? 'higher' : percent >= -12 ? 'stable' : percent >= -35 ? 'lower' : 'drop'
  const label = { peak: 'Unusual peak', higher: 'More activity', stable: 'Stable', lower: 'Less activity', drop: 'Sharp drop', baseline: 'First revision' }[trend]
  return { trend, label, percent, against: revisionName(last.revision) }
}

/** The bursts, by how many images a sequence has — the bins of the profile that compares a deployment with its reference. */
export const BURST_BINS: { label: string; min: number; max: number }[] = [
  { label: '1', min: 1, max: 1 }, { label: '2–3', min: 2, max: 3 }, { label: '4–10', min: 4, max: 10 }, { label: '11–25', min: 11, max: 25 }, { label: '26+', min: 26, max: Infinity },
]

/** The share of the sequences in each bin of the profile, pooling the metrics given. */
export function burstProfile(metrics: StatisticsMetrics[]): { label: string; sequences: number; percent: number }[] {
  const merged = metrics.flatMap((m) => m.sequence_lengths ?? [])
  const total = merged.reduce((n, [, c]) => n + c, 0)
  return BURST_BINS.map((b) => {
    const sequences = merged.reduce((n, [length, c]) => (length >= b.min && length <= b.max ? n + c : n), 0)
    return { label: b.label, sequences, percent: total > 0 ? (sequences / total) * 100 : 0 }
  })
}
