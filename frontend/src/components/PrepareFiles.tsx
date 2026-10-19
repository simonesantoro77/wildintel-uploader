import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export const btnPrimary = 'px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
export const btnOutline = 'px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50'
export const panel = 'rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/40'

/** One deployment of the files being prepared, as the page has followed it. */
export interface PrepareItem {
  id: string
  images: number
  state: 'pending' | 'working' | 'done' | 'failed'
  /** Which of the three steps it is on — 1 check the images, 2 pack them, 3 write the description. */
  step: 1 | 2 | 3
  /** Images packed so far. */
  packed: number
  /** What it wrote, with each file's size in bytes. */
  files: { name: string; bytes: number }[]
  error?: string
}

export const PREPARE_STEPS = ['Checking the images', 'Packing the images', 'Writing the description'] as const

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60
  if (hours) return `${hours} h ${minutes} min`
  if (minutes) return `${minutes} min ${seconds} s`
  return `${seconds} s`
}

export const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
const itemBytes = (item: PrepareItem) => item.files.reduce((sum, f) => sum + f.bytes, 0)

export function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className={`${panel} px-4 py-3`}>
      <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{value}</p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
    </div>
  )
}

export function Bar({ percent, label }: { percent: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
      <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  )
}

export function Spinner() {
  return <span aria-hidden="true" className="inline-block w-5 h-5 shrink-0 border-2 border-blue-200 dark:border-blue-900 border-t-blue-600 dark:border-t-blue-300 rounded-full animate-spin" />
}

/** The images already through, counting the one being worked on by what it has packed. */
const imagesDone = (item: PrepareItem) => (item.state === 'done' ? item.images : item.state === 'working' ? (item.step === 1 ? 0 : item.step === 3 ? item.images : Math.min(item.packed, item.images)) : 0)

