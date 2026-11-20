import { useEffect, useState } from 'react'
import { api } from '../api'
import { formatLocal } from '../dateFormat'
import { btnOutline } from '../pages/ImportDeploymentPage'
import { ActiveFilters, TABLE, TableCard, TableFooter, TableToolbar } from './DashboardParts'
import SidePanel from './SidePanel'

const PER_PAGE = 8

const PHOTO_ICON = (
  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="M21 16l-5-5-8 8" /></svg>
)

/** A photo of the deployment, or a placeholder when it can't be shown. */
function Photo({ project, collection, deployment, name, size, className }: { project: string; collection: string; deployment: string; name: string; size: 'thumb' | 'large'; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <div aria-label="No preview" className={`flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-400 dark:text-zinc-500 ${className ?? ''}`}>no preview</div>
  return <img src={api.deploymentPhotoUrl(project, collection, deployment, name, size)} alt={name} loading="lazy" onError={() => setFailed(true)} className={`bg-zinc-100 dark:bg-zinc-800 object-cover ${className ?? ''}`} />
}

/** The photos of a created deployment, to look at them, in a panel at the right: a grid of thumbnails, and each one big — with the arrows to go to the one before and the one after. */
export default function DeploymentPhotos({ researchProjectId, collection, deploymentId, timezone, onClose }: { researchProjectId: string; collection: string; deploymentId: string; timezone?: string | null; onClose: () => void }) {
  const [photos, setPhotos] = useState<{ name: string; taken: string | null }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<number | null>(null)
  const [text, setText] = useState('')
  useEffect(() => {
    let cancelled = false
    api.deploymentPhotos(researchProjectId, collection, deploymentId)
      .then(({ photos }) => { if (!cancelled) setPhotos(photos) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not read the images.') })
    return () => { cancelled = true }
  }, [researchProjectId, collection, deploymentId])
  useEffect(() => {
    if (open === null || !photos) return
    const go = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setOpen((i) => (i === null ? i : Math.min(photos.length - 1, i + 1)))
      if (e.key === 'ArrowLeft') setOpen((i) => (i === null ? i : Math.max(0, i - 1)))
    }
    window.addEventListener('keydown', go)
    return () => window.removeEventListener('keydown', go)
  }, [open, photos])

  const needle = text.trim().toLowerCase()
  const found = (photos ?? []).filter((p) => !needle || `${p.name} ${p.taken ? formatLocal(p.taken, timezone) : ''}`.toLowerCase().includes(needle))
  const pages = Math.max(1, Math.ceil(found.length / PER_PAGE))
  const current = Math.min(page, pages)
  const visible = found.slice((current - 1) * PER_PAGE, current * PER_PAGE)
  const shown = open !== null && photos ? photos[open] : null
  const taken = (t: string | null) => (t ? formatLocal(t, timezone) : 'date unknown')

  return (
    <SidePanel label={`Images of the deployment ${deploymentId}`} title={deploymentId} icon={PHOTO_ICON}
      subtitle={photos ? `${photos.length.toLocaleString('en-US')} ${photos.length === 1 ? 'image' : 'images'}` : undefined} onClose={onClose}>
      {error ? <p role="alert" className="mt-6 text-sm text-amber-700 dark:text-amber-400">{error}</p>
        : photos === null ? <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">Reading the images…</p>
        : photos.length === 0 ? <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">This deployment has no images in its folder.</p>
        : shown ? (
          <div className="mt-6">
            <Photo project={researchProjectId} collection={collection} deployment={deploymentId} name={shown.name} size="large" className="w-full max-h-[28rem] rounded-xl border border-zinc-200 dark:border-zinc-700 object-contain" />
            <p className="mt-3 font-mono text-sm break-all text-zinc-900 dark:text-zinc-100">{shown.name}</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{taken(shown.taken)}</p>
            <div className="mt-4 flex items-center justify-between gap-2">
              <button type="button" className={`${btnOutline} !px-3 !py-1.5`} aria-label="Previous image" disabled={open === 0} onClick={() => setOpen(open! - 1)}>‹ Previous</button>
              <button type="button" className={`${btnOutline} !px-3 !py-1.5`} onClick={() => { setPage(Math.floor(open! / PER_PAGE) + 1); setOpen(null) }}>Back to the images</button>
              <button type="button" className={`${btnOutline} !px-3 !py-1.5`} aria-label="Next image" disabled={open === photos.length - 1} onClick={() => setOpen(open! + 1)}>Next ›</button>
            </div>
            <p className="mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400">{open! + 1} of {photos.length}</p>
          </div>
        ) : (
          <div className="mt-6">
            <TableCard label="Images">
              <TableToolbar searchLabel="Search the images" placeholder="Search by file name or date…" text={text} onText={(t) => { setText(t); setPage(1) }} onReset={() => { setText(''); setPage(1) }} />
              {needle && <ActiveFilters filters={[{ label: `Search: ${text.trim()}`, tone: 'blue' }]} summary={`${found.length} of ${photos.length} images match`} />}
              <div className="overflow-x-auto">
                <table aria-label="Images" className={TABLE.table}>
                  <thead className={TABLE.head}>
                    <tr><th scope="col" className={TABLE.th}>Image</th><th scope="col" className={TABLE.th}>File</th><th scope="col" className={TABLE.th}>Taken</th><th scope="col" className={TABLE.th}><span className="sr-only">Open</span></th></tr>
                  </thead>
                  <tbody className={TABLE.body}>
                    {visible.length === 0 && <tr><td colSpan={4} className={`${TABLE.cell} text-zinc-500 dark:text-zinc-400`}>No image matches.</td></tr>}
                    {visible.map((p) => {
                      const index = photos.indexOf(p)
                      return (
                        <tr key={p.name} className={TABLE.row(false)}>
                          <td className={TABLE.cell}>
                            <button type="button" aria-label={`Open the image ${p.name}`} onClick={() => setOpen(index)} className="block overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-blue-500">
                              <Photo project={researchProjectId} collection={collection} deployment={deploymentId} name={p.name} size="thumb" className="h-12 w-16" />
                            </button>
                          </td>
                          <td className={`${TABLE.cell} font-mono text-xs break-all`}>{p.name}</td>
                          <td className={`${TABLE.cell} font-mono text-xs`}>{taken(p.taken)}</td>
                          <td className={`${TABLE.cell} text-right`}>
                            <button type="button" aria-label={`View the image ${p.name}`} title="View the image" onClick={() => setOpen(index)}
                                    className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></svg>
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <TableFooter from={found.length === 0 ? 0 : (current - 1) * PER_PAGE + 1} to={Math.min(current * PER_PAGE, found.length)} total={found.length} noun="images" page={current} pages={pages} onPage={setPage} />
            </TableCard>
          </div>
        )}
    </SidePanel>
  )
}
