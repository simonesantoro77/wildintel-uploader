import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { Report } from '../types'
import { btnOutline } from '../pages/ImportDeploymentPage'
import CheckFailures from './CheckFailures'
import Notice, { StatusIcon } from './Notice'
import { Figure, plural, tabClass } from './SessionResults'

export interface DeploymentResult {
  name: string
  images: number
  /** The labels of the checks it failed. */
  failed: string[]
  /** What went wrong when it could not be checked. */
  error?: string
  /** The report of its checks, once there is one. */
  reportId?: string | null
  /** What to show of a deployment whose checks have no report. */
  detail?: ReactNode
}

/** The results of the postvalidation of a revision, deployment by deployment — laid out like the results of the checks of the folders:
 * the figures, a message, and the deployments (or the checks) below. */
export default function DeploymentResults({ deployments, banner, byCheck }: {
  deployments: DeploymentResult[]
  banner: { kind: 'success' | 'warning' | 'error'; text: ReactNode } | null
  /** The table of the checks, with how many deployments failed each. */
  byCheck: ReactNode
}) {
  const [view, setView] = useState<'deployment' | 'check'>('deployment')
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [opened, setOpened] = useState<string | null>(null)

  const [reports, setReports] = useState<Record<string, Report>>({})
  const [viewing, setViewing] = useState<{ name: string; check: string } | null>(null)
  const ids = deployments.map((d) => d.reportId).filter((id): id is string => Boolean(id)).join('|')
  useEffect(() => {
    let cancelled = false
    for (const id of ids.split('|').filter(Boolean)) {
      api.getReport(id).then((r) => { if (!cancelled) setReports((all) => ({ ...all, [id]: r })) }).catch(() => undefined)
    }
    return () => { cancelled = true }
  }, [ids])
  const reportOf = (d: DeploymentResult) => (d.reportId ? reports[d.reportId] : undefined)
  const failedKeys = (d: DeploymentResult) => { const r = reportOf(d); return r ? Object.keys(r.checks).filter((c) => r.checks[c].failed > 0) : [] }

  const problems = (d: DeploymentResult) => Boolean(d.error) || d.failed.length > 0
  const firstWithProblems = deployments.find(problems)?.name ?? null
  useEffect(() => { if (firstWithProblems) setOpened((o) => o ?? firstWithProblems) }, [firstWithProblems])
  const withProblems = deployments.filter(problems)
  const shown = deployments.filter((d) => !onlyProblems || problems(d))

  const viewed = viewing ? deployments.find((d) => d.name === viewing.name) : undefined
  const viewedReport = viewed ? reportOf(viewed) : undefined
  if (viewing && viewed && viewedReport) {
    return <CheckFailures report={viewedReport} check={viewing.check} parent={viewing.name} onBack={() => setViewing(null)} />
  }

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4" aria-label="Summary">
        <Figure tone="text-zinc-900 dark:text-zinc-100" value={deployments.length} label="Deployments checked" />
        <Figure tone="text-emerald-600 dark:text-emerald-400" value={deployments.length - withProblems.length} label="Deployments passed" />
        <Figure tone="text-amber-600 dark:text-amber-400" value={withProblems.length} label="With problems" />
        <Figure tone="text-zinc-900 dark:text-zinc-100" value={deployments.reduce((n, d) => n + d.images, 0)} label="Images checked" />
      </div>
      {banner && <Notice role="status" className="mb-4" kind={banner.kind}>{banner.text}</Notice>}

      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex gap-2" role="tablist" aria-label="Results by">
          <button type="button" role="tab" aria-selected={view === 'deployment'} className={tabClass(view === 'deployment')} onClick={() => setView('deployment')}>By deployment</button>
          <button type="button" role="tab" aria-selected={view === 'check'} className={tabClass(view === 'check')} onClick={() => setView('check')}>By check</button>
        </div>
        {view === 'deployment' && (
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
            Only deployments with problems
          </label>
        )}
      </div>

      {view === 'check' ? byCheck : (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700">
          {shown.map((d) => {
            const bad = problems(d)
            const open = opened === d.name
            return (
              <div key={d.name}>
                <button type="button" aria-expanded={open} aria-label={`${open ? 'Close' : 'Open'} ${d.name}`} onClick={() => setOpened(open ? null : d.name)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left">
                  <StatusIcon kind={bad ? 'warning' : 'success'} className={`h-5 w-5 ${bad ? 'text-amber-500' : 'text-emerald-500'}`} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-mono font-semibold text-zinc-900 dark:text-zinc-100">{d.name}</span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">{plural(d.images, 'image', 'images')}</span>
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${bad ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300' : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'}`}>
                    {d.error ? 'Not checked' : bad ? `${plural(d.failed.length, 'check', 'checks')} failed` : 'Passed'}
                  </span>
                  <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 fill-none stroke-current text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                </button>
                {open && (
                  <div className="px-4 pb-4">
                    {d.error && <p className="text-sm text-red-600 dark:text-red-400">{d.error}</p>}
                    {(() => {
                      const report = reportOf(d)
                      const keys = failedKeys(d)
                      return (
                        <>
                          {report ? keys.map((c) => (
                            <p key={c} className="text-sm text-amber-700 dark:text-amber-400 mb-1">
                              <span className="font-medium">{report.checks[c].label}</span>
                              {' — '}{report.entries.find((e) => e.check === c && e.status === 'failed')?.message ?? `${report.checks[c].failed} failed`}
                            </p>
                          )) : d.failed.map((label) => <p key={label} className="text-sm font-medium text-amber-700 dark:text-amber-400 mb-1">{label}</p>)}
                          {!bad && <p className="text-sm text-zinc-600 dark:text-zinc-400">Every check passed.</p>}
                          {!d.reportId && d.detail}
                          {d.reportId && (
                            <div className="mt-3 flex gap-2">
                              {keys.length > 0 && <button type="button" className={btnOutline} onClick={() => setViewing({ name: d.name, check: keys[0] })}>View the images</button>}
                              <a className={btnOutline} href={api.reportUrl(d.reportId, 'csv')} download>Download report</a>
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </div>
                )}
              </div>
            )
          })}
          {shown.length === 0 && <p className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">No deployment has problems.</p>}
        </div>
      )}
    </div>
  )
}
