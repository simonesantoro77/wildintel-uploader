import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { Report } from '../types'
import CheckFailures from './CheckFailures'
import { StatusIcon } from './Notice'
import { SmallSpinner, btnOutline, btnPrimary } from '../pages/ImportDeploymentPage'

export interface DashboardContext {
  report: Report | null
  /** The check whose failures are open, if any. */
  openCheck: string | null
  open: (check: string) => void
}

export const formatRun = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function Kpi({ icon, tone, value, label }: { icon: 'success' | 'warning' | 'info'; tone: string; value: number | string; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
      <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tone}`}><StatusIcon kind={icon} className="h-5 w-5" /></span>
      <div>
        <p className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-100">{typeof value === 'number' ? value.toLocaleString() : value}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      </div>
    </div>
  )
}

function Figure({ tone, value, label }: { tone: string; value: number; label: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-4 py-3">
      <p className={`text-2xl font-bold leading-tight ${tone}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
    </div>
  )
}

/** The validation as a dashboard: what it was run on and when, how many images are fine, the checks with how each ended — and,
 * opened from one, the images that failed it. The table of checks is the page's (it has the choosing of them): it goes in `children`. */
export default function ValidationDashboard({ title, subtitle, reportId, running, canRun, onRun, runLabel = 'Run validation', runningLabel = 'Validating…', preprocessing = false, variant = 'classic', lastRunLine = false, onReport, children }: {
  title: string
  subtitle: string
  /** The report of the last run, once there is one. */
  reportId: string | null
  running: boolean
  canRun: boolean
  onRun: () => void
  runLabel?: string
  runningLabel?: string
  /** The report is of a preprocessing: its figures are the images processed and skipped, not tests. */
  preprocessing?: boolean
  /** 'steps': the look of the import steps — the figures as plain numbers, and no header: the step has the run and the report. */
  variant?: 'classic' | 'steps' | 'headed'
  /** With the 'steps' variant: the subtitle, when it was last run and the report to download, as a line above the figures. */
  lastRunLine?: boolean
  /** Told the report once it is read (null while there is none). */
  onReport?: (report: Report | null) => void
  children: (context: DashboardContext) => ReactNode
}) {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openCheck, setOpenCheck] = useState<string | null>(null)

  useEffect(() => {
    setOpenCheck(null)
    if (!reportId) { setReport(null); setError(null); onReport?.(null); return }
    let cancelled = false
    api.getReport(reportId)
      .then((r) => { if (!cancelled) { setReport(r); setError(null); onReport?.(r) } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not read the report.') })
    return () => { cancelled = true }
  }, [reportId])

  const checks = report ? Object.values(report.checks) : []
  const withIssues = report?.totals.images_with_issues ?? 0
  const shown = report && !running ? report : null

  if (variant === 'headed') {
    const nChecks = checks.length
    const withProblems = checks.filter((c) => c.failed > 0).length
    return (
      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
          <div className="flex items-center gap-3 min-w-0">
            <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.500-7-10V6z" /><path d="M9 12l2 2 4-4" /></svg>
            </span>
            <div className="min-w-0">
              <h5 className="text-base font-semibold font-mono text-zinc-900 dark:text-zinc-100 break-all">{title}</h5>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {subtitle}
                {report && <> · last run {formatRun(report.created_at)} · <a className="font-medium text-blue-600 dark:text-blue-400 hover:underline" href={api.reportUrl(report.id, 'csv')} download>Download report</a></>}
              </p>
            </div>
          </div>
          <button type="button" className={`${report ? btnOutline : btnPrimary} flex items-center gap-2`} disabled={running || !canRun} onClick={onRun}>
            {running ? <SmallSpinner /> : <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current"><path d="M6 4l14 8-14 8z" /></svg>}{running ? runningLabel : runLabel}
          </button>
        </div>

        {shown && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4" aria-label="Summary">
            <Figure tone="text-emerald-600 dark:text-emerald-400" value={Math.max(0, shown.checked - withIssues)} label="Valid images" />
            <Figure tone="text-amber-600 dark:text-amber-400" value={withIssues} label={withIssues === 1 ? 'Image with issues' : 'Images with issues'} />
            <Figure tone="text-zinc-900 dark:text-zinc-100" value={nChecks} label="Checks run" />
            <Figure tone="text-amber-600 dark:text-amber-400" value={withProblems} label={withProblems === 1 ? 'Check with problems' : 'Checks with problems'} />
          </div>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}

        {children({ report: shown, openCheck, open: (check) => setOpenCheck((current) => (current === check ? null : check)) })}

        {shown && openCheck && shown.checks[openCheck] && <CheckFailures report={shown} check={openCheck} parent={title} onBack={() => setOpenCheck(null)} />}
      </div>
    )
  }

  if (variant === 'steps') {
    return (
      <div>
        {lastRunLine && subtitle && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400 -mt-3 mb-4">
            {subtitle}
            {shown && <> · last run {formatRun(shown.created_at)} · <a className="font-medium text-blue-600 dark:text-blue-400 hover:underline" href={api.reportUrl(shown.id, 'csv')} download>Download report</a></>}
          </p>
        )}
        {shown && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4" aria-label="Summary">
            {preprocessing ? (
              <>
                <Figure tone="text-zinc-900 dark:text-zinc-100" value={shown.checked} label="Images" />
                <Figure tone="text-emerald-600 dark:text-emerald-400" value={Math.max(0, shown.checked - withIssues)} label="Images processed" />
                <Figure tone="text-amber-600 dark:text-amber-400" value={withIssues} label="Images skipped" />
                <Figure tone="text-zinc-900 dark:text-zinc-100" value={2 + (['rename', 'resize', 'metadata'] as const).filter((step) => shown.parameters[step] === true).length} label="Steps done" />
              </>
            ) : (
              <>
                <Figure tone="text-emerald-600 dark:text-emerald-400" value={Math.max(0, shown.checked - withIssues)} label="Valid images" />
                <Figure tone="text-amber-600 dark:text-amber-400" value={withIssues} label="Images with issues" />
                <Figure tone="text-zinc-900 dark:text-zinc-100" value={checks.length} label="Checks run" />
                <Figure tone="text-amber-600 dark:text-amber-400" value={checks.filter((c) => c.failed > 0).length} label="With problems" />
              </>
            )}
          </div>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}

        {children({ report: shown, openCheck, open: (check) => setOpenCheck((current) => (current === check ? null : check)) })}

        {shown && openCheck && shown.checks[openCheck] && <CheckFailures report={shown} check={openCheck} parent={title} onBack={() => setOpenCheck(null)} />}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/40 text-xl">🛡️</span>
          <div>
            <h5 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h5>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 break-all">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {report && <span className="text-xs text-zinc-500 dark:text-zinc-400">Last run: {formatRun(report.created_at)}</span>}
          {report && (
            <span className="flex gap-2 text-xs">
              <a className="text-blue-600 dark:text-blue-400 hover:underline" href={api.reportUrl(report.id, 'csv')} download>Download CSV</a>
              <a className="text-blue-600 dark:text-blue-400 hover:underline" href={api.reportUrl(report.id, 'json')} download>Download JSON</a>
            </span>
          )}
          <button type="button" className={`${report ? btnOutline : btnPrimary} flex items-center gap-2`} disabled={running || !canRun} onClick={onRun}>
            {running ? <SmallSpinner /> : <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current"><path d="M6 4l14 8-14 8z" /></svg>}{running ? runningLabel : runLabel}
          </button>
        </div>
      </div>

      {shown && (preprocessing ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4" aria-label="Summary">
          <Kpi icon="info" tone="bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400" value={shown.checked} label="Images" />
          <Kpi icon="success" tone="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400" value={Math.max(0, shown.checked - withIssues)} label="Images processed" />
          <Kpi icon="warning" tone="bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400" value={withIssues} label="Images skipped" />
          <Kpi icon="info" tone="bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400" value={2 + (['rename', 'resize', 'metadata'] as const).filter((step) => shown.parameters[step] === true).length} label="Steps done" />
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4" aria-label="Summary">
          <Kpi icon="success" tone="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400" value={Math.max(0, shown.checked - withIssues)} label="Valid images" />
          <Kpi icon="warning" tone="bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400" value={withIssues} label="Images with issues" />
          <Kpi icon="info" tone="bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400" value={checks.length} label="Tests executed" />
          <Kpi icon="warning" tone="bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400" value={checks.filter((c) => c.failed > 0).length} label="Tests with errors" />
        </div>
      ))}
      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}

      {children({ report: shown, openCheck, open: (check) => setOpenCheck((current) => (current === check ? null : check)) })}

      {shown && openCheck && shown.checks[openCheck] && <CheckFailures report={shown} check={openCheck} parent={title} onBack={() => setOpenCheck(null)} />}
    </div>
  )
}
