import { useEffect, useRef, useState } from 'react'
import { btnOutline } from './PrepareFiles'
import type { VisitsCsvColumns } from '../types'

export type FileKind = 'form' | 'other'

export const FILE_KINDS: Record<FileKind, { title: string; summary: string }> = {
  form: { title: 'WildINTEL Epicollect CSV', summary: 'The download of the WildINTEL field form' },
  other: { title: 'Custom CSV / Spreadsheet', summary: 'Any other file: you match its columns next' },
}

/** The core fields shown for each kind, with the field of a visit each one is. */
const CORE: Record<FileKind, [label: string, field: string][]> = {
  form: [['Location', 'location_id'], ['Status of the camera', 'camera_status'], ['Date and time', 'created_at']],
  other: [['Site', 'location_id'], ['Actions', 'actions'], ['Date', 'date'], ['Time', 'time']],
}

const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** The file once it is read: what it is, the type the app detected — which the user can change —, the fields that matched and the first rows. */
export function DetectedFile({ name, text, found, kind, onKind, onReplace }: {
  name: string; text: string; found: VisitsCsvColumns; kind: FileKind; onKind: (kind: FileKind) => void; onReplace: () => void
}) {
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const detected: FileKind = found.kind
  const changed = kind !== detected
  const columns = kind === 'form' ? (found.form_columns ?? {}) : found.mapping
  const core = CORE[kind].map(([label, field]) => ({ label, field, column: columns[field] }))
  const matched = core.filter((c) => c.column).length
  const rows = Math.max(0, text.trim().split(/\r?\n/).length - 1)
  const shown = found.columns.slice(0, 6)
  // what the file would give if it is read as the kind chosen: the form needs its columns; a custom CSV needs the required fields matched, which can still be done in the next step
  const missing = found.fields.filter((f) => f.required && !found.mapping[f.field]).map((f) => f.label)
  const problem = kind === 'form' ? (found.form_error ?? null) : missing.length > 0 ? `No column of the file matches ${missing.join(', ')}. You can choose them in the next step.` : null
  const accent = changed ? 'border-l-blue-500' : 'border-l-emerald-500'

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-5">
        <div className="flex items-center gap-4 min-w-0">
          <span className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3 text-blue-600 dark:text-blue-400">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h8" /></svg>
          </span>
          <div className="min-w-0">
            <div className="font-mono font-semibold text-zinc-900 dark:text-zinc-100 truncate">{name}</div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">{size(new Blob([text]).size)} · {rows} {rows === 1 ? 'row' : 'rows'} · {found.columns.length} columns</div>
          </div>
        </div>
        <button type="button" className={btnOutline} onClick={onReplace}>Replace file</button>
      </div>

      <div data-testid="detected" className={`border-y border-zinc-200 dark:border-zinc-800 border-l-4 ${accent} bg-zinc-50 dark:bg-zinc-950/40 px-6 py-5`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2 mb-2">
              {changed
                ? <><span className="rounded-full border border-blue-300 bg-blue-50 px-3 py-0.5 text-xs font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300">Changed manually</span>
                    <span className="rounded-full border border-blue-300 bg-blue-50 px-3 py-0.5 text-xs font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300">Overridden by user</span></>
                : <span className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-0.5 text-xs font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">Auto-detected</span>}
            </div>
            <h5 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Detected file type: {FILE_KINDS[kind].title}</h5>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {changed
                ? <>Manually switched from <strong>{FILE_KINDS[detected].title}</strong> · Applying <strong>{FILE_KINDS[kind].title}</strong> rules.</>
                : kind === 'form'
                  ? <>Its columns are recognised by themselves: there is nothing to match.</>
                  : <>No form of the WildINTEL project found: in the next step you say which column is each field.</>}
            </p>
            {changed && <button type="button" className="mt-2 text-sm text-blue-600 underline dark:text-blue-400" onClick={() => onKind(detected)}>↺ Reset to auto-detected ({FILE_KINDS[detected].title})</button>}
          </div>
          <div className="relative" ref={menu}>
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 text-right mb-2">File type</div>
            <button type="button" className={btnOutline} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Change type <span aria-hidden="true">▾</span></button>
            {open && (
              <div role="menu" aria-label="Choose how to read this file" className="absolute right-0 z-10 mt-2 w-72 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                {(Object.keys(FILE_KINDS) as FileKind[]).map((k) => (
                  <button key={k} type="button" role="menuitemradio" aria-checked={kind === k} onClick={() => { setOpen(false); onKind(k) }}
                          className={`flex w-full items-start justify-between gap-2 rounded-lg px-3 py-2 text-left ${kind === k ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}>
                    <span>
                      <span className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100">{FILE_KINDS[k].title}
                        {k === detected && <span className="rounded-full bg-emerald-100 px-2 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Auto</span>}</span>
                      <span className="block text-sm text-zinc-500 dark:text-zinc-400">{FILE_KINDS[k].summary}</span>
                    </span>
                    {kind === k && <span aria-hidden="true" className="text-blue-600">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {problem && <p role="alert" className="border-b border-zinc-200 dark:border-zinc-800 bg-red-50 px-6 py-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">Cannot read the file as {FILE_KINDS[kind].title}: {problem}</p>}

      <div className="px-6 py-5">
        <div className="mb-5">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Header of the file</p>
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Header of the file">
            {found.columns.map((c, i) => <li key={`${c}-${i}`} className={`rounded-md border px-2 py-1 font-mono text-xs ${Object.values(columns).includes(c) ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400'}`}>{c}</li>)}
          </ul>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h5 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Columns of the file for a visit</h5>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Key visit fields found with the rules of {FILE_KINDS[kind].title}</p>
          </div>
          <span className={`rounded-full border px-3 py-0.5 text-xs font-semibold ${matched === core.length ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300'}`}>{matched} / {core.length} core fields matched</span>
        </div>
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Core fields">
          {core.map((c) => (
            <li key={c.field} className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-3">
              <div className="flex items-center justify-between text-sm text-zinc-500 dark:text-zinc-400"><span>{c.label}</span>
                {c.column ? <span aria-label="matched" className="text-emerald-600">✓</span> : <span aria-label="not matched" className="text-amber-600">–</span>}</div>
              <div className="mt-1 font-mono text-sm text-zinc-900 dark:text-zinc-100 truncate">{c.column ?? 'not found'}</div>
            </li>
          ))}
        </ul>
        {found.sample.length > 0 && (
          <div className="mt-5">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">First {found.sample.length} {found.sample.length === 1 ? 'row' : 'rows'} of the file</p>
            <div className="mt-2 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 dark:bg-zinc-800/60 text-left text-zinc-500 dark:text-zinc-400"><tr><th className="px-4 py-2 font-medium">#</th>{shown.map((c) => <th key={c} className="px-4 py-2 font-medium">{c}</th>)}</tr></thead>
                <tbody>{found.sample.map((row, i) => <tr key={i} className="border-t border-zinc-200 dark:border-zinc-700"><td className="px-4 py-2 text-zinc-400">{i + 1}</td>{shown.map((_, j) => <td key={j} className="px-4 py-2 font-mono whitespace-nowrap">{row[j]}</td>)}</tr>)}</tbody>
              </table>
            </div>
            {found.columns.length > shown.length && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{found.columns.length - shown.length} more columns not shown.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
