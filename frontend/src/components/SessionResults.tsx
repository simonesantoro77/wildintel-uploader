import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { Report } from '../types'
import CheckFailures from './CheckFailures'
import Notice, { StatusIcon } from './Notice'
import { btnOutline } from '../pages/ImportDeploymentPage'
import { formatRun } from './ValidationDashboard'

export interface FolderResult {
  name: string
  images: number
  /** The report of its check, once there is one. */
  reportId: string | null
  /** What went wrong when the folder could not be checked. */
  error?: string
  /** What to show of a folder whose check has no report (it could not be written). */
  plain?: ReactNode
  /** Whether it has problems — all that is known of a folder whose check has no report. */
  problem: boolean
  /** Whether it goes on to the next steps. */
  included: boolean
}

function Figure({ tone, value, label }: { tone: string; value: number; label: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2.5">
      <p className={`text-2xl font-bold leading-tight ${tone}`}>{value.toLocaleString('en-US')}</p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
    </div>
  )
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** The results of the checks of a session, folder by folder: how many passed, which had problems and what they were, and — by check —
 * the table the page has. The folders are units: each is checked on its own. */
export default function SessionResults({ folders, checks, running, banner, byCheck, onLeaveOut }: {
  folders: FolderResult[]
  /** The checks that were run — only their failures count. */
  checks: string[]
  running: boolean
  banner: { tone: 'ok' | 'warn' | 'error'; text: ReactNode } | null
  /** The table of the checks, with how many folders failed each. */
  byCheck: ReactNode
  /** Leaves these folders out of the session. */
  onLeaveOut: (names: string[]) => void
}) {
  const [reports, setReports] = useState<Record<string, Report | { error: string }>>({})
  const [view, setView] = useState<'folder' | 'check'>('folder')
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [opened, setOpened] = useState<string | null>(null)
  const [viewing, setViewing] = useState<{ name: string; check: string } | null>(null)

  const ids = folders.map((f) => f.reportId).filter((id): id is string => Boolean(id)).join('|')
  useEffect(() => {
    let cancelled = false
    for (const id of ids.split('|').filter(Boolean)) {
      api.getReport(id)
        .then((r) => { if (!cancelled) setReports((all) => ({ ...all, [id]: r })) })
        .catch((e) => { if (!cancelled) setReports((all) => ({ ...all, [id]: { error: e instanceof Error ? e.message : 'Could not read the report.' } })) })
    }
    return () => { cancelled = true }
  }, [ids])

  const reportOf = (f: FolderResult): Report | null => {
    const r = f.reportId ? reports[f.reportId] : undefined
    return r && !('error' in r) ? r : null
  }
  const failedChecks = (f: FolderResult) => {
    const report = reportOf(f)
    return report ? checks.filter((c) => (report.checks[c]?.failed ?? 0) > 0) : []
  }
  const problems = (f: FolderResult) => Boolean(f.error) || (f.reportId ? failedChecks(f).length > 0 : f.problem)
  const badImages = (f: FolderResult) => reportOf(f)?.totals.images_with_issues ?? 0

  // The first folder with problems is open, to start with.
  const firstWithProblems = folders.find(problems)?.name ?? null
  useEffect(() => { if (!running && firstWithProblems) setOpened((o) => o ?? firstWithProblems) }, [running, firstWithProblems])
  const withProblems = folders.filter(problems)
  const stillIn = withProblems.filter((f) => f.included)
  const lastRun = Object.values(reports).filter((r): r is Report => !('error' in r)).map((r) => r.created_at).sort().pop()
  const shown = folders.filter((f) => !onlyProblems || problems(f))
  const view1 = viewing ? folders.find((f) => f.name === viewing.name) : undefined
  const viewReport = view1 ? reportOf(view1) : null

  if (viewing && viewReport && view1) {
    return <CheckFailures report={viewReport} check={viewing.check} parent={viewing.name} onBack={() => setViewing(null)} />
  }

  const kindOf = { ok: 'success', warn: 'warning', error: 'error' } as const
  const tab = (active: boolean) => `px-3 py-1.5 text-sm font-medium rounded-md ${active ? 'bg-blue-600 text-white' : 'border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300'}`

  return (
    <div>
      {lastRun && !running && <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">Last run {formatRun(lastRun)}</p>}
      {!running && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4" aria-label="Summary">
          <Figure tone="text-zinc-900 dark:text-zinc-100" value={folders.length} label="Folders checked" />
          <Figure tone="text-emerald-600 dark:text-emerald-400" value={folders.length - withProblems.length} label="Folders passed" />
          <Figure tone="text-amber-600 dark:text-amber-400" value={withProblems.length} label="With problems" />
          <Figure tone="text-zinc-900 dark:text-zinc-100" value={folders.reduce((n, f) => n + (reportOf(f)?.checked ?? f.images), 0)} label="Images checked" />
        </div>
      )}
      {banner && !running && (
        <Notice role="status" className="mb-4" kind={kindOf[banner.tone]}
                action={stillIn.length > 0 && (
                  <button type="button" className="rounded border border-current px-3 py-1.5 text-xs font-medium" onClick={() => onLeaveOut(stillIn.map((f) => f.name))}>Leave them out</button>
                )}>
          {banner.text}
        </Notice>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex gap-2" role="tablist" aria-label="Results by">
          <button type="button" role="tab" aria-selected={view === 'folder'} className={tab(view === 'folder')} onClick={() => setView('folder')}>By folder</button>
          <button type="button" role="tab" aria-selected={view === 'check'} className={tab(view === 'check')} onClick={() => setView('check')}>By check</button>
        </div>
        {view === 'folder' && (
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
            Only folders with problems
          </label>
        )}
      </div>

      {view === 'check' ? byCheck : (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700">
          {shown.map((f) => {
            const report = reportOf(f)
            const failed = failedChecks(f)
            const bad = problems(f)
            const open = opened === f.name
            return (
              <div key={f.name} className={f.included ? '' : 'opacity-60'}>
                <button type="button" aria-expanded={open} aria-label={`${open ? 'Close' : 'Open'} ${f.name}`} onClick={() => setOpened(open ? null : f.name)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left">
                  <StatusIcon kind={bad ? 'warning' : 'success'} className={`h-5 w-5 ${bad ? 'text-amber-500' : 'text-emerald-500'}`} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-mono font-semibold text-zinc-900 dark:text-zinc-100">{f.name}</span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">{plural(f.images, 'image', 'images')}{!f.included && ' · left out'}</span>
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${bad ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300' : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'}`}>
                    {f.error ? 'Not checked' : bad && !f.reportId ? 'Problems found' : bad ? `${plural(failed.length, 'check', 'checks')} failed${badImages(f) ? ` · ${plural(badImages(f), 'image', 'images')}` : ''}` : 'Passed'}
                  </span>
                  <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 fill-none stroke-current text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                </button>
                {open && (
                  <div className="px-4 pb-4">
                    {f.error && <p className="text-sm text-red-600 dark:text-red-400">{f.error}</p>}
                    {report && failed.map((c) => (
                      <p key={c} className="text-sm text-amber-700 dark:text-amber-400 mb-1">
                        <span className="font-medium">{report.checks[c].label}</span> — {report.entries.find((e) => e.check === c && e.status === 'failed')?.message ?? `${report.checks[c].failed} failed`}
                      </p>
                    ))}
                    {report && !bad && <p className="text-sm text-zinc-600 dark:text-zinc-400">Every check passed.</p>}
                    {!f.reportId && f.plain}
                    {f.reportId && (
                      <div className="mt-3 flex gap-2">
                        {failed.length > 0 && <button type="button" className={btnOutline} onClick={() => setViewing({ name: f.name, check: failed[0] })}>View the images</button>}
                        <a className={btnOutline} href={api.reportUrl(f.reportId, 'csv')} download>Download report</a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {shown.length === 0 && <p className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">No folder has problems.</p>}
        </div>
      )}
    </div>
  )
}
