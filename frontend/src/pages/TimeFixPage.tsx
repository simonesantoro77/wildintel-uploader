import { listWorking } from '../researchProjects'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { defaultResearchProject } from '../defaultResearchProject'
import Combobox from '../components/Combobox'
import BackButton from '../components/BackButton'
import WizardStep from '../components/WizardStep'
import { PageHeader, UTIL_ICONS } from '../components/TaskCard'
import { HELP_ICONS, HelpButton, HelpCard, HelpDrawer } from '../components/DashboardParts'
import { SmallSpinner, btnOutline, btnPrimary, visitKey, visitLabel } from './ImportDeploymentPage'
import type { ClosedVisit, StoredVisit, TimeFixTarget, TimeSegment, Timeline } from '../types'
import { PAGE_CLASS } from '../components/PageBar'

const labelClass = 'block text-sm font-semibold mb-1.5 text-zinc-700 dark:text-zinc-300'
const inputClass = 'rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60'
const hintClass = 'text-xs text-zinc-500 dark:text-zinc-400'

/** An offset in seconds as "+400 d 5 h 30 min 15 s". */
export function offsetText(seconds: number): string {
  const sign = seconds < 0 ? '−' : '+'
  let rest = Math.abs(seconds)
  const parts: string[] = []
  for (const [unit, size] of [['d', 86400], ['h', 3600], ['min', 60], ['s', 1]] as const) {
    const n = Math.floor(rest / size)
    rest -= n * size
    if (n) parts.push(`${n} ${unit}`)
  }
  return `${sign}${parts.join(' ') || '0 s'}`
}

/** Seconds between two "YYYY-MM-DDTHH:MM(:SS)" times read as the same clock — no timezone involved. */
export function secondsBetween(from: string, to: string): number {
  const ms = (s: string) => Date.parse(`${s.length === 16 ? `${s}:00` : s}Z`)
  return Math.round((ms(to) - ms(from)) / 1000)
}

const shown = (iso: string | null) => (iso ? iso.replace('T', ' ').slice(0, 19) : '—')

const SEGMENT_STATE: Record<TimeSegment['state'], [string, string]> = {
  ok: ['In its period', 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'],
  partly: ['Partly outside', 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300'],
  outside: ['Outside its period', 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'],
}

/** The images' times against their order — a straight climb when the clock was right; the period as a band. */
function TimeChart({ timeline }: { timeline: Timeline }) {
  const points = timeline.images.map((img, i) => ({ i, t: img.time ? Date.parse(`${img.time}Z`) : null })).filter((p): p is { i: number; t: number } => p.t !== null)
  if (points.length === 0) return null
  const W = 720, H = 220, L = 120, R = 12, T = 12, B = 28
  const start = timeline.period ? Date.parse(`${timeline.period.start}Z`) : null
  const end = timeline.period ? Date.parse(`${timeline.period.end}Z`) : null
  const values = [...points.map((p) => p.t), ...(start && end ? [start, end] : [])]
  const lo = Math.min(...values), hi = Math.max(...values)
  const span = hi - lo || 1
  const n = Math.max(1, timeline.images.length - 1)
  const x = (i: number) => L + ((W - L - R) * i) / n
  const y = (t: number) => T + (H - T - B) * (1 - (t - lo) / span)
  const day = (t: number) => new Date(t).toISOString().slice(0, 10)
  const ticks = [lo, lo + span / 2, hi]
  return (
    <figure className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[32rem] text-zinc-500 dark:text-zinc-400" role="img" aria-label="Time of each image, in the camera's order">
        {start && end && <rect x={L} width={W - L - R} y={y(end)} height={Math.max(1, y(start) - y(end))} className="fill-emerald-500/15" />}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={0.15} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="currentColor">{day(t)}</text>
          </g>
        ))}
        {points.map((p) => {
          const inside = !start || !end || (p.t >= start - timeline.tolerance_hours * 3.6e6 && p.t <= end + timeline.tolerance_hours * 3.6e6)
          return <circle key={p.i} cx={x(p.i)} cy={y(p.t)} r={points.length > 500 ? 1.2 : 2.5} className={inside ? 'fill-blue-600 dark:fill-blue-400' : 'fill-red-600 dark:fill-red-400'} />
        })}
        <text x={L} y={H - 8} fontSize="11" fill="currentColor">first image</text>
        <text x={W - R} y={H - 8} fontSize="11" fill="currentColor" textAnchor="end">last image</text>
      </svg>
      <figcaption className={hintClass}>Each dot is an image, in the camera&rsquo;s order; the green band is the deployment&rsquo;s period. Red dots fall outside it.</figcaption>
    </figure>
  )
}

