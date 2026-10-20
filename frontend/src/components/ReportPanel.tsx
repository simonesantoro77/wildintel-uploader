import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Report } from '../types'
import { btnOutline } from '../pages/ImportDeploymentPage'

/** How many of the failures are listed before "Show all". */
const SHOWN = 100

/** A report of a validation, postvalidation or preprocessing, as it was kept: what was checked, which images failed
 * which check and why — and the files to download it to look at in detail. */
export default function ReportPanel({ reportId }: { reportId: string }) {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [check, setCheck] = useState('')
  const [all, setAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    setReport(null); setError(null); setCheck(''); setAll(false)
    api.getReport(reportId)
      .then((r) => { if (!cancelled) setReport(r) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not read the report.') })
    return () => { cancelled = true }
  }, [reportId])

  if (error) return <p className="text-sm text-red-600 dark:text-red-400 mt-3">{error}</p>
  if (!report) return <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-3">Reading the report…</p>

  const failures = report.entries.filter((e) => e.status === 'failed' && (!check || e.check === check))
  const shown = all ? failures : failures.slice(0, SHOWN)
  const checks = Object.entries(report.checks)

  return (
    <section aria-label="Report" className="mt-4 rounded border border-zinc-200 dark:border-zinc-700 p-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Report</h4>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {report.checked} {report.kind === 'upload' ? 'deployment(s)' : 'image(s)'} — {report.totals.failed === 0 ? 'nothing failed' : `${report.totals.failed} problem(s)`}
          </p>
        </div>
        <div className="flex gap-2">
          <a className={`${btnOutline} no-underline !px-3 !py-1.5`} href={api.reportUrl(report.id, 'csv')} download>Download CSV</a>
          <a className={`${btnOutline} no-underline !px-3 !py-1.5`} href={api.reportUrl(report.id, 'json')} download>Download JSON</a>
        </div>
      </div>

      <table className="mt-3 w-full text-xs">
        <thead>
          <tr className="text-left text-zinc-500 dark:text-zinc-400">
            <th className="py-1 font-medium">Check</th><th className="py-1 font-medium text-right">Passed</th><th className="py-1 font-medium text-right">Failed</th>
          </tr>
        </thead>
        <tbody>
          {checks.map(([name, c]) => (
            <tr key={name} className="border-t border-zinc-200 dark:border-zinc-800">
              <td className="py-1">{c.label}{c.scope === 'deployment' && <span className="text-zinc-400 dark:text-zinc-500"> (deployment)</span>}</td>
              <td className="py-1 text-right">{c.ok}</td>
              <td className={`py-1 text-right ${c.failed ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}`}>{c.failed}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {report.totals.failed > 0 && (
        <div className="mt-3">
          <label className="text-xs text-zinc-500 dark:text-zinc-400 mr-2" htmlFor={`report-check-${report.id}`}>Show</label>
          <select id={`report-check-${report.id}`} aria-label="Check to show" className="text-xs rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2 py-1"
                  value={check} onChange={(e) => { setCheck(e.target.value); setAll(false) }}>
            <option value="">every check ({report.totals.failed})</option>
            {checks.filter(([, c]) => c.failed > 0).map(([name, c]) => <option key={name} value={name}>{c.label} ({c.failed})</option>)}
          </select>
          <div className="mt-2 max-h-72 overflow-y-auto rounded border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-800 text-left text-zinc-500 dark:text-zinc-400">
                <tr><th className="px-2 py-1 font-medium">{report.kind === 'upload' ? 'Deployment' : 'Image'}</th><th className="px-2 py-1 font-medium">Check</th><th className="px-2 py-1 font-medium">What failed</th></tr>
              </thead>
              <tbody>
                {shown.map((e, i) => (
                  <tr key={`${e.identifier}|${e.check}|${i}`} className="border-t border-zinc-200 dark:border-zinc-800 align-top">
                    <td className="px-2 py-1 font-mono break-all">{e.identifier}</td>
                    <td className="px-2 py-1">{report.checks[e.check]?.label ?? e.check}</td>
                    <td className="px-2 py-1 text-amber-700 dark:text-amber-400">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!all && failures.length > SHOWN && (
            <button type="button" className="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline" onClick={() => setAll(true)}>Show all {failures.length}</button>
          )}
        </div>
      )}
    </section>
  )
}
