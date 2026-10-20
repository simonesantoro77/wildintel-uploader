import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import Combobox from '../components/Combobox'
import { SmallSpinner, btnOutline, btnPrimary } from './ImportDeploymentPage'
import type { LocalResearchProject, TimeSegment, Timeline } from '../types'

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

/** Fixing the dates and times of a copied card's images: where the clock went wrong, a run of images shifted by an offset
 * (or to match an image whose real time is known), images with no time to trust removed — every fix written down, and
 * the card kept as it came so it can be put back. */
export default function TimeFixPage() {
  const [projects, setProjects] = useState<LocalResearchProject[]>([])
  const [projectId, setProjectId] = useState('')
  const [collections, setCollections] = useState<{ collection: string; deployments: string[] }[]>([])
  const [collection, setCollection] = useState('')
  const [deployment, setDeployment] = useState('')
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
  const [confirm, setConfirm] = useState<null | { kind: 'remove'; names: string[] } | { kind: 'restore' }>(null)

  const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

  useEffect(() => {
    api.listResearchProjects().then(({ results }) => setProjects(results)).catch((e) => setError(message(e, 'Could not read the collections folder.')))
  }, [])

  async function chooseProject(id: string) {
    setProjectId(id); setCollections([]); setCollection(''); setDeployment(''); setTimeline(null); setError(null)
    if (!id) return
    try {
      const { results } = await api.timefixCollections(id)
      setCollections(results)
      if (results.length) setCollection(results[0].collection)
    } catch (e) { setError(message(e, 'Could not read the copied cards.')) }
  }

  function resetForm(t: Timeline | null) {
    setFirst(t?.images[0]?.name ?? ''); setLast(''); setReason(''); setParts({ d: '0', h: '0', m: '0', s: '0' }); setSign(1)
    setRefImage(''); setRefTime(''); setConfirm(null)
  }

  async function chooseDeployment(id: string) {
    setDeployment(id); setTimeline(null); setError(null)
    if (!id) return
    setBusy(true)
    try { const t = await api.timefixTimeline(projectId, collection, id); setTimeline(t); resetForm(t) } catch (e) { setError(message(e, 'Could not read the images.')) } finally { setBusy(false) }
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

  function applySuggestion(seg: TimeSegment) {
    if (!seg.suggestion) return
    const total = Math.abs(seg.suggestion.offset_seconds)
    setMode('offset'); setSign(seg.suggestion.offset_seconds < 0 ? -1 : 1)
    setParts({ d: String(Math.floor(total / 86400)), h: String(Math.floor((total % 86400) / 3600)), m: String(Math.floor((total % 3600) / 60)), s: String(total % 60) })
    setFirst(seg.first); setLast(seg.last === names[names.length - 1] ? '' : seg.last)
    setReason(`Segment ${seg.first}–${seg.last} ${seg.suggestion.why}`)
  }

  async function run(action: () => Promise<Timeline>, fallback: string) {
    setBusy(true); setError(null)
    try { const t = await action(); setTimeline(t); resetForm(t) } catch (e) { setError(message(e, fallback)) } finally { setBusy(false) }
  }

  const applyShift = () => offset && run(() => api.timefixShift(projectId, collection, deployment, first, last || null, offset, reason), 'Could not change the dates.')
  const runNames = (seg: TimeSegment) => names.slice(names.indexOf(seg.first), names.indexOf(seg.last) + 1)
  const runCount = first ? (last ? names.indexOf(last) - names.indexOf(first) + 1 : names.length - names.indexOf(first)) : 0
  const deployments = collections.find((c) => c.collection === collection)?.deployments ?? []

  return (
    <div className="max-w-screen-lg mx-auto px-4 py-8 space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1 text-zinc-900 dark:text-zinc-100">Fix dates and times</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          For a copied card whose camera clock went wrong: see where the time jumps, shift a run of images by an offset — or to match an image whose real time
          you know — and remove the images whose time can&rsquo;t be trusted. Every fix is written down, and the card is kept as it came, so it can be put back.
          Then import the collection with Import session.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <label className={labelClass} htmlFor="tf-project">Research project</label>
          <Combobox id="tf-project" options={projects.map((p) => ({ value: p.acronym, label: `${p.acronym} — ${p.name}` }))} value={projectId}
                    onChange={(v) => void chooseProject(v)} disabled={busy} placeholder="Select…" clearLabel="Clear research project" />
        </div>
        <div>
          <label className={labelClass} htmlFor="tf-collection">Collection</label>
          <Combobox id="tf-collection" options={collections.map((c) => ({ value: c.collection, label: c.collection }))} value={collection}
                    onChange={(v) => { setCollection(v); setDeployment(''); setTimeline(null) }} disabled={busy || !projectId}
                    placeholder={projectId && !collections.length ? 'No copied cards yet' : 'Select…'} clearLabel="Clear collection" />
        </div>
        <div>
          <label className={labelClass} htmlFor="tf-deployment">Deployment</label>
          <Combobox id="tf-deployment" options={deployments.map((d) => ({ value: d, label: d }))} value={deployment}
                    onChange={(v) => void chooseDeployment(v)} disabled={busy || !collection} placeholder="Select…" clearLabel="Clear deployment" />
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      {busy && !timeline && <p className="text-sm text-zinc-500 flex items-center gap-2"><SmallSpinner />Reading the images…</p>}

      {timeline && (
        <>
          <section className="space-y-3" aria-label="What the images say">
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ['Images', String(timeline.images.length)],
                ['Period (cameras’ clock)', timeline.period ? `${shown(timeline.period.start)} → ${shown(timeline.period.end)}` : 'not in the FileTimestampLog'],
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
            <p className={`${hintClass} mb-2`}>A new segment starts wherever the time goes backwards from one image to the next — usually the clock reset or changed.</p>
            <div className="space-y-2">
              {timeline.segments.map((seg) => {
                const [text, tone] = SEGMENT_STATE[seg.state]
                return (
                  <div key={seg.first} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 flex flex-wrap items-center gap-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{text}</span>
                    <span className="text-sm"><span className="font-mono">{seg.first}</span> → <span className="font-mono">{seg.last}</span> · {seg.count} image(s)</span>
                    <span className={hintClass}>{shown(seg.first_time)} → {shown(seg.last_time)}</span>
                    <span className="flex gap-2 ml-auto">
                      {seg.suggestion && <button type="button" className={btnOutline} disabled={busy} onClick={() => applySuggestion(seg)}>Shift {offsetText(seg.suggestion.offset_seconds)}</button>}
                      {seg.state !== 'ok' && <button type="button" className={btnOutline} disabled={busy} onClick={() => setConfirm({ kind: 'remove', names: runNames(seg) })}>Remove these images</button>}
                    </span>
                  </div>
                )
              })}
              {timeline.undated.length > 0 && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 flex flex-wrap items-center gap-3">
                  <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">No date</span>
                  <span className="text-sm">{timeline.undated.length} image(s): <span className="font-mono">{timeline.undated.slice(0, 3).join(', ')}{timeline.undated.length > 3 ? '…' : ''}</span></span>
                  <button type="button" className={`${btnOutline} ml-auto`} disabled={busy} onClick={() => setConfirm({ kind: 'remove', names: timeline.undated })}>Remove these images</button>
                </div>
              )}
            </div>
          </section>

          {confirm?.kind === 'remove' && (
            <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 space-y-3" role="alertdialog" aria-label="Remove images">
              <p className="text-sm text-red-800 dark:text-red-300">
                Remove {confirm.names.length} image(s) from {deployment}? They won&rsquo;t be imported nor uploaded. They stay in the copy of the card kept as it came.
              </p>
              <input className={`${inputClass} w-full`} placeholder="Why (e.g. the clock reset and nothing tells when they were taken)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why they are removed" />
              <div className="flex justify-end gap-2">
                <button type="button" className={btnOutline} onClick={() => setConfirm(null)}>Cancel</button>
                <button type="button" className={`${btnPrimary} !bg-red-600 hover:!bg-red-700`} disabled={busy}
                        onClick={() => void run(() => api.timefixRemove(projectId, collection, deployment, confirm.names, reason), 'Could not remove the images.')}>
                  Remove {confirm.names.length} image(s)
                </button>
              </div>
            </div>
          )}

          <section className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 space-y-4" aria-label="Shift dates and times">
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
                  <label className={labelClass} htmlFor="tf-ref-time">Was really taken at (cameras&rsquo; clock, {timeline.camera_timezone})</label>
                  <input id="tf-ref-time" type="datetime-local" step={1} className={`${inputClass} w-full`} value={refTime} onChange={(e) => setRefTime(e.target.value)} />
                </div>
                <p className={`${hintClass} sm:col-span-2`}>For instance the photo of the field team at the visit: its real time is the visit&rsquo;s, in the field records.</p>
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

          <section aria-label="Fixes made">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="font-semibold mr-auto">Fixes made</h3>
              {timeline.has_originals && <button type="button" className={btnOutline} disabled={busy} onClick={() => setConfirm({ kind: 'restore' })}>Put back as the card was</button>}
            </div>
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
            {confirm?.kind === 'restore' && (
              <div className="mt-3 rounded-xl border border-amber-300 dark:border-amber-800 p-3 flex items-center gap-3 flex-wrap" role="alertdialog" aria-label="Put back">
                <p className="text-sm mr-auto">Undo every fix of {deployment}? The images go back to how the card had them.</p>
                <button type="button" className={btnOutline} onClick={() => setConfirm(null)}>Cancel</button>
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => void run(() => api.timefixRestore(projectId, collection, deployment), 'Could not put the card back.')}>Put back</button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