/** Checking and fixing the dates and times of the images in a folder: where the clock went wrong, a run of images shifted
 * by an offset (or to match an image whose real time is known), images with no time to trust removed — every fix written
 * down. */
export default function TimeFixPage({ initial, onBack, parent = 'Utilities' }: {
  /** Opened from where the dates were found wrong: the folder, and the research project and visit its dates are checked against. */
  initial?: { folder: string; researchProjectId?: string; visit?: StoredVisit }
  onBack?: () => void
  onOpenSettings?: (section?: 'general') => void
  settingsOpen?: boolean
  /** The page it is reached from: Utilities, or Import deployment when the dates were found wrong there. */
  parent?: string
} = {}) {
  const [projectId, setProjectId] = useState('')
  const [folder, setFolder] = useState('')
  const [browsing, setBrowsing] = useState(false)
  const [visits, setVisits] = useState<ClosedVisit[]>([])
  const [visitId, setVisitId] = useState('')
  // The revision comes first: the visits to choose from are those of the one picked.
  const [revision, setRevision] = useState('')
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The fix being prepared.
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [mode, setMode] = useState<'offset' | 'reference'>('offset')
  const [sign, setSign] = useState<1 | -1>(1)
  const [parts, setParts] = useState({ d: '0', h: '0', m: '0', s: '0' })
  const [refImage, setRefImage] = useState('')
  const [refTime, setRefTime] = useState('')
  const [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState<null | { kind: 'remove'; names: string[] } | { kind: 'shift'; segment: TimeSegment }>(null)

  const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

  useEffect(() => {
    listWorking().then(async ({ results }) => {
      // Opened with no research project: the default of the general settings comes filled in.
      if (initial?.researchProjectId) return
      const wanted = await defaultResearchProject()
      const found = results.find((p) => p.acronym.toLowerCase() === wanted.toLowerCase())
      if (wanted && found) void chooseProject(found.acronym)
    }).catch((e) => setError(message(e, 'Could not read the collections folder.')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!initial) return
    setFolder(initial.folder)
    const { researchProjectId, visit } = initial
    if (!researchProjectId) return
    setProjectId(researchProjectId)
    api.closedVisits(researchProjectId).then(({ results }) => {
      setVisits(results)
      const key = visit && visitKey({ visit, end: visit })
      const found = key ? results.find((c) => visitKey(c) === key) : undefined
      if (found) { setVisitId(key!); setRevision(found.visit.session ?? '') }
      void check({ folder: initial.folder, ...(visit ? { research_project_id: researchProjectId, location_id: visit.location_id, date: visit.date, time: visit.time } : {}) })
    }).catch((e) => setError(message(e, 'Could not read the visits.')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const revisions = [...new Set(visits.map((c) => c.visit.session).filter((x): x is string => Boolean(x)))].sort().reverse()
  const visitsOfRevision = visits.filter((c) => c.visit.session === revision)

  async function chooseProject(id: string) {
    setProjectId(id); setVisits([]); setVisitId(''); setRevision(''); setTimeline(null); setError(null)
    if (!id) return
    try { setVisits((await api.closedVisits(id)).results) } catch (e) { setError(message(e, 'Could not read the visits.')) }
  }

  /** The folder, and the visit that left the camera — what its dates are checked against — as the backend wants them. */
  const target = (): TimeFixTarget => {
    const visit = visits.find((c) => visitKey(c) === visitId)?.visit
    return { folder: folder.trim(), ...(visit ? { research_project_id: projectId, location_id: visit.location_id, date: visit.date, time: visit.time } : {}) }
  }

  async function browse() {
    setBrowsing(true); setError(null)
    try { const { path } = await api.browseFolder(); if (path) { setFolder(path); setTimeline(null) } } catch (e) { setError(message(e, 'Could not open the folder browser.')) } finally { setBrowsing(false) }
  }

  function resetForm(t: Timeline | null) {
    setFirst(t?.images[0]?.name ?? ''); setLast(''); setReason(''); setParts({ d: '0', h: '0', m: '0', s: '0' }); setSign(1)
    setRefImage(''); setRefTime(''); setConfirm(null)
  }

  async function check(given?: TimeFixTarget) {
    setTimeline(null); setError(null); setBusy(true)
    try { const t = await api.timefixTimeline(given ?? target()); setTimeline(t); resetForm(t) } catch (e) { setError(message(e, 'Could not read the images.')) } finally { setBusy(false) }
  }

  const names = timeline?.images.map((i) => i.name) ?? []
  const timeOf = useMemo(() => Object.fromEntries((timeline?.images ?? []).map((i) => [i.name, i.time])), [timeline])

  const offset = useMemo(() => {
    if (mode === 'reference') {
      const was = timeOf[refImage]
      return was && refTime ? secondsBetween(was, refTime) : null
    }
    const nums = [parts.d, parts.h, parts.m, parts.s].map((v) => (/^\d+$/.test(v.trim()) ? Number(v) : NaN))
    if (nums.some(Number.isNaN)) return null
    return sign * (nums[0] * 86400 + nums[1] * 3600 + nums[2] * 60 + nums[3])
  }, [mode, parts, sign, refImage, refTime, timeOf])

  const [helpOpen, setHelpOpen] = useState(false)

  async function run(action: () => Promise<Timeline>, fallback: string) {
    setBusy(true); setError(null)
    try { const t = await action(); setTimeline(t); resetForm(t) } catch (e) { setError(message(e, fallback)) } finally { setBusy(false) }
  }

  const applyShift = () => offset && run(() => api.timefixShift(target(), first, last || null, offset, reason), 'Could not change the dates.')
  const runNames = (seg: TimeSegment) => names.slice(names.indexOf(seg.first), names.indexOf(seg.last) + 1)
  const runCount = first ? (last ? names.indexOf(last) - names.indexOf(first) + 1 : names.length - names.indexOf(first)) : 0

  return (
    <div className={`${PAGE_CLASS} space-y-6`}>
      <PageHeader icon={UTIL_ICONS.timefix} title="Check and fix dates and times" parent={parent} onParent={onBack}
        description="For the images of a card copied to a folder whose camera clock went wrong: see where the time jumps, shift the dates and remove the images that can’t be trusted."
        actions={<HelpButton label="Help" expanded={helpOpen} onClick={() => setHelpOpen(true)} />} />

      <WizardStep n={1} title="Choose the folder and the visit" status={timeline ? 'done' : 'open'} canEdit={!busy} onEdit={() => setTimeline(null)}
                  summary={<><span className="font-mono">{folder}</span>{visitId && visits.find((c) => visitKey(c) === visitId) ? <> · {visitLabel(visits.find((c) => visitKey(c) === visitId)!)}</> : ' · no visit chosen'}</>}
                  description="The images of the card copied to a folder, and the visit that left the camera — the dates are checked against its period.">
        <div className="space-y-4">
        <div>
          <label className={labelClass} htmlFor="tf-folder">Folder</label>
          <div className="flex gap-2">
            <input id="tf-folder" className={`${inputClass} flex-1`} placeholder="/home/me/Pictures/R0001-SITE_01" value={folder} disabled={busy}
                   onChange={(e) => { setFolder(e.target.value); setTimeline(null) }} />
            <button type="button" className={`${btnOutline} flex items-center gap-2`} disabled={browsing || busy} onClick={() => void browse()}>
              {browsing && <SmallSpinner />}{browsing ? 'Browsing…' : 'Browse…'}
            </button>
          </div>
        </div>
        {/* the revision first, then the visit to a site in it */}
        <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
          <div>
            <label className={labelClass} htmlFor="tf-revision">Revision</label>
            <Combobox id="tf-revision" options={revisions.map((r) => ({ value: r, label: r }))} value={revision}
                      onChange={(v) => { setRevision(v); setVisitId(''); setTimeline(null) }} disabled={busy || !projectId}
                      placeholder={!projectId ? 'No default research project' : !revisions.length ? 'No closed visits' : 'Select…'} clearLabel="Clear revision" />
          </div>
          <div>
            <label className={labelClass} htmlFor="tf-visit">Visit that left the camera</label>
            <Combobox id="tf-visit" options={visitsOfRevision.map((c) => ({ value: visitKey(c), label: visitLabel(c) }))} value={visitId}
                      onChange={(v) => { setVisitId(v); setTimeline(null) }} disabled={busy || !revision}
                      placeholder={!revision ? 'Pick the revision first' : 'Select…'} clearLabel="Clear visit" />
          </div>
        </div>
        <p className={hintClass}>The visit is optional: without it the time jumps are found, but the dates can&rsquo;t be checked against a period.</p>
        <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!folder.trim() || busy} onClick={() => void check()}>
          {busy && !timeline && <SmallSpinner />}Check the dates
        </button>
        </div>
      </WizardStep>

      {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      {busy && !timeline && <p className="text-sm text-zinc-500 flex items-center gap-2"><SmallSpinner />Reading the images…</p>}

      <WizardStep n={2} title="Check the dates" status={!timeline ? 'locked' : timeline.ok ? 'done' : 'open'} expanded canEdit={false} onEdit={() => {}}
                  description="Where the time jumps, and which images are outside the period of the visit.">
        {timeline && (
          <div className="space-y-6">
          <section className="space-y-3" aria-label="What the images say">
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ['Images', String(timeline.images.length)],
                ['Period (cameras’ clock)', timeline.period ? `${shown(timeline.period.start)} → ${shown(timeline.period.end)}` : 'no visit chosen'],
                ['Segments', String(timeline.segments.length)],
                ['Outside the period', String(timeline.outside)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-2 min-w-0">
                  <dt className={hintClass}>{k}</dt><dd className="text-sm font-semibold tabular-nums break-words">{v}</dd>
                </div>
              ))}
            </dl>
            {timeline.ok
              ? <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">✔ Every image has a date, in order and within the deployment&rsquo;s period (± {timeline.tolerance_hours} h).</p>
              : <ul className="text-sm text-amber-800 dark:text-amber-300 list-disc pl-5">{timeline.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            <TimeChart timeline={timeline} />
          </section>

          <section aria-label="Segments">
            <h3 className="font-semibold mb-2">Segments</h3>
            <p className={`${hintClass} mb-2`}>A new segment starts wherever the time goes backwards from one image to the next — usually the clock reset or changed. The next step is to fix the ones that are not in their period.</p>
            <div className="space-y-2">
              {timeline.segments.map((seg) => {
                const [text, tone] = SEGMENT_STATE[seg.state]
                return (
                  <div key={seg.first} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 flex flex-wrap items-center gap-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{text}</span>
                    <span className="text-sm"><span className="font-mono">{seg.first}</span> → <span className="font-mono">{seg.last}</span> · {seg.count} image(s)</span>
                    <span className={hintClass}>{shown(seg.first_time)} → {shown(seg.last_time)}</span>
                  </div>
                )
              })}
              {timeline.undated.length > 0 && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 flex flex-wrap items-center gap-3">
                  <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">No date</span>
                  <span className="text-sm">{timeline.undated.length} image(s): <span className="font-mono">{timeline.undated.slice(0, 3).join(', ')}{timeline.undated.length > 3 ? '…' : ''}</span></span>
                </div>
              )}
            </div>
          </section>

          </div>
        )}
      </WizardStep>

      <WizardStep n={3} title="Fix the segments" status={timeline ? 'open' : 'locked'} canEdit={false} onEdit={() => {}}
                  description="For each segment that is not in its period: move its images into it, or remove them.">
        {timeline && (
          <section className="space-y-3" aria-label="Fix the segments">
            {timeline.segments.every((seg) => seg.state === 'ok') && timeline.undated.length === 0 && (
              <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">✔ Every segment is in its period: there is nothing to fix here.</p>
            )}
            {timeline.segments.filter((seg) => seg.state !== 'ok').map((seg) => {
              const [text, tone] = SEGMENT_STATE[seg.state]
              return (
                <div key={seg.first} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 flex flex-wrap items-center gap-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{text}</span>
                  <span className="text-sm"><span className="font-mono">{seg.first}</span> → <span className="font-mono">{seg.last}</span> · {seg.count} image(s)</span>
                  <span className={hintClass}>{shown(seg.first_time)} → {shown(seg.last_time)}</span>
                  <div className="flex basis-full flex-wrap items-center gap-2 border-t border-zinc-200 dark:border-zinc-700 pt-3">
                    <span className="mr-auto text-sm text-zinc-700 dark:text-zinc-300">What do you want to do with {seg.count === 1 ? 'this image' : `these ${seg.count} images`}?</span>
                    {seg.suggestion && <button type="button" className={btnOutline} disabled={busy} onClick={() => { setReason(`Segment ${seg.first}–${seg.last} ${seg.suggestion!.why}`); setConfirm({ kind: 'shift', segment: seg }) }}>Move them into the period · {offsetText(seg.suggestion.offset_seconds)}</button>}
                    <button type="button" className={btnOutline} disabled={busy} onClick={() => { setReason(''); setConfirm({ kind: 'remove', names: runNames(seg) }) }}>Remove these images</button>
                  </div>
                </div>
              )
            })}
            {timeline.undated.length > 0 && (
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 flex flex-wrap items-center gap-3">
                <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">No date</span>
                <span className="text-sm">{timeline.undated.length} image(s) with no date can’t be moved: they can only be removed.</span>
                <button type="button" className={`${btnOutline} ml-auto`} disabled={busy} onClick={() => { setReason(''); setConfirm({ kind: 'remove', names: timeline.undated }) }}>Remove these images</button>
              </div>
            )}
          {confirm?.kind === 'shift' && (
            <div className="rounded-xl border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 p-4 space-y-3" role="alertdialog" aria-label="Move the images">
              <p className="text-sm text-blue-900 dark:text-blue-200">
                Move {confirm.segment.count} image(s), <span className="font-mono">{confirm.segment.first}</span> to <span className="font-mono">{confirm.segment.last}</span>, by <strong className="tabular-nums">{offsetText(confirm.segment.suggestion!.offset_seconds)}</strong> {confirm.segment.suggestion!.why}? Their dates are changed in the folder; the shift is written down and is undone by shifting back.
              </p>
              <input className={`${inputClass} w-full`} placeholder="Why (written down with the fix)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why the dates are moved" />
              <div className="flex justify-end gap-2">
                <button type="button" className={btnOutline} onClick={() => setConfirm(null)}>Cancel</button>
                <button type="button" className={btnPrimary} disabled={busy}
                        onClick={() => { const seg = confirm.segment; setConfirm(null); void run(() => api.timefixShift(target(), seg.first, seg.last === names[names.length - 1] ? null : seg.last, seg.suggestion!.offset_seconds, reason), 'Could not change the dates.') }}>
                  Move {confirm.segment.count} image(s)
                </button>
              </div>
            </div>
          )}
          {confirm?.kind === 'remove' && (
            <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 space-y-3" role="alertdialog" aria-label="Remove images">
              <p className="text-sm text-red-800 dark:text-red-300">
                Remove {confirm.names.length} image(s) from the folder? They are deleted from it; their names are written down with the fix.
              </p>
              <input className={`${inputClass} w-full`} placeholder="Why (e.g. the clock reset and nothing tells when they were taken)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why they are removed" />
              <div className="flex justify-end gap-2">
                <button type="button" className={btnOutline} onClick={() => setConfirm(null)}>Cancel</button>
                <button type="button" className={`${btnPrimary} !bg-red-600 hover:!bg-red-700`} disabled={busy}
                        onClick={() => void run(() => api.timefixRemove(target(), confirm.names, reason), 'Could not remove the images.')}>
                  Remove {confirm.names.length} image(s)
                </button>
              </div>
            </div>
          )}

          </section>
        )}
      </WizardStep>

      <WizardStep n={4} title="Fix the dates" status={timeline ? 'open' : 'locked'} canEdit={false} onEdit={() => {}}
                  description="Shift any run of images by hand — even one image — by an offset, or from an image whose real time you know.">
        {timeline && (
          <section className="space-y-4" aria-label="Shift dates and times">
            <h3 className="font-semibold">Shift dates and times</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass} htmlFor="tf-first">From image</label>
                <select id="tf-first" className={`${inputClass} w-full font-mono`} value={first} disabled={busy} onChange={(e) => setFirst(e.target.value)}>
                  {names.map((n) => <option key={n} value={n}>{n} · {shown(timeOf[n])}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="tf-last">To image</label>
                <select id="tf-last" className={`${inputClass} w-full font-mono`} value={last} disabled={busy} onChange={(e) => setLast(e.target.value)}>
                  <option value="">The last one</option>
                  {names.slice(Math.max(0, names.indexOf(first))).map((n) => <option key={n} value={n}>{n} · {shown(timeOf[n])}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2" role="radiogroup" aria-label="How the offset is given">
              {([['offset', 'By an offset'], ['reference', 'From an image whose real time I know']] as const).map(([value, text]) => (
                <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => setMode(value)}
                        className={`px-3 py-1.5 text-sm rounded-lg border ${mode === value ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-zinc-300 dark:border-zinc-600'}`}>{text}</button>
              ))}
            </div>
            {mode === 'offset' ? (
              <div className="flex flex-wrap items-end gap-3">
                <select aria-label="Forward or back" className={inputClass} value={sign} onChange={(e) => setSign(Number(e.target.value) as 1 | -1)}>
                  <option value={1}>Forward (+)</option>
                  <option value={-1}>Back (−)</option>
                </select>
                {([['d', 'days'], ['h', 'hours'], ['m', 'minutes'], ['s', 'seconds']] as const).map(([k, text]) => (
                  <label key={k} className="text-xs text-zinc-500">
                    {text}
                    <input aria-label={text} inputMode="numeric" className={`${inputClass} block w-20 tabular-nums`} value={parts[k]} onChange={(e) => setParts({ ...parts, [k]: e.target.value })} />
                  </label>
                ))}
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass} htmlFor="tf-ref-image">Image</label>
                  <select id="tf-ref-image" className={`${inputClass} w-full font-mono`} value={refImage} onChange={(e) => setRefImage(e.target.value)}>
                    <option value="">Choose one…</option>
                    {names.map((n) => <option key={n} value={n}>{n} · {shown(timeOf[n])}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="tf-ref-time">Was really taken at (cameras&rsquo; clock)</label>
                  <input id="tf-ref-time" type="datetime-local" step={1} className={`${inputClass} w-full`} value={refTime} onChange={(e) => setRefTime(e.target.value)} />
                </div>
                <p className={`${hintClass} sm:col-span-2`}>For instance the photo of the field team at the visit, whose real time you know.</p>
              </div>
            )}
            <input className={`${inputClass} w-full`} placeholder="Why (written down with the fix)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why the dates are shifted" />
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-sm mr-auto">
                {offset ? <>Shift <strong>{runCount}</strong> image(s) by <strong className="tabular-nums">{offsetText(offset)}</strong>{first && timeOf[first] ? <> — {first} becomes {shown(new Date(Date.parse(`${timeOf[first]}Z`) + offset * 1000).toISOString().slice(0, 19))}</> : null}</> : <span className={hintClass}>Give the offset, or an image and its real time.</span>}
              </p>
              <button type="button" className={`${btnPrimary} flex items-center gap-2`} disabled={!offset || !first || busy} onClick={() => void applyShift()}>
                {busy && <SmallSpinner />}Shift the dates
              </button>
            </div>
          </section>

        )}
      </WizardStep>

      <WizardStep n={5} title="Fixes made" status={timeline ? 'open' : 'locked'} canEdit={false} onEdit={() => {}}
                  description="Everything that was changed, written down in the folder (time_corrections.json): a shift is undone by shifting back.">
        {timeline && (
          <section aria-label="Fixes made">
            <h3 className="font-semibold mb-2">Fixes made</h3>
            {timeline.corrections.length === 0 && <p className={hintClass}>None: the images are as they came from the card.</p>}
            <ol className="space-y-1 text-sm">
              {timeline.corrections.map((c, i) => (
                <li key={i} className="text-zinc-700 dark:text-zinc-300">
                  <span className={hintClass}>{shown(c.at)} UTC{c.by ? ` · ${c.by}` : ''} · </span>
                  {c.action === 'shift' && <>{c.count} image(s) {c.first}–{c.last} shifted {offsetText(c.offset_seconds ?? 0)}</>}
                  {c.action === 'remove' && <>{c.count} image(s) removed</>}
                  {c.action === 'restore' && <>put back as the card was</>}
                  {c.reason && <span className={hintClass}> — {c.reason}</span>}
                </li>
              ))}
            </ol>
          </section>

        )}
      </WizardStep>
      {helpOpen && (
        <HelpDrawer title="Dates and times: help" onClose={() => setHelpOpen(false)}>
          <HelpCard title="What it is for" tone="text-blue-600 dark:text-blue-400" icon={HELP_ICONS.progress}>
            <p>The clock of a camera can go wrong — it is reset, or it was never set — and then the dates of its images are not the days they were taken. Here you find where the time jumps and fix it, for the images of a card that you <strong>copied to a folder</strong>.</p>
            <p className="mt-1.5">The images of the folder are changed, so work on the copy, <strong>never on the card</strong>.</p>
          </HelpCard>
          <HelpCard title="Check the dates" tone="text-emerald-600 dark:text-emerald-400" icon={HELP_ICONS.images}>
            <p>Say the <strong>folder</strong> and the <strong>visit that left the camera</strong> — those of the default research project, the one in the card at the top —, and press <em>Check the dates</em>.</p>
            <p className="mt-1.5">The visit is optional: without it the jumps in the time are found, but the dates can’t be checked against a period. With it, the dates are compared with the days between the visit that left the camera and the next one, with a margin of a few hours.</p>
          </HelpCard>
          <HelpCard title="Segments" tone="text-amber-600 dark:text-amber-400" icon={HELP_ICONS.filter}>
            <p>A <strong>segment</strong> is a run of consecutive images taken with the camera’s clock in <strong>one setting</strong>. The images are read in the order the camera numbered them; while the time goes up they are in the same segment, and a <strong>new one starts wherever the time goes backwards</strong> from one image to the next.</p>
            <p className="mt-1.5">With a clock that worked, all the images make one segment. With several, the clock was reset or changed: for instance, when the batteries ran out the camera went back to its factory date, so <span className="font-mono">IMG_0001</span>–<span className="font-mono">IMG_0500</span> say 2026 and <span className="font-mono">IMG_0501</span> on say 2020.</p>
            <p className="mt-1.5">Each segment is compared with the period of the visit (with a margin of a few hours) and says if it is <em>In its period</em>, <em>Partly outside</em> or <em>Outside its period</em>.</p>
            <p className="mt-1.5">In the step <em>Fix the segments</em>, for each one that is not in its period you choose: <strong>move its images into the period</strong> — the shift is shown and asked before it is made: the first segment is moved to start when the deployment started, and each later one to go on from where the one before ended — or <strong>remove them</strong>. The images with <em>No date</em> are not in any segment.</p>
          </HelpCard>
          <HelpCard title="Fix the dates" tone="text-violet-600 dark:text-violet-400" icon={HELP_ICONS.tags}>
            <p>Pick the run of images — <em>From image</em> and <em>To image</em>, up to the last one if none is said — and how far to move them:</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5">
              <li><strong>By an offset</strong>: forward or back, in days, hours, minutes and seconds.</li>
              <li><strong>From an image whose real time I know</strong>: say one image and the time it was really taken (a photo of the field team, for one), and the shift is worked out from it.</li>
            </ul>
            <p className="mt-1.5">Write <em>why</em>: it is kept with the fix.</p>
          </HelpCard>
          <HelpCard title="Remove images" tone="text-red-600 dark:text-red-400" icon={HELP_ICONS.upload}>
            <p>The images whose time can’t be trusted, and that nothing tells when they were taken, can be removed from the folder: a segment that is outside its period, or the images with no date. They are <strong>deleted</strong> from the folder; their names are written down with the fix and the reason.</p>
          </HelpCard>
          <HelpCard title="Fixes made" tone="text-sky-600 dark:text-sky-400" icon={HELP_ICONS.progress}>
            <p>Every fix is written down in the folder, in <span className="font-mono">time_corrections.json</span>, and listed under <em>Fixes made</em>. A shift is undone by shifting back by the same amount.</p>
          </HelpCard>
        </HelpDrawer>
      )}
      {onBack && <div className="pt-4"><BackButton onClick={onBack} disabled={busy} /></div>}
    </div>
  )
}