/** The files being prepared: where it is overall, the deployment it is on, and every deployment's state. */
export function PreparingFiles({ items, startedAt, onStop }: {
  items: PrepareItem[]; startedAt: number; onStop: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const total = items.reduce((sum, i) => sum + i.images, 0)
  const done = items.reduce((sum, i) => sum + imagesDone(i), 0)
  const percent = total > 0 ? (done / total) * 100 : 0
  const current = items.find((i) => i.state === 'working')
  const written = items.filter((i) => i.state === 'done').reduce((sum, i) => sum + itemBytes(i), 0)
  const elapsed = now - startedAt
  const remaining = done > 0 && elapsed > 3000 ? (elapsed / done) * (total - done) : null
  const left = remaining === null ? null : remaining < 60_000 ? 'Less than a minute left' : `About ${Math.round(remaining / 60_000)} min left`
  const rowPercent = (i: PrepareItem) => (i.step === 1 || i.images === 0 ? 0 : i.step === 3 ? 100 : (i.packed / i.images) * 100)
  return (
    <div>
      <div role="status" className="flex items-center gap-3 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-5 py-4 mb-4">
        <Spinner />
        <div>
          <p className="font-semibold text-zinc-900 dark:text-zinc-100">Writing the files…</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Nothing is sent to Trapper in this mode. You can leave this page open and come back.</p>
        </div>
      </div>

      <div className={`${panel} px-5 py-4 mb-4`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Now working on</p>
            <p className="font-mono font-semibold text-zinc-900 dark:text-zinc-100 truncate">{current?.id ?? '…'}</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {current ? `${PREPARE_STEPS[current.step - 1]}${current.step === 2 ? ` · ${current.packed.toLocaleString('en-US')} of ${current.images.toLocaleString('en-US')}` : ''}` : 'Starting…'}
            </p>
          </div>
          <p className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">{Math.round(percent)}%</p>
        </div>
        <div className="mt-3"><Bar percent={percent} label="Progress of all the deployments" /></div>
        <div className="mt-2 flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>{done.toLocaleString('en-US')} of {count(total, 'image')} in total</span>
          {left && <span>{left}</span>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Tile value={`${items.filter((i) => i.state === 'done').length} of ${items.length}`} label="Deployments done" />
        <Tile value={done.toLocaleString('en-US')} label="Images packed" />
        <Tile value={formatBytes(written)} label="Written so far" />
      </div>

      <div className={`${panel} mb-4 overflow-hidden`}>
        <div className="flex justify-between px-5 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700"><span>Deployment</span><span>Status</span></div>
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-4 px-5 py-3">
              <span className="w-5 shrink-0 flex justify-center">
                {i.state === 'done' ? <span aria-hidden="true" className="text-emerald-600 dark:text-emerald-400">✓</span> : i.state === 'working' ? <Spinner /> : i.state === 'failed' ? <span aria-hidden="true" className="text-red-600 dark:text-red-400">✕</span> : null}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">{i.id}</p>
                {i.state === 'done' && <p className="text-xs text-zinc-500 dark:text-zinc-400">{count(i.images, 'image')} · {formatBytes(itemBytes(i))}</p>}
                {i.state === 'working' && (
                  <>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Step {i.step} of 3 · {PREPARE_STEPS[i.step - 1]}</p>
                    <div className="mt-1.5 max-w-xs"><Bar percent={rowPercent(i)} label={`Progress of ${i.id}`} /></div>
                  </>
                )}
                {i.state === 'pending' && <p className="text-xs text-zinc-500 dark:text-zinc-400">{count(i.images, 'image')} · waiting</p>}
                {i.state === 'failed' && <p className="text-xs text-red-600 dark:text-red-400">{i.error}</p>}
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${i.state === 'done' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : i.state === 'working' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' : i.state === 'failed' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'}`}>
                {i.state === 'done' ? 'Done' : i.state === 'working' ? 'Working…' : i.state === 'failed' ? 'Failed' : 'Waiting'}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
        Each deployment goes through three steps: check the images, pack them together, and write its description. If you stop, the files already written are kept.
      </p>
      <div className="flex justify-end"><button type="button" className={btnOutline} onClick={onStop}>Stop</button></div>
    </div>
  )
}

/** What was written, once the preparing has ended — whether it all went well or not. */
export function FilesReady({ collection, items, outputDir, startedAt, finishedAt, onOpenFolder, onBack, onUpload }: {
  collection: string; items: PrepareItem[]; outputDir: string | null; startedAt: number; finishedAt: number
  onOpenFolder: () => void; onBack: () => void; onUpload?: () => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const doneItems = items.filter((i) => i.state === 'done')
  const failed = items.filter((i) => i.state !== 'done')
  const csvSuffix = '_deployments.csv'
  const allFiles = doneItems.flatMap((i) => i.files)
  const csv = [...allFiles].reverse().find((f) => f.name.endsWith(csvSuffix))
  const unique = new Map(allFiles.map((f) => [f.name, f.bytes]))
  const totalBytes = [...unique.values()].reduce((sum, b) => sum + b, 0)
  const finished = new Date(finishedAt)
  const when = `${finished.getUTCDate()} ${finished.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${finished.getUTCFullYear()}, ${String(finished.getUTCHours()).padStart(2, '0')}:${String(finished.getUTCMinutes()).padStart(2, '0')} UTC`
  const copy = async () => {
    if (!outputDir) return
    try { await navigator.clipboard.writeText(outputDir); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* the path stays on screen to select */ }
  }
  const banner: ReactNode = failed.length === 0 ? (
    <div role="status" className="flex items-center gap-4 rounded-xl border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-5 py-4 mb-4">
      <span aria-hidden="true" className="flex w-9 h-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">✓</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-emerald-900 dark:text-emerald-100">Files prepared</p>
        <p className="text-xs text-emerald-800/90 dark:text-emerald-200/80">{when} · took {formatDuration(finishedAt - startedAt)}. Nothing was sent to Trapper.</p>
      </div>
      {outputDir && <button type="button" className={btnPrimary} onClick={onOpenFolder}>Open folder</button>}
    </div>
  ) : (
    <div role="alert" className="rounded-xl border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-5 py-4 mb-4">
      <p className="font-semibold text-amber-900 dark:text-amber-200">{doneItems.length === 0 ? 'No files were prepared' : `${count(failed.length, 'deployment')} could not be prepared`}</p>
      <ul className="mt-1 text-sm text-amber-800 dark:text-amber-300 list-disc ml-5">
        {failed.map((i) => <li key={i.id}><span className="font-mono">{i.id}</span>: {i.error ?? 'It was not prepared.'}</li>)}
      </ul>
      {outputDir && doneItems.length > 0 && <button type="button" className={`${btnOutline} mt-3`} onClick={onOpenFolder}>Open folder</button>}
    </div>
  )
  return (
    <div>
      {banner}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Tile value={String(doneItems.length)} label="Deployments" />
        <Tile value={doneItems.reduce((sum, i) => sum + i.images, 0).toLocaleString('en-US')} label="Images packed" />
        <Tile value={formatBytes(totalBytes)} label="Total size" />
        <Tile value={String(unique.size)} label="Files written" />
      </div>
      {outputDir && doneItems.length > 0 && (
        <div className={`${panel} flex items-center gap-4 px-5 py-3 mb-5`}>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Where the files are</p>
            <p className="font-mono text-xs break-all text-zinc-800 dark:text-zinc-200">{outputDir}</p>
          </div>
          <button type="button" className={btnOutline} onClick={copy}>{copied ? 'Copied' : 'Copy path'}</button>
        </div>
      )}
      {doneItems.length > 0 && (
        <>
          <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">What was written</h4>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">Each deployment gets its images packed together and a description of the deployment. The collection gets one list of its deployments.</p>
          <ul className={`${panel} divide-y divide-zinc-200 dark:divide-zinc-700 mb-4`}>
            {doneItems.map((i) => {
              const own = i.files.filter((f) => !f.name.endsWith(csvSuffix))
              return (
                <li key={i.id}>
                  <button type="button" aria-expanded={open === i.id} onClick={() => setOpen(open === i.id ? null : i.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left">
                    <span aria-hidden="true" className="text-emerald-600 dark:text-emerald-400">✓</span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">{i.id}</span>
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">{count(i.images, 'image')} · {count(own.length, 'file')}</span>
                    </span>
                    <span className="text-sm text-zinc-700 dark:text-zinc-300">{formatBytes(own.reduce((sum, f) => sum + f.bytes, 0))}</span>
                    <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 fill-none stroke-current text-zinc-500 transition-transform ${open === i.id ? 'rotate-180' : ''}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                  {open === i.id && (
                    <ul className="px-5 pb-3 pl-12 text-xs font-mono text-zinc-600 dark:text-zinc-400 space-y-0.5">
                      {own.map((f) => <li key={f.name} className="flex justify-between gap-3"><span className="break-all">{f.name}</span><span className="shrink-0">{formatBytes(f.bytes)}</span></li>)}
                    </ul>
                  )}
                </li>
              )
            })}
            {csv && (
              <li className="flex items-center gap-3 px-5 py-3">
                <span aria-hidden="true" className="text-zinc-500">▤</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">List of deployments in {collection}</span>
                  <span className="block font-mono text-xs text-zinc-500 dark:text-zinc-400">{csv.name}</span>
                </span>
                <span className="text-sm text-zinc-700 dark:text-zinc-300">{formatBytes(csv.bytes)}</span>
              </li>
            )}
          </ul>
          <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 px-5 py-3 text-sm text-zinc-700 dark:text-zinc-300 mb-4">
            <strong className="font-semibold">What next?</strong> You can send these files to Trapper yourself, or let the app do it with <strong className="font-semibold">Upload to Trapper</strong>.
          </div>
        </>
      )}
      <div className="flex justify-between items-center">
        <button type="button" className={`${btnOutline} flex items-center gap-2`} onClick={onBack}><span aria-hidden="true">←</span>Back</button>
        {onUpload && <button type="button" className="px-4 py-2 text-sm border border-blue-600 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors" onClick={onUpload}>Upload to Trapper</button>}
      </div>
    </div>
  )
}
