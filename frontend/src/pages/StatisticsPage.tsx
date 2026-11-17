import { Fragment, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import { Icon, StateCard } from '../components/Dashboard'
import {
  ActiveFilters, ChevronCell, DashboardHeader, DetailsRow, HELP_ICONS, HelpButton, HelpCard, HelpDrawer, MetricsSection, RevisionSelection, TABLE, TableCard, TableFooter, TableToolbar,
} from '../components/DashboardParts'
import { useDefaultResearchProject } from '../components/DefaultResearchProject'
import { Columns, ImagesPerDay, SequencesOfDeployment } from '../components/StatisticsCharts'
import StatisticsComparator, { TREND_TONE } from '../components/StatisticsComparator'
import type { Column } from '../components/StatisticsCharts'
import { mark } from '../components/Notice'
import { formatDay, formatInstant, formatLocal, formatMonth, formatPeriod } from '../dateFormat'
import { compact, dayBins, daysOfMonth, formatDuration, monthsOf, perDay, sizeBins, toCsv, totalsOf, trendOf } from '../statistics'
import type { DayTotal } from '../statistics'
import type { FieldDeployment, RepairCollection, StatisticsRow } from '../types'
import { btnOutline, btnPrimary } from './ImportDeploymentPage'

interface Props {
  onBack: () => void
  /** Opens the settings, on the section given — where the default research project is changed. */
  onOpenSettings?: (section?: 'general') => void
  settingsOpen?: boolean
  /** The deployment it starts on — from the dashboard of the deployments —: its revision, with it isolated in the figures. */
  focus?: { collection: string; deploymentId: string }
}

type State = StatisticsRow['status']
type Tab = 'days' | 'sequences'

const PER_PAGE = 8
const TH = 'px-3 py-3 text-left font-semibold print:px-1.5 print:py-1.5 print:text-[9px]'
const TD = 'px-3 py-3 print:px-1.5 print:py-1.5'
const QUICK_PILLS = 8

const STATUS: Record<State, { text: string; tone: string; help: string }> = {
  ok: { text: 'Similar', tone: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300', help: 'Every value is within the tolerance of the previous revisions.' },
  review: { text: 'To review', tone: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300', help: 'Some value departs from the previous revisions: worth a look before it is uploaded.' },
  insufficient_history: { text: 'Not enough history', tone: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300',
    help: 'The location has fewer previous revisions than Postvalidation asks for, so nothing is judged. The first revision of a location is always this.' },
}
const STATES = Object.keys(STATUS) as State[]

const BADGE = {
  blue: 'bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400',
  emerald: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400',
  sky: 'bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400',
  violet: 'bg-violet-100 dark:bg-violet-950/60 text-violet-600 dark:text-violet-400',
  amber: 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400',
  zinc: 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300',
}

const TROPHY = <><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z" /></>

/** A number as the page shows it: whole, or with `digits` decimals at most; a dash when there is none. */
export function num(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return '—'
  return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toLocaleString('en-US', { maximumFractionDigits: digits })
}

/** The camera's wall clock of an image time (seconds, stood as UTC) as 2023-11-06T15:00:46. */
const wallIso = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 19)

function StatusBadge({ status }: { status: State }) {
  const { text, tone } = STATUS[status]
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold print:px-1 print:text-[9px] ${tone}`}>{status === 'ok' ? mark('success', text) : text}</span>
}

/** A card of the top of the page: its name and icon, one figure, what it is of, and two lines that qualify it. */
function Kpi({ label, icon, badge, value, unit, caption, lines }: { label: string; icon: ReactNode; badge: string; value: string; unit?: string; caption: string; lines: [string, ReactNode][] }) {
  return (
    <div className="flex flex-col justify-between rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/40 p-4" role="group" aria-label={label}>
      <div>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</span>
          <span aria-hidden="true" className={`flex h-7 w-7 items-center justify-center rounded-lg ${badge}`}>{icon}</span>
        </div>
        <p className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{value}{unit && <span className="ml-1 text-sm font-normal text-zinc-500 dark:text-zinc-400">{unit}</span>}</p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{caption}</p>
      </div>
      <dl className="mt-4 space-y-1.5 border-t border-zinc-200 dark:border-zinc-700 pt-3 text-xs">
        {lines.map(([name, value]) => <div key={name} className="flex items-center justify-between gap-2"><dt className="text-zinc-500 dark:text-zinc-400">{name}</dt><dd className="font-mono font-medium text-zinc-900 dark:text-zinc-100">{value}</dd></div>)}
      </dl>
    </div>
  )
}

/** The longest sequence of a deployment, told in full: how many images, how long, when, and how far apart they are. */
function SequenceDialog({ deploymentId, row, field, onClose }: { deploymentId: string; row: StatisticsRow | undefined; field: FieldDeployment | undefined; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const s = row?.metrics.longest_sequence
  if (!row || !s) return null
  const zone = field?.timezone ?? null
  const interval = s.images > 1 ? s.seconds / (s.images - 1) : null
  const tile = (name: string, value: string, tone: string) => (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 p-3.5">
      <p className="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{name}</p>
      <p className={`mt-1 font-mono text-xl font-bold ${tone}`}>{value}</p>
    </div>
  )
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Longest sequence">
      <button type="button" aria-label="Close the sequence" tabIndex={-1} className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center gap-3 border-b border-zinc-200 dark:border-zinc-700 pb-4">
          <span aria-hidden="true" className={`flex h-9 w-9 items-center justify-center rounded-xl ${BADGE.amber}`}><Icon path={TROPHY} className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h5 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Longest sequence</h5>
            <p className="truncate font-mono text-xs text-blue-600 dark:text-blue-400">{deploymentId}{field?.card ? ` · SD ${field.card}` : ''}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {tile('Images', num(s.images), 'text-amber-600 dark:text-amber-400')}
          {tile('Duration', formatDuration(s.seconds), 'text-blue-600 dark:text-blue-400')}
          {tile('Mean interval', interval === null ? '—' : `${num(interval)} s`, 'text-emerald-600 dark:text-emerald-400')}
        </div>
        <dl className="mt-4 space-y-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 p-4 text-xs">
          {([
            ['Began', formatLocal(s.start, zone)],
            ['Ended', formatLocal(s.end, zone)],
            ['Site', field?.site ?? row.location],
            ['Share of its images', `${num((s.images / Math.max(row.metrics.image_count, 1)) * 100)}% of the ${num(row.metrics.image_count)} of the deployment`],
          ] as [string, string][]).map(([name, value]) => <div key={name} className="flex justify-between gap-4"><dt className="text-zinc-500 dark:text-zinc-400">{name}</dt><dd className="text-right font-medium text-zinc-900 dark:text-zinc-100">{value}</dd></div>)}
        </dl>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">The images are one sequence while each is less than the sequence gap of Postvalidation after the one before.</p>
        <div className="mt-5 flex justify-end"><button type="button" className={btnPrimary} onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}

const segment = (on: boolean) => `rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${on ? 'bg-blue-600 text-white' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'}`
const segmented = 'inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-950/60 p-0.5'

/** Which view a diagram has: how its numbers are distributed, or each day of a month. */
function ViewToggle({ value, onChange, name }: { value: 'distribution' | 'days'; onChange: (view: 'distribution' | 'days') => void; name: string }) {
  return (
    <div className={segmented} role="group" aria-label={`View of the ${name}`}>
      <button type="button" aria-pressed={value === 'distribution'} className={segment(value === 'distribution')} onClick={() => onChange('distribution')}>Distribution</button>
      <button type="button" aria-pressed={value === 'days'} className={segment(value === 'days')} onClick={() => onChange('days')}>By day</button>
    </div>
  )
}

/** The month a diagram shows, with the arrows to the month before and the month after. */
function MonthNav({ months, month, onChange, name }: { months: string[]; month: string; onChange: (month: string) => void; name: string }) {
  const at = months.indexOf(month)
  return (
    <div className={segmented} role="group" aria-label={`Month of the ${name}`}>
      <button type="button" aria-label={`Previous month of the ${name}`} disabled={at <= 0} className={`${segment(false)} disabled:cursor-not-allowed disabled:opacity-35`} onClick={() => onChange(months[at - 1])}>‹</button>
      <span className="px-2 py-1 text-[11px] font-medium text-zinc-700 dark:text-zinc-200" aria-live="polite">{month ? formatMonth(month) : '—'}</span>
      <button type="button" aria-label={`Next month of the ${name}`} disabled={at < 0 || at >= months.length - 1} className={`${segment(false)} disabled:cursor-not-allowed disabled:opacity-35`} onClick={() => onChange(months[at + 1])}>›</button>
    </div>
  )
}

/** The statistics of a revision of the default research project: the figures of its deployments — days, images, images per day, sequences, the longest sequence —, how those are
 * distributed, and each deployment against the previous revisions of its location. A deployment can be isolated, to see the figures of that one alone. */
export default function StatisticsPage({ onBack, settingsOpen, focus }: Props) {
  const { project, defaultAcronym, error: projectError } = useDefaultResearchProject(settingsOpen)
  const [collections, setCollections] = useState<RepairCollection[]>([])
  const [collectionName, setCollectionName] = useState('')
  const [rows, setRows] = useState<StatisticsRow[] | null>(null)
  const [fields, setFields] = useState<Record<string, FieldDeployment>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [revisionsOpen, setRevisionsOpen] = useState(true)
  const [comparisonOpen, setComparisonOpen] = useState(true)
  const [helpOpen, setHelpOpen] = useState(false)
  const [isolated, setIsolated] = useState<string | null>(null)
  const [state, setState] = useState<State | ''>('')
  const [text, setText] = useState('')
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<{ id: string; tab: Tab } | null>(null)
  const [binCount, setBinCount] = useState(6)
  const [showMean, setShowMean] = useState(true)
  const [scale, setScale] = useState<'linear' | 'log'>('linear')
  const [inspected, setInspected] = useState<string | null>(null)
  const [comparing, setComparing] = useState<string | null>(null)
  // the report is being printed: every row of the table is there, not only the page, and the paper is white
  const [printing, setPrinting] = useState(false)
  const [imageView, setImageView] = useState<'distribution' | 'days'>('distribution')
  const [sequenceView, setSequenceView] = useState<'distribution' | 'days'>('distribution')
  const [imageMonth, setImageMonth] = useState('')
  const [sequenceMonth, setSequenceMonth] = useState('')
  const error = projectError ?? loadError

  // The revisions of the research project: it opens on the latest, in the same render they come in. What the visits say of each deployment — its card, its site, its timezone — comes besides.
  useEffect(() => {
    setCollections([]); setCollectionName(''); setRows(null); setLoadError(null); setFields({})
    if (!project) return
    let cancelled = false
    api.repairCollections(project.acronym)
      .then(({ results }) => {
        if (cancelled) return
        setCollections(results)
        setCollectionName(focus && results.some((c) => c.name === focus.collection) ? focus.collection : ([...results].map((c) => c.name).sort().reverse()[0] ?? ''))
      })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not read the revisions.') })
    Promise.resolve().then(() => api.fieldDeployments(project.acronym))
      .then(({ results }) => { if (!cancelled) setFields(Object.fromEntries(results.map((d) => [d.deployment_id, d]))) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [project?.acronym]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setRows(null); setDetail(null); setIsolated(null); setState(''); setText(''); setPage(1); setComparing(null)
    if (!project || !collectionName) return
    let cancelled = false
    api.statisticsRevision(project.acronym, collectionName)
      .then(({ results }) => {
        if (cancelled) return
        setRows(results)
        if (focus && collectionName === focus.collection && results.some((r) => r.deployment_id === focus.deploymentId)) setIsolated(focus.deploymentId)   // it came for one deployment
      })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not read the statistics.') })
    return () => { cancelled = true }
  }, [project?.acronym, collectionName]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!printing) return
    const root = document.documentElement
    const wasDark = root.classList.contains('dark')
    if (wasDark) root.classList.remove('dark')          // paper is white: the light colours, not the dark ones
    let done = false
    const finish = () => {
      if (done) return
      done = true
      if (wasDark) root.classList.add('dark')
      window.removeEventListener('afterprint', finish)
      setPrinting(false)
    }
    window.addEventListener('afterprint', finish)
    const safety = window.setTimeout(finish, 60000)      // a browser that never says it has printed
    window.print()
    return () => { window.clearTimeout(safety); finish() }
  }, [printing])

  const all = useMemo(() => rows ?? [], [rows])
  const scoped = useMemo(() => (isolated ? all.filter((r) => r.deployment_id === isolated) : all), [all, isolated])
  const totals = useMemo(() => totalsOf(scoped), [scoped])
  const whole = useMemo(() => totalsOf(all), [all])
  const days = useMemo(() => dayBins(scoped, binCount), [scoped, binCount])
  const sizes = useMemo(() => sizeBins(scoped), [scoped])
  const count = (s: State) => all.filter((r) => r.status === s).length
  const needle = text.trim().toLowerCase()
  const matching = all.filter((r) => (!state || r.status === state) && (!needle || [r.deployment_id, fields[r.deployment_id]?.site, fields[r.deployment_id]?.card].some((v) => v?.toLowerCase().includes(needle))))
  const pages = Math.max(1, Math.ceil(matching.length / PER_PAGE))
  const current = Math.min(page, pages)
  const shown = printing ? matching : matching.slice((current - 1) * PER_PAGE, current * PER_PAGE)
  const maxDays = Math.max(...all.map((r) => r.metrics.days ?? 0), 1)
  const totalImages = all.reduce((n, r) => n + r.metrics.image_count, 0)
  const inspectedRow = all.find((r) => r.deployment_id === inspected)
  const pill = 'rounded-md border px-2.5 py-1 font-medium'
  const quick = all.slice(0, QUICK_PILLS), more = all.slice(QUICK_PILLS)
  const short = (id: string) => (collectionName && id.startsWith(`${collectionName}-`) ? id.slice(collectionName.length + 1) : id)

  function exportCsv() {
    const url = URL.createObjectURL(new Blob([toCsv(all)], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url; a.download = `statistics_${project?.acronym ?? 'project'}_${collectionName}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  const dayTotal = days.bins.reduce((n, b) => n + b.days, 0)
  const dayColumns: Column[] = days.bins.map((b) => ({
    key: b.label, tick: b.label, label: `${b.label} images a day`, value: b.days,
    lines: [['Share of the days', `${num(b.percent)}%`]],
    list: b.contributors.length ? { heading: 'Deployments in this range:', items: b.contributors.slice(0, 3).map(([id, n]) => [short(id), `${n}d`]) } : undefined,
  }))
  const seqImages = sizes.reduce((n, b) => n + b.images, 0)
  const sizeColumns: Column[] = sizes.map((b) => ({
    key: b.label, tick: b.label, label: `${b.label} ${b.label === '1' ? 'image' : 'images'} per sequence`, value: b.sequences,
    lines: [['Share of the sequences', `${num(totals.sequences > 0 ? (b.sequences / totals.sequences) * 100 : 0)}%`], ['Images in them', `${num(b.images, 0)} (${num(seqImages > 0 ? (b.images / seqImages) * 100 : 0)}%)`]],
  }))
  // each day of a month: the images — and the sequences that began — of the deployments in scope, with the months to go through
  const imageDays = useMemo(() => perDay(scoped, 'daily'), [scoped])
  const sequenceDays = useMemo(() => perDay(scoped, 'sequences_daily'), [scoped])
  const months = useMemo(() => monthsOf(imageDays.keys()), [imageDays])
  const shownImageMonth = months.includes(imageMonth) ? imageMonth : (months[0] ?? '')
  const shownSequenceMonth = months.includes(sequenceMonth) ? sequenceMonth : (months[0] ?? '')
  const byDay = (month: string, totals: Map<string, DayTotal>): Column[] => (month ? daysOfMonth(month) : []).map((date) => {
    const d = totals.get(date)
    return {
      key: date, tick: String(Number(date.slice(8))), label: formatDay(date), value: d?.value ?? 0,
      list: d && d.by.size > 1 ? { heading: 'Deployments that day:', items: [...d.by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => [short(id), compact(n)] as [string, string]) } : undefined,
    }
  })
  const imageDayColumns = byDay(shownImageMonth, imageDays)
  const sequenceDayColumns = byDay(shownSequenceMonth, sequenceDays)
  const busiest = (columns: Column[]) => columns.reduce<Column | null>((best, c) => (c.value > (best?.value ?? 0) ? c : best), null)
  const meanAt = totals.meanPerDay !== null && days.edge > 0 ? Math.min(Math.max(totals.meanPerDay / days.edge, 0), 1) : null

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-8 print:max-w-none print:px-0 print:py-0">
            {/* what the paper starts with: the report's own head */}
      <div className="mb-5 hidden border-b border-zinc-300 pb-3 print:block">
        <p className="text-xl font-semibold">Statistics report — {project?.acronym ?? defaultAcronym}{collectionName ? ` · Revision ${collectionName}` : ''}</p>
        <p className="text-xs text-zinc-600">{isolated ? `Figures of ${isolated} alone` : `Figures of the ${all.length} deployments of the revision`} · {formatInstant(new Date().toISOString())} · WildINTEL Uploader</p>
      </div>
      <div className="print:hidden"><DashboardHeader parent="Manage deployments" onParent={onBack} icon={<path d="M3 3v18h18M7 15l4-4 3 3 5-6" />} title="Statistics" description="Each deployment of a revision against the previous revisions of its location."
        actions={<>
          <HelpButton expanded={helpOpen} onClick={() => setHelpOpen(true)} />
          <button type="button" className={`${btnOutline} inline-flex items-center gap-2`} disabled={!rows || rows.length === 0 || printing} title="Print the report of the revision, or save it as a PDF" onClick={() => setPrinting(true)}>
            <Icon path={<><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></>} className="h-4 w-4" />
            Print the report
          </button>
        </>} /></div>

      {error && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {project && collections.length === 0 && !error && <p className="text-sm text-zinc-500 dark:text-zinc-400">No revisions yet.</p>}
      {collections.length > 0 && (
        <div className="print:hidden"><RevisionSelection open={revisionsOpen} onToggle={() => setRevisionsOpen(!revisionsOpen)} hint="Select one to see its deployments' statistics" value={collectionName}
          revisions={[...collections].sort((x, y) => y.name.localeCompare(x.name)).map((c) => ({ id: c.name, label: c.name, note: `${c.deployments.length} ${c.deployments.length === 1 ? 'deployment' : 'deployments'}` }))}
          onPick={(id) => { if (id) setCollectionName(id) }} /></div>
      )}

      {collectionName && rows === null && !error && <p className="text-sm text-zinc-500 dark:text-zinc-400">Reading the statistics…</p>}
      {rows && rows.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">This revision has no deployments.</p>}

      {rows && rows.length > 0 && (
        <>
          {/* the scope of the figures: the whole revision, or one deployment of it */}
          <section aria-label="Scope of the figures" className="mb-5 flex flex-col print:hidden gap-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 px-4 py-3 text-xs md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 font-medium text-zinc-500 dark:text-zinc-400"><Icon path={<path d="M3 5h18l-7 8v6l-4-2v-4z" />} className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />Figures of:</span>
              <span className={`${pill} border-blue-300/60 dark:border-blue-700/50 bg-blue-100 dark:bg-blue-900/50 font-mono text-blue-800 dark:text-blue-200`}>Revision {collectionName}</span>
              {isolated
                ? (
                  <span className={`${pill} inline-flex items-center gap-1.5 border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/40 font-mono text-amber-800 dark:text-amber-300`}>
                    Only {isolated}
                    <button type="button" aria-label="Show the whole revision" title="Show the whole revision" onClick={() => setIsolated(null)}><Icon path={<path d="M6 6l12 12M18 6L6 18" />} className="h-3.5 w-3.5" /></button>
                  </span>
                )
                : <span className={`${pill} border-emerald-300/60 dark:border-emerald-700/50 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300`}>All the deployments ({all.length})</span>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Isolate a deployment">
              <span className="mr-1 text-zinc-500 dark:text-zinc-400">Isolate a deployment:</span>
              {quick.map((r) => (
                <button key={r.deployment_id} type="button" aria-label={`Isolate ${r.deployment_id}`} aria-pressed={isolated === r.deployment_id} onClick={() => setIsolated(isolated === r.deployment_id ? null : r.deployment_id)}
                        className={`rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${isolated === r.deployment_id ? 'border-blue-500 bg-blue-600 text-white' : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 hover:border-blue-500 hover:text-zinc-900 dark:hover:text-white'}`}>
                  {short(r.deployment_id)}
                </button>
              ))}
              {more.length > 0 && (
                <select aria-label="More deployments to isolate" value={more.some((r) => r.deployment_id === isolated) ? (isolated ?? '') : ''} onChange={(e) => setIsolated(e.target.value || null)}
                        className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                  <option value="">{more.length} more…</option>
                  {more.map((r) => <option key={r.deployment_id} value={r.deployment_id}>{short(r.deployment_id)}</option>)}
                </select>
              )}
              {isolated && <button type="button" className="px-1.5 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline" onClick={() => setIsolated(null)}>Whole revision</button>}
            </div>
          </section>

          {/* the figures */}
          <section aria-label="Figures" className="mb-5 grid break-inside-avoid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 print:grid-cols-3">
            <Kpi label="Length" icon={<Icon path={<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>} className="h-3.5 w-3.5" />} badge={BADGE.blue}
                 value={num(totals.avgDays)} unit="days" caption="Mean per deployment"
                 lines={[['Range', totals.minDays === null ? '—' : `${num(totals.minDays)} – ${num(totals.maxDays)} d`], ['Camera-days', num(totals.cameraDays)]]} />
            <Kpi label="Images" icon={<Icon path={<><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>} className="h-3.5 w-3.5" />} badge={BADGE.emerald}
                 value={num(totals.images)} caption="Images captured"
                 lines={[['Mean per deployment', num(Math.round(totals.imagesPerDeployment))], ['Deployments', num(totals.deployments)]]} />
            <Kpi label="Images per day" icon={<Icon path={<path d="M22 12h-4l-3 9L9 3l-3 9H2" />} className="h-3.5 w-3.5" />} badge={BADGE.sky}
                 value={num(totals.meanPerDay)} unit="/ day" caption="Mean daily rate"
                 lines={[['Median day', num(totals.medianPerDay)], ['Busiest day', totals.peak ? num(totals.peak.images) : '—']]} />
            <Kpi label="Sequences" icon={<Icon path={<><rect x="2" y="2" width="20" height="20" rx="2.18" /><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5" /></>} className="h-3.5 w-3.5" />} badge={BADGE.violet}
                 value={num(totals.sequences)} caption="Independent sequences"
                 lines={[['Images per sequence', num(totals.meanPerSequence)], ['Median', num(totals.medianPerSequence)]]} />
            {totals.longest && (
              <div className="flex flex-col justify-between rounded-xl border border-amber-400/60 dark:border-amber-500/40 bg-gradient-to-br from-amber-50 via-white to-white dark:from-amber-950/30 dark:via-zinc-900 dark:to-zinc-900 p-4" role="group" aria-label="Longest sequence card">
                <div>
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">Longest sequence</span>
                    <span aria-hidden="true" className={`flex h-7 w-7 items-center justify-center rounded-lg ${BADGE.amber}`}><Icon path={TROPHY} className="h-3.5 w-3.5" /></span>
                  </div>
                  <p className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">{num(totals.longest.sequence.images)}</span>
                    <span className="text-sm text-zinc-600 dark:text-zinc-300">images</span>
                    <span className="ml-auto rounded border border-amber-300/60 dark:border-amber-700/50 bg-amber-100 dark:bg-amber-950/50 px-2 py-0.5 font-mono text-xs text-amber-800 dark:text-amber-300">{formatDuration(totals.longest.sequence.seconds)}</span>
                  </p>
                  <p className="mt-2 truncate font-mono text-[11px] text-blue-600 dark:text-blue-400">{totals.longest.deploymentId}{fields[totals.longest.deploymentId]?.card ? ` · SD ${fields[totals.longest.deploymentId].card}` : ''}</p>
                  <p className="truncate font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{formatDay(totals.longest.sequence.start)}, {totals.longest.sequence.start.slice(11, 16)} → {totals.longest.sequence.end.slice(11, 16)}</p>
                </div>
                <button type="button" onClick={() => setInspected(totals.longest!.deploymentId)}
                        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg print:hidden border border-amber-300/70 dark:border-amber-600/40 bg-amber-100/70 dark:bg-amber-950/40 px-3 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 transition-colors hover:bg-amber-200/70 dark:hover:bg-amber-900/40">
                  <Icon path={<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>} className="h-3.5 w-3.5" />Inspect the sequence
                </button>
              </div>
            )}
          </section>

          {/* against the previous revisions */}
          <MetricsSection label="Comparison with the previous revisions" title="Comparison with the previous revisions" open={comparisonOpen} onToggle={() => setComparisonOpen(!comparisonOpen)} hint="Click a card to filter the table by state">
            {STATES.map((s) => (
              <StateCard key={s} label={STATUS[s].text} note={s === 'insufficient_history' ? 'Too few revisions to judge' : s === 'review' ? 'Differ from the previous' : 'Like the previous'} count={count(s)}
                         tone={s === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : s === 'review' ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-600 dark:text-zinc-300'}
                         badge={s === 'ok' ? BADGE.emerald : s === 'review' ? BADGE.amber : BADGE.zinc}
                         icon={<Icon className="h-3.5 w-3.5" path={s === 'ok' ? <><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></> : s === 'review' ? <><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></> : <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>} />}
                         pressed={state === s} onPress={() => { setState(state === s ? '' : s); setPage(1) }} />
            ))}
          </MetricsSection>

          {/* how the figures are distributed, and day by day */}
          <section aria-label="Distributions" className="mb-6 space-y-4">
            {imageView === 'distribution' ? (
              <Columns name="Distribution of the images per day" title="Images per day" subtitle="How many days had each number of images" badge={`${num(dayTotal)} days`}
                       unit={['day', 'days']} header={['Images in a day', 'Days']} columns={dayColumns} marker={showMean && meanAt !== null ? { at: meanAt, label: `Mean: ${num(totals.meanPerDay)}` } : undefined}
                       footer={{ left: <>X axis: <strong className="font-normal text-zinc-700 dark:text-zinc-200">Images in a day</strong> · Y axis: <strong className="font-normal text-zinc-700 dark:text-zinc-200">Days</strong></>, right: `Median: ${num(totals.medianPerDay)} · Busiest: ${num(totals.peak?.images)} images a day` }}
                       controls={<>
                         <ViewToggle value={imageView} onChange={setImageView} name="images per day" />
                         <div className={segmented} role="group" aria-label="Ranges">
                           {[6, 10].map((n) => <button key={n} type="button" aria-pressed={binCount === n} className={segment(binCount === n)} onClick={() => setBinCount(n)}>{n} ranges</button>)}
                         </div>
                         <button type="button" aria-pressed={showMean} onClick={() => setShowMean(!showMean)}
                                 className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium ${showMean ? 'border-sky-400/60 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300' : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400'}`}>
                           <span aria-hidden="true" className="h-2 w-2 rounded-full bg-sky-500" />Mean
                         </button>
                       </>} />
            ) : (
              <Columns name={`Images each day of ${shownImageMonth ? formatMonth(shownImageMonth) : 'the month'}`} title="Images each day" subtitle={`How many images were taken on each day of ${shownImageMonth ? formatMonth(shownImageMonth) : 'the month'}`}
                       badge={`${num(imageDayColumns.reduce((n, c) => n + c.value, 0))} images`} unit={['image', 'images']} header={['Day', 'Images']} columns={imageDayColumns} labels="always"
                       footer={{ left: <>X axis: <strong className="font-normal text-zinc-700 dark:text-zinc-200">Day of the month</strong> · Y axis: <strong className="font-normal text-zinc-700 dark:text-zinc-200">Images</strong></>, right: busiest(imageDayColumns) ? `Busiest: ${num(busiest(imageDayColumns)!.value)} on ${busiest(imageDayColumns)!.label}` : undefined }}
                       controls={<><ViewToggle value={imageView} onChange={setImageView} name="images per day" /><MonthNav months={months} month={shownImageMonth} onChange={setImageMonth} name="images" /></>} />
            )}
            {sequenceView === 'distribution' ? (
              <Columns name="Distribution of the images per sequence" title="Images per sequence" subtitle="How many sequences have each number of images" badge={`${num(totals.sequences)} sequences`}
                       unit={['sequence', 'sequences']} header={['Images in the sequence', 'Sequences']} columns={sizeColumns} scale={scale} tone="emerald"
                       footer={{ left: <>X axis: <strong className="font-normal text-zinc-700 dark:text-zinc-200">Images in the sequence</strong> · Y axis: <strong className="font-normal text-zinc-700 dark:text-zinc-200">Sequences ({scale === 'log' ? 'log₁₀' : 'linear'})</strong></>, right: totals.longest ? `Longest: ${num(totals.longest.sequence.images)} images (${formatDuration(totals.longest.sequence.seconds)})` : undefined }}
                       controls={<>
                         <ViewToggle value={sequenceView} onChange={setSequenceView} name="sequences" />
                         <div className={segmented} role="group" aria-label="Scale">
                           <button type="button" aria-pressed={scale === 'linear'} className={segment(scale === 'linear')} onClick={() => setScale('linear')}>Linear</button>
                           <button type="button" aria-pressed={scale === 'log'} className={segment(scale === 'log')} onClick={() => setScale('log')}>Logarithmic</button>
                         </div>
                       </>} />
            ) : (
              <Columns name={`Sequences each day of ${shownSequenceMonth ? formatMonth(shownSequenceMonth) : 'the month'}`} title="Sequences each day" subtitle={`How many sequences began on each day of ${shownSequenceMonth ? formatMonth(shownSequenceMonth) : 'the month'}`}
                       badge={`${num(sequenceDayColumns.reduce((n, c) => n + c.value, 0))} sequences`} unit={['sequence', 'sequences']} header={['Day', 'Sequences']} columns={sequenceDayColumns} labels="always" tone="emerald"
                       footer={{ left: <>X axis: <strong className="font-normal text-zinc-700 dark:text-zinc-200">Day of the month</strong> · Y axis: <strong className="font-normal text-zinc-700 dark:text-zinc-200">Sequences</strong></>, right: busiest(sequenceDayColumns) ? `Busiest: ${num(busiest(sequenceDayColumns)!.value)} on ${busiest(sequenceDayColumns)!.label}` : undefined }}
                       controls={<><ViewToggle value={sequenceView} onChange={setSequenceView} name="sequences" /><MonthNav months={months} month={shownSequenceMonth} onChange={setSequenceMonth} name="sequences" /></>} />
            )}
          </section>

          {/* each deployment */}
          <TableCard label="Statistics of the deployments">
            <div className="print:hidden"><TableToolbar searchLabel="Filter the deployments" placeholder="Search by deployment, site or SD card…" text={text} onText={(t) => { setText(t); setPage(1) }}
              choice={{ label: 'State', value: state, onChange: (v) => { setState(v as State | ''); setPage(1) }, options: STATES.map((s) => ({ value: s, label: STATUS[s].text })) }}
              extra={<button type="button" className="flex items-center gap-1 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 transition hover:bg-zinc-200 dark:hover:bg-zinc-700" onClick={exportCsv}>
                <Icon path={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>} className="h-3 w-3" />Export CSV</button>}
              onReset={() => { setText(''); setState(''); setPage(1) }} /></div>
            <div className="print:hidden"><ActiveFilters filters={[{ label: `Revision: ${collectionName}`, tone: 'blue' }, { label: `State: ${state ? STATUS[state].text : 'All'}`, tone: 'green' }]} summary={`${matching.length} of ${all.length} deployments`} /></div>
            <div className="overflow-x-auto print:overflow-visible">
              <table className={`${TABLE.table} print:text-[10px]`} aria-label="Statistics of the deployments, one row each">
                <thead className={TABLE.head}>
                  <tr>
                    <th scope="col" className="w-10 px-2 py-3 print:hidden"><span className="sr-only">Details</span></th>
                    {['Deployment', 'Days', 'Images', 'Per day', 'Sequences', 'Per sequence', 'Longest', 'State'].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}
                  </tr>
                </thead>
                <tbody className={TABLE.body}>
                  {shown.map((r) => {
                    const m = r.metrics, f = fields[r.deployment_id]
                    const tr = trendOf(r, all)
                    const open = detail?.id === r.deployment_id
                    const tab = (t: Tab) => setDetail(open && detail?.tab === t ? null : { id: r.deployment_id, tab: t })
                    const link = 'text-blue-600 dark:text-blue-400 hover:underline'
                    return (
                      <Fragment key={r.deployment_id}>
                        <tr className={TABLE.row(isolated === r.deployment_id)}>
                          <ChevronCell open={open} label={`the statistics of ${r.deployment_id}`} onToggle={() => setDetail(open ? null : { id: r.deployment_id, tab: 'days' })} />
                          <td className={TD}>
                            <button type="button" aria-pressed={isolated === r.deployment_id} aria-label={`Isolate ${r.deployment_id} in the figures`} title="Show only this deployment in the figures" className={`whitespace-nowrap font-mono text-xs font-semibold ${link}`}
                                    onClick={() => setIsolated(isolated === r.deployment_id ? null : r.deployment_id)}>{r.deployment_id}</button>
                            {isolated === r.deployment_id && <span className="ml-1.5 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-medium text-white">Isolated</span>}
                            <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">{[f?.card ? `SD ${f.card}` : null, f?.site ?? r.location].filter(Boolean).join(' · ')}</span>
                          </td>
                          <td className={`${TD} min-w-[8rem] print:min-w-0`}>
                            <span className="font-mono text-sm font-bold text-blue-600 dark:text-blue-400">{num(m.days)}</span> <span className="text-[11px] text-zinc-500 dark:text-zinc-400">days</span>
                            <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700/60"><span className="block h-full rounded-full bg-blue-500" style={{ width: `${((m.days ?? 0) / maxDays) * 100}%` }} /></span>
                            {m.first_image !== null && m.last_image !== null && <span className="mt-1 block font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{formatPeriod(wallIso(m.first_image), wallIso(m.last_image))}</span>}
                          </td>
                          <td className={`${TD} min-w-[6.5rem] print:min-w-0`}>
                            <span className="font-mono font-semibold">{num(m.image_count)}</span>
                            <span className="mt-1 block h-1.5 w-20 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700/60"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${Math.min((m.image_count / Math.max(totalImages, 1)) * 100 * 2.2, 100)}%` }} /></span>
                            <span className="mt-1 block font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{num((m.image_count / Math.max(totalImages, 1)) * 100)}% of the revision</span>
                          </td>
                          <td className={`${TD} whitespace-nowrap print:whitespace-normal`}>
                            {m.images_per_day === null ? '—' : <button type="button" aria-label={`Images per day of ${r.deployment_id}`} title="Show the images of each day" className={`font-mono font-semibold ${link}`} onClick={() => tab('days')}>{num(m.images_per_day)}</button>}
                            {m.daily && m.daily.length > 0 && <span className="mt-1 block font-mono text-[10px] text-zinc-500 dark:text-zinc-400">Busiest: {num(Math.max(...m.daily.map((d) => d.images)))}</span>}
                          </td>
                          <td className={`${TD} whitespace-nowrap print:whitespace-normal`}>
                            {m.sequence_count === 0 ? '0' : <button type="button" aria-label={`Sequences of ${r.deployment_id}`} title="Show the sequences" className={`font-mono font-semibold ${link}`} onClick={() => tab('sequences')}>{num(m.sequence_count)}</button>}
                            {m.days !== null && m.days > 0 && <span className="mt-1 block font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{num(m.sequence_count / m.days)} a day</span>}
                          </td>
                          <td className={`${TD} whitespace-nowrap print:whitespace-normal`}>
                            <span className="font-mono font-semibold text-violet-600 dark:text-violet-300">{num(m.sequence_length)}</span> <span className="text-[11px] text-zinc-500 dark:text-zinc-400">mean</span>
                            <span className="mt-1 block font-mono text-[10px] text-zinc-500 dark:text-zinc-400">Median: {num(m.sequence_median)}</span>
                          </td>
                          <td className={`${TD} whitespace-nowrap print:whitespace-normal`}>
                            {m.longest_sequence
                              ? <button type="button" aria-label={`Longest sequence of ${r.deployment_id}`} title="Show the longest sequence" onClick={() => setInspected(r.deployment_id)}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/70 dark:border-amber-600/40 bg-amber-100/70 dark:bg-amber-950/40 px-2.5 py-1 font-mono text-xs print:px-1 print:text-[9px] font-semibold text-amber-800 dark:text-amber-300 transition-colors hover:bg-amber-200/70 dark:hover:bg-amber-900/40">
                                  <Icon path={TROPHY} className="h-3 w-3" />{num(m.longest_sequence.images)} img<span className="font-normal opacity-75 print:hidden">· {formatDuration(m.longest_sequence.seconds)}</span>
                                </button>
                              : '—'}
                          </td>
                          <td className={TD}>
                            <span className="flex flex-wrap items-center gap-x-2">
                              <StatusBadge status={r.status} />
                              <span className="text-[10px] text-zinc-500 dark:text-zinc-400" title="The previous revisions of this location it is compared with">{r.revisions.length - 1} previous</span>
                            </span>
                            <button type="button" aria-label={`Compare ${r.deployment_id} with the earlier ones`} title="Compare it with the earlier revisions of its location" onClick={() => setComparing(r.deployment_id)}
                                    className={`mt-1.5 flex w-full flex-col gap-0.5 rounded-lg border px-2 py-1 text-left transition-colors hover:brightness-110 print:px-1 print:py-0.5 ${TREND_TONE[tr.trend].chip}`}>
                              <span className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold print:gap-0.5 print:text-[9px]"><Icon path={TREND_TONE[tr.trend].icon} className="h-3 w-3 shrink-0 print:hidden" />{tr.label}{tr.trend !== 'baseline' && <span className="font-mono">({tr.percent > 0 ? '+' : ''}{num(tr.percent)}%)</span>}</span>
                              <span className="font-mono text-[10px] opacity-80">{tr.trend === 'baseline' ? `${tr.percent > 0 ? '+' : ''}${num(tr.percent)}% vs ${tr.against}` : `vs ${tr.against}`}<span className="print:hidden"> · Compare ↗</span></span>
                            </button>
                          </td>
                        </tr>
                        {open && detail && (
                          <DetailsRow colSpan={9}>
                            <div className="mb-3 inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-950/60 p-0.5" role="group" aria-label={`Details of ${r.deployment_id}`}>
                              {([['days', 'Images per day'], ['sequences', 'Sequences']] as [Tab, string][]).map(([t, label]) => (
                                <button key={t} type="button" aria-pressed={detail.tab === t} className={segment(detail.tab === t)} onClick={() => setDetail({ id: r.deployment_id, tab: t })}>{label}</button>
                              ))}
                            </div>
                            {detail.tab === 'days' ? <ImagesPerDay row={r} /> : <SequencesOfDeployment row={r} />}
                          </DetailsRow>
                        )}
                      </Fragment>
                    )
                  })}
                  {shown.length === 0 && <tr><td colSpan={9} className="px-4 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">No deployment matches.</td></tr>}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950/50 text-xs font-semibold">
                    <td />
                    <td className="px-3 py-3">The revision ({all.length})</td>
                    <td className="px-3 py-3 font-mono text-blue-600 dark:text-blue-400">{num(whole.cameraDays)} days in all</td>
                    <td className="px-3 py-3 font-mono text-emerald-600 dark:text-emerald-400">{num(totalImages)}</td>
                    <td className="px-3 py-3 font-mono">{num(whole.meanPerDay)} a day</td>
                    <td className="px-3 py-3 font-mono">{num(whole.sequences)}</td>
                    <td className="px-3 py-3 font-mono text-violet-600 dark:text-violet-300">{num(whole.meanPerSequence)} mean</td>
                    <td className="px-3 py-3 font-mono text-amber-700 dark:text-amber-400">Max {num(whole.longest?.sequence.images)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="print:hidden"><TableFooter from={matching.length === 0 ? 0 : (current - 1) * PER_PAGE + 1} to={Math.min(current * PER_PAGE, matching.length)} total={matching.length} noun="deployments" page={current} pages={pages} onPage={setPage} /></div>
          </TableCard>
        </>
      )}

      {comparing && <StatisticsComparator rows={all} id={comparing} field={fields[comparing]} onNavigate={setComparing} onClose={() => setComparing(null)} />}

      {inspected && <SequenceDialog deploymentId={inspected} row={inspectedRow} field={fields[inspected]} onClose={() => setInspected(null)} />}

      {helpOpen && (
        <HelpDrawer onClose={() => setHelpOpen(false)}>
          <HelpCard title="What is shown" tone="text-blue-600 dark:text-blue-400" icon={HELP_ICONS.progress}>
            <p>The figures of the deployments of the revision picked: how long they were out, how many images they took, how many a day, and how those images group into sequences — a new sequence starts when the gap to the previous image is at least the sequence gap of Settings › Postvalidation. Isolate a deployment, with the buttons above the figures, to see its own.</p>
          </HelpCard>
          <HelpCard title="The figures" tone="text-emerald-600 dark:text-emerald-400" icon={HELP_ICONS.tags}>
            <dl className="space-y-2">
              <div><dt className="font-semibold text-zinc-700 dark:text-zinc-300">Length</dt><dd>The days from the first image of a deployment to its last. <em>Camera-days</em> are those of all of them added.</dd></div>
              <div><dt className="font-semibold text-zinc-700 dark:text-zinc-300">Images per day</dt><dd>The images divided by the days. The <em>median day</em> and the <em>busiest day</em> are of the calendar days.</dd></div>
              <div><dt className="font-semibold text-zinc-700 dark:text-zinc-300">Sequences</dt><dd>How many there are, and how many images a sequence has, on average and the median.</dd></div>
              <div><dt className="font-semibold text-zinc-700 dark:text-zinc-300">Longest sequence</dt><dd>The sequence with most images. Inspect it to see when it began and ended.</dd></div>
            </dl>
          </HelpCard>
          <HelpCard title="The distributions" tone="text-sky-600 dark:text-sky-400" icon={HELP_ICONS.images}>
            <p>The first says how many days had each number of images, with the mean as a dashed line; the second, how many sequences have each number of images. In the logarithmic scale a few very long sequences can be seen beside many of one or two images; the amber column is the long tail. <em>By day</em> shows instead each day of a month — the images of each, or the sequences that began — with the arrows to go to the month before or after.</p>
          </HelpCard>
          <HelpCard title="Against the previous revisions" tone="text-violet-600 dark:text-violet-400" icon={HELP_ICONS.filter}>
            <p className="mb-2">Each deployment is compared with the previous revisions of its location — the same site in the revisions before — in the number of images, of sequences and how many images a sequence has, with the method and the tolerance of Postvalidation.</p>
            <dl className="space-y-2">
              {STATES.map((k) => <div key={k} className="flex items-baseline gap-3"><dt className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS[k].tone}`}>{STATUS[k].text}</dt><dd>{STATUS[k].help}</dd></div>)}
            </dl>
          </HelpCard>
          <HelpCard title="Comparing" tone="text-emerald-600 dark:text-emerald-400" icon={HELP_ICONS.progress}>
            <p className="mb-2">The button under the state of a deployment says how its images a day changed against the revision before of its location — <em>More activity</em> from +12%, <em>Unusual peak</em> over +45%, <em>Less activity</em> from −12%, <em>Sharp drop</em> under −35% — and opens the comparison: the six metrics side by side, how the location evolved revision by revision and how the bursts compare. It can be compared with the previous revision, the mean of all the previous ones, a revision of its location that you pick — in the list, or pressing its bar in the evolution —, the rest of its revision or the whole project; and it says why a deployment is <em>To review</em>. The first revision of a location has none before it, so it is told as <em>First revision</em> and compared with the rest of its revision.</p>
          </HelpCard>
          <HelpCard title="The table" tone="text-amber-600 dark:text-amber-400" icon={HELP_ICONS.upload}>
            <p>Press the arrow of a deployment to see the images of each day and the sequences of each day — or press its images per day or its sequences. To compare it with the revisions of its location, press the button under its state. Its name isolates it in the figures.</p>
          </HelpCard>
        </HelpDrawer>
      )}

      <div className="mt-10 print:hidden">
        <button type="button" className={btnOutline} onClick={onBack}><span aria-hidden="true">← </span>Back</button>
      </div>
    </div>
  )
}
