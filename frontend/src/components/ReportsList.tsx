import { useEffect, useState } from 'react'
import { api } from '../api'
import ReportPanel from './ReportPanel'
import type { ReportKind, ReportSummary } from '../types'
import { btnOutline } from '../pages/ImportDeploymentPage'

const KIND_LABELS: Record<ReportKind, string> = { validation: 'Validation', postvalidation: 'Postvalidation', preprocessing: 'Preprocessing', repair: 'Repair', upload: 'Upload' }

const formatDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** The reports the validations, postvalidations, preprocessings and repairs left: to look at again, download or delete. */
export default function ReportsList() {
  const [reports, setReports] = useState<ReportSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  useEffect(() => {
    api.listReports().then(setReports).catch((e) => setError(e instanceof Error ? e.message : 'Could not read the reports.'))
  }, [])

  async function handleDelete(id: string) {
    try {
      await api.deleteReport(id)
      setReports((list) => (list ?? []).filter((r) => r.id !== id))
      if (open === id) setOpen(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the report.')
    } finally {
      setConfirming(null)
    }
  }

  return (
    <div className="py-3">
      <p className="text-zinc-500 dark:text-zinc-400 mb-5 text-sm">
        Every validation, postvalidation, preprocessing, repair and upload leaves a report of what was checked and done — image by image, or deployment by deployment for an upload. Look at one again, download it
        (a CSV opens in a spreadsheet; the JSON has everything), or delete the ones you no longer need.
      </p>
      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
      {reports === null && !error && <p className="text-sm text-zinc-500 dark:text-zinc-400">Reading the reports…</p>}
      {reports?.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">There are no reports yet — they are made when you validate or import images.</p>}
      <ul className="space-y-3">
        {(reports ?? []).map((r) => (
          <li key={r.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4" aria-label={r.title}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  <span className="mr-2 text-xs font-medium px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">{KIND_LABELS[r.kind]}</span>{r.title}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {formatDate(r.created_at)} · {r.checked} {r.kind === 'upload' ? 'deployment(s)' : 'image(s)'} · {r.totals.failed === 0 ? 'nothing failed' : <span className="text-amber-600 dark:text-amber-400">{r.totals.failed} problem(s)</span>}
                </p>
                {r.source_dir && <p className="text-xs text-zinc-400 dark:text-zinc-500 font-mono break-all mt-0.5">{r.source_dir}</p>}
              </div>
              <div className="flex gap-2 items-center">
                <button type="button" className={`${btnOutline} !px-3 !py-1.5`} aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'View'}</button>
                <a className={`${btnOutline} no-underline !px-3 !py-1.5`} href={api.reportUrl(r.id, 'csv')} download>CSV</a>
                <a className={`${btnOutline} no-underline !px-3 !py-1.5`} href={api.reportUrl(r.id, 'json')} download>JSON</a>
                {confirming === r.id
                  ? <button type="button" className="px-3 py-1.5 text-sm rounded bg-red-600 text-white hover:bg-red-700" onClick={() => handleDelete(r.id)}>Delete it</button>
                  : <button type="button" className={`${btnOutline} !px-3 !py-1.5`} onClick={() => setConfirming(r.id)}>Delete</button>}
              </div>
            </div>
            {open === r.id && <ReportPanel reportId={r.id} />}
          </li>
        ))}
      </ul>
    </div>
  )
}
